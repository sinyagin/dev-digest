import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { strToU8, zipSync } from 'fflate';
import { AgentManifest, CiResultArtifact } from '@devdigest/shared';
import { listTargets } from '../src/modules/ci/targets.js';
import {
  agentSlug,
  buildManifest,
  manifestYaml,
  skillSlugs,
  slugify,
} from '../src/modules/ci/manifest.js';
import { buildWorkflow, RUN_COMMAND } from '../src/modules/ci/workflow.js';
import { assembleBundle, listRunnerFiles } from '../src/modules/ci/bundle.js';
import { CiExportError, mapGitHubError } from '../src/modules/ci/errors.js';
import { memoryJsonl, parseRepo } from '../src/modules/ci/helpers.js';
import { findCredential, verifyArtifact } from '../src/modules/ci/verify-artifact.js';
import { ConfigError } from '../src/platform/errors.js';
import { GOLDEN_AGENT, GOLDEN_SKILLS, goldenManifestYaml } from './fixtures/ci/golden-agent.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'ci');
const RUNNER_FIXTURE = join(FIXTURES, 'runner-dist');

afterEach(() => {
  delete process.env.DEVDIGEST_RUNNER_DIST;
});

describe('ci targets (AC-3)', () => {
  it('lists exactly gha', () => {
    expect(listTargets()).toEqual([{ target: 'gha', label_key: 'ci.targets.gha' }]);
  });
});

describe('ci manifest (AC-8, AC-9, AC-25, golden parity)', () => {
  it('matches the committed golden manifest byte for byte and parses with the shared schema', () => {
    const golden = readFileSync(join(FIXTURES, 'manifest.golden.yaml'), 'utf8');
    expect(goldenManifestYaml()).toBe(golden);
    const parsed = AgentManifest.parse(parse(golden));
    expect(parsed).toMatchObject({
      format: 'devdigest-agent/v1',
      name: GOLDEN_AGENT.name,
      slug: 'security-reviewer-v2',
      agent_version: 3,
      provider: 'openrouter',
      model: GOLDEN_AGENT.model,
      system_prompt: GOLDEN_AGENT.systemPrompt,
      skills: ['security-rules', 'style-guide'],
      strategy: 'map-reduce',
      ci_fail_on: 'warning',
    });
  });

  it('round-trips a hostile name as data and slugs it to a safe value', () => {
    const name = 'x"; rm -rf / #\n$(id)';
    const agent = { ...GOLDEN_AGENT, name };
    const manifest = buildManifest(agent, []);
    expect(AgentManifest.parse(parse(manifestYaml(manifest))).name).toBe(name);
    expect(manifest.slug).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(manifest.skills).toEqual([]);
  });

  it('slugifies deterministically with fallbacks and unique skill slugs', () => {
    expect(slugify('  Hello, World!! ')).toBe('hello-world');
    expect(agentSlug({ id: 'ABCDEF12-3456', name: '!!!' })).toBe('agent-abcdef12');
    expect(slugify('a'.repeat(100))).toHaveLength(64);
    const slugs = skillSlugs([
      { id: '1', name: 'Rules', body: 'a' },
      { id: '2', name: 'rules', body: 'b' },
      { id: '3', name: '???', body: 'c' },
    ]).map((s) => s.slug);
    expect(slugs).toEqual(['rules', 'rules-2', 'skill-3']);
  });
});

describe('ci workflow (AC-21 … AC-28)', () => {
  const base = { slug: 'security-reviewer-v2', postAs: 'github_review' as const, triggers: ['opened', 'synchronize'] as ('opened' | 'synchronize' | 'reopened')[] };
  const doc = (w = buildWorkflow(base)) => parse(w) as Record<string, any>;

  it('triggers on exactly the selected pull_request types and never pull_request_target', () => {
    const w = buildWorkflow({ ...base, triggers: ['reopened', 'opened'] });
    expect(doc(w).on).toEqual({ pull_request: { types: ['opened', 'reopened'] } });
    expect(w).not.toContain('pull_request_target');
  });

  it('runs the bundled runner with the full env contract and no devdigest action', () => {
    const w = buildWorkflow(base);
    const steps = doc(w).jobs.review.steps as Record<string, any>[];
    const run = steps.find((s) => s.run);
    expect(run!.run).toBe(RUN_COMMAND);
    expect(run!.run).toBe('node .devdigest/runner/index.js');
    expect(Object.keys(run!.env).sort()).toEqual(
      [
        'DEVDIGEST_AGENT',
        'DEVDIGEST_HEAD_SHA',
        'DEVDIGEST_POST_AS',
        'DEVDIGEST_PR_NUMBER',
        'DEVDIGEST_WORKFLOW_RUN_ID',
        'GITHUB_REPOSITORY',
        'GITHUB_TOKEN',
        'OPENROUTER_API_KEY',
      ].sort(),
    );
    expect(run!.env.OPENROUTER_API_KEY).toBe('${{ secrets.OPENROUTER_API_KEY }}');
    expect(run!.env.DEVDIGEST_AGENT).toBe('security-reviewer-v2');
    expect(run!.env.DEVDIGEST_POST_AS).toBe('github_review');
    expect(w).not.toMatch(/uses:\s*devdigest\//);
  });

  it('declares permissions per mode, skips forks, pins third-party actions, uploads always', () => {
    expect(doc(buildWorkflow(base)).permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(doc(buildWorkflow({ ...base, postAs: 'pr_comment' })).permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write',
    });
    expect(doc(buildWorkflow({ ...base, postAs: 'none' })).permissions).toEqual({ contents: 'read' });

    const job = doc().jobs.review;
    expect(job.if).toContain('head.repo.full_name == github.repository');
    const uses = (job.steps as { uses?: string }[]).flatMap((s) => (s.uses ? [s.uses] : []));
    expect(uses).toHaveLength(3);
    for (const u of uses) expect(u).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
    const upload = (job.steps as Record<string, any>[]).find((s) => String(s.uses).includes('upload-artifact'))!;
    expect(upload.if).toBe('always()');
    expect(upload.with.name).toBe('devdigest-result');
  });

  it('keeps run: bodies byte-identical for a hostile agent name (AC-25)', () => {
    const hostile = buildManifest({ ...GOLDEN_AGENT, name: 'x"; rm -rf / #\n$(id)' }, []);
    const plain = buildManifest({ ...GOLDEN_AGENT, name: 'x' }, []);
    const runsOf = (slug: string) =>
      (doc(buildWorkflow({ ...base, slug })).jobs.review.steps as { run?: string }[]).flatMap((s) =>
        s.run ? [s.run] : [],
      );
    expect(runsOf(hostile.slug)).toEqual(runsOf(plain.slug));
    expect(buildWorkflow({ ...base, slug: hostile.slug })).not.toContain('rm -rf');
  });

  it('is deterministic and rejects anything outside the closed sets', () => {
    expect(buildWorkflow(base)).toBe(buildWorkflow(base));
    expect(() => buildWorkflow({ ...base, slug: 'x"; rm -rf /' })).toThrow();
    expect(() => buildWorkflow({ ...base, triggers: [] })).toThrow();
    expect(() => buildWorkflow({ ...base, postAs: 'sh' as never })).toThrow();
  });
});

describe('ci bundle (AC-6, AC-7, runner bundle)', () => {
  const input = {
    slug: 'a',
    manifestYaml: 'm: 1\n',
    skills: [{ slug: 's1', body: 'body1' }],
    memoryJsonl: '',
    workflow: 'name: x\n',
  };

  it('copies every dist file flat under .devdigest/runner and lists runner contents as null in preview', async () => {
    const preview = await assembleBundle(input, { runnerContents: false, runnerDir: RUNNER_FIXTURE });
    expect(preview.map((f) => f.path)).toEqual([
      '.devdigest/agents/a.yaml',
      '.devdigest/skills/s1.md',
      '.devdigest/memory.jsonl',
      '.devdigest/runner/index.js',
      '.devdigest/runner/package.json',
      '.github/workflows/devdigest-review.yml',
    ]);
    expect(preview.filter((f) => f.editable).map((f) => f.path)).toEqual([
      '.github/workflows/devdigest-review.yml',
    ]);
    expect(preview.find((f) => f.path.endsWith('index.js'))!.contents).toBeNull();
    expect(preview.find((f) => f.path.endsWith('index.js'))!.size_bytes).toBeGreaterThan(0);
    const full = await assembleBundle(input, { runnerContents: true, runnerDir: RUNNER_FIXTURE });
    expect(full.find((f) => f.path.endsWith('package.json'))!.contents).toContain('"type":"module"');
    expect(full.find((f) => f.path.endsWith('memory.jsonl'))!.contents).toBe('');
  });

  it('fails with runner_bundle_missing when the dist dir is absent or has no index.js', async () => {
    await expect(listRunnerFiles(join(FIXTURES, 'does-not-exist'))).rejects.toMatchObject({ exportCode: 'runner_bundle_missing' });
    // exists, but has no index.js
    await expect(listRunnerFiles(FIXTURES)).rejects.toBeInstanceOf(CiExportError);
  });
});

describe('ci helpers (AC-50, AC-49)', () => {
  it('emits one {kind,content} line per row, or an empty string', () => {
    expect(memoryJsonl([])).toBe('');
    const out = memoryJsonl([
      { kind: 'fact', content: 'a\nb' },
      { kind: 'decision', content: 'c' },
    ]);
    const lines = out.trimEnd().split('\n');
    expect(lines.map((l) => Object.keys(JSON.parse(l)).sort())).toEqual([
      ['content', 'kind'],
      ['content', 'kind'],
    ]);
    expect(JSON.parse(lines[0]!)).toEqual({ kind: 'fact', content: 'a\nb' });
  });

  it('parses owner/name strictly', () => {
    expect(parseRepo('acme/widgets')).toEqual({ owner: 'acme', name: 'widgets' });
    for (const bad of ['acme', 'a/b/c', 'a b/c', '../x', '']) expect(parseRepo(bad)).toBeNull();
  });

  it('maps GitHub failures to typed export errors (AC-20)', () => {
    expect(mapGitHubError(new ConfigError('x')).code).toBe('no_token');
    expect(mapGitHubError({ status: 403, message: 'nope' }).code).toBe('forbidden');
    expect(
      mapGitHubError({ status: 403, message: 'refusing to allow a PAT to update workflow without `workflow` scope' }).code,
    ).toBe('missing_workflow_scope');
    expect(mapGitHubError({ status: 404, message: 'x' }).code).toBe('not_found');
    expect(mapGitHubError({ status: 500, message: 'x' }).code).toBe('upstream_unavailable');
  });
});

describe('verifyArtifact — one case per D6 check (AC-34, AC-36)', () => {
  const valid = readFileSync(join(FIXTURES, 'artifact.valid.json'), 'utf8');
  const expected = {
    repository: 'acme/widgets',
    headSha: '0123456789abcdef0123456789abcdef01234567',
  };
  const zipOf = (entries: Record<string, string | Uint8Array>) =>
    zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
  const check = (zip: Uint8Array, exp = expected) => {
    const r = verifyArtifact(zip, exp);
    return r.ok ? 'ok' : r.check;
  };

  it('the committed valid fixture parses with the shared schema and verifies', () => {
    expect(CiResultArtifact.safeParse(JSON.parse(valid)).success).toBe(true);
    const r = verifyArtifact(zipOf({ 'devdigest-result.json': valid }), expected);
    expect(r.ok).toBe(true);
  });

  it('accepts case differences in repository / sha', () => {
    expect(check(zipOf({ 'devdigest-result.json': valid }), { repository: 'ACME/Widgets', headSha: expected.headSha.toUpperCase() })).toBe('ok');
  });

  it('rejects: oversize entry, too many entries, oversize archive', () => {
    expect(check(zipOf({ 'devdigest-result.json': ' '.repeat(300 * 1024) + valid }))).toBe('oversize');
    const many: Record<string, string> = { 'devdigest-result.json': valid };
    for (let i = 0; i < 70; i++) many[`f${i}.txt`] = 'x';
    expect(check(zipOf(many))).toBe('oversize');
    const big = new Uint8Array(3 * 1024 * 1024);
    expect(verifyArtifact(big, expected)).toEqual({ ok: false, check: 'oversize' });
  });

  it('rejects: unsafe entry names (.. / absolute)', () => {
    expect(check(zipOf({ 'devdigest-result.json': valid, '../evil.txt': 'x' }))).toBe('unsafe_entry');
    expect(check(zipOf({ 'devdigest-result.json': valid, '/abs.txt': 'x' }))).toBe('unsafe_entry');
  });

  it('rejects: not a zip, missing result file, invalid JSON, invalid UTF-8', () => {
    expect(check(strToU8('definitely not a zip'))).toBe('malformed');
    expect(check(zipOf({ 'other.json': valid }))).toBe('malformed');
    expect(check(zipOf({ 'devdigest-result.json': '{nope' }))).toBe('malformed');
    expect(check(zipOf({ 'devdigest-result.json': new Uint8Array([0xff, 0xfe, 0xfd]) }))).toBe('malformed');
  });

  it('rejects: schema-invalid, wrong commit SHA, wrong repository', () => {
    const schemaBad = JSON.stringify({ ...JSON.parse(valid), findings_count: 'many' });
    expect(check(zipOf({ 'devdigest-result.json': schemaBad }))).toBe('schema');
    const shaBad = JSON.stringify({ ...JSON.parse(valid), commit_sha: 'f'.repeat(40) });
    expect(check(zipOf({ 'devdigest-result.json': shaBad }))).toBe('commit_sha');
    const repoBad = JSON.stringify({ ...JSON.parse(valid), repository: 'evil/widgets' });
    expect(check(zipOf({ 'devdigest-result.json': repoBad }))).toBe('repository');
  });

  it('rejects a credential-shaped value, raw or JSON-escaped, naming only the check', () => {
    const token = `ghp_${'a1B2'.repeat(9)}`;
    const raw = JSON.stringify({ ...JSON.parse(valid), agent: `leak ${token}` });
    const r = verifyArtifact(zipOf({ 'devdigest-result.json': raw }), expected);
    expect(r).toEqual({ ok: false, check: 'credential' });
    expect(JSON.stringify(r)).not.toContain(token);
    // `_` written as a JSON escape evades the raw scan but not the parsed-value scan.
    const escaped = raw.replace('ghp_', 'ghp\\u005f');
    expect(escaped).not.toContain('ghp_');
    expect(check(zipOf({ 'devdigest-result.json': escaped }))).toBe('credential');
    expect(findCredential(`sk-or-v1-${'a'.repeat(40)}`)).toBe('openrouter_key');
    expect(findCredential('plain text, model anthropic/claude-sonnet-4')).toBeNull();
  });
});
