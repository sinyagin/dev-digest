/* Smart Diff — matches review findings to rendered diff lines, and the
   render-prop contract that lets shared diff-viewer code show a finding's
   card without importing from an app-route's page-specific _components/. */
import type { ReactNode } from "react";
import type { FindingActionKind, FindingRecord } from "@devdigest/shared";
import type { Line } from "./helpers";

/** Findings are always grounded to the new/right side of the diff (the
   citation gate requires a line that appears in the diff), so unlike
   `keysForLine`'s LEFT/RIGHT split, only `ln.newNo` is ever matched — a
   plain numeric key is enough. Groups a file's findings by exact
   `start_line`, keeping only lines actually rendered in this patch; a
   finding whose start_line has no matching rendered line is dropped (should
   be rare/impossible since findings are diff-grounded server-side). */
export function matchFindingsToLines(
  findings: FindingRecord[],
  lines: Line[],
): Map<number, FindingRecord[]> {
  const renderedNewNos = new Set<number>();
  for (const ln of lines) {
    if ((ln.kind === "add" || ln.kind === "ctx") && ln.newNo != null) renderedNewNos.add(ln.newNo);
  }
  const byLine = new Map<number, FindingRecord[]>();
  for (const f of findings) {
    if (!renderedNewNos.has(f.start_line)) continue;
    const list = byLine.get(f.start_line) ?? [];
    list.push(f);
    byLine.set(f.start_line, list);
  }
  return byLine;
}

/** Severity → CSS colour token for the code-line's left border strip.
   Duplicates FindingCard's own SEV_COLOR (4 lines, same CSS vars) rather
   than importing across the src/components/ <-> app-route _components/
   boundary — no existing precedent crosses that boundary. */
export const LINE_SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

/** Severity → the right-aligned line label the homework spec asks for.
   INFO has no defined label — the line still gets its border, no label. */
export const LINE_SEV_LABEL_KEY: Record<string, "blocker" | "warning" | "suggestion" | undefined> = {
  CRITICAL: "blocker",
  WARNING: "warning",
  SUGGESTION: "suggestion",
};

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1, INFO: 0 };

/** The most severe finding on a line — decides which single strip/label renders. */
export function worstFinding(findings: FindingRecord[]): FindingRecord | undefined {
  return [...findings].sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
  )[0];
}

/** What the diff-viewer needs to overlay findings + accept/dismiss inline. */
export interface DiffFindingApi {
  /** All of the latest review's findings for one file path. */
  findingsForFile: (path: string) => FindingRecord[];
  pending: boolean;
  onAction: (findingId: string, action: FindingActionKind) => void;
  /** Presentational slot — the caller (DiffTab) supplies the actual
     <FindingCard/>, so shared diff-viewer code never imports it directly. */
  renderCard: (
    f: FindingRecord,
    ctx: { pending: boolean; onAction: (a: FindingActionKind) => void },
  ) => ReactNode;
}
