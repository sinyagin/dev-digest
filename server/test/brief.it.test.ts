import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * Same diff shape as `reviews.it.test.ts`'s DIFF (line 11 added inside
 * src/config.ts) so grounding has a real, verifiable changed-line range to
 * check the fixture's "line 11" (valid) vs "line 999" (out of range) focus
 * items against.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const PATCH = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';

/**
 * The model-authored `BriefDraft` fixture. Deliberately includes TWO
 * grounding-bait items (AC: "fixture citing a bogus file path and an
 * out-of-range line"):
 *  - the risk cites an allowed file (src/config.ts) AND a bogus one
 *    (src/does-not-exist.ts) — grounding must drop only the bogus ref, keep
 *    the risk (one real ref survives).
 *  - review_focus has one in-range line (11, part of the diff hunk above)
 *    and one out-of-range line (999) on the same (allowed) file — grounding
 *    must null out the line, not drop the whole item.
 * Mutable so the "generate twice" test can change `.summary` between calls
 * and prove the stored row reflects the SECOND generation.
 */
function makeBriefDraftFixture() {
  return {
    summary: 'Adds rate limiting; introduces a hardcoded Stripe key risk.',
    risks: {
      risks: [
        {
          kind: 'security',
          title: 'Hardcoded secret',
          explanation: 'A live Stripe key is committed in src/config.ts.',
          severity: 'high' as const,
          file_refs: ['src/config.ts', 'src/does-not-exist.ts'],
        },
      ],
    },
    review_focus: [
      { file: 'src/config.ts', line: 11, reason: 'Review the added Stripe key line.' },
      { file: 'src/config.ts', line: 999, reason: 'Bogus out-of-range line.' },
    ],
  };
}

let repoSeq = 0;

async function createRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { withFiles?: boolean } = { withFiles: true },
) {
  const name = `payments-api-brief-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: opts.withFiles ? 1 : 0,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  if (opts.withFiles) {
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: PATCH,
    });
  }
  return { repo: repo!, pr: pr! };
}

/** Insert an agent + a (review, finding) row directly — no LLM call — so
 *  `BriefService.generate`'s Project Context lookup (`reviewsForPull()[0].agentId`)
 *  has a real agent to resolve `contextDocumentsFor`/`linkedSkills` against. */
async function attachReviewWithAgent(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
) {
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name: 'Brief Test Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'review',
      contextDocuments: [],
    })
    .returning();
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId,
      agentId: agent!.id,
      kind: 'review',
      verdict: 'request_changes',
      summary: 'Hardcoded secret found.',
      score: 65,
      model: 'gpt-4.1',
    })
    .returning();
  await db.insert(t.findings).values({
    reviewId: review!.id,
    file: 'src/config.ts',
    startLine: 11,
    endLine: 11,
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded Stripe secret key',
    rationale: 'A live Stripe key is committed in source.',
    confidence: 0.95,
  });
  return { agent: agent!, review: review! };
}

async function insertIntent(db: PgFixture['handle']['db'], prId: string) {
  await db.insert(t.prIntent).values({
    prId,
    intent: 'Add per-IP rate limiting to public endpoints.',
    inScope: ['src/config.ts'],
    outOfScope: ['authentication'],
  });
}

d('A2 PR Why/Risk Brief (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(mock: MockLLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: mock },
      },
    });
  }

  /**
   * `/pulls/:id/brief/generate`'s route-level `config: { rateLimit: {...} }`
   * (`brief/routes.ts:38`, matching `intent/routes.ts`'s `/recompute`) only
   * has any effect if the `@fastify/rate-limit` plugin is itself registered
   * — and `app.ts:95` (`if (config.nodeEnv !== 'test')`) deliberately skips
   * that registration under `nodeEnv: 'test'` so every OTHER integration
   * suite can hammer `inject()` without tripping it. `appWith()` above uses
   * `config()`, i.e. `nodeEnv: 'test'` — fine for every other test in this
   * file, but it means AC-16's actual 429 behavior can only be exercised by
   * building a separate app instance with `nodeEnv` forced to something
   * other than `'test'` (here, `'production'`; `logLevel: 'silent'` keeps
   * this quiet and also sidesteps `app.ts:56`'s pino-pretty transport branch,
   * which only triggers for `nodeEnv === 'development'`). This only affects
   * the single app built by this helper, not the rate-limit-free apps used
   * by every other test above.
   */
  function appWithRateLimitEnabled(mock: MockLLMProvider) {
    return buildApp({
      config: { ...config(), nodeEnv: 'production', logLevel: 'silent' },
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: mock },
      },
    });
  }

  it('1. GET before any generate: not_generated, zero LLM calls', async () => {
    const fixture = makeBriefDraftFixture();
    const mock = new MockLLMProvider('openai', { structuredBySchema: { BriefDraft: fixture } });
    const app = await appWith(mock);
    const { pr } = await createRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'not_generated' });
    expect(mock.calls).toHaveLength(0);

    await app.close();
  });

  it('2/8. generate on a normal PR (files + intent + review/agent): ready, 1 LLM call, 1 pr_brief row, grounding drops bogus ref + nulls out-of-range line', async () => {
    const fixture = makeBriefDraftFixture();
    const mock = new MockLLMProvider('openai', { structuredBySchema: { BriefDraft: fixture } });
    const app = await appWith(mock);
    const { pr } = await createRepoAndPr(pg.handle.db, workspaceId);
    await insertIntent(pg.handle.db, pr.id);
    await attachReviewWithAgent(pg.handle.db, workspaceId, pr.id);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(mock.calls).toHaveLength(1);

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);

    const brief = body.brief;
    // Intent resolved from the seeded pr_intent row.
    expect(brief.intent).not.toBeNull();
    expect(brief.intent.intent).toBe('Add per-IP rate limiting to public endpoints.');
    expect(brief.missing_context).not.toContain('intent');

    // Grounding (#8): the bogus file_ref never survives into the stored row.
    expect(brief.risks.risks).toHaveLength(1);
    expect(brief.risks.risks[0].file_refs).toEqual(['src/config.ts']);
    expect(brief.risks.risks[0].file_refs).not.toContain('src/does-not-exist.ts');

    // Grounding (#8): the out-of-range line comes back null, item kept.
    const focusByLine = brief.review_focus.find((f: { line: number | null }) => f.line === 11);
    const focusOutOfRange = brief.review_focus.find(
      (f: { reason: string }) => f.reason === 'Bogus out-of-range line.',
    );
    expect(focusByLine).toBeDefined();
    expect(focusOutOfRange).toBeDefined();
    expect(focusOutOfRange.line).toBeNull();

    await app.close();
  });

  it('3. read again after generating: same content back, zero additional LLM calls', async () => {
    const fixture = makeBriefDraftFixture();
    const mock = new MockLLMProvider('openai', { structuredBySchema: { BriefDraft: fixture } });
    const app = await appWith(mock);
    const { pr } = await createRepoAndPr(pg.handle.db, workspaceId);

    const generated = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(generated.statusCode).toBe(200);
    expect(mock.calls).toHaveLength(1);

    const read = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(generated.json());
    // The read is a pure cache hit — no additional LLM call.
    expect(mock.calls).toHaveLength(1);

    await app.close();
  });

  it('4. generate again with no new commits: 2 LLM calls, still exactly one row, content reflects the 2nd generation', async () => {
    const fixture = makeBriefDraftFixture();
    const mock = new MockLLMProvider('openai', { structuredBySchema: { BriefDraft: fixture } });
    const app = await appWith(mock);
    const { pr } = await createRepoAndPr(pg.handle.db, workspaceId);

    const first = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(first.json().brief.summary).toBe(fixture.summary);
    expect(mock.calls).toHaveLength(1);

    // Same head SHA (we never touched pull_requests.head_sha) — mutate the
    // SAME fixture object (looked up fresh per call by the mock) so the
    // second generation produces genuinely different content.
    fixture.summary = 'Second generation: updated summary after re-review.';

    const second = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(second.statusCode).toBe(200);
    expect(mock.calls).toHaveLength(2);
    expect(second.json().brief.summary).toBe('Second generation: updated summary after re-review.');

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.json as { summary: string }).summary).toBe(
      'Second generation: updated summary after re-review.',
    );

    await app.close();
  });

  it('5. a PR with zero changed files: nothing_to_brief, zero LLM calls', async () => {
    const fixture = makeBriefDraftFixture();
    const mock = new MockLLMProvider('openai', { structuredBySchema: { BriefDraft: fixture } });
    const app = await appWith(mock);
    const { pr } = await createRepoAndPr(pg.handle.db, workspaceId, { withFiles: false });

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'nothing_to_brief',
      reason: 'This PR has no changed files to brief.',
    });
    expect(mock.calls).toHaveLength(0);

    await app.close();
  });

  it('6/7. a PR with no pr_intent row and zero prior reviews: generate still succeeds, intent null, missing_context includes intent', async () => {
    const fixture = makeBriefDraftFixture();
    const mock = new MockLLMProvider('openai', { structuredBySchema: { BriefDraft: fixture } });
    const app = await appWith(mock);
    // No insertIntent(), no attachReviewWithAgent() — zero reviews, zero intent.
    const { pr } = await createRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.brief.intent).toBeNull();
    expect(body.brief.missing_context).toContain('intent');
    expect(mock.calls).toHaveLength(1);

    await app.close();
  });

  it('9. cross-workspace PR id: GET and POST both 404', async () => {
    const fixture = makeBriefDraftFixture();
    const mock = new MockLLMProvider('openai', { structuredBySchema: { BriefDraft: fixture } });
    const app = await appWith(mock);

    // A second, unrelated workspace + its own PR. `getContext` always
    // resolves to the seeded default workspace (LocalNoAuthProvider), so
    // this PR id is valid but belongs to a workspace the app never scopes to.
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-${repoSeq++}` })
      .returning();
    const { pr: otherPr } = await createRepoAndPr(pg.handle.db, otherWs!.id);

    const getRes = await app.inject({ method: 'GET', url: `/pulls/${otherPr.id}/brief` });
    expect(getRes.statusCode).toBe(404);

    const postRes = await app.inject({ method: 'POST', url: `/pulls/${otherPr.id}/brief/generate` });
    expect(postRes.statusCode).toBe(404);
    expect(mock.calls).toHaveLength(0);

    await app.close();
  });

  it('10 (AC-16). generate is rate-limited like intent/recompute: the 11th POST within one minute is rejected with 429 and leaves mock.calls unchanged', async () => {
    const fixture = makeBriefDraftFixture();
    const mock = new MockLLMProvider('openai', { structuredBySchema: { BriefDraft: fixture } });
    const app = await appWithRateLimitEnabled(mock);
    // A normal PR with changed files — generate must actually attempt an
    // LLM call each time (not short-circuit on `nothing_to_brief`), so the
    // route-level `{ max: 10, timeWindow: '1 minute' }` rate limit (not a
    // zero-files short circuit) is what the 11th request hits.
    const { pr } = await createRepoAndPr(pg.handle.db, workspaceId);

    // `app.inject()` calls share the same default remote address, so all 11
    // requests land in the same rate-limit bucket — exactly what's needed
    // here. First 10 are within the `{ max: 10, timeWindow: '1 minute' }`
    // route limit and must all succeed.
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
      expect(res.statusCode).toBe(200);
    }
    expect(mock.calls).toHaveLength(10);

    // 11th request within the same one-minute window: rejected with 429,
    // and never reaches BriefService.generate — no additional LLM call.
    const eleventh = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(eleventh.statusCode).toBe(429);
    expect(mock.calls).toHaveLength(10);

    await app.close();
  });
});
