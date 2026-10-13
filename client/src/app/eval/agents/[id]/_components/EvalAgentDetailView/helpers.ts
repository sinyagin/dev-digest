import type { EvalBanner, EvalRunSummary, EvalTrendPoint } from "@devdigest/shared";

export const MAX_COMPARE = 2;

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function completedCount(runs: EvalRunSummary[]): number {
  return runs.filter((r) => r.status === "completed").length;
}

/** Compare needs exactly two selected runs. */
export function canCompare(selected: string[]): boolean {
  return selected.length === MAX_COMPARE;
}

/** Orders the selected run ids oldest → newest by ran_at: [old, new]. */
export function orderSelected(selected: string[], runs: EvalRunSummary[]): [string, string] | null {
  if (selected.length !== MAX_COMPARE) return null;
  const at = (id: string) => Date.parse(runs.find((r) => r.id === id)?.ran_at ?? "");
  const [a, b] = selected as [string, string];
  return at(a) <= at(b) ? [a, b] : [b, a];
}

/** Toggle an id in the selection, preserving click order. */
export function toggleSelected(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

export function bannerMetricKey(m: EvalBanner["metric"]): "recall" | "precision" | "citationAccuracy" {
  return m === "citation_accuracy" ? "citationAccuracy" : m;
}

/** Trend series for the chart; points lacking a metric plot as 0 (the chart needs dense data). */
export function trendSeries(trend: EvalTrendPoint[], key: "recall" | "precision" | "citation_accuracy"): number[] {
  return trend.map((p) => p[key] ?? 0);
}

/** Raw-unit (0..1) delta → percentage points. */
export function toPts(d: number | null): number | null {
  return d == null ? null : d * 100;
}
