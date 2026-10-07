/**
 * Prompt-size caps + ordering for the Brief fact-assembly prompt
 * (`facts.ts`). Pure data — no logic here.
 *
 * These caps apply ONLY to what the model is shown in the prompt text; the
 * grounding allowlist (`assembleBriefFacts(...).allowedFiles`) is always the
 * full, untruncated union of PR files + Blast Radius changed-symbol/caller
 * files, regardless of these limits (see `facts.ts`).
 */
import type { SmartDiffRole } from '@devdigest/shared';

/** Max changed-file lines shown in the `## Changed files` prompt section. */
export const MAX_PROMPT_FILES = 150;

/**
 * Max Blast Radius changed-symbol/caller file lines shown in the
 * `## Blast radius` prompt section.
 */
export const MAX_PROMPT_BLAST_FILES = 120;

/**
 * Order in which Smart Diff roles are shown in the prompt when a file list
 * needs to be capped: core (the actual logic change) first, then wiring,
 * tests, docs, and boilerplate last — mirroring the relative review
 * importance of each role, NOT `smart-diff.ts`'s own classification check
 * order (boilerplate → tests → wiring → docs → core, see
 * `reviews/smart-diff-constants.ts`) and NOT its display order (core →
 * tests → wiring → docs → boilerplate, see `reviews/smart-diff.ts`'s
 * `DISPLAY_ORDER`) — this is a third, deliberately different ordering
 * scoped to just this prompt.
 */
export const SMART_DIFF_ROLE_PROMPT_ORDER: SmartDiffRole[] = [
  'core',
  'wiring',
  'tests',
  'docs',
  'boilerplate',
];
