import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { buildChangedLineIndex, groundBrief } from '../src/modules/brief/grounding.js';
import type { BriefDraft } from '../src/modules/brief/llm-schema.js';

/**
 * Hermetic unit tests for `grounding.ts` — pure grounding gate, no Postgres,
 * no LLM, no clone, no network. Every input is a plain fixture.
 */

function draft(overrides: Partial<BriefDraft> = {}): BriefDraft {
  return {
    summary: 'A brief summary.',
    risks: { risks: [] },
    review_focus: [],
    ...overrides,
  };
}

describe('groundBrief — risks', () => {
  it('drops a risk entirely when its only file_ref is not in allowedFiles', () => {
    const result = groundBrief(
      draft({
        risks: {
          risks: [
            {
              kind: 'correctness',
              title: 'Unvalidated input',
              explanation: 'explanation',
              severity: 'high',
              file_refs: ['src/fake/not-real.ts'],
            },
          ],
        },
      }),
      { allowedFiles: new Set(['src/real.ts']), changedLines: new Map() },
    );

    expect(result.risks).toHaveLength(0);
    expect(result.dropped).toContainEqual({
      kind: 'file_ref',
      detail: "risk 'Unvalidated input': file_ref 'src/fake/not-real.ts' is not an allowed file",
    });
    expect(result.dropped).toContainEqual({
      kind: 'risk',
      detail: "risk 'Unvalidated input' dropped: no file_refs survived grounding",
    });
  });

  it('keeps a risk with a mix of valid and invalid file_refs, retaining only the valid ones', () => {
    const result = groundBrief(
      draft({
        risks: {
          risks: [
            {
              kind: 'correctness',
              title: 'Mixed refs',
              explanation: 'explanation',
              severity: 'medium',
              file_refs: ['src/real.ts', 'src/fake/not-real.ts'],
            },
          ],
        },
      }),
      { allowedFiles: new Set(['src/real.ts']), changedLines: new Map() },
    );

    expect(result.risks).toHaveLength(1);
    expect(result.risks[0]!.file_refs).toEqual(['src/real.ts']);
    expect(result.dropped).toContainEqual({
      kind: 'file_ref',
      detail: "risk 'Mixed refs': file_ref 'src/fake/not-real.ts' is not an allowed file",
    });
  });
});

describe('groundBrief — review_focus', () => {
  it('drops a review_focus item entirely when its file is not in allowedFiles', () => {
    const result = groundBrief(
      draft({ review_focus: [{ file: 'src/fake/not-real.ts', line: 10, reason: 'check this' }] }),
      { allowedFiles: new Set(['src/real.ts']), changedLines: new Map() },
    );

    expect(result.review_focus).toHaveLength(0);
    expect(result.dropped).toContainEqual({
      kind: 'focus',
      detail: "review_focus item for 'src/fake/not-real.ts' dropped: file is not an allowed file",
    });
  });

  it('nulls out a line outside the file\'s changed-line ranges but keeps file/reason', () => {
    const changedLines = new Map<string, Set<number>>([['src/real.ts', new Set([10, 11, 12])]]);
    const result = groundBrief(
      draft({ review_focus: [{ file: 'src/real.ts', line: 999, reason: 'check this' }] }),
      { allowedFiles: new Set(['src/real.ts']), changedLines },
    );

    expect(result.review_focus).toEqual([{ file: 'src/real.ts', line: null, reason: 'check this' }]);
    expect(result.dropped).toContainEqual({
      kind: 'line',
      detail:
        "review_focus item for 'src/real.ts': line 999 is outside the file's changed-line ranges in this PR's diff",
    });
  });

  it('always nulls the line for a blast-only file (allowed but with no changedLines entry at all) — correct, not a bug', () => {
    // A blast-only file is in allowedFiles because Blast Radius cited it as a
    // changed-symbol/caller file, NOT because it's part of this PR's diff —
    // so it has no entry in `changedLines` at all. Any focus line on it must
    // always come back null, per AC-18. This is intentional, don't "fix" it.
    const result = groundBrief(
      draft({ review_focus: [{ file: 'src/blast-only.ts', line: 5, reason: 'downstream caller' }] }),
      { allowedFiles: new Set(['src/blast-only.ts']), changedLines: new Map() },
    );

    expect(result.review_focus).toEqual([{ file: 'src/blast-only.ts', line: null, reason: 'downstream caller' }]);
    expect(result.dropped).toContainEqual({
      kind: 'line',
      detail:
        "review_focus item for 'src/blast-only.ts': line 5 is outside the file's changed-line ranges in this PR's diff",
    });
  });

  it('keeps a review_focus item with line: null unchanged (nothing to ground)', () => {
    const result = groundBrief(
      draft({ review_focus: [{ file: 'src/real.ts', line: null, reason: 'general area' }] }),
      { allowedFiles: new Set(['src/real.ts']), changedLines: new Map() },
    );

    expect(result.review_focus).toEqual([{ file: 'src/real.ts', line: null, reason: 'general area' }]);
    expect(result.dropped).toHaveLength(0);
  });
});

describe('groundBrief — order preservation', () => {
  it('preserves input order for both risks and review_focus, minus drops', () => {
    const allowedFiles = new Set(['a.ts', 'b.ts', 'c.ts']);
    const result = groundBrief(
      draft({
        risks: {
          risks: [
            { kind: 'k', title: 'first', explanation: 'e', severity: 'low', file_refs: ['a.ts'] },
            { kind: 'k', title: 'dropped', explanation: 'e', severity: 'low', file_refs: ['not-real.ts'] },
            { kind: 'k', title: 'third', explanation: 'e', severity: 'low', file_refs: ['c.ts'] },
          ],
        },
        review_focus: [
          { file: 'a.ts', line: null, reason: 'first' },
          { file: 'not-real.ts', line: null, reason: 'dropped' },
          { file: 'c.ts', line: null, reason: 'third' },
        ],
      }),
      { allowedFiles, changedLines: new Map() },
    );

    expect(result.risks.map((r) => r.title)).toEqual(['first', 'third']);
    expect(result.review_focus.map((f) => f.reason)).toEqual(['first', 'third']);
  });
});

describe('buildChangedLineIndex', () => {
  it('indexes exactly the newLineNumbers when a hunk provides them', () => {
    const diff: UnifiedDiff = {
      raw: '',
      files: [
        {
          path: 'src/a.ts',
          additions: 3,
          deletions: 0,
          hunks: [
            {
              file: 'src/a.ts',
              oldStart: 10,
              oldLines: 0,
              newStart: 10,
              newLines: 3,
              newLineNumbers: [10, 11, 12],
            },
          ],
        },
      ],
    };

    const idx = buildChangedLineIndex(diff);
    expect(idx.get('src/a.ts')).toEqual(new Set([10, 11, 12]));
  });

  it('falls back to a newStart/newLines-derived range when a pure-deletion hunk has empty newLineNumbers', () => {
    const diff: UnifiedDiff = {
      raw: '',
      files: [
        {
          path: 'src/b.ts',
          additions: 0,
          deletions: 5,
          hunks: [
            {
              file: 'src/b.ts',
              oldStart: 20,
              oldLines: 5,
              newStart: 20,
              newLines: 3,
              newLineNumbers: [],
            },
          ],
        },
      ],
    };

    const idx = buildChangedLineIndex(diff);
    // newStart=20, newLines=3 -> range [20, 21, 22]
    expect(idx.get('src/b.ts')).toEqual(new Set([20, 21, 22]));
  });

  it('falls back to a single-line range when newLines is 0 (Math.max(newLines, 1) floor)', () => {
    const diff: UnifiedDiff = {
      raw: '',
      files: [
        {
          path: 'src/c.ts',
          additions: 0,
          deletions: 2,
          hunks: [
            { file: 'src/c.ts', oldStart: 5, oldLines: 2, newStart: 5, newLines: 0, newLineNumbers: [] },
          ],
        },
      ],
    };

    const idx = buildChangedLineIndex(diff);
    expect(idx.get('src/c.ts')).toEqual(new Set([5]));
  });
});
