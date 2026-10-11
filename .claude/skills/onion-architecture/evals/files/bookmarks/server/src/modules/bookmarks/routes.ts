import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BookmarksService } from './service.js';
import { toBookmarkDto } from './helpers.js';

const CreateBookmarkBody = z.object({
  pull_id: z.string().uuid(),
  note: z.string().max(500).optional(),
});

export default async function bookmarksRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BookmarksService(app.container);

  app.get('/bookmarks', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const rows = await app.container.db
      .select()
      .from(t.bookmarks)
      .where(eq(t.bookmarks.workspaceId, workspaceId))
      .orderBy(desc(t.bookmarks.createdAt));
    return rows.map(toBookmarkDto);
  });

  app.post('/bookmarks', { schema: { body: CreateBookmarkBody } }, async (req, reply) => {
    const created = await service.create(req);
    reply.code(201);
    return created;
  });

  app.delete('/bookmarks/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.remove(workspaceId, req.params.id);
    reply.code(204);
  });
}
