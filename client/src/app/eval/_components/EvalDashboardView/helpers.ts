import type { EvalAgentSummary, EvalDashboard } from "@devdigest/shared";

export type RecentRun = EvalDashboard["recent_runs"][number];

/** Recall series of completed runs with a score, oldest → newest, for the sparkline. */
export function recallSeries(trend: EvalAgentSummary["trend"]): number[] {
  return trend.flatMap((p) => (p.recall == null ? [] : [p.recall]));
}

/** Newest first, regardless of API order. */
export function newestFirst(runs: RecentRun[]): RecentRun[] {
  return [...runs].sort((a, b) => Date.parse(b.ran_at) - Date.parse(a.ran_at));
}

/** Total executions a run-all would start (Σ cases_total). */
export function totalExecutions(agents: EvalAgentSummary[]): number {
  return agents.reduce((n, a) => n + a.cases_total, 0);
}

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
