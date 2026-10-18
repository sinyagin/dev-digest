/* lib/multi-agent.ts — pure helpers for the multi-agent review UI. */
import type { AgentEstimate } from "@devdigest/shared";

export const MAX_AGENTS = 8;
export const MIN_AGENTS = 2;

export interface AgentAccent {
  color: string;
  textColor: string;
  icon: string;
}

/** Fixed palette; every `color` vs `textColor` pair has contrast >= 4.5:1. */
export const AGENT_PALETTE: readonly AgentAccent[] = [
  { color: "#1d4ed8", textColor: "#ffffff", icon: "🔍" },
  { color: "#047857", textColor: "#ffffff", icon: "🛡" },
  { color: "#b91c1c", textColor: "#ffffff", icon: "⚡" },
  { color: "#6d28d9", textColor: "#ffffff", icon: "🧪" },
  { color: "#b45309", textColor: "#ffffff", icon: "📐" },
  { color: "#0e7490", textColor: "#ffffff", icon: "🧭" },
  { color: "#be185d", textColor: "#ffffff", icon: "🧹" },
  { color: "#374151", textColor: "#ffffff", icon: "📎" },
];

/** Stable accent per agent id (djb2-style string hash -> palette index). */
export function agentAccent(agentId: string): AgentAccent {
  let h = 5381;
  for (let i = 0; i < agentId.length; i++) h = ((h * 33) ^ agentId.charCodeAt(i)) >>> 0;
  return AGENT_PALETTE[h % AGENT_PALETTE.length]!;
}

export interface AggregateEstimate {
  durationMs: number | null;
  costUsd: number | null;
  /** Selected agents with no history (excluded from the aggregate). */
  excluded: number;
  /** True when no selected agent has any estimate. */
  none: boolean;
}

/** Runs are parallel: duration = max, cost = sum. Unknown (null) values are excluded. */
export function aggregateEstimate(
  estimates: Pick<AgentEstimate, "avg_duration_ms" | "avg_cost_usd">[],
): AggregateEstimate {
  let durationMs: number | null = null;
  let costUsd: number | null = null;
  let excluded = 0;
  for (const e of estimates) {
    if (e.avg_duration_ms == null && e.avg_cost_usd == null) {
      excluded += 1;
      continue;
    }
    if (e.avg_duration_ms != null) durationMs = Math.max(durationMs ?? 0, e.avg_duration_ms);
    if (e.avg_cost_usd != null) costUsd = (costUsd ?? 0) + e.avg_cost_usd;
  }
  return { durationMs, costUsd, excluded, none: durationMs == null && costUsd == null };
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** Ids of enabled agents, in list order, capped at MAX_AGENTS. */
export function selectAllCapped(agents: { id: string; enabled: boolean }[]): string[] {
  return agents
    .filter((a) => a.enabled)
    .slice(0, MAX_AGENTS)
    .map((a) => a.id);
}
