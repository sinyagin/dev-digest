/* helpers.ts — pure derivations for the multi-agent results page. */
import type { AgentColumn, Conflict, MultiAgentRun } from "@devdigest/shared";
import { formatCost, formatDuration } from "@/lib/multi-agent";

export type ViewMode = "columns" | "tabs";
export type ColumnStatus = AgentColumn["status"];

export function parseView(raw: string | null): ViewMode {
  return raw === "tabs" ? "tabs" : "columns";
}

/** Total cost = sum over `done` agents only; "—" when the run has no cost. */
export function totalCostLabel(run: MultiAgentRun): string {
  if (run.total_cost_usd == null) return "—";
  const sum = run.columns
    .filter((c) => c.status === "done")
    .reduce((acc, c) => acc + (c.cost_usd ?? 0), 0);
  return formatCost(sum);
}

export function totalDurationLabel(run: MultiAgentRun): string {
  return formatDuration(run.total_duration_ms);
}

export type RunSummaryKind = "normal" | "noChildren" | "noneCompleted";

export function summaryKind(run: MultiAgentRun): RunSummaryKind {
  if (run.columns.length === 0) return "noChildren";
  const anyLive = run.columns.some((c) => c.status === "running");
  const anyDone = run.columns.some((c) => c.status === "done");
  if (!anyLive && !anyDone) return "noneCompleted";
  return "normal";
}

export function countByStatus(columns: AgentColumn[], status: ColumnStatus): number {
  return columns.filter((c) => c.status === status).length;
}

/** `show only conflicts` hides only groups with `conflict === false`. */
export function visibleConflicts(conflicts: Conflict[], onlyConflicts: boolean): Conflict[] {
  return onlyConflicts ? conflicts.filter((c) => c.conflict) : conflicts;
}

export type DisagreementState =
  | { kind: "needsTwo"; running: number }
  | { kind: "allAgree" }
  | { kind: "rows"; rows: Conflict[] };

export function disagreementState(
  columns: AgentColumn[],
  conflicts: Conflict[],
  onlyConflicts: boolean,
): DisagreementState {
  if (countByStatus(columns, "done") < 2) {
    return { kind: "needsTwo", running: countByStatus(columns, "running") };
  }
  const rows = visibleConflicts(conflicts, onlyConflicts);
  return rows.length === 0 ? { kind: "allAgree" } : { kind: "rows", rows };
}

export interface StatusChange {
  agentName: string;
  status: ColumnStatus;
}

/** Columns whose status differs from the previous poll (by run id). */
export function statusChanges(
  prev: ReadonlyMap<string, ColumnStatus>,
  columns: AgentColumn[],
): StatusChange[] {
  return columns
    .filter((c) => prev.has(c.run_id) && prev.get(c.run_id) !== c.status)
    .map((c) => ({ agentName: c.agent_name, status: c.status }));
}

export function statusMap(columns: AgentColumn[]): Map<string, ColumnStatus> {
  return new Map(columns.map((c) => [c.run_id, c.status]));
}
export type DrawerTab = "trace" | "log";
