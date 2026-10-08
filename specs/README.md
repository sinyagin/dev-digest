# specs — Spec-Driven Development specifications

This is the one place every DevDigest spec lives, grouped by scope:

| Scope | Location |
|-------|----------|
| `server` only | `specs/server/` |
| `client` only | `specs/client/` |
| `reviewer-core` only | `specs/reviewer-core/` |
| `e2e` only | `specs/e2e/` |
| **cross-module (≥ 2 modules)** | `specs/cross-module/` |

Not to be confused with `e2e/specs/*.flow.json` — those are browser
test-flow fixtures run by `e2e/run.ts`, unrelated to this directory.

## What a spec is

Specs are authored by the **`spec-creator`** agent
(`.claude/agents/spec-creator.md`).

A spec describes **what** a feature must do and **why** — the problem,
goals / non-goals, user stories, EARS acceptance criteria, edge cases,
cross-module interactions, and contracts. It deliberately stops short of
**how** to implement it (file-by-file tasks, layers, code) — that is the
`implementation-planner` agent's Implementation Plan (`docs/plans/`). The
intended chain is:

```
spec-creator → spec (WHAT/WHY) → implementation-planner → plan (HOW) → implementer → code
```

## Conventions

- **File name:** `SPEC-NN-<kebab-feature-name>.md`
- **Spec ID** (in the header line): `SPEC-NN`
- **`NN` is one running counter across this whole `specs/` tree** — before
  writing, glob `specs/**/SPEC-*.md`, take the highest `NN`, use `NN + 1`.
- **Status lifecycle:** `draft` → `approved` → `implemented`
- **Language:** specs are written in English (aligned with the rest of the
  repo docs), regardless of what language the request came in.

A spec that replaces an earlier decision links it via the `Supersedes:`
header line.
