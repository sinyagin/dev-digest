import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  doublePrecision,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { workspaces } from './core';
import { agentRuns } from './runs';

/**
 * An installation is (agent x repository x target) (SPEC-04 D2). Workspace
 * scoping is via the owning agent. `triggers`/`post_as` are what the workflow
 * was generated with, so "Update CI config" can republish identically (AC-46).
 */
export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    triggers: jsonb('triggers')
      .$type<string[]>()
      .notNull()
      .default(['opened', 'synchronize']),
    postAs: text('post_as', { enum: ['github_review', 'pr_comment', 'none'] })
      .notNull()
      .default('github_review'),
    /** agents.version at export time (D13). */
    exportedAgentVersion: integer('exported_agent_version').notNull().default(1),
    /** Generator WORKFLOW_VERSION at export time (D13). */
    workflowVersion: integer('workflow_version').notNull().default(1),
    prUrl: text('pr_url'),
  },
  (t) => ({
    // Also serves as the agent_id FK index (leftmost column).
    uq: uniqueIndex('ci_installations_agent_repo_target_uq').on(t.agentId, t.repo, t.targetType),
  }),
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    /** The `agent_runs` row (source='ci') created for an accepted run. */
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    /** GitHub Actions workflow run id — ingestion is idempotent on it (AC-39). */
    workflowRunId: bigint('workflow_run_id', { mode: 'number' }).notNull(),
    repo: text('repo'),
    agentName: text('agent_name'),
    prNumber: integer('pr_number'),
    prUrl: text('pr_url'),
    commitSha: text('commit_sha'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    verdict: text('verdict'),
    findingsCount: integer('findings_count'),
    critical: integer('critical'),
    warning: integer('warning'),
    suggestion: integer('suggestion'),
    blockers: integer('blockers'),
    costUsd: doublePrecision('cost_usd'),
    durationMs: integer('duration_ms'),
    githubUrl: text('github_url'),
    source: text('source'),
    /** Why the run is `failed` (a D6 check name or the runner's error category). */
    failureReason: text('failure_reason'),
  },
  (t) => ({
    // Workflow run ids are global on GitHub; scoping by workspace lets two
    // workspaces track the same repo without colliding.
    runUq: uniqueIndex('ci_runs_ws_workflow_run_uq').on(t.workspaceId, t.workflowRunId),
    instIdx: index('ci_runs_installation_idx').on(t.ciInstallationId),
    agentRunIdx: index('ci_runs_agent_run_idx').on(t.agentRunId),
    wsRanIdx: index('ci_runs_ws_ran_idx').on(t.workspaceId, t.ranAt),
  }),
);
