import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { RepoRef } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context] Docker not available — skipping integration tests.');
}

/**
 * `MockGitClient` always resolves `clonePathFor` to a fixed, non-existent
 * `/mock/clones/...` path — fine for AC-34 (no-clone) but useless for tests
 * that need the Project Context module to actually read/write real files.
 * This subclass overrides ONLY `clonePathFor` to point at a real temp-dir
 * fixture created per test; everything else (diff/readFile/etc.) is
 * inherited from `MockGitClient` unchanged.
 */
class FixtureGitClient extends MockGitClient {
  constructor(private readonly cloneRoot: string) {
    super();
  }
  clonePathFor(_repo: RepoRef): string {
    return this.cloneRoot;
  }
}

/**
 * T15 — Project Context attachment/listing integration tests (SPEC-01), run
 * against a real (Testcontainers) Postgres via `app.inject`. Covers AC-11,
 * AC-12, AC-13, AC-15, AC-17, AC-34, AC-37, AC-38.
 */
d('Project Context: attachment and listing integration (server/test/context.it.test.ts)', () => {
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

  function makeApp(git: MockGitClient = new MockGitClient()) {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { git, github: new MockGitHubClient() },
    });
  }

  async function createRepo() {
    const owner = 'acme';
    const name = `context-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner, name, fullName: `${owner}/${name}` })
      .returning();
    return repo!;
  }

  async function createAgent(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review.' },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  async function createSkill(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name, type: 'rubric', source: 'manual', body: `# ${name}\n\nBody.` },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  async function makeCloneFixture(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'devdigest-context-it-'));
  }

  async function writeFixtureDoc(root: string, relPath: string, content: string) {
    const full = join(root, relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  // ---------------------------------------------------------------------
  // AC-12 — replace-all round-trip (agents + skills)
  // ---------------------------------------------------------------------

  it('AC-12: POST /agents/:id/context-documents replace-all round-trip preserves the exact ordered set', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'AC12 agent');
    const paths = ['docs/b.md', 'docs/a.md', 'README.md'];

    const posted = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-documents`,
      payload: { paths },
    });
    expect(posted.statusCode).toBe(200);
    expect(posted.json()).toEqual({ paths });

    const got = await app.inject({ method: 'GET', url: `/agents/${agent.id}/context-documents` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual({ paths });

    await app.close();
  });

  it('AC-12: POST /skills/:id/context-documents replace-all round-trip preserves the exact ordered set', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'AC12 skill');
    const paths = ['guides/z.md', 'guides/a.md', 'CLAUDE.md'];

    const posted = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/context-documents`,
      payload: { paths },
    });
    expect(posted.statusCode).toBe(200);
    expect(posted.json()).toEqual({ paths });

    const got = await app.inject({ method: 'GET', url: `/skills/${skill.id}/context-documents` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual({ paths });

    await app.close();
  });

  // ---------------------------------------------------------------------
  // AC-13 — attachment record holds paths only, never content/size
  // ---------------------------------------------------------------------

  it('AC-13: editing a document\'s content via PUT never changes the agent\'s attached-paths record', async () => {
    const cloneRoot = await makeCloneFixture();
    await writeFixtureDoc(cloneRoot, 'docs/guide.md', '# v1\n\nShort.');
    const app = await makeApp(new FixtureGitClient(cloneRoot));
    const repo = await createRepo();
    const agent = await createAgent(app, 'AC13 agent');

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-documents`,
      payload: { paths: ['docs/guide.md'] },
    });
    const before = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/context-documents` })
    ).json();

    const written = await app.inject({
      method: 'PUT',
      url: `/repos/${repo.id}/context/document`,
      payload: { path: 'docs/guide.md', content: '# v2\n\nMuch, much longer content than before.' },
    });
    expect(written.statusCode).toBe(200);

    const after = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/context-documents` })
    ).json();
    expect(after).toEqual(before);

    // The persisted column itself is a bare string array — no size/content
    // ever stored alongside the path.
    const [row] = await pg.handle.db
      .select({ contextDocuments: t.agents.contextDocuments })
      .from(t.agents)
      .where(eq(t.agents.id, agent.id));
    expect(row?.contextDocuments).toEqual(['docs/guide.md']);

    await app.close();
    await rm(cloneRoot, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------
  // AC-15 / AC-17 — a context-documents POST never bumps version/history
  // ---------------------------------------------------------------------

  it('AC-15: agent.version and agent_versions row count are unchanged after a context-documents POST', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'AC15 agent');
    expect(agent.version).toBe(1);

    const versionsBefore = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions` })
    ).json();

    const posted = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-documents`,
      payload: { paths: ['a.md', 'b.md'] },
    });
    expect(posted.statusCode).toBe(200);

    const after = (await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).json();
    expect(after.version).toBe(agent.version);

    const versionsAfter = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions` })
    ).json();
    expect(versionsAfter).toHaveLength(versionsBefore.length);

    await app.close();
  });

  it('AC-17: skill.version and skill_versions row count are unchanged after a context-documents POST', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'AC17 skill');
    expect(skill.version).toBe(1);

    const versionsBefore = (
      await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })
    ).json();

    const posted = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/context-documents`,
      payload: { paths: ['a.md', 'b.md'] },
    });
    expect(posted.statusCode).toBe(200);

    const after = (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json();
    expect(after.version).toBe(skill.version);

    const versionsAfter = (
      await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })
    ).json();
    expect(versionsAfter).toHaveLength(versionsBefore.length);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // AC-38 — concurrent replace-all never merges/partials/empties
  // ---------------------------------------------------------------------

  it('AC-38: two genuinely concurrent POST /agents/:id/context-documents settle on exactly ONE submitted set, never a merge', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'AC38 agent');
    const setA = ['a.md', 'b.md'];
    const setB = ['c.md', 'd.md', 'e.md'];
    const post = (paths: string[]) =>
      app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/context-documents`,
        payload: { paths },
      });

    // Genuinely overlapping — fired together via Promise.all, not sequential
    // await/await, which cannot reproduce the agent_skills-style race
    // documented in server/INSIGHTS.md (2026-09-21).
    const [r1, r2] = await Promise.all([post(setA), post(setB)]);
    expect(r1.statusCode).toBeGreaterThanOrEqual(200);
    expect(r1.statusCode).toBeLessThan(300);
    expect(r2.statusCode).toBeGreaterThanOrEqual(200);
    expect(r2.statusCode).toBeLessThan(300);

    const final = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/context-documents` })
    ).json().paths;

    const matchesA = JSON.stringify(final) === JSON.stringify(setA);
    const matchesB = JSON.stringify(final) === JSON.stringify(setB);
    // eslint-disable-next-line no-console
    console.info(
      `[AC-38][agents] concurrent POST outcome: final=${JSON.stringify(final)} ` +
        `(matches ${matchesA ? 'setA' : matchesB ? 'setB' : 'NEITHER — merge/partial/empty bug'})`,
    );
    expect(matchesA || matchesB).toBe(true);

    await app.close();
  });

  it('AC-38: two genuinely concurrent POST /skills/:id/context-documents settle on exactly ONE submitted set, never a merge', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'AC38 skill');
    const setA = ['x.md', 'y.md'];
    const setB = ['p.md', 'q.md', 'r.md'];
    const post = (paths: string[]) =>
      app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/context-documents`,
        payload: { paths },
      });

    const [r1, r2] = await Promise.all([post(setA), post(setB)]);
    expect(r1.statusCode).toBeGreaterThanOrEqual(200);
    expect(r1.statusCode).toBeLessThan(300);
    expect(r2.statusCode).toBeGreaterThanOrEqual(200);
    expect(r2.statusCode).toBeLessThan(300);

    const final = (
      await app.inject({ method: 'GET', url: `/skills/${skill.id}/context-documents` })
    ).json().paths;

    const matchesA = JSON.stringify(final) === JSON.stringify(setA);
    const matchesB = JSON.stringify(final) === JSON.stringify(setB);
    // eslint-disable-next-line no-console
    console.info(
      `[AC-38][skills] concurrent POST outcome: final=${JSON.stringify(final)} ` +
        `(matches ${matchesA ? 'setA' : matchesB ? 'setB' : 'NEITHER — merge/partial/empty bug'})`,
    );
    expect(matchesA || matchesB).toBe(true);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // AC-34 — no local clone degrades to a successful empty listing
  // ---------------------------------------------------------------------

  it('AC-34: GET /repos/:repoId/context for a repo with no local clone returns 200 with clone_available:false and no documents', async () => {
    // Default MockGitClient.clonePathFor() resolves to a non-existent
    // /mock/clones/... path — no fixture override needed.
    const app = await makeApp();
    const repo = await createRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.clone_available).toBe(false);
    expect(body.documents).toEqual([]);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // AC-37 — traversal / absolute / symlink-escape paths rejected, 4xx only
  // ---------------------------------------------------------------------

  it('AC-37: GET document rejects traversal, absolute, and symlink-escape paths with 4xx (never 5xx)', async () => {
    const cloneRoot = await makeCloneFixture();
    await writeFixtureDoc(cloneRoot, 'safe.md', '# safe');
    const escapeTarget = await mkdtemp(join(tmpdir(), 'devdigest-context-escape-'));
    await writeFile(join(escapeTarget, 'secret.md'), '# secret, must never be returned');
    const linkPath = join(cloneRoot, 'escape-link');
    await symlink(escapeTarget, linkPath, 'dir');

    const app = await makeApp(new FixtureGitClient(cloneRoot));
    const repo = await createRepo();

    const getPath = async (path: string) =>
      app.inject({ method: 'GET', url: `/repos/${repo.id}/context/document?path=${encodeURIComponent(path)}` });

    const traversal = await getPath('../../../../etc/passwd');
    expect(traversal.statusCode).toBeGreaterThanOrEqual(400);
    expect(traversal.statusCode).toBeLessThan(500);

    const absolute = await getPath('/etc/passwd');
    expect(absolute.statusCode).toBeGreaterThanOrEqual(400);
    expect(absolute.statusCode).toBeLessThan(500);

    const symlinkEscape = await getPath('escape-link/secret.md');
    expect(symlinkEscape.statusCode).toBeGreaterThanOrEqual(400);
    expect(symlinkEscape.statusCode).toBeLessThan(500);
    // Confirm the rejection happened BEFORE any read — the secret content
    // never comes back in the response body.
    expect(JSON.stringify(symlinkEscape.json())).not.toContain('must never be returned');

    await app.close();
    await unlink(linkPath).catch(() => {});
    await rm(cloneRoot, { recursive: true, force: true });
    await rm(escapeTarget, { recursive: true, force: true });
  });

  it('AC-37: PUT document rejects traversal, absolute, and symlink-escape paths with 4xx and never writes outside the clone', async () => {
    const cloneRoot = await makeCloneFixture();
    const escapeTarget = await mkdtemp(join(tmpdir(), 'devdigest-context-escape-write-'));
    await writeFile(join(escapeTarget, 'secret.md'), '# original, must stay unchanged');
    const linkPath = join(cloneRoot, 'escape-link');
    await symlink(escapeTarget, linkPath, 'dir');

    const app = await makeApp(new FixtureGitClient(cloneRoot));
    const repo = await createRepo();

    const putPath = async (path: string) =>
      app.inject({
        method: 'PUT',
        url: `/repos/${repo.id}/context/document`,
        payload: { path, content: 'pwned' },
      });

    const traversal = await putPath('../../../../tmp/devdigest-it-pwned.md');
    expect(traversal.statusCode).toBeGreaterThanOrEqual(400);
    expect(traversal.statusCode).toBeLessThan(500);

    const absolute = await putPath('/tmp/devdigest-it-pwned.md');
    expect(absolute.statusCode).toBeGreaterThanOrEqual(400);
    expect(absolute.statusCode).toBeLessThan(500);

    const symlinkEscape = await putPath('escape-link/secret.md');
    expect(symlinkEscape.statusCode).toBeGreaterThanOrEqual(400);
    expect(symlinkEscape.statusCode).toBeLessThan(500);

    // The symlink target's real content must be untouched by the rejected write.
    const stillOriginal = await readFile(join(escapeTarget, 'secret.md'), 'utf8');
    expect(stillOriginal).toBe('# original, must stay unchanged');

    await app.close();
    await unlink(linkPath).catch(() => {});
    await rm(cloneRoot, { recursive: true, force: true });
    await rm(escapeTarget, { recursive: true, force: true });
  });

  it('AC-37: attachment-set submissions reject traversal/absolute paths with 4xx for both agents and skills', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'AC37 agent');
    const skill = await createSkill(app, 'AC37 skill');

    for (const badPath of ['../../../../etc/passwd', '/etc/passwd']) {
      const agentRes = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/context-documents`,
        payload: { paths: [badPath] },
      });
      expect(agentRes.statusCode).toBeGreaterThanOrEqual(400);
      expect(agentRes.statusCode).toBeLessThan(500);

      const skillRes = await app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/context-documents`,
        payload: { paths: [badPath] },
      });
      expect(skillRes.statusCode).toBeGreaterThanOrEqual(400);
      expect(skillRes.statusCode).toBeLessThan(500);
    }

    // Neither rejected submission was persisted.
    const agentPaths = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/context-documents` })
    ).json();
    expect(agentPaths.paths).toEqual([]);
    const skillPaths = (
      await app.inject({ method: 'GET', url: `/skills/${skill.id}/context-documents` })
    ).json();
    expect(skillPaths.paths).toEqual([]);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // AC-11 — used_by_agents reflects attach/detach across agents
  // ---------------------------------------------------------------------

  it('AC-11: used_by_agents is 2 when two agents attach the same path, drops to 1 after detaching one', async () => {
    const cloneRoot = await makeCloneFixture();
    await writeFixtureDoc(cloneRoot, 'ac11-shared.md', '# shared doc');
    const app = await makeApp(new FixtureGitClient(cloneRoot));
    const repo = await createRepo();

    const agentA = await createAgent(app, 'AC11 agent A');
    const agentB = await createAgent(app, 'AC11 agent B');

    await app.inject({
      method: 'POST',
      url: `/agents/${agentA.id}/context-documents`,
      payload: { paths: ['ac11-shared.md'] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agentB.id}/context-documents`,
      payload: { paths: ['ac11-shared.md'] },
    });

    const listing1 = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json();
    const doc1 = listing1.documents.find((doc: { path: string }) => doc.path === 'ac11-shared.md');
    expect(doc1?.used_by_agents).toBe(2);

    // Detach from agent A only.
    await app.inject({
      method: 'POST',
      url: `/agents/${agentA.id}/context-documents`,
      payload: { paths: [] },
    });

    const listing2 = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json();
    const doc2 = listing2.documents.find((doc: { path: string }) => doc.path === 'ac11-shared.md');
    expect(doc2?.used_by_agents).toBe(1);

    await app.close();
    await rm(cloneRoot, { recursive: true, force: true });
  });
});
