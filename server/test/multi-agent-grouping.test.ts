import { describe, it, expect } from 'vitest';
import type { AgentColumn, AgentColumnFinding } from '@devdigest/shared';
import {
  buildLocationGroups,
  deriveRunStatus,
  deriveTotals,
} from '../src/modules/reviews/multi-agent-grouping.js';

let seq = 0;
function fnd(p: Partial<AgentColumnFinding> & { start_line: number; end_line: number }): AgentColumnFinding {
  return {
    id: `f${++seq}`,
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'a.ts',
    kind: 'finding',
    ...p,
  };
}
function col(
  name: string,
  findings: AgentColumnFinding[],
  status: AgentColumn['status'] = 'done',
): AgentColumn {
  return {
    run_id: `run-${name}`,
    agent_id: `ag-${name}`,
    agent_name: name,
    provider: null,
    model: null,
    status,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    error: null,
    last_log: null,
    findings,
  };
}

describe('buildLocationGroups', () => {
  it('AC-38: overlapping/touching ranges merge transitively; a distant one is a new group', () => {
    const cols = [
      col('A', [fnd({ start_line: 10, end_line: 12 }), fnd({ start_line: 30, end_line: 31 })]),
      col('B', [fnd({ start_line: 12, end_line: 14 })]),
      col('C', [fnd({ start_line: 14, end_line: 20 })]),
    ];
    const g = buildLocationGroups(cols);
    expect(g).toHaveLength(2);
    const first = g.find((x) => x.line === 10)!;
    expect([first.line, first.end_line]).toEqual([10, 20]);
    expect(g.find((x) => x.line === 30)).toBeDefined();
  });

  it('AC-37: a failed column appears in no group', () => {
    const cols = [
      col('A', [fnd({ start_line: 1, end_line: 1 })]),
      col('B', [fnd({ start_line: 1, end_line: 1 })], 'failed'),
    ];
    const g = buildLocationGroups(cols);
    expect(g).toHaveLength(1);
    expect(g[0]!.takes.map((t) => t.agent_id)).toEqual(['ag-A']);
  });

  it('AC-39: file-scoped kinds and wide spans group per file + kind regardless of line', () => {
    const cols = [
      col('A', [
        fnd({ start_line: 3, end_line: 3, kind: 'secret_leak' }),
        fnd({ start_line: 90, end_line: 90, kind: 'secret_leak' }),
        fnd({ start_line: 1, end_line: 60 }),
      ]),
    ];
    const g = buildLocationGroups(cols);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.takes[0]!.finding_ids.length === 2)).toBeDefined();
  });

  it('AC-40: representative is most severe, ties by lowest start_line; header uses min/max and top title', () => {
    const w = fnd({ start_line: 5, end_line: 6, severity: 'WARNING', title: 'warn' });
    const c1 = fnd({ start_line: 7, end_line: 9, severity: 'CRITICAL', title: 'crit-late' });
    const c2 = fnd({ start_line: 6, end_line: 7, severity: 'CRITICAL', title: 'crit-early' });
    const g = buildLocationGroups([col('A', [w, c1, c2])]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ line: 5, end_line: 9, title: 'crit-early' });
    expect(g[0]!.takes[0]).toMatchObject({ verdict: 'CRITICAL', note: 'crit-early' });
    expect(g[0]!.takes[0]!.finding_ids).toHaveLength(3);
  });

  it('AC-41: every finding id appears in exactly one group; input is not mutated', () => {
    const cols = [
      col('A', [fnd({ start_line: 1, end_line: 2 }), fnd({ start_line: 40, end_line: 41, file: 'b.ts' })]),
      col('B', [fnd({ start_line: 2, end_line: 3 })]),
    ];
    const before = JSON.stringify(cols);
    const g = buildLocationGroups(cols);
    const ids = g.flatMap((x) => x.takes.flatMap((t) => t.finding_ids));
    expect(ids.sort()).toEqual(cols.flatMap((c) => c.findings.map((f) => f.id)).sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(cols)).toBe(before);
  });

  it('AC-43: conflict flag rules and conflicts-first ordering', () => {
    const same = [
      col('A', [fnd({ start_line: 1, end_line: 1 })]),
      col('B', [fnd({ start_line: 1, end_line: 1 })]),
      col('C', [fnd({ start_line: 1, end_line: 1 })]),
    ];
    expect(buildLocationGroups(same)[0]!.conflict).toBe(false);

    const ignored = [col('A', [fnd({ start_line: 1, end_line: 1 })]), col('B', [])];
    const gi = buildLocationGroups(ignored)[0]!;
    expect(gi.conflict).toBe(true);
    expect(gi.takes.find((t) => t.agent_id === 'ag-B')).toMatchObject({
      verdict: 'ignored',
      note: '',
      finding_ids: [],
    });

    const diverge = [
      col('A', [fnd({ start_line: 1, end_line: 1 })]),
      col('B', [fnd({ start_line: 1, end_line: 1, severity: 'SUGGESTION' })]),
    ];
    expect(buildLocationGroups(diverge)[0]!.conflict).toBe(true);

    // agreement at line 1 (a.ts), disagreement at line 50 (z.ts) → conflict sorts first
    const mixed = [
      col('A', [fnd({ start_line: 1, end_line: 1 }), fnd({ start_line: 50, end_line: 50, file: 'z.ts' })]),
      col('B', [fnd({ start_line: 1, end_line: 1 })]),
    ];
    const gm = buildLocationGroups(mixed);
    expect(gm.map((x) => x.conflict)).toEqual([true, false]);
    expect(gm[0]!.file).toBe('z.ts');
  });
});

describe('deriveRunStatus / deriveTotals (D5)', () => {
  const run = { status: 'running', duration_ms: null, cost_usd: null };
  const done = (d: number, c: number | null) => ({ status: 'done', duration_ms: d, cost_usd: c });
  const failed = { status: 'failed', duration_ms: 500, cost_usd: null };

  it('status', () => {
    expect(deriveRunStatus([run, done(1, 1)])).toBe('running');
    expect(deriveRunStatus([failed, failed])).toBe('failed');
    expect(deriveRunStatus([failed, done(1, 1)])).toBe('done');
    expect(deriveRunStatus([])).toBe('failed');
  });

  it('totals: max duration, cost summed over done children only', () => {
    expect(deriveTotals([run])).toEqual({ total_duration_ms: 0, total_cost_usd: 0 });
    expect(deriveTotals([done(1000, 0.01), done(3000, 0.02), failed])).toEqual({
      total_duration_ms: 3000,
      total_cost_usd: expect.closeTo(0.03, 10),
    });
    expect(deriveTotals([done(1000, null), done(2000, 0.02)]).total_cost_usd).toBeNull();
  });
});
