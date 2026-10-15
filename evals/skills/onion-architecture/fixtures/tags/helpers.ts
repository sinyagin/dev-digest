import type { Tag } from '@devdigest/shared';
import type { TagRow } from './repository.js';

export function toTagDto(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    created_at: row.createdAt.toISOString(),
  };
}
