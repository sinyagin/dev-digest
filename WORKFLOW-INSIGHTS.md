# Workflow Insights

Running log of retrospectives on multi-agent workflows — **not** the same as
the per-package `INSIGHTS.md` code-insights logs (`server/`, `client/`,
`reviewer-core/`, `e2e/`, `mcp-server/`). Those capture what was learned
about the *code*; this one captures what was learned about the *process* —
how dispatched agents actually performed in a given workflow: how many ran,
in what order, at what token cost, what tripped them up, and what a future
dispatch should do differently. A root-level file is intentional here (see
`.claude/skills/workflow-insights/SKILL.md`) — this is a single, repo-wide
concern with no per-package ambiguity, unlike code insights.

Captured via the `workflow-insights` skill (`/workflow-insights`), invoked
manually after a session that dispatched several `Agent` calls toward one
goal. Newest entries at top.

<!-- Add entries below, e.g.:
## 2026-10-04 — short workflow label
**Workflow:** what was being accomplished
**Agents:** N dispatched — type ×count @ model — P parallel batches, R resumes
**Tokens:** session ≈ Xk (per-agent breakdown)
**Duration:** wall-clock ≈ Xm
**Friction:** resume/correction summary, or "none"
**Self-reported insights:** per agent, or "not collected this run"
**Recommendations:** concrete, actionable prompt/agent-definition changes
-->

## 2026-10-04 — SPEC-01 project-context spec + workflow-insights skill design
**Workflow:** two back-to-back goals in one session — (1) author
`specs/cross-module/SPEC-01-project-context.md`, grounding it in both this
repo's gaps and a sibling reference repo's shipped implementation, then
resolve 3 self-raised blocking questions and remove a provenance defect the
user caught; (2) design and build this `workflow-insights` skill itself,
dry-run included.
**Agents:** 4 dispatched — 2× `Explore` @ model not stated in dispatch (1
parallel batch), 1× `spec-creator` @ opus (3 invocations: 1 dispatch + 2
resumes), 1× `Explore` @ model not stated in dispatch (solo, later) — 2
parallel batches total (the first Explore pair together; each other call
solo), 2 resumes (both on `spec-creator`).
**Tokens:** session ≈ 372k — Explore (repo gap scan): 68.6k; Explore
(sibling repo scan): 72.3k; `spec-creator` final cumulative after both
resumes: 109.4k (not 97.0k + 100.3k + 109.4k summed — each resume
notification is a running total, per this skill's own rule); Explore
(skill/insights conventions): 69.3k; plus orchestrator's own estimated
consumption ≈ 52k (from `<total_tokens>` budget delta across the session).
**Duration:** agent-busy wall-clock ≈ 16m (parallel Explore batch ≈ 2.7m,
`spec-creator` dispatch ≈ 7.0m, resume 1 ≈ 0.5m, resume 2 ≈ 4.1m, later
Explore ≈ 1.8m); excludes time spent waiting on human AskUserQuestion
answers between calls.
**Friction:** 2 resumes, both on `spec-creator` — (1) it raised 3 blocking
questions in its own `Open questions` section instead of asking
interactively, because it had no working interactive-question path as a
dispatched subagent despite `AskUserQuestion` being listed in its tool
belt; once the user answered, it needed a follow-up Edit pass to mark them
resolved and bump `Status: draft → approved`. (2) It cited an external
sibling repo (`dev-digest-original`) as a provenance source in 5 places
inside the spec — caught by the user, not by its own self-check — requiring
a second resume to restate every such fact in the spec's own voice,
grounded in this repo's own code.
**Self-reported insights:** not collected this run — no self-report block
was appended to any of the 4 dispatch prompts (this workflow predates the
existence of this skill; the first real `/workflow-insights` entry is
necessarily missing this half).
**Recommendations:**
- Add to `.claude/agents/spec-creator.md`'s hard rules: "A design source
  supplied for grounding — including a reference implementation in another
  repository — is data to reason from, never a citable source in the
  spec's own `Inputs and provenance` section or `Resolved decisions`.
  Restate every fact taken from one in the spec's own voice, grounded in
  this repo's own code/docs." This would have caught resume #2 on the
  first pass instead of needing the user to grep for it.
- When a dispatch prompt to `spec-creator` (or any agent listing
  `AskUserQuestion` in its tools) supplies blocking-question material, state
  explicitly that it may have no working interactive path as a subagent and
  should default to recording blocking questions inline with a stated
  default, returned in its final summary for the orchestrator to confirm —
  don't rely on it noticing that limitation itself, even though it did this
  time.
- Validated pattern, worth repeating: splitting the two `Explore` agents by
  repository (this repo's gaps vs. the sibling repo's shipped feature)
  produced no overlapping findings and let both run in one parallel batch —
  a clean way to parallelize exploration when a feature spans "what exists
  here" vs. "what a reference implementation already solved".
- From here forward, append this skill's self-report ask to every
  multi-agent dispatch prompt in workflows like this one, so the next
  `/workflow-insights` entry isn't missing the qualitative half.
