import type { AgentColumn, AgentColumnFinding, Conflict, ConflictTake } from '@devdigest/shared';

/**
 * Pure, deterministic location grouping + run derivations for multi-agent runs
 * (SPEC-04 D5, D8). Imports neither Fastify nor Drizzle; never mutates input.
 */

/**
 * Finding kinds that are file-scoped rather than line-scoped. Mirrors
 * `FULL_FILE_KINDS` in `reviewer-core/src/grounding.ts:16` (not exported, and
 * reviewer-core must not change — SPEC-04 N12). Keep in sync by hand.
 */
export const FILE_SCOPED_KINDS: ReadonlySet<string> = new Set([
  'secret_leak',
  'lethal_trifecta',
  'phantom',
  'hook',
]);

/** A finding spanning more than this many lines is treated as file-level (AC-39). */
export const MAX_LINE_SPAN = 50;

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };
const rank = (s: string): number => SEVERITY_RANK[s] ?? 0;

// ---------------------------------------------------------------------------
// Run-level derivations (D5)
// ---------------------------------------------------------------------------

export interface ChildSummary {
  status: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
}

/** running while any child runs; else done if any child is done; else failed. */
export function deriveRunStatus(children: ChildSummary[]): 'running' | 'done' | 'failed' {
  if (children.some((c) => c.status === 'running')) return 'running';
  if (children.some((c) => c.status === 'done')) return 'done';
  return 'failed';
}

/**
 * Duration = max of known child durations (0 if none). Cost = sum over `done`
 * children only; `null` only when a `done` child has an unknown cost.
 */
export function deriveTotals(children: ChildSummary[]): {
  total_duration_ms: number;
  total_cost_usd: number | null;
} {
  const durations = children.map((c) => c.duration_ms).filter((d): d is number => d != null);
  const total_duration_ms = durations.length ? Math.max(...durations) : 0;
  const done = children.filter((c) => c.status === 'done');
  const total_cost_usd = done.some((c) => c.cost_usd == null)
    ? null
    : done.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0);
  return { total_duration_ms, total_cost_usd };
}

// ---------------------------------------------------------------------------
// Location grouping (D8)
// ---------------------------------------------------------------------------

interface Owned {
  agentId: string;
  agentName: string;
  f: AgentColumnFinding;
}

/** Most severe first; ties: lowest start line, then agent name, then id. */
function byPriority(a: Owned, b: Owned): number {
  return (
    rank(b.f.severity) - rank(a.f.severity) ||
    a.f.start_line - b.f.start_line ||
    a.agentName.localeCompare(b.agentName) ||
    a.f.id.localeCompare(b.f.id)
  );
}

function isFileLevel(f: AgentColumnFinding): boolean {
  return (
    (f.kind != null && FILE_SCOPED_KINDS.has(f.kind)) ||
    f.end_line - f.start_line + 1 > MAX_LINE_SPAN
  );
}

function buildConflict(file: string, members: Owned[], participants: AgentColumn[]): Conflict {
  const ordered = [...members].sort(byPriority);
  const head = ordered[0]!;
  const takes: ConflictTake[] = participants.map((col) => {
    const mine = ordered.filter((m) => m.agentId === col.agent_id);
    const rep = mine[0];
    if (!rep) {
      return {
        agent_id: col.agent_id,
        persona: col.agent_name,
        verdict: 'ignored' as const,
        note: '',
        finding_ids: [],
      };
    }
    return {
      agent_id: col.agent_id,
      persona: col.agent_name,
      verdict: rep.f.severity,
      note: rep.f.title,
      finding_ids: mine.map((m) => m.f.id),
    };
  });
  const first = takes[0]?.verdict;
  const conflict = !(first !== undefined && first !== 'ignored' && takes.every((t) => t.verdict === first));
  return {
    file,
    line: Math.min(...members.map((m) => m.f.start_line)),
    end_line: Math.max(...members.map((m) => m.f.end_line)),
    conflict,
    title: head.f.title,
    takes,
  };
}

/**
 * Group the findings of all `done` columns by code location. Line findings in
 * one file merge when their inclusive ranges overlap or touch, transitively
 * (AC-38); file-scoped / very wide findings group per file + kind/category
 * (AC-39). Conflicts sort first, then by file, then start line (AC-43).
 */
export function buildLocationGroups(columns: AgentColumn[]): Conflict[] {
  const participants = columns.filter((c) => c.status === 'done');
  const owned: Owned[] = participants.flatMap((c) =>
    c.findings.map((f) => ({ agentId: c.agent_id, agentName: c.agent_name, f })),
  );

  const fileLevel = new Map<string, Owned[]>();
  const perFile = new Map<string, Owned[]>();
  for (const o of owned) {
    if (isFileLevel(o.f)) {
      const key = `${o.f.file}\u0000${o.f.kind ?? o.f.category}`;
      fileLevel.set(key, [...(fileLevel.get(key) ?? []), o]);
    } else {
      perFile.set(o.f.file, [...(perFile.get(o.f.file) ?? []), o]);
    }
  }

  const groups: Conflict[] = [];
  for (const members of fileLevel.values()) {
    groups.push(buildConflict(members[0]!.f.file, members, participants));
  }
  for (const [file, list] of perFile) {
    const sorted = [...list].sort((a, b) => a.f.start_line - b.f.start_line || a.f.end_line - b.f.end_line);
    let current: Owned[] = [];
    let curEnd = -Infinity;
    for (const o of sorted) {
      if (current.length > 0 && o.f.start_line <= curEnd) {
        current.push(o);
        curEnd = Math.max(curEnd, o.f.end_line);
      } else {
        if (current.length > 0) groups.push(buildConflict(file, current, participants));
        current = [o];
        curEnd = o.f.end_line;
      }
    }
    if (current.length > 0) groups.push(buildConflict(file, current, participants));
  }

  return groups.sort(
    (a, b) =>
      Number(b.conflict) - Number(a.conflict) || a.file.localeCompare(b.file) || a.line - b.line,
  );
}
