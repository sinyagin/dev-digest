import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LLMProvider, StructuredResult } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import { loadManifest } from './manifest.js';
import { loadSkillBodies } from './skills.js';
import { CREDENTIAL_PATTERNS } from './credentials.js';
import { runCi } from './run.js';

/**
 * Studio ↔ runner parity: the server's export fixtures (what `CiService`
 * writes / what ingestion accepts) must load and parse through the runner's
 * own code, and the runner's credential scrub must match the server's
 * verifier list — so neither side can drift without a red test.
 */

const SERVER = path.resolve(__dirname, '../../server');
const FIX = path.join(SERVER, 'test/fixtures/ci');

const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;

const emptyReviewLlm: LLMProvider = {
  id: 'openrouter',
  async listModels() {
    return [];
  },
  async complete() {
    throw new Error('not used');
  },
  async completeStructured<T>(): Promise<StructuredResult<T>> {
    const data = { verdict: 'approve', summary: 'ok', score: 100, findings: [] };
    return { data: data as unknown as T, model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0, raw: '{}', attempts: 1 };
  },
  async embed() {
    return [];
  },
};

describe('server parity', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'devdigest-runner-parity-'));
    mkdirSync(path.join(dir, 'agents'), { recursive: true });
    mkdirSync(path.join(dir, 'skills'), { recursive: true });
    writeFileSync(
      path.join(dir, 'agents', 'security-reviewer-v2.yaml'),
      readFileSync(path.join(FIX, 'manifest.golden.yaml'), 'utf8'),
    );
    for (const s of ['security-rules', 'style-guide']) writeFileSync(path.join(dir, 'skills', `${s}.md`), 'x');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('the golden exported manifest loads through the runner loader', () => {
    const { manifest } = loadManifest(dir, 'security-reviewer-v2');
    expect(manifest.slug).toBe('security-reviewer-v2');
    expect(manifest.system_prompt).toContain('${{ secrets.X }}');
    expect(loadSkillBodies(dir, manifest.skills)).toHaveLength(2);
  });

  it('the valid artifact fixture and a runner-produced artifact both parse', async () => {
    expect(
      CiResultArtifact.safeParse(JSON.parse(readFileSync(path.join(FIX, 'artifact.valid.json'), 'utf8'))).success,
    ).toBe(true);

    const resultPath = path.join(dir, 'devdigest-result.json');
    const result = await runCi({
      devdigestDir: dir,
      env: {
        GITHUB_REPOSITORY: 'acme/widgets',
        GITHUB_TOKEN: 'ghp_parity',
        OPENROUTER_API_KEY: 'sk-or-parity-0123456789abcdef',
        DEVDIGEST_AGENT: 'security-reviewer-v2',
        DEVDIGEST_PR_NUMBER: '3',
        DEVDIGEST_HEAD_SHA: 'f'.repeat(40),
        DEVDIGEST_WORKFLOW_RUN_ID: '11',
      },
      llm: emptyReviewLlm,
      postAs: 'none',
      resultPath,
      fetchDiff: async () => DIFF,
      log: () => undefined,
    });

    expect(result.error).toBeUndefined();
    expect(CiResultArtifact.safeParse(JSON.parse(readFileSync(resultPath, 'utf8'))).success).toBe(true);
  });

  it('local credential patterns equal the server verifier list', () => {
    const src = readFileSync(path.join(SERVER, 'src/modules/ci/verify-artifact.ts'), 'utf8');
    const block = src.slice(src.indexOf('CREDENTIAL_PATTERNS'), src.indexOf('export function findCredential'));
    const server = [...block.matchAll(/\{ name: '([a-z_]+)', re: (\/.*\/) \}/g)].map((m) => `${m[1]} ${m[2]}`);
    const local = CREDENTIAL_PATTERNS.map((p) => `${p.name} ${p.re.toString()}`);
    expect(server.length).toBeGreaterThan(5);
    expect(local).toEqual(server);
  });
});
