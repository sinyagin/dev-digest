import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tag } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { TagsService } from './service.js';

const CreateTagBody = z.object({
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});

export default async function tagsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new TagsService(app.container);

  app.get('/tags', async (req): Promise<Tag[]> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/tags', { schema: { body: CreateTagBody } }, async (req, reply): Promise<Tag> => {
    const { workspaceId } = await getContext(app.container, req);
    const tag = await service.create(workspaceId, req.body.name, req.body.color);
    reply.code(201);
    return tag;
  });

  app.delete('/tags/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.remove(workspaceId, req.params.id);
    reply.code(204);
  });
}
