import type { Risk, ReviewFocusItem, UnifiedDiff } from '@devdigest/shared';
import type { BriefDraft } from './llm-schema.js';

/**
 * Pure grounding gate for the PR Why/Risk Brief.
 *
 * Mirrors the structure of `reviewer-core/src/grounding.ts` (its
 * `buildLineIndex`) but is deliberately standalone: no import from
 * `reviewer-core`, `fastify`, `drizzle-orm`, or `Container`. This file has
 * zero framework/infra dependencies so it can be unit-tested in isolation
 * and reused by both the brief service (T5) and its tests (T7a).
 *
 * `groundBrief` filters a model-authored `BriefDraft` against two facts
 * that our own (non-LLM) code computed:
 *  - `allowedFiles`   — every file path the brief is permitted to cite
 *    (this PR's own changed files + Blast Radius callers/changed-symbol
 *    files)
 *  - `changedLines`   — for files that ARE part of this PR's diff, the set
 *    of new-side line numbers actually touched by a hunk. Blast-only files
 *    (in `allowedFiles` only because of blast radius, not because they're
 *    part of this PR's diff) have NO entry here — so any focus line on
 *    such a file always comes back `null`. That's correct per AC-18
 *    ("within that file's actual changed-line ranges in this PR's diff"),
 *    not a bug.
 */

export type GroundingDropKind = 'risk' | 'focus' | 'file_ref' | 'line';

export interface GroundingDrop {
  kind: GroundingDropKind;
  detail: string;
}

export interface GroundBriefOptions {
  allowedFiles: Set<string>;
  changedLines: Map<string, Set<number>>;
}

export interface GroundBriefResult {
  risks: Risk[];
  review_focus: ReviewFocusItem[];
  dropped: GroundingDrop[];
}

/**
 * Build a file → set of new-side line numbers index from a unified diff.
 * For each hunk, prefer its precomputed `newLineNumbers`; fall back to the
 * hunk's declared `newStart`/`newLines` range when `newLineNumbers` is
 * empty (happens on a pure-deletion hunk) — same fallback as
 * `reviewer-core/src/grounding.ts:24-39`'s `buildLineIndex`.
 */
export function buildChangedLineIndex(diff: UnifiedDiff): Map<string, Set<number>> {
  const idx = new Map<string, Set<number>>();
  for (const f of diff.files) {
    const set = new Set<number>();
    for (const h of f.hunks) {
      if (h.newLineNumbers && h.newLineNumbers.length > 0) {
        for (const n of h.newLineNumbers) set.add(n);
      } else {
        // fall back to the hunk's declared new range
        for (let n = h.newStart; n < h.newStart + Math.max(h.newLines, 1); n++) set.add(n);
      }
    }
    idx.set(f.path, set);
  }
  return idx;
}

/**
 * Apply the grounding gate to a model-authored brief draft. See module
 * docstring above for the rules. Order of `risks` and `review_focus` in the
 * output matches the input order minus drops (AC-31 reading order).
 */
export function groundBrief(draft: BriefDraft, opts: GroundBriefOptions): GroundBriefResult {
  const dropped: GroundingDrop[] = [];
  const risks: Risk[] = [];

  for (const risk of draft.risks.risks) {
    const keptRefs: string[] = [];
    for (const ref of risk.file_refs) {
      if (opts.allowedFiles.has(ref)) {
        keptRefs.push(ref);
      } else {
        dropped.push({
          kind: 'file_ref',
          detail: `risk '${risk.title}': file_ref '${ref}' is not an allowed file`,
        });
      }
    }

    if (keptRefs.length === 0) {
      dropped.push({
        kind: 'risk',
        detail: `risk '${risk.title}' dropped: no file_refs survived grounding`,
      });
      continue;
    }

    risks.push(keptRefs.length === risk.file_refs.length ? risk : { ...risk, file_refs: keptRefs });
  }

  const review_focus: ReviewFocusItem[] = [];
  for (const item of draft.review_focus) {
    if (!opts.allowedFiles.has(item.file)) {
      dropped.push({
        kind: 'focus',
        detail: `review_focus item for '${item.file}' dropped: file is not an allowed file`,
      });
      continue;
    }

    if (item.line !== null && !(opts.changedLines.get(item.file)?.has(item.line) ?? false)) {
      dropped.push({
        kind: 'line',
        detail: `review_focus item for '${item.file}': line ${item.line} is outside the file's changed-line ranges in this PR's diff`,
      });
      review_focus.push({ ...item, line: null });
      continue;
    }

    review_focus.push(item);
  }

  return { risks, review_focus, dropped };
}
