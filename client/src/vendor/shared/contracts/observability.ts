import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of GET /multi-agent-runs/:id
 *   - MultiAgentRunSummary one row of GET /multi-agent-runs (recent runs)
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  kind: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['done', 'failed', 'running', 'cancelled']),
  error: z.string().nullable(),
  last_log: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string(),
  /** Ids of all of this agent's findings in the group. */
  finding_ids: z.array(z.string()),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  end_line: z.number().int(),
  /** True when agents disagree (divergent severity or one ignored); false for plain agreement. */
  conflict: z.boolean(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of GET /multi-agent-runs/:id (computed on read). */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  repo_id: z.string(),
  status: z.enum(['running', 'done', 'failed']),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/** One row of GET /multi-agent-runs (recent runs list, newest first). */
export const MultiAgentRunSummary = z.object({
  id: z.string(),
  repo_id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int(),
  pr_title: z.string(),
  ran_at: z.string(),
  status: z.enum(['running', 'done', 'failed']),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
});
export type MultiAgentRunSummary = z.infer<typeof MultiAgentRunSummary>;
export const MultiAgentRunList = z.array(MultiAgentRunSummary);
export type MultiAgentRunList = z.infer<typeof MultiAgentRunList>;

/** One agent's estimate for the Configure run page (GET /agents/estimates). */
export const AgentEstimate = z.object({
  agent_id: z.string(),
  avg_duration_ms: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  sample_size: z.number().int(),
});
export type AgentEstimate = z.infer<typeof AgentEstimate>;
export const AgentEstimatesResponse = z.array(AgentEstimate);
export type AgentEstimatesResponse = z.infer<typeof AgentEstimatesResponse>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
