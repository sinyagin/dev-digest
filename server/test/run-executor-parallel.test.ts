import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hermetic: the engine, diff loader and intent service are mocked (SPEC-04 AC-19..21).
const reviewPullRequest = vi.fn();
vi.mock('@devdigest/reviewer-core', () => ({
  reviewPullRequest: (...a: unknown[]) => reviewPullRequest(...a),
  countBlockers: () => 0,
}));
const loadDiff = vi.fn();
vi.mock('../src/modules/reviews/diff-loader.js', () => ({
  loadDiff: (...a: unknown[]) => loadDiff(...a),
}));
const computeForRun = vi.fn();
vi.mock('../src/modules/intent/service.js', () => ({
  IntentService: class {
    computeForRun = (...a: unknown[]) => computeForRun(...a);
  },
}));

import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { RunBus } from '../src/platform/sse.js';

const DELAY = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function outcome() {
  return {
    review: { verdict: 'approve', summary: 's', score: 100, findings: [] },
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0.01,
    grounding: '0/0 passed',
    assembly: {},
    chunks: [],
    mode: 'single',
    raw: {},
  };
}

function setup() {
  const completeAgentRun = vi.fn().mockResolvedValue(undefined);
  const repo = {
    getIntent: vi.fn().mockResolvedValue(undefined),
    insertReview: vi.fn().mockResolvedValue({ id: 'rev' }),
    insertFindings: vi.fn().mockResolvedValue([]),
    markReviewed: vi.fn().mockResolvedValue(undefined),
    completeAgentRun,
    saveRunTrace: vi.fn().mockResolvedValue(undefined),
  };
  const agents = {
    linkedSkills: vi.fn().mockResolvedValue([]),
    contextDocumentsFor: vi.fn().mockResolvedValue([]),
  };
  const container = {
    runBus: new RunBus(),
    llm: vi.fn().mockResolvedValue({}),
    git: { clonePathFor: () => '/nonexistent' },
    repoIntel: { getCallerSignatures: vi.fn().mockResolvedValue([]) },
  };
  const executor = new ReviewRunExecutor(container as never, repo as never, agents as never);
  const jobs = ['a', 'b', 'c'].map((n) => ({
    agent: { id: n, name: n, provider: 'openai', model: 'm', systemPrompt: 'p', repoIntel: false, version: 1, ciFailOn: 'CRITICAL', strategy: null },
    runId: `run-${n}`,
  }));
  const pull = { id: 'pr', number: 1, headSha: 'sha', body: null, repoId: 'repo' };
  const repoRow = { owner: 'o', name: 'n' };
  return { executor, jobs, pull, repoRow, completeAgentRun };
}

describe('ReviewRunExecutor parallel fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadDiff.mockResolvedValue({ files: [] });
    computeForRun.mockResolvedValue({ intent: 'i', in_scope: [], out_of_scope: [] });
  });

  it('AC-19: three agents with a 300 ms delay finish in under 600 ms', async () => {
    reviewPullRequest.mockImplementation(async () => {
      await sleep(DELAY);
      return outcome();
    });
    const { executor, jobs, pull, repoRow } = setup();
    const t0 = Date.now();
    await executor.executeRuns('ws', pull as never, repoRow as never, jobs as never);
    expect(Date.now() - t0).toBeLessThan(2 * DELAY);
    expect(reviewPullRequest).toHaveBeenCalledTimes(3);
  });

  it('AC-20: one stub throws, the other two still complete as done', async () => {
    reviewPullRequest.mockImplementation(async (args: { sessionId: string }) => {
      if (args.sessionId.endsWith(':b')) throw new Error('boom');
      return outcome();
    });
    const { executor, jobs, pull, repoRow, completeAgentRun } = setup();
    await expect(
      executor.executeRuns('ws', pull as never, repoRow as never, jobs as never),
    ).resolves.toBeUndefined();
    const statusByRun = Object.fromEntries(
      completeAgentRun.mock.calls.map(([runId, v]) => [runId, v.status]),
    );
    expect(statusByRun).toEqual({ 'run-a': 'done', 'run-b': 'failed', 'run-c': 'done' });
  });

  it('AC-21: diff and intent are computed exactly once for three agents', async () => {
    reviewPullRequest.mockResolvedValue(outcome());
    const { executor, jobs, pull, repoRow } = setup();
    await executor.executeRuns('ws', pull as never, repoRow as never, jobs as never);
    expect(loadDiff).toHaveBeenCalledTimes(1);
    expect(computeForRun).toHaveBeenCalledTimes(1);
  });
});
