import type { Tag } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { TagsRepository } from './repository.js';
import { toTagDto } from './helpers.js';

export const MAX_TAGS_PER_WORKSPACE = 50;

export class TagsService {
  private repo: TagsRepository;

  constructor(private container: Container) {
    this.repo = new TagsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Tag[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toTagDto);
  }

  async create(workspaceId: string, name: string, color: string): Promise<Tag> {
    const normalized = name.trim().toLowerCase();
    if ((await this.repo.count(workspaceId)) >= MAX_TAGS_PER_WORKSPACE) {
      throw new ConflictError(`workspace already has ${MAX_TAGS_PER_WORKSPACE} tags`);
    }
    if (await this.repo.findByName(workspaceId, normalized)) {
      throw new ConflictError(`tag "${normalized}" already exists`);
    }
    const row = await this.repo.insert({ workspaceId, name: normalized, color });
    return toTagDto(row);
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const deleted = await this.repo.delete(workspaceId, id);
    if (!deleted) throw new NotFoundError(`tag ${id} not found`);
  }
}
