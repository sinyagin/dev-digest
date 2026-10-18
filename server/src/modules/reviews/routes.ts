import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RunRequest } from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';
import { MultiAgentService } from './multi-agent-service.js';

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   GET    /pulls/:id/smart-diff                       → files grouped by risk role (no LLM call)
 *   POST   /findings/:id/(accept|dismiss|learn)        → finding actions
 *   GET    /multi-agent-runs?repoId=&prId=&limit=      → recent MultiAgentRunSummary[], newest first
 *   GET    /multi-agent-runs/:id                       → MultiAgentRun (computed on read)
 *   GET    /agents/estimates                           → per-agent run estimates
 */
const MultiAgentRunsQuery = z.object({
  repoId: z.string().uuid().optional(),
  prId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
const FINDING_ACTIONS = ['accept', 'dismiss', 'learn'] as const;
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);
  const multiAgent = new MultiAgentService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Body stays a tolerant manual parse (both fields optional; empty body is OK).
  app.post(
    '/pulls/:id/review',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const parsed = RunRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      // agentIds shape errors (non-uuid, <2, >8) are a 400 per AC-14/AC-75.
      if (parsed.error.issues.some((i) => i.path[0] === 'agentIds')) {
        throw new AppError('invalid_run_request', 'agentIds must be a list of 2-8 agent UUIDs', 400, parsed.error.issues);
      }
      throw parsed.error;
    }
    const body = parsed.data;
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
      ...(body.agentIds !== undefined ? { agentIds: body.agentIds } : {}),
    });
    const { runs, reviews, multi_agent_run_id } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
      { multiAgent: body.agentIds !== undefined },
    );
    return { pr_id: req.params.id, runs, reviews, multi_agent_run_id };
  });

  // ---- Multi-agent run: computed on read (no LLM call, no write) ----------
  app.get('/multi-agent-runs', { schema: { querystring: MultiAgentRunsQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const { repoId, prId, limit } = req.query;
    return multiAgent.list(workspaceId, { ...(repoId ? { repoId } : {}), ...(prId ? { prId } : {}), limit });
  });
  app.get('/multi-agent-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return multiAgent.get(workspaceId, req.params.id);
  });

  // ---- Per-agent run estimates (static path wins over /agents/:id) --------
  app.get('/agents/estimates', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return multiAgent.estimates(workspaceId);
  });

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    const runId = req.params.id;

    reply.sse(
      (async function* () {
        // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
        const queue: RunEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsubscribe = container.runBus.subscribe(runId, (e) => {
          queue.push(e);
          resolve?.();
        });
        const offDone = container.runBus.onDone(runId, () => {
          done = true;
          resolve?.();
        });

        try {
          while (true) {
            if (queue.length === 0) {
              if (done) break;
              await new Promise<void>((r) => (resolve = r));
              resolve = null;
              continue;
            }
            const e = queue.shift()!;
            yield {
              id: String(e.seq),
              event: e.kind,
              data: JSON.stringify(e),
            };
          }
        } finally {
          unsubscribe();
          offDone();
        }
      })(),
    );
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    await service.cancelRun(req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- Smart Diff: files grouped by risk, merged with latest findings -----
  // Deterministic — no LLM call.
  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getSmartDiff(workspaceId, req.params.id);
  });

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }
}
