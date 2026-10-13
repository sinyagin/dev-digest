import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * Eval pipeline contracts (SPEC-03). Single source of truth for eval cases,
 * runs, scoring outcomes and the dashboard. Limits here enforce AC-55.
 *
 * The two vendored copies of this file (server + client) must stay
 * byte-identical.
 */

// ---- Case + expectation ----
/** Kept for the DB enum; only 'agent' is used in this slice. */
export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalExpectationType = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationType = z.infer<typeof EvalExpectationType>;

export const EvalExpectation = z
  .object({
    type: EvalExpectationType,
    file: z.string().min(1).max(500),
    start_line: z.number().int().min(1),
    end_line: z.number().int().min(1),
    severity: Severity.optional(),
    category: z.string().max(64).optional(),
    title: z.string().max(300).optional(),
  })
  .strict()
  .refine((e) => e.end_line >= e.start_line, {
    message: 'end_line must be >= start_line',
    path: ['end_line'],
  });
export type EvalExpectation = z.infer<typeof EvalExpectation>;

export const EvalCaseMeta = z.object({
  pr_number: z.number().int().nullable(),
  title: z.string().max(500),
  body: z.string().max(20000).nullable(),
});
export type EvalCaseMeta = z.infer<typeof EvalCaseMeta>;

export const EvalCaseInput = z.object({
  name: z.string().min(1).max(120),
  input_diff: z.string().min(1).max(200000),
  input_files: z.array(z.string().min(1).max(500)).min(1).max(20),
  input_meta: EvalCaseMeta,
  expectation: EvalExpectation,
  notes: z.string().max(4000).nullish(),
  source_finding_id: z.string().uuid().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

// ---- Outcomes ----
export const EvalActualFinding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  matched: z.boolean(),
});
export type EvalActualFinding = z.infer<typeof EvalActualFinding>;

export const EvalCaseStatus = z.enum(['scored', 'errored']);
export type EvalCaseStatus = z.infer<typeof EvalCaseStatus>;

export const EvalCaseOutcome = z.object({
  /** null for a draft dry run (case not saved). */
  case_id: z.string().nullable(),
  name: z.string(),
  expectation_type: EvalExpectationType,
  status: EvalCaseStatus,
  pass: z.boolean().nullable(),
  error_reason: z.string().nullable(),
  /** Grounded findings count. */
  findings_total: z.number().int(),
  findings_matched: z.number().int(),
  grounding_kept: z.number().int(),
  /** kept + dropped. */
  grounding_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  actual: z.array(EvalActualFinding),
});
export type EvalCaseOutcome = z.infer<typeof EvalCaseOutcome>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.array(z.string()),
  input_meta: EvalCaseMeta,
  expectation: EvalExpectation,
  source_finding_id: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  last_result: EvalCaseOutcome.nullable(),
  last_result_at: z.string().nullable(),
});
export type EvalCase = z.infer<typeof EvalCase>;

export const EvalCaseDraft = EvalCaseInput.extend({
  agent: z.object({ id: z.string(), name: z.string() }),
  source_triage: z.enum(['accepted', 'dismissed']),
  existing_case_id: z.string().nullable(),
});
export type EvalCaseDraft = z.infer<typeof EvalCaseDraft>;

// ---- Dry run ----
export const EvalDryRunInput = z.union([
  z.object({ case_id: z.string().uuid() }).strict(),
  z.object({ draft: EvalCaseInput }).strict(),
]);
export type EvalDryRunInput = z.infer<typeof EvalDryRunInput>;

export const EvalDryRunResult = EvalCaseOutcome;
export type EvalDryRunResult = z.infer<typeof EvalDryRunResult>;

// ---- Runs ----
export const EvalRunStatus = z.enum(['running', 'completed', 'errored']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

const Ratio = z.number().min(0).max(1).nullable();

export const EvalRun = z.object({
  recall: Ratio,
  precision: Ratio,
  citation_accuracy: Ratio,
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  cases_errored: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_case: z.array(EvalCaseOutcome),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalRunRecord = EvalRun.extend({
  id: z.string(),
  agent_id: z.string(),
  agent_version: z.number().int(),
  status: EvalRunStatus,
  error_reason: z.string().nullable(),
  ran_at: z.string(),
  finished_at: z.string().nullable(),
  case_ids: z.array(z.string()),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

export const EvalRunSummary = EvalRunRecord.omit({ per_case: true }).extend({
  cases_done: z.number().int(),
});
export type EvalRunSummary = z.infer<typeof EvalRunSummary>;

export const EvalRunEstimate = z.object({
  cases: z.number().int(),
  executions: z.number().int(),
  est_cost_usd: z.number().nullable(),
});
export type EvalRunEstimate = z.infer<typeof EvalRunEstimate>;

export const EvalRunAllResult = z.object({
  results: z.array(
    z.object({
      agent_id: z.string(),
      agent_name: z.string(),
      run_id: z.string().nullable(),
      error: z.object({ code: z.string(), message: z.string() }).nullable(),
    }),
  ),
});
export type EvalRunAllResult = z.infer<typeof EvalRunAllResult>;

// ---- Compare ----
export const EvalMetricDelta = z.object({
  old: z.number().nullable(),
  new: z.number().nullable(),
  delta: z.number().nullable(),
});
export type EvalMetricDelta = z.infer<typeof EvalMetricDelta>;

export const EvalCompare = z.object({
  old: EvalRunRecord,
  new: EvalRunRecord,
  common_cases: z.number().int(),
  metrics: z.object({
    recall: EvalMetricDelta,
    precision: EvalMetricDelta,
    citation_accuracy: EvalMetricDelta,
    cost_usd: EvalMetricDelta,
  }),
  case_set: z.object({
    same: z.boolean(),
    added: z.array(z.object({ case_id: z.string(), name: z.string() })),
    removed: z.array(z.object({ case_id: z.string(), name: z.string() })),
  }),
  prompt: z.object({
    old_version: z.number().int(),
    new_version: z.number().int(),
    unchanged: z.boolean(),
    diff: z.array(
      z.object({ op: z.enum(['equal', 'add', 'remove']), line: z.string() }),
    ),
  }),
});
export type EvalCompare = z.infer<typeof EvalCompare>;

// ---- Dashboard ----
export const EvalTrendPoint = z.object({
  run_id: z.string(),
  ran_at: z.string(),
  agent_version: z.number().int(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  pass_rate: z.number().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

export const EvalBanner = z.object({
  metric: z.enum(['recall', 'precision', 'citation_accuracy']),
  direction: z.enum(['up', 'down']),
  delta_pts: z.number(),
  version: z.number().int(),
  flipped: z.array(
    z.object({
      case_id: z.string(),
      name: z.string(),
      from_pass: z.boolean(),
      to_pass: z.boolean(),
    }),
  ),
});
export type EvalBanner = z.infer<typeof EvalBanner>;

export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  name: z.string(),
  model: z.string(),
  provider: z.string(),
  cases_total: z.number().int(),
  last_run: EvalRunSummary.nullable(),
  trend: z.array(EvalTrendPoint),
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;

export const EvalDashboard = z.object({
  agents: z.array(EvalAgentSummary),
  recent_runs: z.array(EvalRunSummary.extend({ agent_name: z.string() })),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

export const EvalAgentDetail = z.object({
  agent: z.object({
    id: z.string(),
    name: z.string(),
    model: z.string(),
    provider: z.string(),
    version: z.number().int(),
  }),
  cases_total: z.number().int(),
  latest: EvalRunSummary.nullable(),
  previous: EvalRunSummary.nullable(),
  /** Deltas in percentage points. */
  delta: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
  }),
  trend: z.array(EvalTrendPoint),
  runs: z.array(EvalRunSummary),
  banner: EvalBanner.nullable(),
});
export type EvalAgentDetail = z.infer<typeof EvalAgentDetail>;
