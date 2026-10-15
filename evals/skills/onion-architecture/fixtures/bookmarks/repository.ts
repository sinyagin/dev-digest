import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { ConflictError } from '../../platform/errors.js';
import type { BookmarkRow } from '../../db/rows.js';

export type { BookmarkRow };

export const MAX_BOOKMARKS_PER_WORKSPACE = 200;

export interface InsertBookmark {
  workspaceId: string;
  pullId: string;
  note: string | null;
  createdBy: string;
}

export class BookmarksRepository {
  constructor(private db: Db) {}

  async insert(values: InsertBookmark): Promise<BookmarkRow> {
    const [{ value: existing }] = await this.db
      .select({ value: count() })
      .from(t.bookmarks)
      .where(eq(t.bookmarks.workspaceId, values.workspaceId));
    if (existing >= MAX_BOOKMARKS_PER_WORKSPACE) {
      throw new ConflictError(
        `workspace already has ${MAX_BOOKMARKS_PER_WORKSPACE} bookmarks; remove one first`,
      );
    }

    const [dupe] = await this.db
      .select({ id: t.bookmarks.id })
      .from(t.bookmarks)
      .where(
        and(eq(t.bookmarks.workspaceId, values.workspaceId), eq(t.bookmarks.pullId, values.pullId)),
      )
      .limit(1);
    if (dupe) {
      throw new ConflictError('this pull request is already bookmarked');
    }

    const [row] = await this.db.insert(t.bookmarks).values(values).returning();
    return row!;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.bookmarks)
      .where(and(eq(t.bookmarks.workspaceId, workspaceId), eq(t.bookmarks.id, id)))
      .returning({ id: t.bookmarks.id });
    return rows.length > 0;
  }
}
