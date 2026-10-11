import type { Bookmark } from '@devdigest/shared';
import type { BookmarkRow } from './repository.js';

export function toBookmarkDto(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    pull_id: row.pullId,
    note: row.note,
    created_at: row.createdAt.toISOString(),
  };
}
