import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EvalExpectation, EvalCaseInput } from '@devdigest/shared';

const root = resolve(__dirname, '../..');
const read = (pkg: 'server' | 'client', rel: string) =>
  readFileSync(resolve(root, pkg, 'src/vendor/shared', rel), 'utf8');

const validExpectation = {
  type: 'must_find',
  file: 'src/a.ts',
  start_line: 3,
  end_line: 5,
};

describe('eval contract vendored-copy parity', () => {
  it('keeps both copies of eval.ts and index.ts identical', () => {
    expect(read('client', 'contracts/eval.ts')).toBe(read('server', 'contracts/eval.ts'));
    expect(read('client', 'index.ts')).toBe(read('server', 'index.ts'));
  });

  it('has no legacy Eval exports left in knowledge.ts / eval-ci.ts', () => {
    for (const pkg of ['server', 'client'] as const) {
      expect(read(pkg, 'contracts/knowledge.ts')).not.toContain('export const Eval');
      expect(read(pkg, 'contracts/eval-ci.ts')).not.toContain('export const Eval');
    }
  });
});

describe('EvalExpectation / EvalCaseInput limits', () => {
  it('accepts a valid expectation', () => {
    expect(EvalExpectation.safeParse(validExpectation).success).toBe(true);
  });

  it.each([
    ['unknown type', { ...validExpectation, type: 'maybe' }, ['type']],
    ['fractional start_line', { ...validExpectation, start_line: 1.5 }, ['start_line']],
    ['end_line < start_line', { ...validExpectation, start_line: 5, end_line: 2 }, ['end_line']],
  ])('rejects %s', (_n, input, path) => {
    const r = EvalExpectation.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => JSON.stringify(i.path) === JSON.stringify(path))).toBe(true);
  });

  it('rejects an unknown key', () => {
    expect(EvalExpectation.safeParse({ ...validExpectation, extra: 1 }).success).toBe(false);
  });

  it('rejects input_diff over 200000 chars', () => {
    const base = {
      name: 'n',
      input_diff: 'x',
      input_files: ['src/a.ts'],
      input_meta: { pr_number: null, title: 't', body: null },
      expectation: validExpectation,
    };
    expect(EvalCaseInput.safeParse(base).success).toBe(true);
    const r = EvalCaseInput.safeParse({ ...base, input_diff: 'x'.repeat(200001) });
    expect(r.success).toBe(false);
  });
});
