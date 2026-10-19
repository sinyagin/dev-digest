import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { AgentManifest, RunTrace } from '@devdigest/shared';
import type { WorkflowRunInfo } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
  type MockGitHubOptions,
} from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci] Docker not available — skipping integration tests.');
}

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_FIXTURE = join(HERE, 'fixtures', 'ci', 'runner-dist');
const VALID_ARTIFACT = JSON.parse(
  readFileSync(join(HERE, 'fixtures', 'ci', 'artifact.valid.json'), 'utf8'),
) as Record<string, unknown>;

const OPENROUTER_VALUE = 'sk-or-v1-studio-held-openrouter-value-0123456789';
const GITHUB_VALUE = `ghp_${'Zz9'.repeat(12)}`;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const sha = (n: number) => n.toString(16).padStart(40, '0');

d('ci module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  const db = () => pg.handle.db;
  const llm = new MockLLMProvider('openai');
  const llmRouter = new MockLLMProvider('openai');

  beforeAll(async () => {
    process.env.DEVDIGEST_RUNNER_DIST = RUNNER_FIXTURE;
    pg = await startPg();
    await seed(db());
    const [ws] = await db().select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    delete process.env.DEVDIGEST_RUNNER_DIST;
    await pg?.stop();
  });

  function makeApp(gh?: MockGitHubClient, withToken = true) {
    return buildApp({
      config: config(),
      db: db(),
      overrides: {
        git: new MockGitClient({}),
        secrets: new MockSecretsProvider(
          withToken ? { OPENROUTER_API_KEY: OPENROUTER_VALUE, GITHUB_TOKEN: GITHUB_VALUE } : {},
        ),
        ...(gh ? { github: gh } : {}),
        llm: { openai: llm, anthropic: llm, openrouter: llmRouter },
      },
    });
  }

  async function addRepo(fullName: string, ws = workspaceId) {
    const [owner, name] = fullName.split('/') as [string, string];
    const [row] = await db().insert(t.repos).values({ workspaceId: ws, owner, name, fullName }).returning();
    return row!;
  }

  async function addAgent(name: string, skillNames: string[] = [], ws = workspaceId) {
    const [agent] = await db()
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name,
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        systemPrompt: `You are ${name}.`,
        strategy: 'map-reduce',
        ciFailOn: 'warning',
      })
      .returning();
    for (const [i, s] of skillNames.entries()) {
      const [skill] = await db()
        .insert(t.skills)
        .values({ workspaceId: ws, name: s, description: s, type: 'custom', source: 'manual', body: `# ${s}\nbody` })
        .returning();
      await db().insert(t.agentSkills).values({ agentId: agent!.id, skillId: skill!.id, order: i });
    }
    return agent!;
  }

  const body = (repo: string, extra: Record<string, unknown> = {}) => ({ repo, ...extra });
  const post = (app: Awaited<ReturnType<typeof makeApp>>, url: string, payload?: unknown) =>
    app.inject({ method: 'POST', url, ...(payload === undefined ? {} : { payload: payload as object }) });

  // ------------------------------------------------------------------ targets + preview
  it('AC-3 targets returns exactly gha', async () => {
    const app = await makeApp(new MockGitHubClient());
    const res = await app.inject({ method: 'GET', url: '/ci/targets' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ target: 'gha', label_key: 'ci.targets.gha' }]);
  });

  it('AC-6/8/9/50 preview lists the bundle; manifest validates; memory is repo-scoped, content-only', async () => {
    const agent = await addAgent('Security Reviewer', ['Security Rules', 'Style Guide']);
    const widgets = await addRepo('acme/widgets');
    const other = await addRepo('acme/other-memory');
    const empty = await addRepo('acme/empty');
    const mem = (repoId: string | null, scope: 'repo' | 'global', content: string) =>
      db().insert(t.memory).values({ workspaceId, repoId, scope, kind: 'fact', content, confidence: 0.9 });
    await mem(widgets.id, 'repo', 'one');
    await mem(widgets.id, 'repo', 'two');
    await mem(widgets.id, 'repo', 'three\nlines');
    await mem(other.id, 'repo', 'other repo');
    await mem(null, 'global', 'global row');

    const app = await makeApp(new MockGitHubClient());
    const res = await post(app, `/agents/${agent.id}/ci/preview`, body('acme/widgets'));
    expect(res.statusCode).toBe(200);
    const preview = res.json();
    expect(preview.files.map((f: { path: string }) => f.path)).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/skills/security-rules.md',
      '.devdigest/skills/style-guide.md',
      '.devdigest/memory.jsonl',
      '.devdigest/runner/index.js',
      '.devdigest/runner/package.json',
      '.github/workflows/devdigest-review.yml',
    ]);
    const byPath = Object.fromEntries(preview.files.map((f: { path: string }) => [f.path, f]));
    expect(byPath['.devdigest/runner/index.js'].contents).toBeNull();
    expect(byPath['.devdigest/runner/index.js'].size_bytes).toBeGreaterThan(0);
    expect(byPath['.github/workflows/devdigest-review.yml'].editable).toBe(true);
    expect(preview.files.filter((f: { editable: boolean }) => f.editable)).toHaveLength(1);

    const manifest = AgentManifest.parse(parse(byPath['.devdigest/agents/security-reviewer.yaml'].contents));
    expect(manifest).toMatchObject({
      name: 'Security Reviewer',
      slug: 'security-reviewer',
      agent_version: agent.version,
      provider: 'openrouter',
      model: agent.model,
      system_prompt: agent.systemPrompt,
      skills: ['security-rules', 'style-guide'],
      strategy: 'map-reduce',
      ci_fail_on: 'warning',
    });

    const lines = String(byPath['.devdigest/memory.jsonl'].contents).trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(Object.keys(JSON.parse(l)).sort()).toEqual(['content', 'kind']);
    expect(lines.join('')).not.toContain('other repo');
    expect(lines.join('')).not.toContain('global row');

    const emptyPreview = (await post(app, `/agents/${agent.id}/ci/preview`, body(empty.fullName))).json();
    expect(emptyPreview.files.find((f: { path: string }) => f.path === '.devdigest/memory.jsonl').contents).toBe('');
    expect(preview.existing_installation).toBeNull();
  });

  it('AC-7 preview/file loads one runner file on demand and refuses unknown paths', async () => {
    const [agent] = await db().select().from(t.agents).where(eq(t.agents.name, 'Security Reviewer'));
    const app = await makeApp(new MockGitHubClient());
    const ok = await post(app, `/agents/${agent!.id}/ci/preview/file`, {
      ...body('acme/widgets'),
      path: '.devdigest/runner/index.js',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().contents).toContain('fixture runner entry');
    const missing = await post(app, `/agents/${agent!.id}/ci/preview/file`, {
      ...body('acme/widgets'),
      path: '.devdigest/runner/../../etc/passwd',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('AC-14 secret status: ready / not_set / unknown (403), GITHUB_TOKEN always ready', async () => {
    const opts: MockGitHubOptions = { secretNames: ['OPENROUTER_API_KEY', 'OTHER'] };
    const app = await makeApp(new MockGitHubClient(opts));
    const status = async () => (await app.inject({ method: 'GET', url: '/ci/secrets?repo=acme/widgets' })).json();
    expect(await status()).toEqual([
      { name: 'OPENROUTER_API_KEY', status: 'ready' },
      { name: 'GITHUB_TOKEN', status: 'ready' },
    ]);
    opts.secretNames = ['OTHER'];
    expect((await status())[0].status).toBe('not_set');
    opts.secretNames = 'forbidden';
    expect((await status())[0].status).toBe('unknown');
    const [agent] = await db().select().from(t.agents).where(eq(t.agents.name, 'Security Reviewer'));
    const pv = (await post(app, `/agents/${agent!.id}/ci/preview`, body('acme/widgets'))).json();
    expect(pv.secrets[0]).toEqual({ name: 'OPENROUTER_API_KEY', status: 'unknown' });
  });

  // ------------------------------------------------------------------ install
  it('AC-16/17/18/19/24 PR install: one PR, second install reuses it, never the default branch, one row, zip equals preview', async () => {
    const gh = new MockGitHubClient({ defaultBranch: 'trunk' });
    const app = await makeApp(gh);
    const [agent] = await db().select().from(t.agents).where(eq(t.agents.name, 'Security Reviewer'));
    const edited = 'name: edited by user\non:\n  pull_request:\n    types: [opened]\njobs: {}\n';

    const first = await post(app, `/agents/${agent!.id}/ci/export`, body('acme/widgets', { workflow_override: edited }));
    expect(first.statusCode).toBe(200);
    const second = await post(app, `/agents/${agent!.id}/ci/export`, body('acme/widgets'));
    expect(second.statusCode).toBe(200);

    expect(gh.openedPrs).toHaveLength(1);
    expect(gh.openedPrs[0]).toMatchObject({ head: 'devdigest/ci', base: 'trunk', title: 'Add DevDigest CI review' });
    expect(second.json().pr_url).toBe(first.json().pr_url);
    expect(gh.committed).toHaveLength(2);
    expect(gh.committed.every((c) => c.branch === 'devdigest/ci' && c.base === 'trunk')).toBe(true);
    expect(gh.refWrites.length).toBeGreaterThan(0);
    expect(gh.refWrites.every((r) => r === 'heads/devdigest/ci')).toBe(true);
    expect(gh.refWrites).not.toContain('heads/trunk');

    // Edited workflow committed verbatim; the second (no override) regenerates it.
    const wf1 = gh.committed[0]!.files.find((f) => f.path.endsWith('devdigest-review.yml'))!;
    expect(wf1.contents).toBe(edited);
    expect(gh.committed[1]!.files.find((f) => f.path.endsWith('devdigest-review.yml'))!.contents).toContain(
      'name: DevDigest Review',
    );
    // The runner bundle (fixture) is committed with its real contents, flat.
    expect(gh.committed[0]!.files.find((f) => f.path === '.devdigest/runner/package.json')!.contents).toContain('module');
    // AC-24: no studio-held secret value in any generated file.
    for (const c of gh.committed) {
      for (const f of c.files) {
        expect(f.contents).not.toContain(OPENROUTER_VALUE);
        expect(f.contents).not.toContain(GITHUB_VALUE);
      }
    }
    // AC-18: one row per agent x repo x target after two installs.
    const rows = await db()
      .select()
      .from(t.ciInstallations)
      .where(and(eq(t.ciInstallations.agentId, agent!.id), eq(t.ciInstallations.repo, 'acme/widgets')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetType: 'gha', prUrl: first.json().pr_url, exportedAgentVersion: agent!.version });

    // AC-19: zip entries == preview paths; edited workflow verbatim; zip also records the installation.
    const preview = (await post(app, `/agents/${agent!.id}/ci/preview`, body('acme/widgets'))).json();
    const zipRes = await post(app, `/agents/${agent!.id}/ci/export/zip`, body('acme/widgets', { workflow_override: edited }));
    expect(zipRes.statusCode).toBe(200);
    expect(zipRes.headers['content-type']).toContain('application/zip');
    const entries = unzipSync(new Uint8Array(zipRes.rawPayload));
    expect(Object.keys(entries).sort()).toEqual(preview.files.map((f: { path: string }) => f.path).sort());
    expect(new TextDecoder().decode(entries['.github/workflows/devdigest-review.yml'])).toBe(edited);
    expect(gh.committed).toHaveLength(2); // zip never touches GitHub
    const rowsAfterZip = await db().select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agent!.id));
    expect(rowsAfterZip).toHaveLength(1);
    expect(rowsAfterZip[0]!.prUrl).toBeNull();
  });

  it('rejects a workflow_override that is not YAML / too large with a 400 naming the field', async () => {
    const app = await makeApp(new MockGitHubClient());
    const [agent] = await db().select().from(t.agents).where(eq(t.agents.name, 'Security Reviewer'));
    const res = await post(app, `/agents/${agent!.id}/ci/export/zip`, body('acme/widgets', { workflow_override: 'a: [unclosed' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toEqual({ field: 'workflow_override' });
  });

  it('AC-20 GitHub refusal -> typed error, no row, zip still works; no token -> no_token', async () => {
    const denied = await addRepo('acme/denied');
    const noscope = await addRepo('acme/noscope');
    const agent = await addAgent('Denied Agent');
    const gh = new MockGitHubClient({
      commitFailures: {
        'acme/denied': { status: 403, message: 'Resource not accessible' },
        'acme/noscope': { status: 403, message: 'refusing to allow a PAT to create or update workflow without `workflow` scope' },
      },
    });
    const app = await makeApp(gh);
    const res = await post(app, `/agents/${agent.id}/ci/export`, body(denied.fullName));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    const res2 = await post(app, `/agents/${agent.id}/ci/export`, body(noscope.fullName));
    expect(res2.json().error.code).toBe('missing_workflow_scope');
    expect(await db().select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agent.id))).toHaveLength(0);
    expect((await post(app, `/agents/${agent.id}/ci/export/zip`, body(denied.fullName))).statusCode).toBe(200);

    const noToken = await makeApp(undefined, false);
    const res3 = await post(noToken, `/agents/${agent.id}/ci/export`, body(denied.fullName));
    expect(res3.statusCode).toBe(400);
    expect(res3.json().error.code).toBe('no_token');
  });

  it('missing runner bundle fails preview and export with runner_bundle_missing', async () => {
    const agent = await addAgent('Bundle Agent');
    process.env.DEVDIGEST_RUNNER_DIST = join(HERE, 'fixtures', 'ci', 'nope');
    const app = await makeApp(new MockGitHubClient()); // config is read when the app is built
    try {
      const res = await post(app, `/agents/${agent.id}/ci/preview`, body('acme/widgets'));
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('runner_bundle_missing');
      expect(res.json().error.message).toContain('runner bundle not built');
    } finally {
      process.env.DEVDIGEST_RUNNER_DIST = RUNNER_FIXTURE;
    }
  });

  it('AC-5 preview names a different agent already installed in the repo', async () => {
    const gadgets = await addRepo('acme/gadgets');
    const a = await addAgent('Installer A');
    const b = await addAgent('Installer B');
    const app = await makeApp(new MockGitHubClient());
    await post(app, `/agents/${a.id}/ci/export`, body(gadgets.fullName));
    const pv = (await post(app, `/agents/${b.id}/ci/preview`, body(gadgets.fullName))).json();
    expect(pv.existing_installation).toEqual({ agent_id: a.id, agent_name: 'Installer A' });
    const own = (await post(app, `/agents/${a.id}/ci/preview`, body(gadgets.fullName))).json();
    expect(own.existing_installation).toBeNull();
  });

  it('AC-44/45 installations list with out_of_date when the agent or workflow version moved', async () => {
    const repo = await addRepo('acme/versions');
    const agent = await addAgent('Versioned');
    const app = await makeApp(new MockGitHubClient());
    await post(app, `/agents/${agent.id}/ci/export`, body(repo.fullName, { triggers: ['opened'], post_as: 'none' }));
    const list = async () => (await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci/installations` })).json();
    let rows = await list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ repo: repo.fullName, triggers: ['opened'], post_as: 'none', out_of_date: false, last_run: null });
    await db().update(t.agents).set({ version: agent.version + 1 }).where(eq(t.agents.id, agent.id));
    expect((await list())[0].out_of_date).toBe(true);
    await db().update(t.agents).set({ version: agent.version }).where(eq(t.agents.id, agent.id));
    await db().update(t.ciInstallations).set({ workflowVersion: 0 }).where(eq(t.ciInstallations.agentId, agent.id));
    expect((await list())[0].out_of_date).toBe(true);
  });

  it('AC-46 republish: one PR, one reported failure, stored triggers and post mode reused', async () => {
    const ok = await addRepo('acme/rp-ok');
    const bad = await addRepo('acme/rp-bad');
    const agent = await addAgent('Republisher');
    const gh = new MockGitHubClient({ commitFailures: { 'acme/rp-bad': { status: 403, message: 'no' } } });
    const app = await makeApp(gh);
    await db().insert(t.ciInstallations).values([
      { agentId: agent.id, repo: ok.fullName, targetType: 'gha', triggers: ['reopened'], postAs: 'pr_comment', exportedAgentVersion: 1, workflowVersion: 0 },
      { agentId: agent.id, repo: bad.fullName, targetType: 'gha', triggers: ['opened'], postAs: 'none', exportedAgentVersion: 1, workflowVersion: 0 },
    ]);
    const res = await post(app, `/agents/${agent.id}/ci/republish`);
    expect(res.statusCode).toBe(200);
    const results = res.json().results as { repo: string; ok: boolean; pr_url: string | null; error: { code: string } | null }[];
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.repo === 'acme/rp-ok')).toMatchObject({ ok: true, error: null });
    expect(results.find((r) => r.repo === 'acme/rp-bad')).toMatchObject({ ok: false, pr_url: null, error: { code: 'forbidden' } });
    expect(gh.openedPrs).toHaveLength(1);
    const wf = gh.committed[0]!.files.find((f) => f.path.endsWith('devdigest-review.yml'))!.contents;
    expect(wf).toContain('types: [reopened]');
    expect(wf).toContain('DEVDIGEST_POST_AS: pr_comment');
    const installs = await db().select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agent.id));
    expect(installs.find((i) => i.repo === 'acme/rp-ok')!.workflowVersion).toBe(1);
    expect(installs.find((i) => i.repo === 'acme/rp-bad')!.workflowVersion).toBe(0);
  });

  // ------------------------------------------------------------------ tenancy
  it('AC-49 foreign ids -> 404; malformed repo -> 400 naming the field', async () => {
    const [foreignWs] = await db().insert(t.workspaces).values({ name: 'other-tenant' }).returning();
    const foreignAgent = await addAgent('Foreign', [], foreignWs!.id);
    await addRepo('foreign/repo', foreignWs!.id);
    const local = await addAgent('Local tenant agent');
    const app = await makeApp(new MockGitHubClient());

    expect((await post(app, `/agents/${foreignAgent.id}/ci/preview`, body('acme/widgets'))).statusCode).toBe(404);
    expect((await post(app, `/agents/${foreignAgent.id}/ci/export`, body('acme/widgets'))).statusCode).toBe(404);
    expect((await post(app, `/agents/${foreignAgent.id}/ci/republish`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/agents/${foreignAgent.id}/ci/installations` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/ci/runs?agent_id=${foreignAgent.id}` })).statusCode).toBe(404);
    // A repository from another workspace is "not found", not disclosed.
    expect((await post(app, `/agents/${local.id}/ci/preview`, body('foreign/repo'))).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/ci/secrets?repo=foreign/repo' })).statusCode).toBe(404);

    const bad = await post(app, `/agents/${local.id}/ci/preview`, body('not-a-repo'));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain('repo');
    expect(bad.json().error.details).toEqual({ field: 'repo' });
    const badSecrets = await app.inject({ method: 'GET', url: '/ci/secrets?repo=..%2Fx' });
    expect(badSecrets.statusCode).toBe(400);
    expect(badSecrets.json().error.details).toEqual({ field: 'repo' });
  });

  // ------------------------------------------------------------------ ingestion
  describe('ingestion (AC-33 … AC-40)', () => {
    const REPO = 'acme/ingest';
    let agentId: string;
    let installationId: string;
    let prId: string;

    const run = (id: number, extra: Partial<WorkflowRunInfo> = {}): WorkflowRunInfo => ({
      id,
      status: 'completed',
      conclusion: 'success',
      headSha: sha(id),
      htmlUrl: `https://github.com/${REPO}/actions/runs/${id}`,
      createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, id % 60)).toISOString(),
      prNumber: 42,
      ...extra,
    });
    const artifactJson = (id: number, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ ...VALID_ARTIFACT, repository: REPO, commit_sha: sha(id), workflow_run_id: id, ...extra });
    const zipOf = (json: string) => zipSync({ 'devdigest-result.json': strToU8(json) });

    const runs: WorkflowRunInfo[] = [];
    const artifacts: Record<number, Uint8Array | null> = {};
    const ghOpts: MockGitHubOptions = { workflowRuns: { [REPO]: runs }, artifacts };
    const gh = new MockGitHubClient(ghOpts);

    const counts = async () => {
      const q = async (table: string) =>
        Number(((await db().execute(sql.raw(`select count(*)::int as n from ${table}`))) as unknown as { n: number }[])[0]!.n);
      return { ci: await q('ci_runs'), agentRuns: await q(`agent_runs where source = 'ci'`), traces: await q('run_traces') };
    };
    const refresh = async (app: Awaited<ReturnType<typeof makeApp>>) => (await post(app, '/ci/runs/refresh')).json();

    beforeAll(async () => {
      const repo = await addRepo(REPO);
      const agent = await addAgent('Ingest Agent');
      agentId = agent.id;
      const [pr] = await db()
        .insert(t.pullRequests)
        .values({ workspaceId, repoId: repo.id, number: 42, title: 'Imported PR', author: 'a', branch: 'b', base: 'main', headSha: sha(1) })
        .returning();
      prId = pr!.id;
      const [inst] = await db()
        .insert(t.ciInstallations)
        .values({ agentId, repo: REPO, targetType: 'gha' })
        .returning();
      installationId = inst!.id;
    });

    it('stores 3 accepted/failed runs from 3 listed runs, one agent_runs row per accepted run, and a full trace', async () => {
      runs.push(run(101), run(102), run(104, { status: 'in_progress', conclusion: null }), run(105, { conclusion: 'skipped' }));
      artifacts[101] = zipOf(artifactJson(101));
      // 102: completed, no artifact -> failed (AC-35). 104 still running. 105 skipped -> ignored.
      const before = await counts();
      const app = await makeApp(gh);
      const res = await refresh(app);
      expect(res).toMatchObject({ ingested: 3, failed: 1, errors: [] });
      const after = await counts();
      expect(after.ci - before.ci).toBe(3);
      expect(after.agentRuns - before.agentRuns).toBe(1);
      expect(after.traces - before.traces).toBe(1);

      const rows = await db().select().from(t.ciRuns).where(eq(t.ciRuns.ciInstallationId, installationId));
      const byId = Object.fromEntries(rows.map((r) => [r.workflowRunId, r]));
      expect(byId[105]).toBeUndefined();
      // AC-35: no-artifact run -> failed with PR number, time, job url, no counts or cost.
      expect(byId[102]).toMatchObject({
        status: 'failed', failureReason: 'artifact_unavailable', prNumber: 42, githubUrl: run(102).htmlUrl,
        findingsCount: null, costUsd: null, agentRunId: null,
      });
      expect(byId[104]).toMatchObject({ status: 'running', agentRunId: null });
      // AC-37: accepted run.
      expect(byId[101]).toMatchObject({
        status: 'succeeded', verdict: 'request_changes', findingsCount: 3, critical: 1, warning: 1, suggestion: 1,
        blockers: 1, costUsd: 0.0123, durationMs: 8450, commitSha: sha(101), repo: REPO, source: 'ci',
        prUrl: `https://github.com/${REPO}/pull/42`,
      });
      const [agentRun] = await db().select().from(t.agentRuns).where(eq(t.agentRuns.id, byId[101]!.agentRunId!));
      expect(agentRun).toMatchObject({ source: 'ci', agentId, prId, status: 'done', blockers: 1, findingsCount: 3, provider: 'openrouter' });
      // AC-38: trace carries every reproducibility field.
      const [traceRow] = await db().select().from(t.runTraces).where(eq(t.runTraces.runId, agentRun!.id));
      const trace = RunTrace.parse(traceRow!.trace);
      expect(trace.config).toMatchObject({ source: 'ci', model: 'anthropic/claude-sonnet-4', version: '3', pr: 42 });
      expect(trace.ci).toEqual({
        manifest_sha256: VALID_ARTIFACT.manifest_sha256,
        agent_version: 3,
        dependencies: { runner: '0.1.0', reviewer_core: '0.1.0', node: '22.11.0' },
        commit_sha: sha(101),
        workflow_run_id: 101,
      });
      // No `local` row was touched.
      const local = await db().select().from(t.agentRuns).where(eq(t.agentRuns.source, 'local'));
      expect(local.every((r) => r.id !== agentRun!.id)).toBe(true);
    });

    it('AC-34/36 one case per D6 check; nothing from a rejected artifact (or a token) is stored', async () => {
      const token = `ghp_${'a1B2'.repeat(9)}`;
      const cases: [number, string, Uint8Array][] = [
        [110, 'credential', zipOf(artifactJson(110, { agent: `oops ${token}` }))],
        [111, 'commit_sha', zipOf(artifactJson(111, { commit_sha: sha(999) }))],
        [112, 'repository', zipOf(artifactJson(112, { repository: 'evil/repo' }))],
        [113, 'schema', zipOf(artifactJson(113, { findings_count: 'lots' }))],
        [114, 'malformed', zipOf('{nope')],
        [115, 'unsafe_entry', zipSync({ 'devdigest-result.json': strToU8(artifactJson(115)), '../evil': strToU8('x') })],
        [116, 'oversize', zipOf(artifactJson(116, { agent: 'x'.repeat(300 * 1024) }))],
      ];
      for (const [id, , bytes] of cases) {
        runs.push(run(id));
        artifacts[id] = bytes;
      }
      const before = await counts();
      const res = await refresh(await makeApp(gh));
      expect(res.errors).toEqual([]);
      const after = await counts();
      expect(after.agentRuns).toBe(before.agentRuns);
      expect(after.traces).toBe(before.traces);
      for (const [id, check] of cases) {
        const [row] = await db().select().from(t.ciRuns).where(eq(t.ciRuns.workflowRunId, id));
        expect(row, `run ${id}`).toMatchObject({
          status: 'failed', failureReason: `artifact_rejected:${check}`, findingsCount: null, costUsd: null,
          verdict: null, commitSha: sha(id), agentRunId: null,
        });
      }
      // The token appears in no row of any table that ingestion writes.
      for (const table of ['ci_runs', 'agent_runs', 'run_traces']) {
        const hit = (await db().execute(
          sql.raw(`select count(*)::int as n from ${table} where ${table}::text like '%ghp_%'`),
        )) as unknown as { n: number }[];
        expect(Number(hit[0]!.n), table).toBe(0);
      }
    });

    it('AC-39 refresh x3 and concurrent refreshes converge on one row per run; running updates in place', async () => {
      const app = await makeApp(gh);
      const before = await counts();
      await refresh(app);
      await refresh(app);
      await refresh(app);
      expect(await counts()).toEqual(before); // nothing new, nothing duplicated

      // The in-progress run completes -> the stored 'running' row is updated in place.
      const idx = runs.findIndex((r) => r.id === 104);
      runs[idx] = run(104);
      artifacts[104] = zipOf(artifactJson(104, { findings_count: 0, critical: 0, warning: 0, suggestion: 0, blockers: 0, verdict: 'approve', pr_number: 43 }));
      // A brand-new run hit by three concurrent refreshes.
      runs.push(run(120));
      artifacts[120] = zipOf(artifactJson(120));
      await Promise.all([refresh(app), refresh(app), refresh(app)]);
      const rows104 = await db().select().from(t.ciRuns).where(eq(t.ciRuns.workflowRunId, 104));
      expect(rows104).toHaveLength(1);
      expect(rows104[0]).toMatchObject({ status: 'no_findings', verdict: 'approve' });
      expect(rows104[0]!.agentRunId).not.toBeNull();
      const rows120 = await db().select().from(t.ciRuns).where(eq(t.ciRuns.workflowRunId, 120));
      expect(rows120).toHaveLength(1);
      const after = await counts();
      expect(after.ci - before.ci).toBe(1); // only run 120 is new
      expect(after.agentRuns - before.agentRuns).toBe(2); // 104 + 120
      expect(after.traces - before.traces).toBe(2);
    });

    it('a runner-reported failure is accepted with its error category', async () => {
      runs.push(run(130));
      artifacts[130] = zipOf(artifactJson(130, { status: 'failed', error_category: 'llm', verdict: null, findings_count: 0, blockers: 0 }));
      await refresh(await makeApp(gh));
      const [row] = await db().select().from(t.ciRuns).where(eq(t.ciRuns.workflowRunId, 130));
      expect(row).toMatchObject({ status: 'failed', failureReason: 'runner_llm' });
      const [ar] = await db().select().from(t.agentRuns).where(eq(t.agentRuns.id, row!.agentRunId!));
      expect(ar).toMatchObject({ status: 'failed', error: 'llm', source: 'ci' });
    });

    it('AC-40/41 listing reads the DB only: newest first, agent filter, other workspaces hidden, 0 GitHub and 0 LLM calls', async () => {
      const [foreignWs] = await db().select().from(t.workspaces).where(eq(t.workspaces.name, 'other-tenant'));
      await db().insert(t.ciRuns).values({ workspaceId: foreignWs!.id, workflowRunId: 999999, status: 'succeeded', repo: 'foreign/repo' });
      const app = await makeApp(gh);
      const calls = gh.callLog.length;
      const all = (await app.inject({ method: 'GET', url: '/ci/runs' })).json() as { ran_at: string | null; repo: string | null; github_url: string | null }[];
      const mine = (await app.inject({ method: 'GET', url: `/ci/runs?agent_id=${agentId}` })).json() as typeof all;
      expect(gh.callLog.length).toBe(calls);
      expect(all.length).toBeGreaterThanOrEqual(mine.length);
      expect(mine.length).toBeGreaterThan(5);
      expect(all.some((r) => r.repo === 'foreign/repo')).toBe(false);
      const times = mine.map((r) => Date.parse(r.ran_at!));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      expect(mine.every((r) => r.github_url!.startsWith('https://github.com/'))).toBe(true);
      const installs = (await app.inject({ method: 'GET', url: `/agents/${agentId}/ci/installations` })).json();
      expect(installs[0].last_run).toMatchObject({ status: expect.any(String) });
      // AC-40: no LLM call anywhere in this feature.
      expect(llm.calls).toHaveLength(0);
      expect(llmRouter.calls).toHaveLength(0);
    });

    it('refresh reports a missing GitHub token per installation without failing the request', async () => {
      const res = await post(await makeApp(undefined, false), '/ci/runs/refresh');
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ingested).toBe(0);
      expect(body.errors.length).toBeGreaterThan(0);
      expect(body.errors[0]).toMatchObject({ repo: expect.any(String), message: expect.stringContaining('GITHUB_TOKEN') });
    });
  });
});
