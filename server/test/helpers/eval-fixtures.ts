import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type {
  CompletionRequest,
  CompletionResult,
  EvalCaseDraft,
  EvalRunRecord,
  LLMProvider,
  ModelInfo,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import * as t from '../../src/db/schema.js';
import type { PgFixture } from './pg.js';

type Db = PgFixture['handle']['db'];

/** Added-lines-only patch: new-side lines 1..24 of src/a.ts are all inside one hunk. */
export const A_PATCH = `@@ -0,0 +1,24 @@\n${Array.from({ length: 24 }, (_, i) => `+const line${i + 1} = ${i + 1};`).join('\n')}`;
export const A_FILE = 'src/a.ts';
/** A PR file with no patch (binary / too large): cannot ground any expectation. */
export const NULL_PATCH_FILE = 'assets/logo.png';

/** Case expectation the stub should react to, keyed by a `CASE-*` token in the PR title. */
export interface StubExpectation {
  type: 'must_find' | 'must_not_flag';
  file: string;
  start_line: number;
  end_line: number;
}

/**
 * Deterministic per-case LLM stub (MockLLMProvider cannot vary per case). The case is
 * identified by a `CASE-xxx` token that the test puts into `input_meta.title`; the engine
 * renders that title into the user message. Behaviour:
 *  - diff/title contains `FAIL_ME`      -> throws (provider error)
 *  - must_find                          -> one finding on the expected lines
 *  - must_not_flag, system has SABOTAGE -> a false-positive finding on the expected lines
 *  - must_not_flag otherwise / unknown  -> no findings
 */
export class EvalStubLLM implements LLMProvider {
  readonly id = 'openai' as const;
  calls: StructuredRequest<unknown>[] = [];
  private registry = new Map<string, StubExpectation>();

  register(token: string, exp: StubExpectation): void {
    this.registry.set(token, exp);
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('EvalStubLLM.complete should not be called');
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    const system = req.messages.find((m) => m.role === 'system')?.content ?? '';
    const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
    if (user.includes('FAIL_ME')) throw new Error('stub provider failure');

    const token = /CASE-[A-Za-z0-9_]+/.exec(user)?.[0];
    const exp = token ? this.registry.get(token) : undefined;
    const sabotage = system.includes('SABOTAGE');
    const emit = exp && (exp.type === 'must_find' || sabotage);
    const review: Review = {
      verdict: emit ? 'request_changes' : 'approve',
      summary: 'stub',
      score: 50,
      findings: emit
        ? [
            {
              id: `stub-${token}`,
              severity: 'WARNING',
              category: 'bug',
              title: `stub finding ${token}`,
              file: exp.file,
              start_line: exp.start_line,
              end_line: exp.end_line,
              rationale: 'deterministic stub',
              confidence: 0.9,
              kind: 'finding',
            },
          ]
        : [],
    };
    const raw = JSON.stringify(review);
    return {
      data: (req.schema as { parse(v: unknown): T }).parse(review),
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw,
      attempts: 1,
    };
  }
}

export interface EvalFixture {
  workspaceId: string;
  prId: string;
  reviewId: string;
  reviewAgentId: string;
  /** One finding per line 1..14 of src/a.ts, in order. */
  findingIds: string[];
  nullPatchFindingId: string;
  /** A finding on a review with no agent. */
  noAgentFindingId: string;
}

export const FINDING_COUNT = 14;

/** Repo + PR (one real patch, one null patch) + reviewing agent + review with >= 10 findings. */
export async function seedReviewFixture(
  app: FastifyInstance,
  db: Db,
  workspaceId: string,
): Promise<EvalFixture> {
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name: 'eval-repo', fullName: 'acme/eval-repo' })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 77,
      title: 'Add widgets',
      author: 'dev',
      branch: 'feat/w',
      base: 'main',
      headSha: 'abc123',
      additions: 24,
      deletions: 0,
      filesCount: 2,
      status: 'needs_review',
      body: 'Adds widgets.',
    })
    .returning();
  await db.insert(t.prFiles).values([
    { prId: pr!.id, path: A_FILE, additions: 24, deletions: 0, patch: A_PATCH },
    { prId: pr!.id, path: NULL_PATCH_FILE, additions: 0, deletions: 0, patch: null },
  ]);

  const reviewAgent = await createAgent(app, 'Reviewer of record');
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId: pr!.id, agentId: reviewAgent.id, kind: 'review', verdict: 'request_changes', summary: 's', score: 50, model: 'gpt-4.1' })
    .returning();
  const [anonReview] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId: pr!.id, agentId: null, kind: 'review', verdict: 'approve', summary: 's', score: 90, model: 'gpt-4.1' })
    .returning();

  const finding = (reviewId: string, file: string, line: number, title: string) => ({
    reviewId,
    file,
    startLine: line,
    endLine: line,
    severity: 'WARNING',
    category: 'bug',
    title,
    rationale: 'because',
    confidence: 0.8,
  });
  const rows = await db
    .insert(t.findings)
    .values([
      ...Array.from({ length: FINDING_COUNT }, (_, i) =>
        finding(review!.id, A_FILE, i + 1, `Widget problem ${i + 1}`),
      ),
      finding(review!.id, NULL_PATCH_FILE, 1, 'Logo problem'),
      finding(anonReview!.id, A_FILE, 20, 'Anonymous problem'),
    ])
    .returning();

  return {
    workspaceId,
    prId: pr!.id,
    reviewId: review!.id,
    reviewAgentId: reviewAgent.id,
    findingIds: rows.slice(0, FINDING_COUNT).map((r) => r.id),
    nullPatchFindingId: rows[FINDING_COUNT]!.id,
    noAgentFindingId: rows[FINDING_COUNT + 1]!.id,
  };
}

let agentSeq = 0;
export async function createAgent(
  app: FastifyInstance,
  name: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  const res = await app.inject({
    method: 'POST',
    url: '/agents',
    payload: {
      name: `${name} #${agentSeq++}`,
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'You are a careful reviewer.',
      ...over,
    },
  });
  if (res.statusCode !== 201) throw new Error(`createAgent failed: ${res.statusCode} ${res.body}`);
  return res.json();
}

export async function triage(app: FastifyInstance, findingId: string, action: 'accept' | 'dismiss') {
  const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/${action}` });
  if (res.statusCode !== 200) throw new Error(`${action} failed: ${res.statusCode} ${res.body}`);
}

export async function getDraft(app: FastifyInstance, findingId: string): Promise<EvalCaseDraft> {
  const res = await app.inject({ method: 'GET', url: `/findings/${findingId}/eval-case-draft` });
  if (res.statusCode !== 200) throw new Error(`draft failed: ${res.statusCode} ${res.body}`);
  return res.json();
}

/** Save a case from a finding's draft, overriding the PR title (the stub's case token). */
export async function createCaseFromFinding(
  app: FastifyInstance,
  agentId: string,
  findingId: string,
  title: string,
  name?: string,
) {
  const d = await getDraft(app, findingId);
  const res = await app.inject({
    method: 'POST',
    url: `/agents/${agentId}/eval-cases`,
    payload: {
      name: name ?? `${title.toLowerCase()}-case`,
      input_diff: d.input_diff,
      input_files: d.input_files,
      input_meta: { ...d.input_meta, title },
      expectation: d.expectation,
      source_finding_id: d.source_finding_id,
    },
  });
  if (res.statusCode !== 201) throw new Error(`create case failed: ${res.statusCode} ${res.body}`);
  return { draft: d, case: res.json() as { id: string } };
}

/** Bounded poll until the run leaves `running`. */
export async function waitForEvalRun(
  app: FastifyInstance,
  runId: string,
  timeoutMs = 20_000,
): Promise<EvalRunRecord> {
  const start = Date.now();
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/eval-runs/${runId}` });
    const run = res.json() as EvalRunRecord;
    if (res.statusCode === 200 && run.status !== 'running') return run;
    if (Date.now() - start > timeoutMs) throw new Error(`eval run ${runId} still running after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function evalCounts(db: Db): Promise<{ cases: number; runs: number }> {
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(t.evalCases);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(t.evalRuns);
  return { cases: c!.n, runs: r!.n };
}

/** A hand-written, groundable manual case body (lines 1..2 of src/a.ts are inside the hunk). */
export function manualCaseBody(title: string, extraDiffLine = '') {
  return {
    name: `manual-${title.toLowerCase()}`,
    input_diff: `diff --git a/${A_FILE} b/${A_FILE}\n--- a/${A_FILE}\n+++ b/${A_FILE}\n${A_PATCH}${extraDiffLine}`,
    input_files: [A_FILE],
    input_meta: { pr_number: 1, title, body: null },
    expectation: { type: 'must_find' as const, file: A_FILE, start_line: 1, end_line: 2 },
  };
}

/** Insert a `running` eval_runs row directly (simulates an in-flight / stale / orphaned run). */
export async function insertRunningRun(
  db: Db,
  workspaceId: string,
  agentId: string,
  ranAt: Date = new Date(),
) {
  const [row] = await db
    .insert(t.evalRuns)
    .values({ workspaceId, agentId, agentVersion: 1, status: 'running', caseIds: [], ranAt })
    .returning();
  return row!;
}

export async function runRow(db: Db, id: string) {
  const [row] = await db.select().from(t.evalRuns).where(eq(t.evalRuns.id, id));
  return row;
}

export async function casesOfAgent(db: Db, agentId: string) {
  return db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
}

export async function runsOfAgents(db: Db, agentIds: string[]) {
  return db.select().from(t.evalRuns).where(inArray(t.evalRuns.agentId, agentIds));
}

export interface ForeignWorkspace {
  workspaceId: string;
  agentId: string;
  caseId: string;
  runId: string;
  findingId: string;
}

/** A second workspace with its own agent, case, run and a triaged finding. */
export async function seedForeignWorkspace(db: Db): Promise<ForeignWorkspace> {
  const [ws] = await db.insert(t.workspaces).values({ name: 'other-tenant' }).returning();
  const workspaceId = ws!.id;
  const [agent] = await db
    .insert(t.agents)
    .values({ workspaceId, name: 'Foreign agent', provider: 'openai', model: 'gpt-4.1', systemPrompt: 'foreign' })
    .returning();
  const [kase] = await db
    .insert(t.evalCases)
    .values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agent!.id,
      name: 'foreign-case',
      inputDiff: manualCaseBody('FOREIGN').input_diff,
      inputFiles: [A_FILE],
      inputMeta: { pr_number: 1, title: 'FOREIGN', body: null },
      expectedOutput: { type: 'must_find', file: A_FILE, start_line: 1, end_line: 2 },
    })
    .returning();
  const [run] = await db
    .insert(t.evalRuns)
    .values({
      workspaceId,
      agentId: agent!.id,
      agentVersion: 1,
      status: 'completed',
      caseIds: [kase!.id],
      finishedAt: new Date(),
    })
    .returning();
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'other', name: 'repo', fullName: 'other/repo' })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({ workspaceId, repoId: repo!.id, number: 1, title: 'x', author: 'a', branch: 'b', base: 'main', headSha: 'h' })
    .returning();
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId: pr!.id, agentId: agent!.id, kind: 'review' })
    .returning();
  const [finding] = await db
    .insert(t.findings)
    .values({
      reviewId: review!.id,
      file: A_FILE,
      startLine: 1,
      endLine: 1,
      severity: 'WARNING',
      category: 'bug',
      title: 'foreign finding',
      rationale: 'r',
      confidence: 0.5,
      acceptedAt: new Date(),
    })
    .returning();
  return { workspaceId, agentId: agent!.id, caseId: kase!.id, runId: run!.id, findingId: finding!.id };
}
