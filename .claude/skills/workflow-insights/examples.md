# Worked example

Illustrative — based loosely on a real session, trimmed and reworded; do not
copy the numbers into a real entry verbatim.

```
## 2026-10-04 — SPEC-01 project-context authoring
**Workflow:** researched whether "Project Context" already existed (this
repo vs. a sibling reference repo), then dispatched spec-creator to author
specs/cross-module/SPEC-01-project-context.md, then resolved 3 blocking
questions and a provenance-citation defect found by the user afterward.
**Agents:** 3 dispatched — 2× Explore @ sonnet (1 parallel batch), 1×
spec-creator @ opus — 2 parallel batches total (the 2 Explore agents
together; the spec-creator dispatch alone), 2 resumes on spec-creator.
**Tokens:** session ≈ 250k (Explore ×2: 68.6k + 72.3k; spec-creator final
cumulative after both resumes: 109.4k — each agent's *last* notification
only, not summed across its own resumes).
**Duration:** wall-clock ≈ 18m across all agent calls (longest single call
≈ 7m); the two Explore agents ran concurrently so their 145s/162s don't add.
**Friction:** 2 resumes on spec-creator — (1) the user supplied answers to
3 blocking questions spec-creator itself raised, requiring it to update
Resolved-decisions/status in place; (2) the user caught spec-creator citing
an external sibling repo as a provenance source inside the spec, requiring
a second resume to rewrite that section in the spec's own voice.
**Self-reported insights:** not collected this run — no self-report block
was appended to any dispatch prompt (this workflow predates the
workflow-insights skill).
**Recommendations:**
- Add to `.claude/agents/spec-creator.md`'s hard rules: "A design source
  supplied for grounding, including a reference implementation in another
  repository, is data to reason from, never a citable source in the spec's
  own `Inputs and provenance` section — restate every fact you take from it
  in the spec's own voice, grounded in this repo's own code." This would
  have caught resume #2 on the first pass.
- When supplying a reference implementation as grounding material to
  spec-creator, state explicitly in the dispatch prompt that it must not be
  named anywhere in the output spec — don't rely on the agent's own
  judgment to infer that boundary.
```
