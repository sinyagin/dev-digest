---
name: workflow-insights
description: Compiles a retrospective on a just-completed multi-agent workflow — a run-plan execution, a spec-creator/Explore fan-out, or any session that dispatched several Agent calls toward one goal — covering agent count, dispatch order/parallelism, tokens and duration per agent, each agent's self-reported difficulties/ease/duplicated-info/possible-misses, and concrete recommendations, appended as a dated entry to WORKFLOW-INSIGHTS.md. Invoke explicitly via /workflow-insights — this does not fire on its own.
---

# Workflow Insights

`engineering-insights` captures what you learned about the **code**. This
skill captures what you learned about the **process** — how the agents you
dispatched actually performed: how many ran, in what order, at what token
cost, what tripped them up, and what a future dispatch should do
differently. Output goes to the root [`WORKFLOW-INSIGHTS.md`](../../../WORKFLOW-INSIGHTS.md)
(not to be confused with any package's `INSIGHTS.md` — see that file's own
header for why a root-level log is correct here and not a convention break).

This is a **manual-only** skill. It does not fire on its own — invoke it
explicitly by typing `/workflow-insights` after a workflow that dispatched
several `Agent` calls toward one goal (a `run-plan` execution, a
`spec-creator` + `Explore` fan-out, a parallel review pass, etc.).

## Two-part protocol

This skill has a "before" half and an "after" half. Skipping the first half
silently degrades the second — read both before using it.

### Before / during — ask each agent to self-report

When you are about to dispatch multiple `Agent` calls as part of a workflow
you intend to retrospect on, append this block to the end of **every**
dispatch prompt:

> End your final response with a short "Workflow self-report" paragraph:
> difficulties you ran into, what was straightforward, any information you
> found duplicated or redundant in what you were given, and anything you
> suspect you didn't fully cover or might have missed.

This is a habit, not an automatic hook — nothing in this repo currently
forces it (see *Known limitation* below). Do it anyway, every time, for any
workflow worth retrospecting on: it costs a sentence per agent and is the
only source for half of what this skill reports.

### After — compile what's in the conversation

When `/workflow-insights` is invoked, compile the retrospective **entirely
from what is already in the current conversation** — do not re-read any
subagent's raw transcript or `output_file`, and do not dispatch a new agent
just to ask it questions after the fact. The data needed is either already
visible in the conversation, or was never captured (see the self-report
caveat) — in neither case does re-reading a transcript help, and doing so
burns exactly the context budget this skill exists to report on.

## What to compile

### Always available (no self-report needed)

- **Every `Agent` dispatch this session**: `subagent_type`, the one-line
  `description` given at dispatch, and the model if stated.
- **Dispatch order and parallelism**: calls issued in the same message are
  one parallel batch; a later `SendMessage` to an existing agent (a resume)
  is a sequential follow-up, and every resume is a **friction signal** —
  name briefly why the resume was needed (a correction, a missed
  requirement, a scope question).
- **Per-agent stats** straight from each task-notification's `<usage>`
  block: `subagent_tokens`, `tool_uses`, `duration_ms`. **When an agent was
  resumed one or more times, each notification's `subagent_tokens` is that
  agent's cumulative total so far, not a per-turn delta** — use only the
  figure from its *last* notification as that agent's total, never sum
  across its own resumes (that double- or triple-counts the same tokens).
- **Session-level token total**: sum of each agent's final cumulative
  total (one figure per distinct agent, per the rule above), labeled an
  estimate, plus the orchestrator's own consumption if visible from
  remaining-budget deltas (e.g. a `<total_tokens>` system reminder before
  vs. after).

### Only if a self-report was asked for

Per agent, lifted from its own final response: difficulties, what was easy,
duplicated information it was given, and anything it flagged as possibly
missed. If an agent was never asked (no self-report block appended to its
dispatch prompt), its entry says **"self-report not collected for this
agent"** — never infer or invent one from the agent's output alone.

## Recommendations — the part that makes this worth running

For every friction point found — a resume, a correction round, a
self-reported miss or duplication — propose **one concrete, actionable
fix**: a specific line to add to that agent's `.claude/agents/<name>.md`
definition, or to the dispatch-prompt template used for that kind of task,
that would have prevented it next time. A fact log without this section is
half the value — don't skip it, and don't make it vague ("be more careful")
when a specific prompt addition is possible.

Example of the standard this section should meet (from this repo's own
history): `spec-creator` needed a follow-up resume to stop citing an
external sibling repo as a provenance source in a spec. The recommendation
isn't "remind it not to do that" — it's a specific line for the agent's own
hard rules: *"Design sources you were given for grounding (including a
reference implementation in another repo) are data to reason from, never a
citable source in the spec's own provenance section — restate every fact
you take from one in the spec's own voice, grounded in this repo's code."*

## Entry format

Append to the **top** of `WORKFLOW-INSIGHTS.md` (newest first), one entry
per `/workflow-insights` invocation:

```
## YYYY-MM-DD — <short workflow label>
**Workflow:** <what was being accomplished>
**Agents:** N dispatched — <type ×count @ model> — <P parallel batches, R resumes>
**Tokens:** session ≈ Xk (per-agent breakdown)
**Duration:** wall-clock ≈ Xm
**Friction:** <resume/correction summary, or "none">
**Self-reported insights:** <per agent, or "not collected this run">
**Recommendations:** <concrete, actionable prompt/agent-definition changes>
```

Date is the current session date. Title is a short, specific label for the
workflow (not "Agent run" — "SPEC-01 project-context authoring" or similar).

## Discipline: append-only, dedup, soft cap

- **Append-only.** Never edit or delete a past entry. If a new retrospective
  contradicts or supersedes an old recommendation, add a new entry that says
  so and references the old title — don't silently rewrite history.
- **Dedup check.** Before writing, skim the last handful of entries for the
  same friction point or recommendation already recorded. If the same
  lesson keeps recurring (e.g. the same agent keeps needing the same kind of
  correction), that is itself worth flagging — it means the earlier
  recommendation was never actually applied to the agent's definition.
- **Soft cap.** If the file is approaching roughly 100 entries, say so to
  the user and suggest a pruning pass rather than writing past it unprompted.

## Known limitation

Nothing currently forces the "before" half to happen — this skill relies
entirely on the orchestrator remembering to append the self-report ask at
dispatch time. An agent dispatched without it simply contributes no
qualitative data; the token/order/duration facts are unaffected. A
`SubagentStop` hook could eventually auto-remind or auto-inject the ask —
that is a real option worth revisiting, but it is deliberately **not built
here**: this skill is manual-trigger by design, and adding automatic hook
behavior is a separate decision with its own tradeoffs (noise on trivial
single-agent dispatches, maintenance of hook scripts) that shouldn't be
smuggled in as a side effect of writing this skill.

See `examples.md` for one full worked entry.
