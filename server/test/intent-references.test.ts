import { describe, it, expect } from 'vitest';
import { parseReferences, resolveReferences } from '../src/modules/intent/references.js';
import type { GitClient, GitHubClient, WebFetchClient, RepoRef } from '@devdigest/shared';

/**
 * Unit coverage for `resolveReferences` — the resolver used to be a bare
 * try/catch that dropped any failed fetch silently (a 404'd link, a missing
 * GitHub token) with zero trace. It must now report every unresolved
 * reference with a reason, never just drop it.
 */

const repoRef: RepoRef = { owner: 'acme', name: 'widgets' };

function makeGit(overrides: Partial<GitClient> = {}): GitClient {
  return {
    clone: async () => ({ path: '/tmp' }),
    fetchPullHead: async () => {},
    sync: async () => ({ head: 'sha' }),
    currentHead: async () => 'sha',
    diff: async () => ({ raw: '', files: [] }),
    diffNameOnly: async () => [],
    blame: async () => [],
    log: async () => [],
    readFile: async () => '',
    clonePathFor: () => '/tmp',
    ...overrides,
  };
}

function makeGitHub(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    listPullRequests: async () => [],
    getPullRequest: async () => {
      throw new Error('not implemented');
    },
    postReview: async () => ({ id: '1' }),
    listReviewComments: async () => [],
    createReviewComment: async () => ({}) as never,
    openPullRequest: async () => ({ url: '' }),
    commitFiles: async () => ({ branch: '' }),
    findOpenPr: async () => null,
    getIssue: async () => {
      throw new Error('not implemented');
    },
    currentLogin: async () => 'bot',
    ...overrides,
  };
}

describe('resolveReferences', () => {
  it('resolves a repo-file reference successfully (happy path unaffected)', async () => {
    const [ref] = parseReferences('See [plan](docs/plan.md) for details.', repoRef);
    const git = makeGit({ readFile: async () => 'plan content' });

    const { resolved, unresolved } = await resolveReferences([ref!], {
      repoRef,
      git,
      github: null,
      webFetch: null,
    });

    expect(resolved).toEqual([{ kind: 'repo-file', source: 'docs/plan.md', content: 'plan content' }]);
    expect(unresolved).toEqual([]);
  });

  it('records a failed external URL fetch as unresolved with the thrown reason', async () => {
    const [ref] = parseReferences('Spec: https://example.com/spec.md', repoRef);
    const webFetch: WebFetchClient = {
      fetch: async () => {
        throw new Error('URL returned HTTP 404');
      },
    };

    const { resolved, unresolved } = await resolveReferences([ref!], {
      repoRef,
      git: makeGit(),
      github: null,
      webFetch,
    });

    expect(resolved).toEqual([]);
    expect(unresolved).toEqual([
      { kind: 'url', source: 'https://example.com/spec.md', reason: 'URL returned HTTP 404' },
    ]);
  });

  it('records a failed GitHub issue reference — mentions both the issue and PR fallback failures', async () => {
    const [ref] = parseReferences('Closes #42', repoRef);
    const github = makeGitHub({
      getIssue: async () => {
        throw new Error('Not Found');
      },
      getPullRequest: async () => {
        throw new Error('Not Found');
      },
    });

    const { resolved, unresolved } = await resolveReferences([ref!], {
      repoRef,
      git: makeGit(),
      github,
      webFetch: null,
    });

    expect(resolved).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]!.kind).toBe('github');
    expect(unresolved[0]!.source).toBe('https://github.com/acme/widgets/issues/42');
    expect(unresolved[0]!.reason).toMatch(/issue fetch failed/);
    expect(unresolved[0]!.reason).toMatch(/PR fetch also failed/);
  });

  it('records a disabled external-fetch / missing-credentials skip as unresolved, not a silent drop', async () => {
    const [urlRef] = parseReferences('See https://example.com/spec.md', repoRef);
    const [ghRef] = parseReferences('Closes #7', repoRef);

    const { unresolved } = await resolveReferences([urlRef!, ghRef!], {
      repoRef,
      git: makeGit(),
      github: null,
      webFetch: null,
    });

    expect(unresolved).toEqual([
      { kind: 'url', source: 'https://example.com/spec.md', reason: 'external fetch disabled' },
      {
        kind: 'github',
        source: 'https://github.com/acme/widgets/issues/7',
        reason: 'no GitHub credentials configured',
      },
    ]);
  });

  it('records refs skipped once the content budget is exceeded, instead of dropping them', async () => {
    const refs = parseReferences(
      'See [a](docs/a.md) and [b](docs/plans/b.md) and [c](specs/c.md).',
      repoRef,
    );
    expect(refs).toHaveLength(3);

    const git = makeGit({ readFile: async () => 'x'.repeat(10) });

    const { resolved, unresolved } = await resolveReferences(refs, {
      repoRef,
      git,
      github: null,
      webFetch: null,
      budgetBytes: 15, // fits ref 1 fully, truncates ref 2, ref 3 must be reported as skipped
    });

    expect(resolved).toHaveLength(2);
    expect(unresolved).toEqual([
      { kind: 'repo-file', source: 'specs/c.md', reason: 'skipped: content budget exceeded' },
    ]);
  });
});
