import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW: Review = {
  verdict: 'comment',
  summary: 'ok',
  score: 90,
  findings: [],
};

let seq = 0;

d('SPEC-04 multi-agent (Testcontainers pg)', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let workspaceId: string;
  let llm: MockLLMProvider;

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    await seed(db);
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(extra: { rateLimit?: boolean } = {}) {
    llm = new MockLLMProvider('openai', { structured: REVIEW });
    return buildApp({
      config: extra.rateLimit
        ? { ...config(), nodeEnv: 'production', logLevel: 'silent' }
        : config(),
      db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      },
    });
  }

  async function newPr() {
    const name = `ma-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 100 + seq,
        title: 'T',
        author: 'a',
        branch: 'f',
        base: 'main',
        headSha: 'abc',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'b',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repo: repo!, pr: pr! };
  }

  async function newAgent(name: string, ws = workspaceId) {
    const [a] = await db
      .insert(t.agents)
      .values({ workspaceId: ws, name, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'p' })
      .returning();
    return a!;
  }

  const counts = async () => ({
    parents: (await db.select().from(t.multiAgentRuns)).length,
    runs: (await db.select().from(t.agentRuns)).length,
  });

  it('AC-14/16/75: invalid agentIds shapes and combinations → 400, nothing created', async () => {
    const app = await appWith();
    const { pr } = await newPr();
    const a = await newAgent(`A14-${seq}`);
    const before = await counts();
    const post = (payload: unknown) =>
      app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: payload as object });

    expect((await post({ agentIds: [a.id] })).statusCode).toBe(400);
    expect((await post({ agentIds: [a.id, a.id] })).statusCode).toBe(400);
    const nine = Array.from({ length: 9 }, () => randomUUID());
    expect((await post({ agentIds: nine })).statusCode).toBe(400);
    expect((await post({ agentIds: [a.id, 'not-a-uuid'] })).statusCode).toBe(400);
    expect((await post({ agentIds: [a.id, randomUUID()], agentId: a.id })).statusCode).toBe(400);
    expect((await post({ agentIds: [a.id, randomUUID()], all: true })).statusCode).toBe(400);

    expect(await counts()).toEqual(before);
    await app.close();
  });

  it('AC-15/73: a foreign-workspace agent id → 404 and no rows', async () => {
    const app = await appWith();
    const { pr } = await newPr();
    const mine = await newAgent(`A15-${seq}`);
    const [other] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    const foreign = await newAgent(`F15-${seq}`, other!.id);
    const before = await counts();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentIds: [mine.id, foreign.id] },
    });
    expect(res.statusCode).toBe(404);
    expect(await counts()).toEqual(before);
    await app.close();
  });

  it('AC-17/18: valid request links N children to one parent; all:true creates no parent', async () => {
    const app = await appWith();
    const { pr } = await newPr();
    const a = await newAgent(`A17a-${seq}`);
    const b = await newAgent(`A17b-${seq}`);
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentIds: [a.id, b.id, a.id] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.multi_agent_run_id).toEqual(expect.any(String));
    expect(body.runs).toHaveLength(2);
    const runs = await waitForPrRuns(db, pr.id, { expected: 2 });
    expect(runs).toHaveLength(2);
    for (const r of runs) expect(r.multiAgentRunId).toBe(body.multi_agent_run_id);
    const parents = await db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.id, body.multi_agent_run_id));
    expect(parents).toHaveLength(1);

    const { pr: pr2 } = await newPr();
    const before = (await counts()).parents;
    const res2 = await app.inject({ method: 'POST', url: `/pulls/${pr2.id}/review`, payload: { all: true } });
    expect(res2.json().multi_agent_run_id).toBeNull();
    await waitForPrRuns(db, pr2.id);
    expect((await counts()).parents).toBe(before);
    await app.close();
  });

  it('AC-74: the 11th trigger within a minute is rate limited (429)', async () => {
    const app = await appWith({ rateLimit: true });
    const { pr } = await newPr();
    const ids = [randomUUID(), randomUUID()];
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentIds: ids } });
      expect(r.statusCode).toBe(404);
    }
    const r11 = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentIds: ids } });
    expect(r11.statusCode).toBe(429);
    await app.close();
  });

  // ---- reads -------------------------------------------------------------

  async function fixtureParent() {
    const { pr, repo } = await newPr();
    const [parent] = await db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId: pr.id })
      .returning();
    const aDone = await newAgent(`Zed-${seq}`);
    const aFail = await newAgent(`Alpha-${seq}`);
    const aRun = await newAgent(`Mid-${seq}`);
    const mk = (agentId: string, status: string, extra: Partial<typeof t.agentRuns.$inferInsert> = {}) =>
      db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId,
          prId: pr.id,
          provider: 'openai',
          model: 'gpt-4.1',
          status,
          multiAgentRunId: parent!.id,
          ...extra,
        })
        .returning()
        .then((r) => r[0]!);
    const done = await mk(aDone.id, 'done', { durationMs: 4000, costUsd: 0.04, score: 80 });
    const failed = await mk(aFail.id, 'failed', { durationMs: 1000, error: 'boom' });
    const running = await mk(aRun.id, 'running');
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        agentId: aDone.id,
        runId: done.id,
        kind: 'review',
        verdict: 'comment',
        summary: 'sum',
        score: 80,
        model: 'gpt-4.1',
      })
      .returning();
    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded key',
        rationale: 'Live key in source.',
        confidence: 0.9,
      })
      .returning();
    return { pr, repo, parent: parent!, aDone, aFail, aRun, done, failed, running, finding: finding! };
  }

  it('AC-22/23/24/25/73: GET /multi-agent-runs/:id is derived, read-only and workspace scoped', async () => {
    const app = await appWith();
    const f = await fixtureParent();
    const before = await counts();

    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/${f.parent.id}` });
    expect(res.statusCode).toBe(200);
    const run = res.json();
    expect(run).toMatchObject({
      id: f.parent.id,
      pr_id: f.pr.id,
      repo_id: f.repo.id,
      pr_number: f.pr.number,
      status: 'running',
      agent_count: 3,
      total_duration_ms: 4000,
      total_cost_usd: 0.04,
    });
    expect(run.columns.map((c: { agent_name: string }) => c.agent_name)).toEqual(
      [f.aFail.name, f.aRun.name, f.aDone.name].sort(),
    );
    const failedCol = run.columns.find((c: { run_id: string }) => c.run_id === f.failed.id);
    expect(failedCol).toMatchObject({ status: 'failed', error: 'boom', findings: [] });
    const doneCol = run.columns.find((c: { run_id: string }) => c.run_id === f.done.id);
    expect(doneCol).toMatchObject({ verdict: 'comment', summary: 'sum', score: 80, status: 'done' });
    expect(doneCol.findings[0]).toMatchObject({ id: f.finding.id, end_line: 11 });
    expect(run.conflicts).toHaveLength(1);
    expect(run.conflicts[0].takes[0].finding_ids).toEqual([f.finding.id]);

    // AC-24: a deleted agent keeps its column
    await db.delete(t.agents).where(eq(t.agents.id, f.aDone.id));
    const after = (await app.inject({ method: 'GET', url: `/multi-agent-runs/${f.parent.id}` })).json();
    expect(
      after.columns.find((c: { run_id: string }) => c.run_id === f.done.id).agent_name,
    ).toBe('Deleted agent');

    // AC-25
    expect(llm.calls).toHaveLength(0);
    expect(await counts()).toEqual(before);

    // AC-73 / AC-70
    const [other] = await db.insert(t.workspaces).values({ name: 'o2' }).returning();
    const [foreign] = await db
      .insert(t.multiAgentRuns)
      .values({ workspaceId: other!.id, prId: f.pr.id })
      .returning();
    expect((await app.inject({ method: 'GET', url: `/multi-agent-runs/${foreign!.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/multi-agent-runs/${randomUUID()}` })).statusCode).toBe(404);
    await app.close();
  });

  it('AC-6b: GET /multi-agent-runs lists recent runs newest first, repo-filtered and workspace scoped', async () => {
    const app = await appWith();
    const f = await fixtureParent();
    // A second, newer parent on the same PR with no children → failed, zero totals.
    const [newer] = await db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId: f.pr.id, ranAt: new Date(Date.now() + 60_000) })
      .returning();
    // Another repo's run and a foreign workspace's run must not appear under this repo.
    const other = await newPr();
    await db.insert(t.multiAgentRuns).values({ workspaceId, prId: other.pr.id });
    const [ws2] = await db.insert(t.workspaces).values({ name: `o-list-${seq}` }).returning();
    await db.insert(t.multiAgentRuns).values({ workspaceId: ws2!.id, prId: f.pr.id });
    const before = await counts();

    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs?repoId=${f.repo.id}` });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.map((r: { id: string }) => r.id)).toEqual([newer!.id, f.parent.id]);
    expect(list[0]).toMatchObject({ status: 'failed', agent_count: 0, total_duration_ms: 0 });
    expect(list[1]).toMatchObject({
      repo_id: f.repo.id,
      pr_id: f.pr.id,
      pr_number: f.pr.number,
      pr_title: 'T',
      status: 'running',
      agent_count: 3,
      total_duration_ms: 4000,
      total_cost_usd: 0.04,
    });

    // prId filter: only that PR's runs
    const byPr = await app.inject({ method: 'GET', url: `/multi-agent-runs?prId=${other.pr.id}` });
    expect(byPr.json().map((r: { pr_id: string }) => r.pr_id)).toEqual([other.pr.id]);

    // limit + validation; read-only
    const one = await app.inject({ method: 'GET', url: `/multi-agent-runs?repoId=${f.repo.id}&limit=1` });
    expect(one.json()).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/multi-agent-runs?limit=0' })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await app.inject({ method: 'GET', url: '/multi-agent-runs?repoId=nope' })).statusCode).toBeGreaterThanOrEqual(400);
    expect(llm.calls).toHaveLength(0);
    expect(await counts()).toEqual(before);
    await app.close();
  });

  it('AC-10: GET /agents/estimates averages done runs, nulls for agents without any', async () => {
    const app = await appWith();
    const { pr } = await newPr();
    const withRuns = await newAgent(`E1-${seq}`);
    const without = await newAgent(`E2-${seq}`);
    for (const [ms, cost] of [
      [2000, 0.02],
      [4000, 0.04],
    ] as const) {
      await db.insert(t.agentRuns).values({
        workspaceId,
        agentId: withRuns.id,
        prId: pr.id,
        status: 'done',
        durationMs: ms,
        costUsd: cost,
      });
    }
    await db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: withRuns.id, prId: pr.id, status: 'failed', durationMs: 99999 });

    const res = await app.inject({ method: 'GET', url: '/agents/estimates' });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { agent_id: string; avg_duration_ms: number | null; avg_cost_usd: number | null; sample_size: number }[];
    const e1 = list.find((x) => x.agent_id === withRuns.id)!;
    expect(e1.avg_duration_ms).toBe(3000);
    expect(e1.avg_cost_usd).toBeCloseTo(0.03, 10);
    expect(e1.sample_size).toBe(2);
    expect(list.find((x) => x.agent_id === without.id)).toEqual({
      agent_id: without.id,
      avg_duration_ms: null,
      avg_cost_usd: null,
      sample_size: 0,
    });
    expect(llm.calls).toHaveLength(0);
    await app.close();
  });

  // ---- Learn --------------------------------------------------------------

  it('AC-53/54/77: Learn creates one deterministic memory row, is idempotent, and is workspace scoped', async () => {
    const app = await appWith();
    const f = await fixtureParent();
    const url = `/findings/${f.finding.id}/learn`;

    const r1 = await app.inject({ method: 'POST', url });
    expect(r1.statusCode).toBe(200);
    const b1 = r1.json();
    expect(b1.finding.id).toBe(f.finding.id);
    const r2 = await app.inject({ method: 'POST', url });
    expect(r2.json().memory_id).toBe(b1.memory_id);

    const rows = await db.select().from(t.memory).where(eq(t.memory.id, b1.memory_id));
    expect(rows).toHaveLength(1);
    const m = rows[0]!;
    expect(m).toMatchObject({ kind: 'learning', scope: 'repo', repoId: f.repo.id, workspaceId });
    expect(m.content).toContain('Hardcoded key');
    expect(m.content).toContain('Live key in source.');
    expect(m.content).toContain('src/config.ts:11-11');
    expect(m.sources).toEqual([{ pr: f.pr.number, context: `finding:${f.finding.id}` }]);
    const all = await db.select().from(t.memory);
    expect(all.filter((x) => JSON.stringify(x.sources).includes(f.finding.id))).toHaveLength(1);
    expect(llm.calls).toHaveLength(0);

    // AC-77: foreign-workspace finding → 404 and no row
    const [other] = await db.insert(t.workspaces).values({ name: 'o3' }).returning();
    const [fpr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: other!.id,
        repoId: f.repo.id,
        number: 9999,
        title: 'x',
        author: 'x',
        branch: 'x',
        base: 'main',
        headSha: 'x',
        additions: 0,
        deletions: 0,
        filesCount: 0,
        status: 'needs_review',
      })
      .returning();
    const [frev] = await db
      .insert(t.reviews)
      .values({ workspaceId: other!.id, prId: fpr!.id, kind: 'review' })
      .returning();
    const [ffind] = await db
      .insert(t.findings)
      .values({
        reviewId: frev!.id,
        file: 'x.ts',
        startLine: 1,
        endLine: 1,
        severity: 'WARNING',
        category: 'bug',
        title: 'x',
        rationale: 'x',
        confidence: 0.5,
      })
      .returning();
    const memBefore = (await db.select().from(t.memory)).length;
    expect((await app.inject({ method: 'POST', url: `/findings/${ffind!.id}/learn` })).statusCode).toBe(404);
    expect((await db.select().from(t.memory)).length).toBe(memBefore);
    await app.close();
  });
});
