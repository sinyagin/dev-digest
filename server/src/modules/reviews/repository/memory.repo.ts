import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

/**
 * Find-or-create the `learning` memory row for one finding (SPEC-04 D9).
 * Idempotent: the lookup + insert run in one transaction holding a per-finding
 * advisory lock, so two concurrent calls yield one row. No schema change — the
 * finding id is carried in `sources[0].context` as `finding:<id>`.
 */
export async function findOrCreateLearning(
  db: Db,
  input: { workspaceId: string; repoId: string; findingId: string; prNumber: number; content: string },
): Promise<string> {
  const context = `finding:${input.findingId}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.findingId}))`);
    const [existing] = await tx
      .select({ id: t.memory.id })
      .from(t.memory)
      .where(
        and(
          eq(t.memory.workspaceId, input.workspaceId),
          eq(t.memory.kind, 'learning'),
          sql`${t.memory.sources} @> ${JSON.stringify([{ context }])}::jsonb`,
        ),
      );
    if (existing) return existing.id;
    const [row] = await tx
      .insert(t.memory)
      .values({
        workspaceId: input.workspaceId,
        repoId: input.repoId,
        scope: 'repo',
        kind: 'learning',
        content: input.content,
        sources: [{ pr: input.prNumber, context }],
        confidence: null,
      })
      .returning({ id: t.memory.id });
    return row!.id;
  });
}
