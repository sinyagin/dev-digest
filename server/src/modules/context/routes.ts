/**
 * Project Context HTTP module (T9 — SPEC-01-project-context).
 *
 *   GET /repos/:repoId/context          → ContextListing (AC-2, AC-34)
 *   GET /repos/:repoId/context/document → ContextDocumentContent, `path` as
 *                                          a query string param (paths
 *                                          contain `/`, so it can't be a
 *                                          path segment) — AC-10, AC-37
 *   PUT /repos/:repoId/context/document → write, body { path, content };
 *                                          echoes the written document back
 *                                          as ContextDocumentContent so the
 *                                          already-committed client hook
 *                                          (`useWriteContextDocument`, which
 *                                          reads `data.path` on success) gets
 *                                          a usable response — AC-24
 *
 * Thin Fastify shell only: each handler resolves tenancy via `getContext`
 * then delegates to `ContextService` (T8). No Drizzle/fs here — see
 * onion-architecture. `POST /repos/:repoId/context/reindex` is an explicit
 * non-goal of this feature and is deliberately not implemented.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextDocumentWrite } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { ContextService } from './service.js';

/** `/repos/:repoId/...` — repoId addresses a DB row (uuid primary key). */
const RepoParams = z.object({ repoId: z.string().uuid() });

/** `path` arrives as a query string param — see module doc comment above. */
const DocumentQuery = z.object({ path: z.string().min(1) });

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ContextService(app.container);

  app.get('/repos/:repoId/context', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.repoId);
  });

  app.get(
    '/repos/:repoId/context/document',
    { schema: { params: RepoParams, querystring: DocumentQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDocument(workspaceId, req.params.repoId, req.query.path);
    },
  );

  app.put(
    '/repos/:repoId/context/document',
    { schema: { params: RepoParams, body: ContextDocumentWrite } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.writeDocument(workspaceId, req.params.repoId, req.body.path, req.body.content);
      // writeDocument() returns void (AC-24: write-only, no git commit/push) —
      // re-read via getDocument() so the response carries fresh
      // size/token/updated_at, matching ContextDocumentContent end to end.
      return service.getDocument(workspaceId, req.params.repoId, req.body.path);
    },
  );
}
