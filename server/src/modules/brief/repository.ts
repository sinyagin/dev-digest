import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export class BriefRepository {
  constructor(private readonly db: Db) {}

  async getBriefJson(prId: string): Promise<unknown | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row?.json;
  }

  async upsertBriefJson(prId: string, json: unknown): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json })
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: { json },
      });
  }
}
