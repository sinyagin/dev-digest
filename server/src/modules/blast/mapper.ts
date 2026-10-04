import type { BlastResult } from '../repo-intel/types.js';
import type { ChangedSymbol, DownstreamImpact } from '@devdigest/shared';

/**
 * Maps the internal repo-intel BlastResult (flat callers, keyed by
 * viaSymbol) into the HTTP contract's changed_symbols/downstream shape.
 * Pure — no IO, no model call. `downstream` has one entry per DISTINCT
 * symbol name (including names with zero callers), so the UI can render a
 * clean "no callers" state per symbol.
 *
 * Deliberately NOT one entry per changed-symbol declaration: `viaSymbol` on
 * a caller row is a bare name with no file qualifier, so two declarations
 * sharing a name (e.g. a repository-pattern refactor that keeps an old
 * class method and adds an equivalent free function, both called
 * `getPull`) are indistinguishable to the facade and would otherwise
 * produce duplicate downstream entries — duplicate React keys client-side,
 * and double-counted callers in the summary.
 */
export function mapBlastResult(blast: BlastResult): {
  changed_symbols: ChangedSymbol[];
  downstream: DownstreamImpact[];
  summary: string;
} {
  const changed_symbols: ChangedSymbol[] = blast.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  const seenNames = new Set<string>();
  const uniqueNames: string[] = [];
  for (const sym of changed_symbols) {
    if (seenNames.has(sym.name)) continue;
    seenNames.add(sym.name);
    uniqueNames.push(sym.name);
  }

  const downstream: DownstreamImpact[] = uniqueNames.map((name) => {
    const callers = blast.callers.filter((c) => c.viaSymbol === name);
    const files = new Set(callers.map((c) => c.file));
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const file of files) {
      const facts = blast.factsByFile?.[file];
      if (!facts) continue;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const c of facts.crons) crons.add(c);
    }
    return {
      symbol: name,
      callers: callers.map((c) => ({ name: c.symbol, file: c.file, line: c.line })),
      endpoints_affected: [...endpoints],
      crons_affected: [...crons],
    };
  });

  return { changed_symbols, downstream, summary: buildSummary(changed_symbols, downstream) };
}

function buildSummary(symbols: ChangedSymbol[], downstream: DownstreamImpact[]): string {
  if (symbols.length === 0) return 'No changed symbols detected.';

  const callerCount = downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpointCount = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;
  const cronCount = new Set(downstream.flatMap((d) => d.crons_affected)).size;

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let text = `${plural(symbols.length, 'changed symbol')}, ${plural(callerCount, 'caller')}`;
  if (endpointCount > 0 || cronCount > 0) {
    const parts: string[] = [];
    if (endpointCount > 0) parts.push(plural(endpointCount, 'endpoint'));
    if (cronCount > 0) parts.push(plural(cronCount, 'cron'));
    text += ` across ${parts.join(' and ')} affected.`;
  } else {
    text += ', no endpoints or crons affected.';
  }
  return text;
}
