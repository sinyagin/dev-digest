import type { EvalCase, EvalCaseInput, EvalRunSummary } from "@devdigest/shared";

/** Blank input for the "New eval case" modal. */
export function emptyCaseInput(): EvalCaseInput {
  return {
    name: "",
    input_diff: "",
    input_files: [],
    input_meta: { pr_number: null, title: "", body: null },
    expectation: { type: "must_find", file: "", start_line: 1, end_line: 1 },
    notes: null,
    source_finding_id: null,
  };
}

/** Saved case -> editable input. */
export function caseToInput(c: EvalCase): EvalCaseInput {
  return {
    name: c.name,
    input_diff: c.input_diff,
    input_files: c.input_files,
    input_meta: c.input_meta,
    expectation: c.expectation,
    notes: c.notes,
    source_finding_id: c.source_finding_id,
  };
}

export type CaseState = "pass" | "fail" | "errored" | "neverRun";

export function caseState(c: EvalCase): CaseState {
  const r = c.last_result;
  if (!r) return "neverRun";
  // An errored execution (timeout / provider error) DID run — it just produced no
  // score. Showing it as "never run" hides the reason from the user.
  if (r.status === "errored") return "errored";
  if (r.pass === null) return "neverRun";
  return r.pass ? "pass" : "fail";
}

/** Expected finding count: a must_find case expects one, a must_not_flag case none. */
export function expectedCount(c: EvalCase): number {
  return c.expectation.type === "must_find" ? 1 : 0;
}

/** `SEVERITY · category` for must_find; null for must_not_flag (rendered separately). */
/** `file:start–end` the expectation targets (basename keeps the row short). */
export function caseLocation(c: EvalCase): string {
  const { file, start_line, end_line } = c.expectation;
  const base = file.split("/").pop() ?? file;
  return start_line === end_line ? `${base}:${start_line}` : `${base}:${start_line}–${end_line}`;
}

export function findTag(c: EvalCase): string {
  const { severity, category } = c.expectation;
  return [severity, category].filter(Boolean).join(" · ");
}

export function passingCount(cases: readonly EvalCase[]): number {
  return cases.filter((c) => caseState(c) === "pass").length;
}

export type RunStatusKey = "passed" | "completed" | "running" | "errored";

/** A completed run is never "failed": failing cases are a result, not a run error
 *  (that is `errored`). All cases passing is called out as `passed`. */
export function runStatusKey(r: EvalRunSummary): RunStatusKey {
  if (r.status === "running") return "running";
  if (r.status === "errored") return "errored";
  return r.traces_passed === r.traces_total ? "passed" : "completed";
}
