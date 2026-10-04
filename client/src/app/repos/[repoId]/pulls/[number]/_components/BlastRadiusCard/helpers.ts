import type { CSSProperties } from "react";
import type { BlastRadiusResponse, BlastDegradedReason } from "@devdigest/shared";

/** Deduped totals across every downstream group — avoids double-counting a
 *  shared endpoint/cron that two groups both reference. */
export function aggregateCounts(data: BlastRadiusResponse): {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
} {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const d of data.downstream) {
    callers += d.callers.length;
    for (const e of d.endpoints_affected) endpoints.add(e);
    for (const c of d.crons_affected) crons.add(c);
  }
  return { symbols: data.changed_symbols.length, callers, endpoints: endpoints.size, crons: crons.size };
}

const DEGRADED_REASON_LABEL: Record<BlastDegradedReason, string> = {
  flag_off: "Repo indexing is disabled.",
  index_failed: "Repo index failed to build.",
  index_partial: "Repo index is incomplete — results may be partial.",
  repo_too_large: "Repo is too large to fully index.",
  no_data: "No index data available yet.",
};

export function degradedReasonLabel(reason: BlastDegradedReason | undefined): string {
  return (reason && DEGRADED_REASON_LABEL[reason]) ?? "Impact map is unavailable.";
}

const METHOD_COLOR: Record<string, { bg: string; color: string }> = {
  GET: { bg: "var(--ok-bg)", color: "var(--ok)" },
  POST: { bg: "var(--accent-bg)", color: "var(--accent-text)" },
  PUT: { bg: "var(--warn-bg)", color: "var(--warn)" },
  PATCH: { bg: "var(--warn-bg)", color: "var(--warn)" },
  DELETE: { bg: "var(--crit-bg)", color: "var(--crit)" },
};

/** Inline style for an "METHOD /path" endpoint chip, colored by HTTP method. */
export function endpointPillStyle(endpoint: string): CSSProperties {
  const method = endpoint.split(" ")[0]?.toUpperCase() ?? "";
  const { bg, color } = METHOD_COLOR[method] ?? { bg: "var(--info-bg)", color: "var(--info)" };
  return { background: bg, color };
}

/** "today" / "yesterday" / "{n}d ago" / "{n}mo ago" / "{n}y ago" */
export function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
