import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { EvalCaseRow } from '../../../db/rows.js';

export type { EvalCaseRow };
export type EvalCaseInsert = typeof t.evalCases.$inferInsert;
export type EvalCasePatch = Partial<
  Pick<EvalCaseInsert, 'name' | 'inputDiff' | 'inputFiles' | 'inputMeta' | 'expectedOutput' | 'notes'>
>;

/** Eval cases (Drizzle only; rows in, rows out). Every method is workspace-scoped. */
export class EvalCaseRepo {
  constructor(private readonly db: Db) {}

  async listCasesByOwner(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      )
      .orderBy(t.evalCases.createdAt);
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | null> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .limit(1);
    return row ?? null;
  }

  async findCaseBySource(
    workspaceId: string,
    agentId: string,
    findingId: string,
  ): Promise<EvalCaseRow | null> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
          eq(t.evalCases.sourceFindingId, findingId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async insertCase(values: EvalCaseInsert): Promise<EvalCaseRow> {
    const [row] = await this.db.insert(t.evalCases).values(values).returning();
    return row!;
  }

  async updateCase(workspaceId: string, id: string, patch: EvalCasePatch): Promise<EvalCaseRow | null> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row ?? null;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /** Denormalized "last result" shown on the case list; does not touch updatedAt. */
  async setLastResult(workspaceId: string, caseId: string, outcome: unknown, at: Date): Promise<void> {
    await this.db
      .update(t.evalCases)
      .set({ lastResult: outcome as never, lastResultAt: at })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)));
  }

  /** Case count per agent owner, reduced in JS (house style: no SQL GROUP BY). */
  async countCasesByOwner(workspaceId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ ownerId: t.evalCases.ownerId })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')));
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.ownerId, (counts.get(r.ownerId) ?? 0) + 1);
    return counts;
  }
}
