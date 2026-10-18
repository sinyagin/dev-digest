import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveAgentSlug, resolvePrContext } from './context.js';
import { RunnerError } from './errors.js';

const SHA = 'B'.repeat(40);

describe('CI context resolution (DEVDIGEST_* env contract)', () => {
  let dir: string;
  let eventPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'devdigest-runner-ctx-'));
    eventPath = path.join(dir, 'event.json');
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: 7, title: 't', body: 'b', head: { sha: SHA } } }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('explicit env wins over the event payload', () => {
    const ctx = resolvePrContext({
      GITHUB_REPOSITORY: 'acme/widgets',
      GITHUB_EVENT_PATH: eventPath,
      DEVDIGEST_PR_NUMBER: '12',
      DEVDIGEST_HEAD_SHA: 'c'.repeat(40),
      DEVDIGEST_WORKFLOW_RUN_ID: '99',
    });
    expect(ctx).toMatchObject({ owner: 'acme', repo: 'widgets', prNumber: 12, headSha: 'c'.repeat(40), workflowRunId: 99 });
  });

  it('empty env vars fall back to the event payload / GITHUB_RUN_ID (SHA lower-cased)', () => {
    const ctx = resolvePrContext({
      GITHUB_REPOSITORY: 'acme/widgets',
      GITHUB_EVENT_PATH: eventPath,
      DEVDIGEST_PR_NUMBER: '',
      DEVDIGEST_HEAD_SHA: ' ',
      DEVDIGEST_WORKFLOW_RUN_ID: '',
      GITHUB_RUN_ID: '5',
    });
    expect(ctx).toMatchObject({ prNumber: 7, headSha: SHA.toLowerCase(), workflowRunId: 5, title: 't', body: 'b' });
  });

  it('rejects a malformed repository, head SHA or run id', () => {
    const base = { GITHUB_EVENT_PATH: eventPath, GITHUB_RUN_ID: '1' };
    expect(() => resolvePrContext({ ...base, GITHUB_REPOSITORY: 'acme' })).toThrow(RunnerError);
    expect(() =>
      resolvePrContext({ ...base, GITHUB_REPOSITORY: 'acme/w', DEVDIGEST_HEAD_SHA: 'not-a-sha' }),
    ).toThrow(/DEVDIGEST_HEAD_SHA/);
    expect(() =>
      resolvePrContext({ GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: 'acme/w', DEVDIGEST_WORKFLOW_RUN_ID: '-1' }),
    ).toThrow(/DEVDIGEST_WORKFLOW_RUN_ID/);
  });

  it('requires a valid agent slug', () => {
    expect(resolveAgentSlug({ DEVDIGEST_AGENT: 'security-reviewer' })).toBe('security-reviewer');
    expect(() => resolveAgentSlug({})).toThrow(/DEVDIGEST_AGENT/);
    expect(() => resolveAgentSlug({ DEVDIGEST_AGENT: '../etc' })).toThrow(/DEVDIGEST_AGENT/);
  });
});
