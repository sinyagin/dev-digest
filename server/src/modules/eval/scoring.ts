/**
 * Eval scoring (SPEC-03 AC-22..AC-28). Pure and deterministic: no I/O, no LLM,
 * no refetching — it only reads the stored/grounded outputs it is handed.
 */
import type {
  EvalActualFinding,
  EvalCaseOutcome,
  EvalExpectation,
  EvalExpectationType,
  EvalRun,
} from '@devdigest/shared';

/** Minimal grounded-finding shape scoring needs (a subset of `Finding`). */
export type ScorableFinding = Pick<
  EvalActualFinding,
  'file' | 'start_line' | 'end_line' | 'severity' | 'category' | 'title'
>;

export interface EvalCaseScoreMeta {
  case_id: string | null;
  name: string;
  expectation_type: EvalExpectationType;
}

export interface ScoreCaseInput {
  /** Grounded (kept) findings only (AC-27). */
  kept: readonly ScorableFinding[];
  droppedCount: number;
  expectation: Pick<EvalExpectation, 'file' | 'start_line' | 'end_line' | 'type'>;
  caseMeta: EvalCaseScoreMeta;
  durationMs: number;
  costUsd: number | null;
}

type Range = { file: string; start_line: number; end_line: number };

/** Same file and inclusive line-interval intersection (ranges normalised). */
export function matches(f: Range, exp: Range): boolean {
  if (f.file !== exp.file) return false;
  const fs = Math.min(f.start_line, f.end_line);
  const fe = Math.max(f.start_line, f.end_line);
  const es = Math.min(exp.start_line, exp.end_line);
  const ee = Math.max(exp.start_line, exp.end_line);
  return fs <= ee && es <= fe;
}

export function scoreCase(input: ScoreCaseInput): EvalCaseOutcome {
  const { kept, droppedCount, expectation, caseMeta, durationMs, costUsd } = input;
  const actual: EvalActualFinding[] = kept.map((f) => ({
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    severity: f.severity,
    category: f.category,
    title: f.title,
    matched: matches(f, expectation),
  }));
  const matched = actual.filter((a) => a.matched).length;
  const pass = expectation.type === 'must_find' ? matched > 0 : matched === 0;
  return {
    case_id: caseMeta.case_id,
    name: caseMeta.name,
    expectation_type: caseMeta.expectation_type,
    status: 'scored',
    pass,
    error_reason: null,
    findings_total: kept.length,
    findings_matched: matched,
    grounding_kept: kept.length,
    grounding_total: kept.length + droppedCount,
    duration_ms: durationMs,
    cost_usd: costUsd,
    actual,
  };
}

export function erroredOutcome(
  caseMeta: EvalCaseScoreMeta,
  reason: string,
  durationMs: number,
): EvalCaseOutcome {
  return {
    case_id: caseMeta.case_id,
    name: caseMeta.name,
    expectation_type: caseMeta.expectation_type,
    status: 'errored',
    pass: null,
    error_reason: reason,
    findings_total: 0,
    findings_matched: 0,
    grounding_kept: 0,
    grounding_total: 0,
    duration_ms: durationMs,
    cost_usd: null,
    actual: [],
  };
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

/** Set-level metrics. Errored outcomes are skipped from every figure except `cases_errored`. */
export function aggregate(outcomes: readonly EvalCaseOutcome[]): EvalRun {
  const scored = outcomes.filter((o) => o.status === 'scored');

  const mustFind = scored.filter((o) => o.expectation_type === 'must_find');
  const found = mustFind.filter((o) => o.findings_matched > 0).length;

  const groundedTotal = scored.reduce((s, o) => s + o.findings_total, 0);
  // False positives count findings, not cases (AC-25).
  const falsePositives = scored
    .filter((o) => o.expectation_type === 'must_not_flag')
    .reduce((s, o) => s + o.findings_matched, 0);

  const kept = scored.reduce((s, o) => s + o.grounding_kept, 0);
  const produced = scored.reduce((s, o) => s + o.grounding_total, 0);

  const precisionRatio = ratio(falsePositives, groundedTotal);

  return {
    recall: ratio(found, mustFind.length),
    precision: precisionRatio === null ? null : 1 - precisionRatio,
    citation_accuracy: ratio(kept, produced),
    traces_passed: scored.filter((o) => o.pass === true).length,
    traces_total: scored.length,
    cases_errored: outcomes.length - scored.length,
    duration_ms: scored.reduce((s, o) => s + o.duration_ms, 0),
    cost_usd: scored.some((o) => o.cost_usd === null)
      ? null
      : scored.reduce((s, o) => s + (o.cost_usd ?? 0), 0),
    per_case: [...outcomes],
  };
}
