import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CiExportInput, CiPreviewFileInput, CiRunsQuery, CiSecretsQuery } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiService } from './service.js';

/**
 * ci module routes (SPEC-04). Thin handlers: getContext -> one service call.
 * No route here calls an LLM; only `refresh` / `export` / `republish` / `secrets`
 * / `preview` (secret status) reach GitHub — listing stored runs never does.
 */
/** Refresh hits GitHub per installation — keep it modest (inactive under nodeEnv 'test'). */
const REFRESH_LIMIT = { max: 6, timeWindow: '1 minute' };

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container, app.log);

  app.get('/ci/targets', async () => service.listTargets());

  app.post(
    '/agents/:id/ci/preview',
    { schema: { params: IdParams, body: CiExportInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.preview(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/ci/preview/file',
    { schema: { params: IdParams, body: CiPreviewFileInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.previewFile(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/ci/export',
    { schema: { params: IdParams, body: CiExportInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.exportViaPr(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/ci/export/zip',
    { schema: { params: IdParams, body: CiExportInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const { filename, bytes } = await service.exportZip(workspaceId, req.params.id, req.body);
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(Buffer.from(bytes));
    },
  );

  app.get('/agents/:id/ci/installations', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listInstallations(workspaceId, req.params.id);
  });

  app.get('/ci/secrets', { schema: { querystring: CiSecretsQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.secretStatus(workspaceId, req.query.repo);
  });

  app.post('/agents/:id/ci/republish', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.republish(workspaceId, req.params.id);
  });

  // Bodyless POST: must not 400 (no body schema).
  app.post('/ci/runs/refresh', { config: { rateLimit: REFRESH_LIMIT } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.refresh(workspaceId);
  });

  app.get('/ci/runs', { schema: { querystring: CiRunsQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listRuns(workspaceId, req.query.agent_id);
  });
}
