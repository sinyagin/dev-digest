# Insights — reviewer-core

Running log of non-obvious things learned while working in
`@devdigest/reviewer-core`: gotchas, dead ends, decisions that don't belong in
the fixed map in [`CLAUDE.md`](CLAUDE.md). Newest entries at top.

<!-- Add entries below, e.g.:
## 2026-09-15 — short title
What happened, what was tried, what actually worked or didn't, and why.
-->

## 2026-09-27 — `INJECTION_GUARD` named "derived intent/scope" as untrusted before `PromptParts` had an `intent` field [Pattern]
When wiring a new `intent?: string` slot into `PromptParts`/`ReviewInput` (`src/prompt.ts:61-67`, `src/review/run.ts:65-68`), the trust-model text in `INJECTION_GUARD` (`src/prompt.ts:16-18`) already listed "derived intent/scope" among untrusted content types — written in anticipation of a field that didn't exist yet. This confirms `CLAUDE.md`'s note that this engine "accepts prompt slots the course lessons feed later" is a real, load-bearing convention, not just a comment: when adding a new slot, check `INJECTION_GUARD`'s prose first — it may already specify the exact trust treatment (wrap via `wrapUntrusted`, never treat as instructions) the new field must follow, saving a design decision.
