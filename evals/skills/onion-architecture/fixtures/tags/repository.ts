import { and, asc, count, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { TagRow } from '../../db/rows.js';

export type { TagRow };

export interface InsertTag {
  workspaceId: string;
  name: string;
  color: string;
}

export class TagsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<TagRow[]> {
    return this.db
      .select()
      .from(t.tags)
      .where(eq(t.tags.workspaceId, workspaceId))
      .orderBy(asc(t.tags.name));
  }

  async count(workspaceId: string): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(t.tags)
      .where(eq(t.tags.workspaceId, workspaceId));
    return value;
  }

  async findByName(workspaceId: string, name: string): Promise<TagRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.tags)
      .where(and(eq(t.tags.workspaceId, workspaceId), eq(t.tags.name, name)))
      .limit(1);
    return row;
  }

  async insert(values: InsertTag): Promise<TagRow> {
    const [row] = await this.db.insert(t.tags).values(values).returning();
    return row!;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.tags)
      .where(and(eq(t.tags.workspaceId, workspaceId), eq(t.tags.id, id)))
      .returning({ id: t.tags.id });
    return rows.length > 0;
  }
}
