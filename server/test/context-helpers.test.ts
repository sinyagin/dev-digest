/**
 * T4 — pure-logic unit tests for the Project Context module's constants and
 * helpers (SPEC-01-project-context). No I/O, no clone, no DB.
 */
import { describe, it, expect } from 'vitest';
import { bucketFor, estimateTokens, toPosixRelative } from '../src/modules/context/helpers.js';
import { ROOT_BUCKET } from '../src/modules/context/constants.js';

describe('bucketFor', () => {
  it('returns the top-level directory name for nested documents (AC-4)', () => {
    expect(bucketFor('specs/public-api.md')).toBe('specs');
    expect(bucketFor('docs/b.md')).toBe('docs');
  });

  it('returns ROOT_BUCKET for a document at the repository root (AC-4)', () => {
    expect(bucketFor('README.md')).toBe(ROOT_BUCKET);
    expect(ROOT_BUCKET).toBe('root');
  });

  it('passes an arbitrary/unrecognised directory name through unchanged (AC-5)', () => {
    expect(bucketFor('adr/0001-foo.md')).toBe('adr');
  });
});

describe('estimateTokens', () => {
  it('computes ceil(size_bytes / 4) (AC-6)', () => {
    expect(estimateTokens(1000)).toBe(250);
  });

  it('rounds up for non-multiples of 4', () => {
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
  });

  it('is 0 for a zero-byte document', () => {
    expect(estimateTokens(0)).toBe(0);
  });

  it('sums across documents to the spec example total: 400 + 800 + 1200 bytes -> 600 tokens (AC-7)', () => {
    // AC-7: "the listing shall report an aggregate estimated_tokens_total
    // equal to the sum of all listed documents' estimated_tokens" — the
    // actual summation lives in service.ts's list() (outside this module's
    // pure-helper surface), but the arithmetic it depends on is exactly
    // this: ceil(bytes/4) per document, summed.
    const sizes = [400, 800, 1200];
    const total = sizes.reduce((sum, size) => sum + estimateTokens(size), 0);
    expect(total).toBe(600);
  });
});

describe('toPosixRelative', () => {
  it('strips a leading "./" (AC-3)', () => {
    expect(toPosixRelative('', './specs/a.md')).toBe('specs/a.md');
  });

  it('strips a leading "/" (AC-3)', () => {
    expect(toPosixRelative('', '/specs/a.md')).toBe('specs/a.md');
  });

  it('strips an absolute root prefix, producing a forward-slash relative path', () => {
    expect(toPosixRelative('/clone/repo', '/clone/repo/specs/public-api.md')).toBe(
      'specs/public-api.md',
    );
  });

  it('normalises backslashes to forward slashes', () => {
    expect(toPosixRelative('C:\\clone\\repo', 'C:\\clone\\repo\\docs\\b.md')).toBe('docs/b.md');
  });
});
