/* Pure helpers for ContextAttachmentPicker. No React, no fetching — every
   function here derives a value from the `documents`/`paths` props the
   component already has, per "derive, don't store". */
import type { ContextDocument } from "@devdigest/shared";

export interface AttachmentRow {
  path: string;
  attached: boolean;
  /** True when this path is in the persisted attached list but absent from
      the discovered `documents` list (renamed/deleted since attaching —
      AC-36). Always rendered, never silently dropped. */
  missing: boolean;
  document: ContextDocument | null;
  /** 0-based position within the persisted attached order. Only set when
      `attached` is true; drives the move-up/move-down disabled state. */
  order?: number;
}

/** Pinned default filter semantics (Rec-6): case-insensitive substring match
    on `path` only, never on content. An empty query matches everything. */
export function matchesFilter(path: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return path.toLowerCase().includes(q);
}

/** Build the single merged, ordered row list: every attached path first, in
    its persisted order (including ones no longer discovered — AC-36),
    followed by every discovered-but-unattached document that matches
    `query`. Attached rows are NEVER hidden by the filter — a filter must
    never hide a document the user might be about to replace or inspect. */
export function buildRows(documents: ContextDocument[], paths: string[], query: string): AttachmentRow[] {
  const byPath = new Map(documents.map((d) => [d.path, d] as const));
  const attachedSet = new Set(paths);

  const attachedRows: AttachmentRow[] = paths.map((path, order) => ({
    path,
    attached: true,
    missing: !byPath.has(path),
    document: byPath.get(path) ?? null,
    order,
  }));

  const availableRows: AttachmentRow[] = documents
    .filter((d) => !attachedSet.has(d.path) && matchesFilter(d.path, query))
    .map((d) => ({ path: d.path, attached: false, missing: false, document: d }));

  return [...attachedRows, ...availableRows];
}

/** Sum of `estimated_tokens` across every attached path that is still
    discovered. A missing path carries no size data and contributes 0. */
export function attachedTokenSum(documents: ContextDocument[], paths: string[]): number {
  const byPath = new Map(documents.map((d) => [d.path, d] as const));
  return paths.reduce((sum, p) => sum + (byPath.get(p)?.estimated_tokens ?? 0), 0);
}

/** Explicit `≈` estimate formatting (AC-8) — never present a token figure as
    an exact count. */
export function formatTokenEstimate(tokens: number): string {
  return `≈${tokens} tokens`;
}

/** Toggle one path's attached state. Detach if present; attach (appended at
    the end of the persisted order) if absent. Always returns a new array. */
export function toggleAttachment(paths: string[], path: string): string[] {
  if (paths.includes(path)) return paths.filter((p) => p !== path);
  return [...paths, path];
}

/** Move `path` one slot earlier/later within the persisted attached order.
    No-op (returns the same array reference) at either edge, so callers can
    check `=== paths` to skip a redundant onChange. */
export function moveAttachment(paths: string[], path: string, direction: "up" | "down"): string[] {
  const index = paths.indexOf(path);
  if (index === -1) return paths;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= paths.length) return paths;
  const next = [...paths];
  const moved = next[index]!;
  const displaced = next[target]!;
  next[index] = displaced;
  next[target] = moved;
  return next;
}
