import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { DigestRow } from '../../db/rows.js';

export type { DigestRow };

export interface InsertDigest {
  workspaceId: string;
  repoId: string;
  since: Date;
  pullCount: number;
  reviewedCount: number;
  blockingCount: number;
  summary: string;
}

export class DigestsRepository {
  constructor(private db: Db) {}

  async insert(values: InsertDigest): Promise<DigestRow> {
    const [row] = await this.db.insert(t.digests).values(values).returning();
    return row!;
  }

  async get(workspaceId: string, id: string): Promise<DigestRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.digests)
      .where(and(eq(t.digests.workspaceId, workspaceId), eq(t.digests.id, id)))
      .limit(1);
    return row;
  }
}
