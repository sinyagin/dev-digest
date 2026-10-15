import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { EvalRunRow } from '../../../db/rows.js';

export type { EvalRunRow };
export type EvalRunWithAgent = EvalRunRow & { agentName: string | null };

export interface EvalRunMetrics {
  tracesPassed: number;
  tracesTotal: number;
  casesErrored: number;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
}

/** Eval runs (Drizzle only; rows in, rows out). Workspace-scoped except the run-id-keyed executor writes. */
export class EvalRunRepo {
  constructor(private readonly db: Db) {}

  /** Inserts a `running` row. The partial unique index rejects a 2nd running run per agent. */
  async insertRun(input: {
    workspaceId: string;
    agentId: string;
    agentVersion: number;
    caseIds: string[];
  }): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({ ...input, status: 'running' })
      .returning();
    return row!;
  }

  /** Atomic jsonb array append so concurrent/partial progress never loses outcomes. */
  async appendCaseOutcome(runId: string, outcome: unknown): Promise<void> {
    await this.db
      .update(t.evalRuns)
      .set({ perCase: sql`${t.evalRuns.perCase} || ${JSON.stringify([outcome])}::jsonb` })
      .where(eq(t.evalRuns.id, runId));
  }

  async completeRun(runId: string, metrics: EvalRunMetrics): Promise<void> {
    await this.db
      .update(t.evalRuns)
      .set({ ...metrics, status: 'completed', finishedAt: new Date() })
      .where(eq(t.evalRuns.id, runId));
  }

  async failRun(runId: string, reason: string): Promise<void> {
    await this.db
      .update(t.evalRuns)
      .set({ status: 'errored', errorReason: reason, finishedAt: new Date() })
      .where(eq(t.evalRuns.id, runId));
  }

  async getRun(workspaceId: string, id: string): Promise<EvalRunRow | null> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.id, id)))
      .limit(1);
    return row ?? null;
  }

  async listRunsByAgent(workspaceId: string, agentId: string, limit: number): Promise<EvalRunRow[]> {
    return this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.agentId, agentId)))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
  }

  async listRecentRuns(workspaceId: string, limit: number): Promise<EvalRunWithAgent[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, agentName: t.agents.name })
      .from(t.evalRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.evalRuns.agentId))
      .where(eq(t.evalRuns.workspaceId, workspaceId))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map((r) => ({ ...r.run, agentName: r.agentName ?? null }));
  }

  async runningRunForAgent(workspaceId: string, agentId: string): Promise<EvalRunRow | null> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.agentId, agentId),
          eq(t.evalRuns.status, 'running'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Marks stale `running` rows (ran_at < olderThan) errored/'interrupted'. null = all workspaces / agents. */
  async reconcileStale(
    workspaceId: string | null,
    agentId: string | null,
    olderThan: Date,
  ): Promise<number> {
    const conds: SQL[] = [eq(t.evalRuns.status, 'running'), lt(t.evalRuns.ranAt, olderThan)];
    if (workspaceId) conds.push(eq(t.evalRuns.workspaceId, workspaceId));
    if (agentId) conds.push(eq(t.evalRuns.agentId, agentId));
    const rows = await this.db
      .update(t.evalRuns)
      .set({ status: 'errored', errorReason: 'interrupted', finishedAt: new Date() })
      .where(and(...conds))
      .returning({ id: t.evalRuns.id });
    return rows.length;
  }
}
