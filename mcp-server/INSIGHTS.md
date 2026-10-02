# Insights — mcp-server

Running log of non-obvious things learned while working in `@devdigest/mcp-server`:
gotchas, dead ends, decisions that don't belong in the fixed map in
[`../CLAUDE.md`](../CLAUDE.md). Newest entries at top.

<!-- Add entries below, e.g.:
## 2026-09-15 — short title
What happened, what was tried, what actually worked or didn't, and why.
-->

## 2026-10-01 — `devdigest_get_blast_radius` contract corrected: no LLM summary, grouped downstream [Correction]
The 5-tool port below is still valid as wiring (tool → `resolvePullId` → `http/client.ts` → `GET /pulls/:id/blast`), but the blast contract/summary logic it was ported with was wrong — see `server/INSIGHTS.md`'s 2026-10-01 entry for the full story. In short: `@devdigest/shared` now exports `BlastRadiusResponse` (not `BlastRadiusResult`) — `downstream` groups callers by changed symbol instead of a flat `callers[]` list, and `summary` is a plain computed string (the server never calls a model for it). `mcp-server/src/http/client.ts` and `README.md`'s tools table were updated to match; `get-blast-radius.ts` itself needed no logic change since it just forwards whatever the HTTP client returns.

## 2026-09-29 — `ConventionCandidate.status` is a tri-state enum, not a boolean [Context]
This repo's `ConventionCandidate` contract (`server/src/vendor/shared/contracts/knowledge.ts:181-194`) carries `status: 'pending'|'accepted'|'rejected'`, unlike the course reference implementation this package was ported from, which had a plain `accepted: boolean`. `compactConvention` (`src/format.ts:88-104`) surfaces `status` directly rather than deriving a boolean, and `devdigest_get_conventions`'s description/output was adjusted to match (`src/tools/get-conventions.ts`). Anyone porting more tools from the reference repo should diff every contract field against this repo's actual `@devdigest/shared` before assuming field-for-field parity.

## 2026-09-29 — `pnpm install` under a fresh package needs `pnpm approve-builds` before it succeeds [Context]
First `pnpm install` in this brand-new package failed with `ERR_PNPM_IGNORED_BUILDS` (esbuild's postinstall, a transitive dep of `tsx`, was blocked). `pnpm approve-builds esbuild` resolved it and wrote `pnpm-workspace.yaml` with an `allowBuilds: { esbuild: true }` block — that file is just the build-approval record, not an actual pnpm workspace definition; it doesn't conflict with the repo's "not a monorepo workspace" convention in root `CLAUDE.md`.

## 2026-09-29 — Full 5-tool MCP server ported and verified end-to-end against the live dev stack [Decision]
Ported verbatim from `dev-digest-original`'s finished `lesson-4-lab/mcp-finish` branch (not its earlier stub-only commit) so `devdigest_get_blast_radius` (`src/tools/get-blast-radius.ts`) is a real, working tool from day one rather than a placeholder — this required also adding `server/src/modules/blast/` (see `server/INSIGHTS.md`). Verified via `scripts/call.mjs` against the running `./scripts/dev.sh` stack: `list_agents`, `get_conventions`, `get_findings`, `get_blast_radius` (both a real repo/pr and an unknown-repo error path), and a full `run_agent_on_pr` trigger→poll→findings round trip all returned correct, well-formed results.
