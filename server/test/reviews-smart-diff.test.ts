import { describe, it, expect } from 'vitest';
import { classifyFile, buildSmartDiff } from '../src/modules/reviews/smart-diff.js';
import { SPLIT_SUGGESTION_LINE_THRESHOLD } from '../src/modules/reviews/smart-diff-constants.js';

/**
 * Smart Diff classifier — order-sensitive by spec: the check order is
 * boilerplate → tests → wiring → docs → core (first match wins), which is
 * NOT the same as the group display order (core → tests → wiring → docs →
 * boilerplate) `buildSmartDiff` emits.
 */

describe('classifyFile — order-sensitive cases (pinned by the homework spec)', () => {
  it('a snapshot inside a __tests__ dir is boilerplate, not tests — boilerplate checked first', () => {
    expect(classifyFile('__tests__/__snapshots__/x.snap')).toBe('boilerplate');
  });

  it('.claude/** is wiring even for a markdown file — wiring checked before docs', () => {
    expect(classifyFile('.claude/skills/security/SKILL.md')).toBe('wiring');
  });

  it('e2e/README.md is tests, not docs — tests checked before docs in our chosen order', () => {
    expect(classifyFile('e2e/README.md')).toBe('tests');
  });
});

describe('classifyFile — wiring basename widening (deliberate deviation, pinned)', () => {
  it('classifies bare server.ts/config.ts/container.ts basenames as wiring, any directory depth', () => {
    expect(classifyFile('server/src/platform/config.ts')).toBe('wiring');
    expect(classifyFile('server/src/platform/container.ts')).toBe('wiring');
    expect(classifyFile('src/server.ts')).toBe('wiring');
  });

  it('does not widen past an exact basename match', () => {
    expect(classifyFile('src/services/config-service.ts')).toBe('core');
  });
});

describe('classifyFile — standard per-role coverage', () => {
  it('classifies lock files as boilerplate', () => {
    expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyFile('package-lock.json')).toBe('boilerplate');
    expect(classifyFile('yarn.lock')).toBe('boilerplate');
    expect(classifyFile('Cargo.lock')).toBe('boilerplate');
  });

  it('boilerplate beats the index.* wiring basename pattern via check order', () => {
    expect(classifyFile('dist/index.js')).toBe('boilerplate');
  });

  it('classifies test files and test directories as tests', () => {
    expect(classifyFile('server/test/pulls-status.test.ts')).toBe('tests');
    expect(classifyFile('src/components/Button.spec.ts')).toBe('tests');
  });

  it('classifies config/barrel/CI files as wiring', () => {
    expect(classifyFile('vite.config.ts')).toBe('wiring');
    expect(classifyFile('.github/workflows/ci.yml')).toBe('wiring');
    expect(classifyFile('tsconfig.json')).toBe('wiring');
    expect(classifyFile('src/index.ts')).toBe('wiring');
  });

  it('classifies markdown and docs directories as docs', () => {
    expect(classifyFile('README.md')).toBe('docs');
    expect(classifyFile('docs/architecture.md')).toBe('docs');
  });

  it('falls back to core for everything else', () => {
    expect(classifyFile('src/handlers/payment.ts')).toBe('core');
  });
});

describe('buildSmartDiff', () => {
  it('emits groups in display order (core, tests, wiring, docs, boilerplate), omitting empty roles', () => {
    const result = buildSmartDiff(
      [
        { path: 'README.md', additions: 1, deletions: 0 },
        { path: 'pnpm-lock.yaml', additions: 1, deletions: 0 },
        { path: 'src/a.test.ts', additions: 1, deletions: 0 },
        { path: 'src/index.ts', additions: 1, deletions: 0 },
        { path: 'src/a.ts', additions: 1, deletions: 0 },
      ],
      [],
    );
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
  });

  it('omits a role with zero files entirely rather than emitting an empty group', () => {
    const result = buildSmartDiff(
      [
        { path: 'src/foo.ts', additions: 5, deletions: 1 },
        { path: 'pnpm-lock.yaml', additions: 20, deletions: 0 },
      ],
      [],
    );
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
  });

  it('expands, dedupes, and sorts finding_lines per file; ignores findings for files not in the PR', () => {
    const result = buildSmartDiff(
      [
        { path: 'src/foo.ts', additions: 5, deletions: 1 },
        { path: 'src/bar.ts', additions: 2, deletions: 0 },
      ],
      [
        { file: 'src/foo.ts', startLine: 10, endLine: 12 },
        { file: 'src/foo.ts', startLine: 11, endLine: 11 },
        { file: 'src/foo.ts', startLine: 20, endLine: 20 },
        { file: 'src/missing.ts', startLine: 1, endLine: 1 },
      ],
    );
    const foo = result.groups[0]!.files.find((f) => f.path === 'src/foo.ts')!;
    const bar = result.groups[0]!.files.find((f) => f.path === 'src/bar.ts')!;
    expect(foo.finding_lines).toEqual([10, 11, 12, 20]);
    expect(bar.finding_lines).toEqual([]);
    expect(result.groups[0]!.files.some((f) => f.path === 'src/missing.ts')).toBe(false);
  });

  it('never sets pseudocode_summary (no LLM call)', () => {
    const result = buildSmartDiff([{ path: 'src/foo.ts', additions: 1, deletions: 0 }], []);
    expect(result.groups[0]!.files[0]!.pseudocode_summary).toBeNull();
  });

  it('flips too_big strictly above the threshold', () => {
    const at = buildSmartDiff(
      [{ path: 'src/foo.ts', additions: SPLIT_SUGGESTION_LINE_THRESHOLD, deletions: 0 }],
      [],
    );
    expect(at.split_suggestion.too_big).toBe(false);
    expect(at.split_suggestion.total_lines).toBe(SPLIT_SUGGESTION_LINE_THRESHOLD);

    const over = buildSmartDiff(
      [{ path: 'src/foo.ts', additions: SPLIT_SUGGESTION_LINE_THRESHOLD + 1, deletions: 0 }],
      [],
    );
    expect(over.split_suggestion.too_big).toBe(true);
  });

  it('groups proposed_splits by top-level directory of core files only, excluding wiring/boilerplate', () => {
    const result = buildSmartDiff(
      [
        { path: 'src/api/foo.ts', additions: SPLIT_SUGGESTION_LINE_THRESHOLD, deletions: 0 },
        { path: 'src/api/bar.ts', additions: 1, deletions: 0 },
        { path: 'lib/baz.ts', additions: 1, deletions: 0 },
        { path: 'root.ts', additions: 1, deletions: 0 },
        { path: 'src/index.ts', additions: 1, deletions: 0 }, // wiring — excluded
        { path: 'pnpm-lock.yaml', additions: 1, deletions: 0 }, // boilerplate — excluded
      ],
      [],
    );
    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.proposed_splits).toEqual([
      { name: 'src', files: ['src/api/foo.ts', 'src/api/bar.ts'] },
      { name: 'lib', files: ['lib/baz.ts'] },
      { name: '(root)', files: ['root.ts'] },
    ]);
  });
});
