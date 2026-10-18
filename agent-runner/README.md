# @devdigest/agent-runner

The **DevDigest CI runner** — a standalone CLI that runs a DevDigest review agent
inside a *target repository's own CI* (GitHub Actions), entirely outside this
repo's server, its DI graph, and its Postgres instance.

`src/index.ts` is `ncc`-bundled into a single self-contained `dist/index.js`,
embedded as `.devdigest/runner/index.js` in the exported `devdigest/ci` PR, and
executed by the target repo's workflow as `node .devdigest/runner/index.js`.

## What it does

1. **Loads + validates** the manifest of the agent the workflow names
   (`DEVDIGEST_AGENT` → `.devdigest/agents/<slug>.yaml`; a repo may hold several
   exported agents), its skill bodies `.devdigest/skills/*.md`, and the optional
   repo memory `.devdigest/memory.jsonl` (validated against `AgentManifest` /
   `MemoryRecord` before use; invalid memory lines are skipped).
2. **Resolves the PR context** (owner / repo / number / title / body / fork flag)
   from CI env vars + the `pull_request` event payload.
3. **Fetches the PR diff** via the GitHub REST API (native `fetch`, no octokit)
   and strips DevDigest's own exported files (`.devdigest/**`, the generated
   workflow) before parsing.
4. **Runs the exact same `reviewer-core` pipeline** a local studio review uses —
   `assemblePrompt` / `wrapUntrusted` / `completeStructured` / mandatory
   `groundFindings` gate — via `reviewPullRequest`, with an injected
   `OpenRouterProvider` (model id `model` for openrouter agents, else
   `<provider>/<model>`). Memory records are fenced as `<untrusted>`.
5. **Computes a deterministic verdict** from the *grounded* findings + the
   manifest's `ci_fail_on` (`countBlockers` / `gateTriggered`), never from the
   model's self-reported verdict.
6. **Writes `devdigest-result.json`** (`CiResultArtifact`) — the artifact the
   studio ingests, with provenance (agent slug + version, manifest SHA-256,
   model, runner/reviewer-core/node versions, repo, commit, workflow run id) —
   then **posts** to the PR (`github_review` | `pr_comment` | `none`). A publish
   failure is logged and changes nothing else.

All orchestration lives in `src/run.ts` (`runCi`), which takes every side effect
(fs, `fetch`, LLM provider, clock, diff retrieval) as an injectable dependency so
it can be unit-tested hermetically. `src/index.ts` only wires those to the real
world and maps the result onto `process.exitCode`.

## Requirements — sibling source packages

This package is **not fully self-contained on its own**. It consumes
`reviewer-core` and the shared Zod contracts **as raw TypeScript source** via
`tsconfig.json` path aliases (exactly like the server does — this is intended,
not a workaround; `reviewer-core` emits no JS). To typecheck, test, or build the
runner, these folders **must exist as siblings** in the expected layout:

```
<repo-root>/
├── agent-runner/                      # this package
│   └── tsconfig.json                  # declares the aliases below
├── reviewer-core/
│   └── src/index.ts                   # → @devdigest/reviewer-core
└── server/
    └── src/vendor/shared/
        └── index.ts                   # → @devdigest/shared
```

Path aliases declared in `agent-runner/tsconfig.json`:

| Alias | Resolves to |
|-------|-------------|
| `@devdigest/reviewer-core` | `../reviewer-core/src/index.ts` |
| `@devdigest/reviewer-core/*` | `../reviewer-core/src/*` |
| `@devdigest/shared` | `../server/src/vendor/shared/index.ts` |
| `@devdigest/shared/*` | `../server/src/vendor/shared/*` |

If you lift this module onto a fresh branch or repo, bring `reviewer-core/` and
`server/src/vendor/shared/` along (or re-point the aliases). `pnpm build` (`ncc`)
inlines both packages plus their transitive deps into `dist/index.js`, so the
**shipped bundle** has zero runtime imports from `node_modules/@devdigest/*` — the
sibling requirement is a **build/dev-time** requirement only.

## Commands

```bash
pnpm install        # install deps (yaml, zod + dev tooling)
pnpm typecheck      # tsc --noEmit -p tsconfig.json
pnpm test           # vitest run (hermetic; LLM stubbed, no network)
pnpm build          # ncc build src/index.ts -o dist  →  dist/index.js
```

`dist/` and `node_modules/` are git-ignored — `dist/index.js` is a generated
artifact, regenerate it with `pnpm build`.

## Runtime environment (set by the target repo's workflow)

The runner reads these directly from `process.env`. This is the **correct and
only** channel for secrets here: the bundle runs in someone else's CI, where
there is no `SecretsProvider` / DI graph to inject from (see `CLAUDE.md`).

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENROUTER_API_KEY` | yes | LLM credential → `OpenRouterProvider` |
| `GITHUB_TOKEN` | yes | fetch the diff + post the review/comment |
| `GITHUB_REPOSITORY` | yes | `owner/name` of the target repo |
| `DEVDIGEST_AGENT` | yes | slug of the agent to run (`.devdigest/agents/<slug>.yaml`) |
| `DEVDIGEST_PR_NUMBER` | yes¹ | PR to review |
| `DEVDIGEST_HEAD_SHA` | yes¹ | head commit reviewed (recorded in the artifact) |
| `DEVDIGEST_WORKFLOW_RUN_ID` | yes² | Actions run id (recorded in the artifact) |
| `GITHUB_EVENT_PATH` | auto (GHA) | `pull_request` event payload (title/body/fork) |
| `DEVDIGEST_DIR` | no | override the `.devdigest` dir (default: `cwd/.devdigest`) |
| `DEVDIGEST_RESULT_PATH` | no | override artifact path (default: `cwd/devdigest-result.json`) |
| `DEVDIGEST_POST_AS` | no | `github_review` (default) \| `pr_comment` \| `none` |

¹ Falls back to `pull_request.number` / `pull_request.head.sha` from the event payload.
² Falls back to `GITHUB_RUN_ID`.

The generated workflow (`server/src/modules/ci/workflow.ts`) sets all of these.

Secrets are never logged and never written to `devdigest-result.json` or any
posted comment.

## Exit codes

- `0` — review completed; the deterministic gate did **not** request changes.
- `1` — review completed; the gate triggered `REQUEST_CHANGES`.
- `2` — could not complete a review. Nothing is posted, never a synthetic review:
  - **pre-flight** (unresolvable CI context or agent slug, missing/invalid
    manifest, missing skill file, no `GITHUB_TOKEN`) → no LLM call, **no artifact**;
  - **afterwards** (missing `OPENROUTER_API_KEY`, diff fetch, LLM call, internal
    error) → a `status: "failed"` artifact with `error_category`
    (`missing_secret` | `github` | `llm` | `internal`), so the studio records it.

## Invariants (do not break)

Because this package embeds `reviewer-core`'s pipeline into an artifact that
leaves this repo, it must preserve every reviewer-core invariant:

- The `groundFindings()` gate is mandatory — never skip or make it conditional.
  An all-dropped result is a valid zero-finding APPROVE, not an error.
- `wrapUntrusted()` + `INJECTION_GUARD` must wrap the diff and PR body before they
  reach the prompt — reuse `assemblePrompt`; never hand-roll it.
- The posted verdict and exit code come from the **deterministic** gate against
  the manifest's `ci_fail_on`, never the model's self-reported verdict.

See `CLAUDE.md` for the full rationale and `insights/INSIGHTS.md` for gotchas.
