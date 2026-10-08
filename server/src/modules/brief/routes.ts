import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * brief module routes.
 *
 * GET  /pulls/:id/brief            → pure cache read (no LLM calls)
 * POST /pulls/:id/brief/generate   → always regenerates (modest rate limit — one LLM call)
 *
 * Onion layer: presentation — thin handlers: getContext → one service call → reply.
 * No business logic here. No response schema: `BriefReadResponse`/
 * `BriefGenerateResponse` are discriminated unions and `fastify-type-provider-zod`
 * would strip fields a partial schema doesn't describe.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // ---- GET: pure cache read -------------------------------------------------
  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new BriefService(app.container, req.log);
      return service.read(workspaceId, req.params.id);
    },
  );

  // ---- POST: force regenerate -------------------------------------------------
  // Rate-limited like intent's /recompute route — each call fans out to an LLM.
  app.post(
    '/pulls/:id/brief/generate',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new BriefService(app.container, req.log);
      return service.generate(workspaceId, req.params.id);
    },
  );
}
