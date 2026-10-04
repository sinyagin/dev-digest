import { describe, it, expect } from 'vitest';
import { mapBlastResult } from '../src/modules/blast/mapper.js';
import { BlastService } from '../src/modules/blast/service.js';
import { BlastRadiusResponse } from '../src/vendor/shared/contracts/brief.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

/**
 * Hermetic blast tests — no Postgres, no clone, no LLM (this feature does no
 * model call: `summary` is a plain string built from counts).
 */

describe('mapBlastResult', () => {
  it('groups callers by viaSymbol and dedups endpoints/crons across shared files', () => {
    const blast: BlastResult = {
      changedSymbols: [
        { file: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function' },
        { file: 'src/middleware/ratelimit.ts', name: 'bucketKey', kind: 'function' },
      ],
      callers: [
        {
          file: 'src/api/public/webhooks.ts',
          symbol: 'handleWebhook',
          viaSymbol: 'rateLimit',
          line: 42,
          rank: 1,
        },
        {
          file: 'src/api/public/index.ts',
          symbol: 'publicRouter',
          viaSymbol: 'rateLimit',
          line: 23,
          rank: 2,
        },
        {
          file: 'src/api/public/webhooks.ts',
          symbol: 'handleWebhook',
          viaSymbol: 'bucketKey',
          line: 50,
          rank: 1,
        },
      ],
      impactedEndpoints: ['POST /webhooks', 'GET /items'],
      factsByFile: {
        'src/api/public/webhooks.ts': { endpoints: ['POST /webhooks'], crons: ['reset-rate-buckets'] },
        'src/api/public/index.ts': { endpoints: ['POST /webhooks', 'GET /items'], crons: [] },
      },
    };

    const result = mapBlastResult(blast);

    expect(result.changed_symbols).toEqual([
      { name: 'rateLimit', file: 'src/middleware/ratelimit.ts', kind: 'function' },
      { name: 'bucketKey', file: 'src/middleware/ratelimit.ts', kind: 'function' },
    ]);

    const rateLimit = result.downstream.find((d) => d.symbol === 'rateLimit')!;
    expect(rateLimit.callers).toEqual([
      { name: 'handleWebhook', file: 'src/api/public/webhooks.ts', line: 42 },
      { name: 'publicRouter', file: 'src/api/public/index.ts', line: 23 },
    ]);
    // Endpoint shared by both caller files is deduped, not duplicated.
    expect(rateLimit.endpoints_affected.sort()).toEqual(['GET /items', 'POST /webhooks']);
    expect(rateLimit.crons_affected).toEqual(['reset-rate-buckets']);

    const bucketKey = result.downstream.find((d) => d.symbol === 'bucketKey')!;
    expect(bucketKey.callers).toEqual([{ name: 'handleWebhook', file: 'src/api/public/webhooks.ts', line: 50 }]);

    expect(() => BlastRadiusResponse.parse(result)).not.toThrow();
  });

  it('dedupes downstream by symbol name when two declarations share a name (regression)', () => {
    // Mirrors a real repository-pattern refactor: an old class method and a
    // new free function both named `getPull`, in different files. viaSymbol
    // has no file qualifier, so the facade can't tell them apart — the
    // mapper must still produce exactly one downstream entry, not two
    // duplicate-keyed ones.
    const blast: BlastResult = {
      changedSymbols: [
        { file: 'server/src/modules/reviews/repository.ts', name: 'getPull', kind: 'method' },
        { file: 'server/src/modules/reviews/repository/pull.repo.ts', name: 'getPull', kind: 'function' },
      ],
      callers: [
        { file: 'server/src/modules/reviews/service.ts', symbol: 'runReview', viaSymbol: 'getPull', line: 109, rank: 1 },
      ],
      impactedEndpoints: [],
    };

    const result = mapBlastResult(blast);

    // Both declarations are still listed as changed.
    expect(result.changed_symbols).toHaveLength(2);
    // But only one downstream group — no duplicate `symbol` keys.
    expect(result.downstream).toHaveLength(1);
    expect(result.downstream[0]).toEqual({
      symbol: 'getPull',
      callers: [{ name: 'runReview', file: 'server/src/modules/reviews/service.ts', line: 109 }],
      endpoints_affected: [],
      crons_affected: [],
    });
    // Caller count in the summary reflects the deduped total (1), not 2x.
    expect(result.summary).toBe('2 changed symbols, 1 caller, no endpoints or crons affected.');
  });

  it('produces a downstream entry with empty callers for a symbol nobody calls', () => {
    const blast: BlastResult = {
      changedSymbols: [{ file: 'src/lonely.ts', name: 'unused', kind: 'function' }],
      callers: [],
      impactedEndpoints: [],
    };

    const result = mapBlastResult(blast);

    expect(result.downstream).toEqual([
      { symbol: 'unused', callers: [], endpoints_affected: [], crons_affected: [] },
    ]);
    expect(result.summary).toBe('1 changed symbol, 0 callers, no endpoints or crons affected.');
  });

  it('builds a plural-aware summary string with no model call', () => {
    const multi = mapBlastResult({
      changedSymbols: [
        { file: 'a.ts', name: 'a', kind: 'function' },
        { file: 'b.ts', name: 'b', kind: 'function' },
      ],
      callers: [
        { file: 'c.ts', symbol: 'callerA', viaSymbol: 'a', line: 1, rank: 1 },
        { file: 'd.ts', symbol: 'callerB', viaSymbol: 'b', line: 2, rank: 1 },
      ],
      impactedEndpoints: [],
      factsByFile: {
        'c.ts': { endpoints: ['GET /a'], crons: [] },
        'd.ts': { endpoints: [], crons: ['nightly'] },
      },
    });
    expect(multi.summary).toBe('2 changed symbols, 2 callers across 1 endpoint and 1 cron affected.');

    const noDownstream = mapBlastResult({
      changedSymbols: [{ file: 'a.ts', name: 'a', kind: 'function' }],
      callers: [],
      impactedEndpoints: [],
    });
    expect(noDownstream.summary).toBe('1 changed symbol, 0 callers, no endpoints or crons affected.');

    expect(mapBlastResult({ changedSymbols: [], callers: [], impactedEndpoints: [] }).summary).toBe(
      'No changed symbols detected.',
    );
  });
});

/** Build a BlastService with its repository + container deps faked. */
function buildService(opts: {
  changedFiles: string[];
  blast?: BlastResult;
  prMissing?: boolean;
}): BlastService {
  const container = {
    repoIntel: {
      getBlastRadius: async () =>
        opts.blast ?? {
          changedSymbols: [],
          callers: [],
          impactedEndpoints: [],
        },
    },
  } as never;

  const svc = new BlastService(container);

  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    resolvePrAndRepo: async () =>
      opts.prMissing
        ? { pr: null, repo: null }
        : { pr: { id: 'pr1', repoId: 'repo1' }, repo: { id: 'repo1' } },
    getChangedFilePaths: async () => opts.changedFiles,
    findPriorPrsTouchingSameFiles: async () => [],
  };

  return svc;
}

describe('BlastService.getForPr', () => {
  it('maps internal blast result to the HTTP contract', async () => {
    const svc = buildService({
      changedFiles: ['src/middleware/ratelimit.ts'],
      blast: {
        changedSymbols: [{ file: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function' }],
        callers: [
          { file: 'src/api/public/webhooks.ts', symbol: 'handleWebhook', viaSymbol: 'rateLimit', line: 42, rank: 1 },
        ],
        impactedEndpoints: ['POST /webhooks'],
        factsByFile: { 'src/api/public/webhooks.ts': { endpoints: ['POST /webhooks'], crons: [] } },
      },
    });

    const result = await svc.getForPr('pr1', 'ws1');

    expect(() => BlastRadiusResponse.parse(result)).not.toThrow();
    expect(result.changed_symbols).toHaveLength(1);
    expect(result.downstream[0].callers).toEqual([
      { name: 'handleWebhook', file: 'src/api/public/webhooks.ts', line: 42 },
    ]);
    expect(result.priorPrs).toEqual([]);
    expect(result.degraded).toBeUndefined();
  });

  it('returns a degraded no_data result when the PR has no changed files', async () => {
    const svc = buildService({ changedFiles: [] });
    const result = await svc.getForPr('pr1', 'ws1');

    expect(() => BlastRadiusResponse.parse(result)).not.toThrow();
    expect(result).toMatchObject({
      changed_symbols: [],
      downstream: [],
      degraded: true,
      reason: 'no_data',
    });
  });

  it('throws NotFoundError when the PR does not exist', async () => {
    const svc = buildService({ changedFiles: [], prMissing: true });
    await expect(svc.getForPr('missing', 'ws1')).rejects.toBeInstanceOf(NotFoundError);
  });
});
