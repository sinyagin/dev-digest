import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { EvalRunRecord, EvalCompare } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import {
  A_FILE,
  EvalStubLLM,
  casesOfAgent,
  createAgent,
  createCaseFromFinding,
  evalCounts,
  getDraft,
  insertRunningRun,
  manualCaseBody,
  runRow,
  runsOfAgents,
  seedForeignWorkspace,
  seedReviewFixture,
  triage,
  waitForEvalRun,
  type EvalFixture,
  type ForeignWorkspace,
} from './helpers/eval-fixtures.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * SPEC-03 eval pipeline end-to-end over HTTP (app.inject) against a real
 * Postgres. The LLM is a deterministic per-case stub injected through the
 * container's `llm` override; the secrets provider is empty so the suite is
 * hermetic whatever keys the developer's shell/.env holds.
 *
 * Tests are order-dependent by design: the AC-33 run feeds the AC-14 and
 * AC-22 tests. Every test that starts a run waits for it to finish before
 * returning, because buildApp's boot reconciliation reaps `running` rows.
 */
d('eval pipeline (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let fx: EvalFixture;
  let foreign: ForeignWorkspace;
  const stub = new EvalStubLLM();
  const db = () => pg.handle.db;

  // Findings used by the AC-33 suite: 0..3 accepted (must_find), 4..7 dismissed (must_not_flag).
  // 8 accepted (save/duplicate/re-triage), 9 untriaged, 10 accepted (draft/dry-run), 11 dismissed.
  const F = { save: 8, untriaged: 9, draft: 10, dismissedDraft: 11, outOfHunk: 12 } as const;

  // State shared by the order-dependent AC-33 -> AC-14 -> AC-22 tests.
  let agent33: { id: string };
  let run1: EvalRunRecord;
  let run2: EvalRunRecord;
  let case33Ids: string[] = [];

  function makeApp(opts: { nodeEnv?: string; llm?: boolean } = {}) {
    const base = config();
    return buildApp({
      config: opts.nodeEnv ? { ...base, nodeEnv: opts.nodeEnv as typeof base.nodeEnv, logLevel: 'silent' } : base,
      db: db(),
      overrides: {
        git: new MockGitClient({}),
        secrets: new MockSecretsProvider({}),
        ...(opts.llm === false ? {} : { llm: { openai: stub } }),
      },
    });
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(db());
    const [ws] = await db().select().from(t.workspaces);
    app = await makeApp();
    fx = await seedReviewFixture(app, db(), ws!.id);
    // Triage through the real routes.
    for (const i of [0, 1, 2, 3, F.save, F.draft, F.outOfHunk]) await triage(app, fx.findingIds[i]!, 'accept');
    for (const i of [4, 5, 6, 7, F.dismissedDraft]) await triage(app, fx.findingIds[i]!, 'dismiss');
    await triage(app, fx.nullPatchFindingId, 'accept');
    await triage(app, fx.noAgentFindingId, 'accept');
    foreign = await seedForeignWorkspace(db());
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('AC-2/AC-3/AC-4 draft returns prefill and writes no eval rows (counts before = after)', async () => {
    const before = await evalCounts(db());
    const accepted = await getDraft(app, fx.findingIds[F.draft]!);
    const dismissed = await getDraft(app, fx.findingIds[F.dismissedDraft]!);
    expect(await evalCounts(db())).toEqual(before);

    expect(accepted.source_triage).toBe('accepted');
    expect(accepted.expectation).toMatchObject({ type: 'must_find', file: A_FILE, start_line: 11, end_line: 11 });
    expect(accepted.name).toBe('widget-problem-11');
    expect(accepted.input_files).toEqual([A_FILE]);
    expect(accepted.input_meta).toMatchObject({ pr_number: 77, title: 'Add widgets', body: 'Adds widgets.' });
    expect(accepted.input_diff).toContain(`+++ b/${A_FILE}`);
    expect(accepted.input_diff).toContain('+const line11 = 11;');
    expect(accepted.agent).toMatchObject({ id: fx.reviewAgentId });
    expect(accepted.source_finding_id).toBe(fx.findingIds[F.draft]);
    expect(accepted.existing_case_id).toBeNull();
    expect(dismissed.source_triage).toBe('dismissed');
    expect(dismissed.expectation.type).toBe('must_not_flag');
  });

  it('AC-1 untriaged finding draft → 422 (and no-agent finding → 422)', async () => {
    const untriaged = await app.inject({ method: 'GET', url: `/findings/${fx.findingIds[F.untriaged]}/eval-case-draft` });
    expect(untriaged.statusCode).toBe(422);
    expect(untriaged.json().error.code).toBe('eval_finding_untriaged');

    const noAgent = await app.inject({ method: 'GET', url: `/findings/${fx.noAgentFindingId}/eval-case-draft` });
    expect(noAgent.statusCode).toBe(422);
    expect(noAgent.json().error.code).toBe('eval_finding_no_agent');
  });

  it('AC-7 draft dry run returns outcome and writes nothing', async () => {
    const agent = await createAgent(app, 'DryRunner');
    const body = createDraftBody('CASE-DRY1');
    stub.register('CASE-DRY1', { type: 'must_find', file: A_FILE, start_line: 1, end_line: 2 });
    const before = await evalCounts(db());
    const calls = stub.calls.length;

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases/dry-run`, payload: { draft: body } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ case_id: null, status: 'scored', pass: true, findings_matched: 1 });
    expect(stub.calls.length).toBe(calls + 1);
    expect(await evalCounts(db())).toEqual(before);
  });

  it('AC-7 saved-case dry run writes only last_result', async () => {
    const agent = await createAgent(app, 'SavedDry');
    stub.register('CASE-DRY2', { type: 'must_find', file: A_FILE, start_line: 1, end_line: 2 });
    const created = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases`, payload: createDraftBody('CASE-DRY2') });
    expect(created.statusCode).toBe(201);
    const before = created.json();
    expect(before.last_result).toBeNull();
    const counts = await evalCounts(db());

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases/dry-run`, payload: { case_id: before.id } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ case_id: before.id, pass: true });
    expect(await evalCounts(db())).toEqual(counts);

    const after = (await app.inject({ method: 'GET', url: `/eval-cases/${before.id}` })).json();
    expect(after.last_result).toMatchObject({ case_id: before.id, status: 'scored', pass: true });
    expect(after.last_result_at).not.toBeNull();
    const strip = ({ last_result, last_result_at, updated_at, ...rest }: Record<string, unknown>) => rest;
    expect(strip(after)).toEqual(strip(before));
  });

  it('AC-8 save creates exactly one case with source_finding_id', async () => {
    const agent = await createAgent(app, 'Saver');
    const before = await evalCounts(db());
    const { case: saved } = await createCaseFromFinding(app, agent.id, fx.findingIds[F.save]!, 'CASE-SAVE');
    const after = await evalCounts(db());
    expect(after.cases).toBe(before.cases + 1);
    expect(after.runs).toBe(before.runs);
    const rows = await casesOfAgent(db(), agent.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: saved.id, sourceFindingId: fx.findingIds[F.save], ownerKind: 'agent', ownerId: agent.id });
  });

  it('AC-10 out-of-hunk expectation → 422 with reason; null-patch file → 422', async () => {
    const agent = await createAgent(app, 'Grounder');
    const before = await evalCounts(db());

    // The hunk covers lines 1..24; line 99 is outside.
    const outside = createDraftBody('CASE-OUT');
    outside.expectation = { ...outside.expectation, start_line: 99, end_line: 99 };
    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases`, payload: outside });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('eval_expectation_ungrounded');
    expect(res.json().error.message).toMatch(/do not intersect any hunk/);

    // A finding on a null-patch file drafts an empty diff; a diff with no hunks can't ground it.
    const draft = await getDraft(app, fx.nullPatchFindingId);
    expect(draft.input_diff).toBe('');
    const noHunks = {
      ...createDraftBody('CASE-NULL'),
      input_diff: 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files a/assets/logo.png and b/assets/logo.png differ\n',
      input_files: ['assets/logo.png'],
      expectation: { ...draft.expectation },
    };
    const res2 = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases`, payload: noHunks });
    expect(res2.statusCode).toBe(422);
    expect(res2.json().error.code).toBe('eval_expectation_ungrounded');
    expect(res2.json().error.message).toMatch(/no hunks/);
    expect(await evalCounts(db())).toEqual(before);
  });

  it('AC-11 second create for same finding → 409 with case_id; draft reports existing_case_id', async () => {
    const agent = await createAgent(app, 'Dupe');
    const { case: first } = await createCaseFromFinding(app, agent.id, fx.findingIds[F.outOfHunk]!, 'CASE-DUPE');
    const draft = await getDraft(app, fx.findingIds[F.outOfHunk]!);
    const again = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { ...createDraftBody('CASE-DUPE2'), expectation: draft.expectation, source_finding_id: draft.source_finding_id },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('eval_case_exists');
    expect(again.json().error.details.case_id).toBe(first.id);
    expect(await casesOfAgent(db(), agent.id)).toHaveLength(1);

    // The draft is owned by the reviewing agent, so it reports an existing case only for that agent.
    await createCaseFromFinding(app, fx.reviewAgentId, fx.findingIds[F.outOfHunk]!, 'CASE-DUPE3');
    expect((await getDraft(app, fx.findingIds[F.outOfHunk]!)).existing_case_id).not.toBeNull();
  });

  it('AC-12 re-triage leaves expectation type unchanged', async () => {
    const agent = await createAgent(app, 'Retriage');
    const { case: saved } = await createCaseFromFinding(app, agent.id, fx.findingIds[F.save]!, 'CASE-RETRIAGE');
    await triage(app, fx.findingIds[F.save]!, 'dismiss');
    const stored = (await app.inject({ method: 'GET', url: `/eval-cases/${saved.id}` })).json();
    expect(stored.expectation.type).toBe('must_find');
    expect((await getDraft(app, fx.findingIds[F.save]!)).expectation.type).toBe('must_not_flag');
    await triage(app, fx.findingIds[F.save]!, 'accept');
  });

  it('AC-13 invalid PUT → 422 naming field; stored case unchanged', async () => {
    const agent = await createAgent(app, 'Editor');
    const created = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases`, payload: createDraftBody('CASE-EDIT') })
    ).json();

    const bad = await app.inject({ method: 'PUT', url: `/eval-cases/${created.id}`, payload: { name: '' } });
    expect(bad.statusCode).toBe(422);
    expect(JSON.stringify(bad.json().error.details)).toContain('name');
    const badRange = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${created.id}`,
      payload: { expectation: { ...created.expectation, start_line: 5, end_line: 2 } },
    });
    expect(badRange.statusCode).toBe(422);
    expect(JSON.stringify(badRange.json().error.details)).toContain('end_line');

    const stored = (await app.inject({ method: 'GET', url: `/eval-cases/${created.id}` })).json();
    expect(stored).toEqual(created);

    const ok = await app.inject({ method: 'PUT', url: `/eval-cases/${created.id}`, payload: { name: 'renamed', notes: 'n' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ name: 'renamed', notes: 'n' });
  });

  it('AC-55 oversize input_diff → 422; expectation with extra key → 422', async () => {
    const agent = await createAgent(app, 'Limits');
    const before = await evalCounts(db());
    const oversize = { ...createDraftBody('CASE-BIG'), input_diff: 'x'.repeat(200_001) };
    const r1 = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases`, payload: oversize });
    expect(r1.statusCode).toBe(422);
    const extra = createDraftBody('CASE-EXTRA');
    const r2 = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { ...extra, expectation: { ...extra.expectation, evil: 'x' } },
    });
    expect(r2.statusCode).toBe(422);
    expect(await evalCounts(db())).toEqual(before);
  });

  it('AC-15/AC-29 POST eval-runs returns 202 running; poll to completed; row has agent_version, case_ids, metrics, per_case with all AC-29 fields', async () => {
    const agent = await createAgent(app, 'Runner');
    stub.register('CASE-R1', { type: 'must_find', file: A_FILE, start_line: 1, end_line: 2 });
    const c1 = (await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases`, payload: createDraftBody('CASE-R1') })).json();

    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ status: 'running', agent_version: 1, case_ids: [c1.id] });

    const done = await waitForEvalRun(app, started.json().id);
    expect(done.status).toBe('completed');
    const parsed = EvalRunRecord.parse(done);
    expect(parsed).toMatchObject({
      agent_id: agent.id,
      agent_version: 1,
      case_ids: [c1.id],
      traces_passed: 1,
      traces_total: 1,
      cases_errored: 0,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
    });
    expect(parsed.finished_at).not.toBeNull();
    expect(parsed.duration_ms).toBeGreaterThanOrEqual(0);
    expect(parsed.cost_usd).toBeCloseTo(0.001);
    expect(parsed.per_case).toHaveLength(1);
    expect(parsed.per_case[0]).toMatchObject({
      case_id: c1.id,
      name: 'manual-case-r1',
      expectation_type: 'must_find',
      status: 'scored',
      pass: true,
      error_reason: null,
      findings_total: 1,
      findings_matched: 1,
      grounding_kept: 1,
      grounding_total: 1,
    });
    expect(parsed.per_case[0]!.actual[0]).toMatchObject({ file: A_FILE, matched: true });
    expect(parsed.per_case[0]!.cost_usd).toBeCloseTo(0.001);
    // last_result is mirrored on the case.
    const kase = (await app.inject({ method: 'GET', url: `/eval-cases/${c1.id}` })).json();
    expect(kase.last_result).toMatchObject({ case_id: c1.id, pass: true });
  });

  it('AC-18 one FAIL_ME case → completed, cases_errored = 1, metrics over the rest', async () => {
    const agent = await createAgent(app, 'Failer');
    stub.register('CASE-OK1', { type: 'must_find', file: A_FILE, start_line: 1, end_line: 2 });
    stub.register('CASE-OK2', { type: 'must_find', file: A_FILE, start_line: 1, end_line: 2 });
    for (const title of ['CASE-OK1', 'CASE-OK2', 'CASE-BAD FAIL_ME']) {
      const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases`, payload: createDraftBody(title) });
      expect(res.statusCode).toBe(201);
    }
    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    const done = await waitForEvalRun(app, started.json().id);
    expect(done.status).toBe('completed');
    expect(done.cases_errored).toBe(1);
    expect(done.traces_total).toBe(2);
    expect(done.traces_passed).toBe(2);
    expect(done.recall).toBe(1);
    expect(done.per_case).toHaveLength(3);
    const errored = done.per_case.find((o) => o.status === 'errored');
    expect(errored).toMatchObject({ pass: null, error_reason: 'provider_error' });
  });

  it('AC-19 two concurrent POSTs → exactly one run row, other 409', async () => {
    const agent = await createAgent(app, 'Concurrent');
    stub.register('CASE-C1', { type: 'must_find', file: A_FILE, start_line: 1, end_line: 2 });
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases`, payload: createDraftBody('CASE-C1') });

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` }),
      app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([202, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().error.code).toBe('eval_run_in_flight');
    const winner = a.statusCode === 202 ? a : b;
    expect(await runsOfAgents(db(), [agent.id])).toHaveLength(1);
    await waitForEvalRun(app, winner.json().id);
  });

  it('AC-20 no cases → 422 eval_no_cases; missing key → 422; in-flight → 409; no run row created in each case', async () => {
    // no cases
    const empty = await createAgent(app, 'NoCases');
    const r1 = await app.inject({ method: 'POST', url: `/agents/${empty.id}/eval-runs` });
    expect(r1.statusCode).toBe(422);
    expect(r1.json().error.code).toBe('eval_no_cases');
    expect(await runsOfAgents(db(), [empty.id])).toHaveLength(0);

    // missing key: an app with no LLM override and an empty secrets provider
    const keyless = await makeApp({ llm: false });
    const anthropicAgent = await createAgent(keyless, 'NoKey', { provider: 'anthropic', model: 'claude-x' });
    const c = await keyless.inject({
      method: 'POST',
      url: `/agents/${anthropicAgent.id}/eval-cases`,
      payload: createDraftBody('CASE-NOKEY'),
    });
    expect(c.statusCode).toBe(201);
    const callsBefore = stub.calls.length;
    const r2 = await keyless.inject({ method: 'POST', url: `/agents/${anthropicAgent.id}/eval-runs` });
    expect(r2.statusCode).toBe(422);
    expect(r2.json().error.code).toBe('eval_provider_key_missing');
    expect(await runsOfAgents(db(), [anthropicAgent.id])).toHaveLength(0);
    const r2b = await keyless.inject({
      method: 'POST',
      url: `/agents/${anthropicAgent.id}/eval-cases/dry-run`,
      payload: { case_id: c.json().id },
    });
    expect(r2b.statusCode).toBe(422);
    expect(r2b.json().error.code).toBe('eval_provider_key_missing');
    await keyless.close();
    expect(stub.calls.length).toBe(callsBefore);

    // in-flight
    const busy = await createAgent(app, 'Busy');
    await app.inject({ method: 'POST', url: `/agents/${busy.id}/eval-cases`, payload: createDraftBody('CASE-BUSY') });
    const fake = await insertRunningRun(db(), fx.workspaceId, busy.id);
    const r3 = await app.inject({ method: 'POST', url: `/agents/${busy.id}/eval-runs` });
    expect(r3.statusCode).toBe(409);
    expect(r3.json().error.code).toBe('eval_run_in_flight');
    expect(await runsOfAgents(db(), [busy.id])).toHaveLength(1);
    await db().update(t.evalRuns).set({ status: 'errored', errorReason: 'test_cleanup' }).where(eq(t.evalRuns.id, fake.id));
  });

  it('D15 stale running row (ran_at −16 min) is reconciled to errored before guard; boot reaps all running rows', async () => {
    const agent = await createAgent(app, 'Stale');
    stub.register('CASE-ST', { type: 'must_find', file: A_FILE, start_line: 1, end_line: 2 });
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases`, payload: createDraftBody('CASE-ST') });
    const stale = await insertRunningRun(db(), fx.workspaceId, agent.id, new Date(Date.now() - 16 * 60_000));

    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(started.statusCode).toBe(202);
    const reaped = await runRow(db(), stale.id);
    expect(reaped).toMatchObject({ status: 'errored', errorReason: 'interrupted' });
    await waitForEvalRun(app, started.json().id);

    // Boot: even a FRESH running row is reaped when a new app boots.
    const orphan = await insertRunningRun(db(), fx.workspaceId, agent.id);
    const booted = await makeApp();
    await booted.ready();
    expect(await runRow(db(), orphan.id)).toMatchObject({ status: 'errored', errorReason: 'interrupted' });
    await booted.close();
  });

  it('AC-33a/b/c eight cases from triaged findings (≥1 of each type) → run v1; update system_prompt with SABOTAGE → version bump → run v2; compare shows distinct versions, prompt diff, precision(v2) < precision(v1)', async () => {
    agent33 = await createAgent(app, 'Suite');
    for (let i = 0; i < 8; i++) {
      const findingId = fx.findingIds[i]!;
      const token = `CASE-S${i}`;
      const { draft, case: saved } = await createCaseFromFinding(app, agent33.id, findingId, token);
      stub.register(token, {
        type: draft.expectation.type,
        file: draft.expectation.file,
        start_line: draft.expectation.start_line,
        end_line: draft.expectation.end_line,
      });
      case33Ids.push(saved.id);
    }
    const stored = await casesOfAgent(db(), agent33.id);
    expect(new Set(stored.map((c) => (c.expectedOutput as { type: string }).type))).toEqual(
      new Set(['must_find', 'must_not_flag']),
    );

    // v1
    const s1 = await app.inject({ method: 'POST', url: `/agents/${agent33.id}/eval-runs` });
    expect(s1.statusCode).toBe(202);
    run1 = await waitForEvalRun(app, s1.json().id);
    expect(run1).toMatchObject({ status: 'completed', agent_version: 1, traces_total: 8, traces_passed: 8, cases_errored: 0 });
    expect(run1.recall).toBe(1);
    expect(run1.precision).toBe(1);
    expect(run1.case_ids).toEqual(expect.arrayContaining(case33Ids));

    // Degrade the prompt -> version bump.
    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agent33.id}`,
      payload: { system_prompt: 'You are a careful reviewer.\nSABOTAGE: flag everything.' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().version).toBe(2);

    const s2 = await app.inject({ method: 'POST', url: `/agents/${agent33.id}/eval-runs` });
    expect(s2.statusCode).toBe(202);
    run2 = await waitForEvalRun(app, s2.json().id);
    expect(run2).toMatchObject({ status: 'completed', agent_version: 2, traces_total: 8, traces_passed: 4 });
    expect(run2.recall).toBe(1);
    expect(run2.precision).toBeCloseTo(0.5);
    expect(run2.precision!).toBeLessThan(run1.precision!);

    const cmpRes = await app.inject({ method: 'GET', url: `/eval-runs/compare?a=${run1.id}&b=${run2.id}` });
    expect(cmpRes.statusCode).toBe(200);
    const cmp = EvalCompare.parse(cmpRes.json());
    expect(cmp.old.id).toBe(run1.id);
    expect(cmp.new.id).toBe(run2.id);
    expect(cmp.prompt).toMatchObject({ old_version: 1, new_version: 2, unchanged: false });
    expect(cmp.prompt.diff.some((l) => l.op === 'add' && l.line.includes('SABOTAGE'))).toBe(true);
    expect(cmp.metrics.precision.old).toBe(1);
    expect(cmp.metrics.precision.new).toBeCloseTo(0.5);
    expect(cmp.metrics.precision.delta!).toBeLessThan(0);
    expect(cmp.common_cases).toBe(8);
    expect(cmp.case_set.same).toBe(true);
  });

  it('AC-14 edit/delete case leaves stored run per_case unchanged', async () => {
    const before = (await app.inject({ method: 'GET', url: `/eval-runs/${run1.id}` })).json();
    const edit = await app.inject({ method: 'PUT', url: `/eval-cases/${case33Ids[0]}`, payload: { name: 'renamed-after-run', notes: 'edited' } });
    expect(edit.statusCode).toBe(200);
    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${case33Ids[7]}` });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/eval-cases/${case33Ids[7]}` })).statusCode).toBe(404);
    const after = (await app.inject({ method: 'GET', url: `/eval-runs/${run1.id}` })).json();
    expect(after.per_case).toEqual(before.per_case);
    expect(after.case_ids).toEqual(before.case_ids);
    expect(after.per_case.some((o: { name: string }) => o.name === 'renamed-after-run')).toBe(false);
    expect(after.per_case).toHaveLength(8);
  });

  it('AC-22/D11 GET dashboard, detail, runs, run, compare, estimate, draft, cases → stub.calls unchanged', async () => {
    const calls = stub.calls.length;
    const counts = await evalCounts(db());
    const urls = [
      '/eval/dashboard',
      `/eval/agents/${agent33.id}`,
      `/agents/${agent33.id}/eval-runs`,
      `/eval-runs/${run1.id}`,
      `/eval-runs/compare?a=${run1.id}&b=${run2.id}`,
      `/agents/${agent33.id}/eval-runs/estimate`,
      `/findings/${fx.findingIds[F.draft]}/eval-case-draft`,
      `/agents/${agent33.id}/eval-cases`,
      `/eval-cases/${case33Ids[0]}`,
    ];
    for (const url of urls) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
    }
    expect(stub.calls.length).toBe(calls);
    expect(await evalCounts(db())).toEqual(counts);

    const est = (await app.inject({ method: 'GET', url: `/agents/${agent33.id}/eval-runs/estimate` })).json();
    expect(est).toMatchObject({ cases: 7, executions: 7 });
    const detail = (await app.inject({ method: 'GET', url: `/eval/agents/${agent33.id}` })).json();
    expect(detail).toMatchObject({ cases_total: 7 });
    expect(detail.latest.id).toBe(run2.id);
    expect(detail.previous.id).toBe(run1.id);
    expect(detail.delta.precision).toBeLessThan(0);
    const dash = (await app.inject({ method: 'GET', url: '/eval/dashboard' })).json();
    expect(dash.agents.find((a: { agent_id: string }) => a.agent_id === agent33.id)).toMatchObject({ cases_total: 7 });
  });

  it('AC-31 POST /eval-runs/all → per-agent results, agent without cases reported, not thrown', async () => {
    // One agent that is busy (reported as an error), plus every agent with cases from earlier tests.
    const busy = await createAgent(app, 'BusyAll');
    await app.inject({ method: 'POST', url: `/agents/${busy.id}/eval-cases`, payload: createDraftBody('CASE-BUSYALL') });
    const fake = await insertRunningRun(db(), fx.workspaceId, busy.id);
    const bare = await createAgent(app, 'BareAll');

    const res = await app.inject({ method: 'POST', url: '/eval-runs/all' });
    expect(res.statusCode).toBe(202);
    const { results } = res.json() as { results: Array<{ agent_id: string; run_id: string | null; error: { code: string } | null }> };
    const busyResult = results.find((r) => r.agent_id === busy.id);
    expect(busyResult).toMatchObject({ run_id: null, error: { code: 'eval_run_in_flight' } });
    // Agents without cases are not started (nothing to execute) and nothing throws.
    expect(results.find((r) => r.agent_id === bare.id)).toBeUndefined();
    const started = results.filter((r) => r.run_id);
    expect(started.length).toBeGreaterThan(0);
    expect(started.every((r) => r.error === null)).toBe(true);
    for (const r of started) await waitForEvalRun(app, r.run_id!);
    await db().update(t.evalRuns).set({ status: 'errored', errorReason: 'test_cleanup' }).where(eq(t.evalRuns.id, fake.id));
  });

  it('AC-56 every route on the other workspace\'s case/run/agent → 404 and no row changes', async () => {
    const counts = await evalCounts(db());
    const calls = stub.calls.length;
    const caseBefore = (await db().select().from(t.evalCases).where(eq(t.evalCases.id, foreign.caseId)))[0];
    const runBefore = await runRow(db(), foreign.runId);

    const probes: Array<[string, string, unknown?]> = [
      ['GET', `/findings/${foreign.findingId}/eval-case-draft`],
      ['POST', `/agents/${foreign.agentId}/eval-cases/dry-run`, { case_id: foreign.caseId }],
      ['GET', `/agents/${foreign.agentId}/eval-cases`],
      ['POST', `/agents/${foreign.agentId}/eval-cases`, createDraftBody('CASE-X')],
      ['GET', `/eval-cases/${foreign.caseId}`],
      ['PUT', `/eval-cases/${foreign.caseId}`, { name: 'hijacked' }],
      ['DELETE', `/eval-cases/${foreign.caseId}`],
      ['GET', `/agents/${foreign.agentId}/eval-runs/estimate`],
      ['POST', `/agents/${foreign.agentId}/eval-runs`],
      ['GET', `/agents/${foreign.agentId}/eval-runs`],
      ['GET', `/eval-runs/${foreign.runId}`],
      ['GET', `/eval-runs/compare?a=${foreign.runId}&b=${foreign.runId}`],
      ['GET', `/eval/agents/${foreign.agentId}`],
    ];
    for (const [method, url, payload] of probes) {
      const res = await app.inject({ method: method as 'GET', url, ...(payload ? { payload: payload as object } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    // A mixed own/foreign compare is also a 404, not a leak.
    const mixed = await app.inject({ method: 'GET', url: `/eval-runs/compare?a=${run1.id}&b=${foreign.runId}` });
    expect(mixed.statusCode).toBe(404);

    expect(await evalCounts(db())).toEqual(counts);
    expect(stub.calls.length).toBe(calls);
    expect((await db().select().from(t.evalCases).where(eq(t.evalCases.id, foreign.caseId)))[0]).toEqual(caseBefore);
    expect(await runRow(db(), foreign.runId)).toEqual(runBefore);
    // Foreign data never shows up in own listings.
    const dash = (await app.inject({ method: 'GET', url: '/eval/dashboard' })).json();
    expect(dash.agents.some((a: { agent_id: string }) => a.agent_id === foreign.agentId)).toBe(false);
    expect(dash.recent_runs.some((r: { id: string }) => r.id === foreign.runId)).toBe(false);
  });

  it('D14 DELETE /agents/:id removes its eval_cases and eval_runs', async () => {
    const agent = await createAgent(app, 'Doomed');
    stub.register('CASE-DOOM', { type: 'must_find', file: A_FILE, start_line: 1, end_line: 2 });
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-cases`, payload: createDraftBody('CASE-DOOM') });
    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    await waitForEvalRun(app, started.json().id);
    expect(await casesOfAgent(db(), agent.id)).toHaveLength(1);
    expect(await runsOfAgents(db(), [agent.id])).toHaveLength(1);

    const del = await app.inject({ method: 'DELETE', url: `/agents/${agent.id}` });
    expect(del.statusCode).toBe(200);
    expect(await casesOfAgent(db(), agent.id)).toHaveLength(0);
    expect(await runsOfAgents(db(), [agent.id])).toHaveLength(0);
  });

  it('AC-21 rate limit: with an app built with nodeEnv production, the 6th POST /agents/:id/eval-runs within a minute → 429', async () => {
    const limited = await makeApp({ nodeEnv: 'production' });
    const agent = await createAgent(limited, 'RateLimited');
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await limited.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })).statusCode);
    }
    // No cases -> the first five are 422 (still counted); the sixth is throttled.
    expect(codes.slice(0, 5)).toEqual([422, 422, 422, 422, 422]);
    expect(codes[5]).toBe(429);
    await limited.close();
  });
});

/** A groundable manual case body (expectation lines 1-2 are inside src/a.ts's hunk). */
function createDraftBody(title: string) {
  return manualCaseBody(title);
}
