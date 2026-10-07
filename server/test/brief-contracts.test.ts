import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PrBrief } from '@devdigest/shared';

/**
 * Byte-identity + shape tests for the extended `PrBrief` contract (AC-1
 * through AC-7 in specs/cross-module/SPEC-02-pr-why-risk-brief.md). Both
 * vendored copies of brief.ts must stay byte-for-byte identical (AC-2).
 */
describe('brief.ts vendored copies', () => {
  it('server and client copies are byte-identical', () => {
    const serverPath = join(__dirname, '..', 'src', 'vendor', 'shared', 'contracts', 'brief.ts');
    const clientPath = join(__dirname, '..', '..', 'client', 'src', 'vendor', 'shared', 'contracts', 'brief.ts');
    const serverContents = readFileSync(serverPath);
    const clientContents = readFileSync(clientPath);
    expect(clientContents.equals(serverContents)).toBe(true);
  });
});

describe('PrBrief (extended contract)', () => {
  const validPayload = {
    intent: null,
    blast: null,
    risks: { risks: [] },
    history: { history: [] },
    summary: 's',
    review_focus: [{ file: 'a.ts', line: null, reason: 'r' }],
    missing_context: ['intent', 'blast'],
    generated_for_sha: 'abc',
  };

  it('succeeds with nullable intent/blast, missing_context, review_focus, summary, generated_for_sha', () => {
    const result = PrBrief.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBeNull();
      expect(result.data.blast).toBeNull();
      expect(result.data.missing_context).toEqual(['intent', 'blast']);
      expect(result.data.review_focus).toEqual([{ file: 'a.ts', line: null, reason: 'r' }]);
      expect(result.data.generated_for_sha).toBe('abc');
    }
  });

  it('fails when summary is omitted', () => {
    const { summary, ...rest } = validPayload;
    const result = PrBrief.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('fails when review_focus is omitted', () => {
    const { review_focus, ...rest } = validPayload;
    const result = PrBrief.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
