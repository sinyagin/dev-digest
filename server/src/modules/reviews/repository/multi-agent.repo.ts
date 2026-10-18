import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

// ---- multi-agent runs (SPEC-04) ------------------------------------------

/**
 * Create the parent `multi_agent_runs` row plus one `agent_runs` child per agent
 * (status `running`, linked via `multi_agent_run_id`) in ONE transaction, so a
 * failure leaves neither a parent without children nor orphan children (AC-17).
 * Returns the parent id and the child run ids in input order.
 */
export async function createMultiAgentRunWithChildren(
  db: Db,
  input: {
    workspaceId: string;
    prId: string;
    agents: { id: string; provider: string | null; model: string | null }[];
  },
): Promise<{ multiAgentRunId: string; runIds: string[] }> {
  return db.transaction(async (tx) => {
    const [parent] = await tx
      .insert(t.multiAgentRuns)
      .values({ workspaceId: input.workspaceId, prId: input.prId })
      .returning({ id: t.multiAgentRuns.id });
    const multiAgentRunId = parent!.id;
    const rows = await tx
      .insert(t.agentRuns)
      .values(
        input.agents.map((a) => ({
          workspaceId: input.workspaceId,
          agentId: a.id,
          prId: input.prId,
          provider: a.provider,
          model: a.model,
          multiAgentRunId,
          status: 'running',
          source: 'local' as const,
        })),
      )
      .returning({ id: t.agentRuns.id, agentId: t.agentRuns.agentId });
    // `returning` order is not contractually guaranteed: re-order by agent id.
    const byAgent = new Map(rows.map((r) => [r.agentId, r.id]));
    return { multiAgentRunId, runIds: input.agents.map((a) => byAgent.get(a.id)!) };
  });
}

// ---- reads (workspace-scoped) ---------------------------------------------

export type MultiAgentRunRow = typeof t.multiAgentRuns.$inferSelect;
export type AgentRunRow = typeof t.agentRuns.$inferSelect;
export type ReviewRowT = typeof t.reviews.$inferSelect;
export type FindingRowT = typeof t.findings.$inferSelect;

/** The parent row, scoped by workspace (foreign workspace → undefined). */
export async function getMultiAgentRun(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<MultiAgentRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.multiAgentRuns)
    .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.id, id)));
  return row;
}

/**
 * Children of a parent, left-joined to `agents` (name; null when deleted) and
 * `reviews` (verdict/summary; null for runs that produced none). `reviews.run_id`
 * has no FK, so the join is a plain equality.
 */
export async function childrenOfMultiAgentRun(
  db: Db,
  multiAgentRunId: string,
): Promise<{ run: AgentRunRow; agentName: string | null; review: ReviewRowT | null }[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name, review: t.reviews })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .leftJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
    .where(eq(t.agentRuns.multiAgentRunId, multiAgentRunId));
  return rows.map((r) => ({ run: r.run, agentName: r.agentName ?? null, review: r.review ?? null }));
}

/**
 * Recent parents for the "Recent runs" list, newest first, workspace-scoped and
 * optionally filtered by repo and/or PR, each with its PR number/title and the children's
 * status/duration/cost (for the derived status + totals). Two queries, no N+1.
 */
export async function listMultiAgentRuns(
  db: Db,
  workspaceId: string,
  opts: { repoId?: string; prId?: string; limit: number },
): Promise<
  {
    parent: MultiAgentRunRow;
    repoId: string;
    prNumber: number;
    prTitle: string;
    children: { status: string | null; durationMs: number | null; costUsd: number | null }[];
  }[]
> {
  const parents = await db
    .select({
      parent: t.multiAgentRuns,
      repoId: t.pullRequests.repoId,
      prNumber: t.pullRequests.number,
      prTitle: t.pullRequests.title,
    })
    .from(t.multiAgentRuns)
    .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
    .where(
      and(
        eq(t.multiAgentRuns.workspaceId, workspaceId),
        opts.repoId ? eq(t.pullRequests.repoId, opts.repoId) : undefined,
        opts.prId ? eq(t.multiAgentRuns.prId, opts.prId) : undefined,
      ),
    )
    .orderBy(desc(t.multiAgentRuns.ranAt), desc(t.multiAgentRuns.id))
    .limit(opts.limit);
  if (parents.length === 0) return [];

  const children = await db
    .select({
      multiAgentRunId: t.agentRuns.multiAgentRunId,
      status: t.agentRuns.status,
      durationMs: t.agentRuns.durationMs,
      costUsd: t.agentRuns.costUsd,
    })
    .from(t.agentRuns)
    .where(inArray(t.agentRuns.multiAgentRunId, parents.map((p) => p.parent.id)));

  return parents.map((p) => ({
    ...p,
    children: children
      .filter((c) => c.multiAgentRunId === p.parent.id)
      .map(({ status, durationMs, costUsd }) => ({ status, durationMs, costUsd })),
  }));
}

export async function findingsByReviewIds(db: Db, reviewIds: string[]): Promise<FindingRowT[]> {
  if (reviewIds.length === 0) return [];
  return db.select().from(t.findings).where(inArray(t.findings.reviewId, reviewIds));
}

/**
 * Per-agent average duration/cost over each agent's last 20 `done` runs
 * (row_number window over `ran_at desc`). Averages ignore nulls; an agent with
 * no done runs is simply absent (the service fills in the nulls).
 */
export async function estimatesForWorkspace(
  db: Db,
  workspaceId: string,
): Promise<
  { agentId: string; avgDurationMs: number | null; avgCostUsd: number | null; sampleSize: number }[]
> {
  const result = await db.execute(sql`
    SELECT agent_id,
           avg(duration_ms)::float8 AS avg_duration_ms,
           avg(cost_usd)::float8   AS avg_cost_usd,
           count(*)::int           AS sample_size
    FROM (
      SELECT agent_id, duration_ms, cost_usd,
             row_number() OVER (PARTITION BY agent_id ORDER BY ran_at DESC) AS rn
      FROM agent_runs
      WHERE workspace_id = ${workspaceId} AND status = 'done' AND agent_id IS NOT NULL
    ) ranked
    WHERE rn <= 20
    GROUP BY agent_id
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
    agent_id: string;
    avg_duration_ms: number | null;
    avg_cost_usd: number | null;
    sample_size: number;
  }[];
  return rows.map((r) => ({
    agentId: r.agent_id,
    avgDurationMs: r.avg_duration_ms,
    avgCostUsd: r.avg_cost_usd,
    sampleSize: r.sample_size,
  }));
}
