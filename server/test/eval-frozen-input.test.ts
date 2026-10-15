import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import {
  buildDraft,
  checkExpectationGrounded,
  expectationFromFinding,
  slugifyCaseName,
  synthesizeFrozenDiff,
} from '../src/modules/eval/frozen-input.js';

const PATCH = '@@ -1,3 +10,4 @@\n a\n+b\n c\n d';
const base = {
  id: 'f1',
  file: 'src/a.ts',
  startLine: 11,
  endLine: 12,
  severity: 'CRITICAL',
  category: 'bug',
  title: 'Null deref',
  acceptedAt: null as Date | null,
  dismissedAt: null as Date | null,
};

describe('frozen-input', () => {
  it('AC-4 accepted → must_find with file/lines/severity/category/title', () => {
    const e = expectationFromFinding({ ...base, acceptedAt: new Date() });
    expect(e).toEqual({
      type: 'must_find',
      file: 'src/a.ts',
      start_line: 11,
      end_line: 12,
      severity: 'CRITICAL',
      category: 'bug',
      title: 'Null deref',
    });
    const d = buildDraft({
      finding: { ...base, acceptedAt: new Date() },
      pull: { number: 7, title: 'T', body: null },
      prFilePatch: PATCH,
      agent: { id: 'a', name: 'Agent' },
      existingCaseId: null,
    });
    expect(d.input_files).toEqual(['src/a.ts']);
    expect(d.input_meta).toEqual({ pr_number: 7, title: 'T', body: null });
    expect(d.source_triage).toBe('accepted');
  });

  it('AC-4 dismissed → must_not_flag', () => {
    expect(expectationFromFinding({ ...base, dismissedAt: new Date() }).type).toBe('must_not_flag');
  });

  it('AC-3 synthesized diff round-trips through parseUnifiedDiff with the original hunks', () => {
    const diff = parseUnifiedDiff(synthesizeFrozenDiff('src/a.ts', PATCH));
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.path).toBe('src/a.ts');
    expect(diff.files[0]!.hunks[0]).toMatchObject({ newStart: 10, newLines: 4 });
  });

  it('AC-10 lines outside every hunk refused with reason', () => {
    const d = synthesizeFrozenDiff('src/a.ts', PATCH);
    expect(checkExpectationGrounded(d, { file: 'src/a.ts', start_line: 11, end_line: 11 })).toEqual({ ok: true });
    const r = checkExpectationGrounded(d, { file: 'src/a.ts', start_line: 90, end_line: 95 });
    expect(r).toEqual({
      ok: false,
      reason: 'expectation lines 90-95 do not intersect any hunk of src/a.ts in the frozen diff',
    });
  });

  it('AC-10 null patch refused', () => {
    const d = synthesizeFrozenDiff('src/a.ts', null);
    expect(d).toBe('');
    expect(checkExpectationGrounded(d, { file: 'src/a.ts', start_line: 1, end_line: 1 })).toEqual({
      ok: false,
      reason: 'frozen diff has no hunks for src/a.ts',
    });
  });

  it('full-file-kind source finding still requires line intersection', () => {
    const d = synthesizeFrozenDiff('src/a.ts', PATCH);
    const draft = buildDraft({
      finding: { ...base, kind: 'secret_leak', startLine: 500, endLine: 501, acceptedAt: new Date() },
      pull: { number: 1, title: 'T', body: 'b' },
      prFilePatch: PATCH,
      agent: { id: 'a', name: 'A' },
      existingCaseId: null,
    });
    expect(checkExpectationGrounded(d, draft.expectation).ok).toBe(false);
  });

  it('slug from `Hardcoded Stripe <secret> key!` is `hardcoded-stripe-secret-key`', () => {
    expect(slugifyCaseName('Hardcoded Stripe <secret> key!')).toBe('hardcoded-stripe-secret-key');
    expect(slugifyCaseName('!!!')).toBe('eval-case');
    expect(slugifyCaseName('a'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});
