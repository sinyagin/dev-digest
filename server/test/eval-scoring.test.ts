import { describe, it, expect } from 'vitest';
import type { EvalCaseOutcome, EvalExpectationType } from '@devdigest/shared';
import {
  aggregate,
  erroredOutcome,
  matches,
  scoreCase,
  type ScorableFinding,
} from '../src/modules/eval/scoring.js';

const F = (file: string, s: number, e = s): ScorableFinding => ({
  file,
  start_line: s,
  end_line: e,
  severity: 'warning',
  category: 'bug',
  title: 't',
});

const meta = (type: EvalExpectationType, id = 'c1') => ({
  case_id: id,
  name: `case ${id}`,
  expectation_type: type,
});

const exp = (type: EvalExpectationType, file = 'a.ts', start_line = 10, end_line = 20) => ({
  type,
  file,
  start_line,
  end_line,
});

const score = (
  type: EvalExpectationType,
  kept: ScorableFinding[],
  dropped = 0,
  id = 'c1',
  cost: number | null = 0.01,
): EvalCaseOutcome =>
  scoreCase({
    kept,
    droppedCount: dropped,
    expectation: exp(type),
    caseMeta: meta(type, id),
    durationMs: 100,
    costUsd: cost,
  });

describe('eval scoring', () => {
  it('AC-23 must_find passes on one-line overlap', () => {
    const o = score('must_find', [F('a.ts', 20, 30)]);
    expect(o.pass).toBe(true);
    expect(o.findings_matched).toBe(1);
    expect(o.actual[0]?.matched).toBe(true);
    expect(score('must_find', [F('a.ts', 21, 30)]).pass).toBe(false);
    expect(matches(F('a.ts', 30, 5), exp('must_find'))).toBe(true); // reversed range normalised
  });

  it('AC-23 must_not_flag passes with zero matches', () => {
    expect(score('must_not_flag', [F('a.ts', 1, 9)]).pass).toBe(true);
    expect(score('must_not_flag', [F('a.ts', 15)]).pass).toBe(false);
  });

  it('AC-25 one must_not_flag case, four grounded findings, one overlapping → precision 0.75', () => {
    const o = score('must_not_flag', [F('a.ts', 12), F('a.ts', 1), F('a.ts', 2), F('b.ts', 12)]);
    expect(aggregate([o]).precision).toBe(0.75);
  });

  it('AC-26 four produced, three kept → citation 0.75', () => {
    const o = score('must_find', [F('a.ts', 1), F('a.ts', 2), F('a.ts', 12)], 1);
    expect(o.grounding_total).toBe(4);
    expect(aggregate([o]).citation_accuracy).toBe(0.75);
  });

  it('AC-28 only must_not_flag cases → recall null', () => {
    const r = aggregate([score('must_not_flag', [F('a.ts', 1)])]);
    expect(r.recall).toBeNull();
    expect(r.precision).toBe(1);
  });

  it('AC-28 zero findings → precision and citation null', () => {
    const r = aggregate([score('must_find', [])]);
    expect(r.precision).toBeNull();
    expect(r.citation_accuracy).toBeNull();
    expect(r.recall).toBe(0);
  });

  it('AC-18 errored case excluded from numerators and denominators; cases_errored = 1', () => {
    const r = aggregate([
      score('must_find', [F('a.ts', 12)], 0, 'c1'),
      erroredOutcome(meta('must_find', 'c2'), 'llm failed', 50),
    ]);
    expect(r.cases_errored).toBe(1);
    expect(r.traces_total).toBe(1);
    expect(r.traces_passed).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.duration_ms).toBe(100);
    expect(r.cost_usd).toBe(0.01);
    expect(r.per_case).toHaveLength(2);
  });

  it('AC-27 dropped finding inside a must_not_flag range is not a false positive', () => {
    const o = score('must_not_flag', [F('a.ts', 1)], 1); // the dropped one is never matched
    expect(o.pass).toBe(true);
    expect(aggregate([o]).precision).toBe(1);
    expect(aggregate([o]).citation_accuracy).toBe(0.5);
  });

  it('file mismatch never matches', () => {
    expect(matches(F('b.ts', 10, 20), exp('must_find'))).toBe(false);
    expect(score('must_find', [F('b.ts', 10, 20)]).pass).toBe(false);
  });

  it('cost is null when any scored case cost is null', () => {
    const r = aggregate([score('must_find', [], 0, 'c1', 0.01), score('must_find', [], 0, 'c2', null)]);
    expect(r.cost_usd).toBeNull();
  });
});
