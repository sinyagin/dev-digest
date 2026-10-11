import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { DigestsService } from './service.js';

const CreateDigestBody = z.object({
  repo_id: z.string().uuid(),
  since: z.string().datetime(),
});

export default async function digestsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new DigestsService(app.container);

  app.post('/digests', { schema: { body: CreateDigestBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const digest = await service.generate(workspaceId, req.body.repo_id, new Date(req.body.since));
    reply.code(201);
    return digest;
  });

  app.get('/digests/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });
}
