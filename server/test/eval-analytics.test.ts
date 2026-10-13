import { describe, it, expect } from 'vitest';
import type { EvalCaseOutcome, EvalRunRecord } from '@devdigest/shared';
import { aggregate, erroredOutcome } from '../src/modules/eval/scoring.js';
import {
  compareRuns,
  deriveBanner,
  diffPromptLines,
  latestTwoCompleted,
  deltaPts,
} from '../src/modules/eval/analytics.js';

const scored = (id: string, type: 'must_find' | 'must_not_flag', matched: number, pass: boolean): EvalCaseOutcome => ({
  case_id: id,
  name: `case-${id}`,
  expectation_type: type,
  status: 'scored',
  pass,
  error_reason: null,
  findings_total: 1,
  findings_matched: matched,
  grounding_kept: 1,
  grounding_total: 1,
  duration_ms: 1,
  cost_usd: 0.01,
  actual: [],
});

function run(
  id: string,
  ranAt: string,
  version: number,
  per_case: EvalCaseOutcome[],
  over: Partial<EvalRunRecord> = {},
): EvalRunRecord {
  return {
    ...aggregate(per_case),
    id,
    agent_id: 'a',
    agent_version: version,
    status: 'completed',
    error_reason: null,
    ran_at: ranAt,
    finished_at: ranAt,
    case_ids: per_case.map((o) => o.case_id as string),
    ...over,
  };
}

describe('eval analytics', () => {
  it('AC-35 different case sets: added/removed named, deltas over intersection', () => {
    const a = run('r1', '2026-01-01T00:00:00Z', 1, [scored('1', 'must_find', 1, true), scored('2', 'must_find', 0, false)]);
    const b = run('r2', '2026-01-02T00:00:00Z', 2, [scored('2', 'must_find', 1, true), scored('3', 'must_find', 1, true)]);
    const c = compareRuns(b, a, 'x', 'y'); // out of order on purpose
    expect(c.old.id).toBe('r1');
    expect(c.common_cases).toBe(1);
    expect(c.case_set.same).toBe(false);
    expect(c.case_set.added).toEqual([{ case_id: '3', name: 'case-3' }]);
    expect(c.case_set.removed).toEqual([{ case_id: '1', name: 'case-1' }]);
    expect(c.metrics.recall).toEqual({ old: 0, new: 1, delta: 1 });
  });

  it('AC-35 errored case in one run narrows the intersection (D20)', () => {
    const a = run('r1', '2026-01-01T00:00:00Z', 1, [scored('1', 'must_find', 1, true), scored('2', 'must_find', 1, true)]);
    const b = run('r2', '2026-01-02T00:00:00Z', 1, [
      scored('1', 'must_find', 1, true),
      erroredOutcome({ case_id: '2', name: 'case-2', expectation_type: 'must_find' }, 'boom', 1),
    ]);
    const c = compareRuns(a, b, 'p', 'p');
    expect(c.common_cases).toBe(1);
    expect(c.case_set.same).toBe(true);
  });

  it('AC-36 removed/added lines distinguished', () => {
    const { unchanged, diff } = diffPromptLines('a\r\nb\nc', 'a\nB\nc');
    expect(unchanged).toBe(false);
    expect(diff).toEqual([
      { op: 'equal', line: 'a' },
      { op: 'remove', line: 'b' },
      { op: 'add', line: 'B' },
      { op: 'equal', line: 'c' },
    ]);
  });

  it('AC-36 same version -> unchanged true, diff empty', () => {
    expect(diffPromptLines('same\ntext', 'same\ntext')).toEqual({ unchanged: true, diff: [] });
  });

  it('AC-47 move with no case transition yields flipped = []', () => {
    const prev = run('r1', '2026-01-01T00:00:00Z', 1, [scored('1', 'must_find', 1, true), scored('2', 'must_find', 0, false)]);
    const cur = run('r2', '2026-01-02T00:00:00Z', 2, [scored('1', 'must_find', 1, true), scored('2', 'must_find', 0, false)], {
      citation_accuracy: 0.5,
    });
    const b = deriveBanner(cur, prev);
    expect(b).toMatchObject({ metric: 'citation_accuracy', direction: 'down', delta_pts: 50, version: 2 });
    expect(b?.flipped).toEqual([]);
  });

  it('AC-47 flipped case named', () => {
    const prev = run('r1', '2026-01-01T00:00:00Z', 1, [scored('1', 'must_find', 0, false), scored('2', 'must_find', 1, true)]);
    const cur = run('r2', '2026-01-02T00:00:00Z', 2, [scored('1', 'must_find', 1, true), scored('2', 'must_find', 1, true)]);
    const b = deriveBanner(cur, prev);
    expect(b?.metric).toBe('recall');
    expect(b?.direction).toBe('up');
    expect(b?.flipped).toEqual([{ case_id: '1', name: 'case-1', from_pass: false, to_pass: true }]);
  });

  it('AC-51 errored latest is skipped', () => {
    const r1 = run('r1', '2026-01-01T00:00:00Z', 1, [scored('1', 'must_find', 1, true)]);
    const r2 = run('r2', '2026-01-02T00:00:00Z', 1, [scored('1', 'must_find', 1, true)]);
    const r3 = run('r3', '2026-01-03T00:00:00Z', 1, [], { status: 'errored' });
    const r4 = run('r4', '2026-01-04T00:00:00Z', 1, [], { status: 'running' });
    const { latest, previous } = latestTwoCompleted([r1, r4, r3, r2]);
    expect(latest?.id).toBe('r2');
    expect(previous?.id).toBe('r1');
  });

  it('AC-50 single completed run -> banner null, delta null', () => {
    const r1 = run('r1', '2026-01-01T00:00:00Z', 1, [scored('1', 'must_find', 1, true)]);
    const { latest, previous } = latestTwoCompleted([r1]);
    expect(previous).toBeNull();
    expect(deriveBanner(latest, previous)).toBeNull();
    expect(deltaPts(null, 0.5)).toBeNull();
    expect(deltaPts(0.5, 0.75)).toBe(25);
  });
});
