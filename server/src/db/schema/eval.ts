import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff').notNull(),
    inputFiles: jsonb('input_files').notNull(),
    inputMeta: jsonb('input_meta').notNull(),
    expectedOutput: jsonb('expected_output').notNull(),
    // No FK: the case outlives the finding it was made from (D8).
    sourceFindingId: uuid('source_finding_id'),
    notes: text('notes'),
    lastResult: jsonb('last_result'),
    lastResultAt: timestamp('last_result_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    ownerIdx: index('eval_cases_owner_idx').on(t.workspaceId, t.ownerKind, t.ownerId),
    // NULLs are distinct, so manual cases (null source) are unrestricted (D13).
    sourceUq: uniqueIndex('eval_cases_owner_source_uq').on(t.ownerKind, t.ownerId, t.sourceFindingId),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    agentVersion: integer('agent_version').notNull(),
    status: text('status', { enum: ['running', 'completed', 'errored'] })
      .notNull()
      .default('running'),
    errorReason: text('error_reason'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    caseIds: jsonb('case_ids').notNull(),
    tracesPassed: integer('traces_passed').notNull().default(0),
    tracesTotal: integer('traces_total').notNull().default(0),
    casesErrored: integer('cases_errored').notNull().default(0),
    perCase: jsonb('per_case').notNull().default([]),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    agentRanIdx: index('eval_runs_agent_ran_idx').on(t.agentId, t.ranAt),
    wsRanIdx: index('eval_runs_ws_ran_idx').on(t.workspaceId, t.ranAt),
    oneRunning: uniqueIndex('eval_runs_one_running_per_agent')
      .on(t.agentId)
      .where(sql`status = 'running'`),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
