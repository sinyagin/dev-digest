/**
 * Eval analytics (SPEC-03 AC-35, AC-36, AC-47, AC-50, AC-51). Pure functions of
 * stored run rows: no DB, no LLM (AC-22). The banner is structured data, never
 * a model sentence (D16).
 */
import type {
  EvalBanner,
  EvalCaseOutcome,
  EvalCompare,
  EvalMetricDelta,
  EvalRunRecord,
  EvalRunSummary,
  EvalTrendPoint,
} from '@devdigest/shared';
import { aggregate } from './scoring.js';

/** Mirrors `TREND_LIMIT` in the module's constants (plan T7); overridable by arg. */
const DEFAULT_TREND_LIMIT = 20;

type MetricKey = 'recall' | 'precision' | 'citation_accuracy';
/** Tie-break order for the banner (recall > precision > citation). */
const BANNER_METRICS: readonly MetricKey[] = ['recall', 'precision', 'citation_accuracy'];

const byRanAt = <T extends { ran_at: string }>(a: T, b: T): number =>
  Date.parse(a.ran_at) - Date.parse(b.ran_at);

/** `(new - old) * 100` rounded to 1 dp; null if either side is null. */
export function deltaPts(oldV: number | null, newV: number | null): number | null {
  if (oldV === null || newV === null) return null;
  return Math.round((newV - oldV) * 1000) / 10;
}

/** Newest first: the two most recent `completed` runs (running/errored ignored, AC-51). */
export function latestTwoCompleted<T extends { status: string; ran_at: string }>(
  runs: readonly T[],
): { latest: T | null; previous: T | null } {
  const done = runs.filter((r) => r.status === 'completed').sort(byRanAt);
  return {
    latest: done[done.length - 1] ?? null,
    previous: done[done.length - 2] ?? null,
  };
}

/** LCS line diff. CRLF and LF are treated the same. */
export function diffPromptLines(
  a: string,
  b: string,
): { unchanged: boolean; diff: { op: 'equal' | 'add' | 'remove'; line: string }[] } {
  if (a === b) return { unchanged: true, diff: [] };
  const x = a.split(/\r?\n/);
  const y = b.split(/\r?\n/);
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const diff: { op: 'equal' | 'add' | 'remove'; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      diff.push({ op: 'equal', line: x[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      diff.push({ op: 'remove', line: x[i++]! });
    } else {
      diff.push({ op: 'add', line: y[j++]! });
    }
  }
  while (i < n) diff.push({ op: 'remove', line: x[i++]! });
  while (j < m) diff.push({ op: 'add', line: y[j++]! });
  // Line-wise equal after CRLF normalisation: nothing to show.
  return { unchanged: diff.every((d) => d.op === 'equal') && a === b, diff };
}

const scoredById = (run: EvalRunRecord): Map<string, EvalCaseOutcome> => {
  const m = new Map<string, EvalCaseOutcome>();
  for (const o of run.per_case) {
    if (o.status === 'scored' && o.case_id !== null) m.set(o.case_id, o);
  }
  return m;
};

const delta = (oldV: number | null, newV: number | null): EvalMetricDelta => ({
  old: oldV,
  new: newV,
  delta: oldV === null || newV === null ? null : newV - oldV,
});

/** Compare two runs of one agent. Metrics are recomputed over the common scored cases (AC-35). */
export function compareRuns(
  runA: EvalRunRecord,
  runB: EvalRunRecord,
  promptA: string,
  promptB: string,
): EvalCompare {
  const [older, newer, oldPrompt, newPrompt] =
    byRanAt(runA, runB) <= 0 ? [runA, runB, promptA, promptB] : [runB, runA, promptB, promptA];

  const nameOf = (run: EvalRunRecord, id: string): string =>
    run.per_case.find((o) => o.case_id === id)?.name ?? id;

  const oldIds = new Set(older.case_ids);
  const newIds = new Set(newer.case_ids);
  const added = newer.case_ids
    .filter((id) => !oldIds.has(id))
    .map((id) => ({ case_id: id, name: nameOf(newer, id) }));
  const removed = older.case_ids
    .filter((id) => !newIds.has(id))
    .map((id) => ({ case_id: id, name: nameOf(older, id) }));

  const oldScored = scoredById(older);
  const newScored = scoredById(newer);
  const common = [...oldScored.keys()].filter((id) => newScored.has(id));
  const commonSet = new Set(common);
  const pick = (run: EvalRunRecord) =>
    aggregate(run.per_case.filter((o) => o.case_id !== null && commonSet.has(o.case_id)));
  const oa = pick(older);
  const na = pick(newer);

  const { unchanged, diff } = diffPromptLines(oldPrompt, newPrompt);
  return {
    old: older,
    new: newer,
    common_cases: common.length,
    metrics: {
      recall: delta(oa.recall, na.recall),
      precision: delta(oa.precision, na.precision),
      citation_accuracy: delta(oa.citation_accuracy, na.citation_accuracy),
      cost_usd: delta(oa.cost_usd, na.cost_usd),
    },
    case_set: { same: added.length === 0 && removed.length === 0, added, removed },
    prompt: {
      old_version: older.agent_version,
      new_version: newer.agent_version,
      unchanged,
      diff,
    },
  };
}

/**
 * Banner for the latest completed run vs the previous one (D16/AC-47).
 * `delta_pts` is the magnitude (>0); `direction` carries the sign.
 * `flipped` lists common scored cases whose `pass` differs; empty => no causal clause.
 */
export function deriveBanner(
  latest: EvalRunRecord | null,
  previous: EvalRunRecord | null,
): EvalBanner | null {
  if (!latest || !previous) return null;
  let best: { metric: MetricKey; pts: number } | null = null;
  for (const metric of BANNER_METRICS) {
    const pts = deltaPts(previous[metric], latest[metric]);
    if (pts === null || pts === 0) continue;
    if (best === null || Math.abs(pts) > Math.abs(best.pts)) best = { metric, pts };
  }
  if (best === null) return null;

  const prev = scoredById(previous);
  const flipped: EvalBanner['flipped'] = [];
  for (const [id, cur] of scoredById(latest)) {
    const before = prev.get(id);
    if (!before || before.pass === null || cur.pass === null || before.pass === cur.pass) continue;
    flipped.push({ case_id: id, name: cur.name, from_pass: before.pass, to_pass: cur.pass });
  }
  return {
    metric: best.metric,
    direction: best.pts > 0 ? 'up' : 'down',
    delta_pts: Math.abs(best.pts),
    version: latest.agent_version,
    flipped,
  };
}

/** Completed runs only, chronological, last `limit` points. */
export function toTrend(
  runs: readonly (EvalRunSummary | EvalRunRecord)[],
  limit: number = DEFAULT_TREND_LIMIT,
): EvalTrendPoint[] {
  return runs
    .filter((r) => r.status === 'completed')
    .sort(byRanAt)
    .slice(-limit)
    .map((r) => ({
      run_id: r.id,
      ran_at: r.ran_at,
      agent_version: r.agent_version,
      recall: r.recall,
      precision: r.precision,
      citation_accuracy: r.citation_accuracy,
      pass_rate: r.traces_total === 0 ? null : r.traces_passed / r.traces_total,
      cost_usd: r.cost_usd,
    }));
}
