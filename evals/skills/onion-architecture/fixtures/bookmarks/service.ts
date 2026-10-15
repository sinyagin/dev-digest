import type { FastifyRequest } from 'fastify';
import type { Bookmark } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { getContext } from '../_shared/context.js';
import { BookmarksRepository } from './repository.js';
import { toBookmarkDto } from './helpers.js';

interface CreateBookmarkBody {
  pull_id: string;
  note?: string;
}

export class BookmarksService {
  private repo: BookmarksRepository;

  constructor(private container: Container) {
    this.repo = new BookmarksRepository(container.db);
  }

  async create(req: FastifyRequest): Promise<Bookmark> {
    const { workspaceId, userId } = await getContext(this.container, req);
    const body = req.body as CreateBookmarkBody;
    const row = await this.repo.insert({
      workspaceId,
      pullId: body.pull_id,
      note: body.note ?? null,
      createdBy: userId,
    });
    return toBookmarkDto(row);
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const deleted = await this.repo.delete(workspaceId, id);
    if (!deleted) throw new NotFoundError(`bookmark ${id} not found`);
  }
}
