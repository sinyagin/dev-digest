import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput, EvalDryRunInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalService } from './service.js';
import { agentSourceFrom, findingSourceFrom } from './ports.js';

/**
 * eval module routes (SPEC-03). Thin handlers: getContext -> one service call.
 *
 * Rate limits (only active when the global plugin is registered, i.e. not in
 * nodeEnv 'test'): LLM-backed triggers are limited; the polled run read is exempt.
 * Request bodies of the run triggers are intentionally absent — a bodyless POST
 * must not 400.
 */
const DRY_RUN_LIMIT = { max: 20, timeWindow: '1 minute' };
const START_RUN_LIMIT = { max: 5, timeWindow: '1 minute' };
const RUN_ALL_LIMIT = { max: 2, timeWindow: '1 minute' };

const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });
/** `source_finding_id` is immutable after create; strip it from updates. */
const UpdateCaseBody = EvalCaseInput.omit({ source_finding_id: true }).partial();

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(
    app.container,
    { findings: findingSourceFrom(app.container), agents: agentSourceFrom(app.container) },
    app.log,
  );

  // Q5: no run survives a restart — reap every `running` row. Awaited during
  // plugin registration, i.e. before the server accepts requests (same posture
  // as app.ts's agent_runs reaper), so a fresh run can never be reaped. Non-fatal.
  try {
    await service.reconcileOnBoot();
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'eval: reconcileOnBoot failed');
  }

  // ---- cases ----
  app.get('/findings/:id/eval-case-draft', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getDraftForFinding(workspaceId, req.params.id);
  });

  app.post(
    '/agents/:id/eval-cases/dry-run',
    { schema: { params: IdParams, body: EvalDryRunInput }, config: { rateLimit: DRY_RUN_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.dryRun(workspaceId, req.params.id, req.body);
    },
  );

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listCases(workspaceId, req.params.id);
  });

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createCase(workspaceId, req.params.id, req.body);
      return reply.code(201).send(created);
    },
  );

  app.get('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getCase(workspaceId, req.params.id);
  });

  app.put('/eval-cases/:id', { schema: { params: IdParams, body: UpdateCaseBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.updateCase(workspaceId, req.params.id, req.body);
  });

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.deleteCase(workspaceId, req.params.id);
    return reply.code(204).send();
  });

  // ---- runs ----
  app.get('/agents/:id/eval-runs/estimate', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.estimateRun(workspaceId, req.params.id);
  });

  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: START_RUN_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const run = await service.startRun(workspaceId, req.params.id);
      return reply.code(202).send(run);
    },
  );

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // Static segments first: /eval-runs/compare and /eval-runs/all must not hit /eval-runs/:id.
  app.get('/eval-runs/compare', { schema: { querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.compare(workspaceId, req.query.a, req.query.b);
  });

  app.post(
    '/eval-runs/all',
    { config: { rateLimit: RUN_ALL_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.startAll(workspaceId);
      return reply.code(202).send(result);
    },
  );

  app.get(
    '/eval-runs/:id',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getRun(workspaceId, req.params.id);
    },
  );

  // ---- analytics ----
  app.get('/eval/dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.dashboard(workspaceId);
  });

  app.get('/eval/agents/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.agentDetail(workspaceId, req.params.id);
  });
}
