import type { CiRun } from "@devdigest/shared";

/** Placeholder for unknown values (AC-42). */
export const DASH = "—";

/** Render external links only for GitHub URLs (untrusted artifact-derived data). */
export function safeGithubUrl(url: string | null | undefined): string | null {
  return url && url.startsWith("https://github.com/") ? url : null;
}

export function fmtCostUsd(v: number | null | undefined): string {
  return v == null ? DASH : `$${v.toFixed(v < 0.01 && v > 0 ? 4 : 2)}`;
}

export function fmtDurationS(v: number | null | undefined): string {
  if (v == null) return DASH;
  if (v < 60) return `${Math.round(v)}s`;
  return `${Math.floor(v / 60)}m ${Math.round(v % 60)}s`;
}

export function fmtTime(v: string | null | undefined): string {
  if (!v) return DASH;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleString();
}

/** Newest first; runs without a timestamp sort last. */
export function sortRuns(runs: readonly CiRun[]): CiRun[] {
  return [...runs].sort((a, b) => (b.ran_at ?? "").localeCompare(a.ran_at ?? ""));
}

const STATUS_KEYS: Record<string, string> = {
  succeeded: "succeeded",
  no_findings: "noFindings",
  failed: "failed",
  running: "running",
};

/** i18n key under `runs.status` or null for unknown statuses. */
export function statusKey(status: string | null | undefined): string | null {
  return status ? (STATUS_KEYS[status] ?? null) : null;
}
