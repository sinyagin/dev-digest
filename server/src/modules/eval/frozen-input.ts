import { groundFindings } from '@devdigest/reviewer-core';
import type { EvalCaseDraft, EvalExpectation, Finding } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { FindingRow, PullRow } from '../../db/rows.js';

/**
 * Pure helpers that freeze a triaged finding's PR input into an eval case
 * (SPEC-03). No DB, no LLM: callers pass already-loaded rows.
 */

const MAX_SLUG_LENGTH = 60;
const FALLBACK_SLUG = 'eval-case';

/**
 * Rebuild a parseable unified diff from a bare per-file patch. `parseUnifiedDiff`
 * keys files off `+++ b/<path>`, so a bare patch would parse to zero files
 * (same shape as `reviews/diff-loader.ts`). Empty string for a null/empty patch.
 */
export function synthesizeFrozenDiff(path: string, patch: string | null | undefined): string {
  if (!patch) return '';
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`;
}

/** kebab-case ASCII slug, max 60 chars, never empty. */
export function slugifyCaseName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug || FALLBACK_SLUG;
}

type TriagedFinding = Pick<
  FindingRow,
  'id' | 'file' | 'startLine' | 'endLine' | 'severity' | 'category' | 'title' | 'acceptedAt' | 'dismissedAt'
> &
  Partial<Pick<FindingRow, 'kind'>>;

/** accepted -> must_find, dismissed -> must_not_flag. Throws if untriaged. */
export function expectationFromFinding(row: TriagedFinding): EvalExpectation {
  const type = row.acceptedAt ? 'must_find' : row.dismissedAt ? 'must_not_flag' : null;
  if (!type) throw new Error('finding has no triage decision (neither accepted nor dismissed)');
  return {
    type,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    severity: row.severity as EvalExpectation['severity'],
    category: row.category,
    title: row.title,
  };
}

export interface BuildDraftArgs {
  finding: TriagedFinding;
  pull: Pick<PullRow, 'number' | 'title' | 'body'>;
  prFilePatch: string | null | undefined;
  agent: { id: string; name: string };
  existingCaseId: string | null;
}

export function buildDraft(args: BuildDraftArgs): EvalCaseDraft {
  const { finding, pull, prFilePatch, agent, existingCaseId } = args;
  const expectation = expectationFromFinding(finding);
  return {
    name: slugifyCaseName(finding.title),
    input_diff: synthesizeFrozenDiff(finding.file, prFilePatch),
    input_files: [finding.file],
    input_meta: {
      pr_number: pull.number,
      title: pull.title.slice(0, 500),
      body: pull.body ? pull.body.slice(0, 20000) : null,
    },
    expectation,
    notes: null,
    source_finding_id: finding.id,
    agent,
    source_triage: expectation.type === 'must_find' ? 'accepted' : 'dismissed',
    existing_case_id: existingCaseId,
  };
}

export type GroundedCheck = { ok: true } | { ok: false; reason: string };

/**
 * AC-10: the expectation's lines must intersect a hunk of the frozen diff.
 * Reuses `groundFindings` (forced non-full-file kind) rather than re-indexing.
 */
export function checkExpectationGrounded(
  inputDiff: string,
  expectation: Pick<EvalExpectation, 'file' | 'start_line' | 'end_line'>,
): GroundedCheck {
  const diff = parseUnifiedDiff(inputDiff);
  const probe: Finding = {
    id: 'expectation',
    severity: 'SUGGESTION',
    category: 'bug',
    title: 'expectation',
    file: expectation.file,
    start_line: expectation.start_line,
    end_line: expectation.end_line,
    rationale: '',
    confidence: 1,
    kind: 'finding',
  };
  const { kept } = groundFindings([probe], diff);
  if (kept.length > 0) return { ok: true };
  const hasHunks = diff.files.some((f) => f.path === expectation.file && f.hunks.length > 0);
  return {
    ok: false,
    reason: hasHunks
      ? `expectation lines ${expectation.start_line}-${expectation.end_line} do not intersect any hunk of ${expectation.file} in the frozen diff`
      : `frozen diff has no hunks for ${expectation.file}`,
  };
}
