import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotificationChannel } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotificationsService } from './service.js';

const ListQuery = z.object({ unread: z.coerce.boolean().optional() });

const PreferencesBody = z.object({
  channel: NotificationChannel,
  muted_kinds: z.array(z.string()).default([]),
});

export default async function notificationsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new NotificationsService(app.container);

  app.get('/notifications', { schema: { querystring: ListQuery } }, async (req) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    return service.list(workspaceId, userId, req.query.unread ?? false);
  });

  app.post('/notifications/:id/read', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    await service.markRead(workspaceId, userId, req.params.id);
    reply.code(204);
  });

  app.get('/notifications/preferences', async (req) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    return service.getPreferences(workspaceId, userId);
  });

  app.put('/notifications/preferences', { schema: { body: PreferencesBody } }, async (req) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    return service.setPreferences(workspaceId, userId, req.body.channel, req.body.muted_kinds);
  });
}
