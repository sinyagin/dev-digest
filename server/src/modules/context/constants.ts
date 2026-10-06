/**
 * Project Context module constants (SPEC-01-project-context).
 *
 * Pure constants only — no I/O, no Fastify, no Drizzle.
 */

/** Extension discovery is scoped to — the only file type this feature surfaces. */
export const MARKDOWN_EXT = '.md';

/**
 * Directories the discovery walk never descends into (AC-2).
 *
 * The literal values are copied from `repo-intel/constants.ts`'s
 * `EXCLUDED_DIRS` as a point-in-time precedent, not imported — that list is
 * annotated for the *indexer's* walk scope and evolves on its own schedule,
 * unrelated to this feature. Keep this module's own copy independent.
 */
export const CONTEXT_EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;

/**
 * AC-2 requires excluding *every* dot-directory, not just `.git` — e.g.
 * `.devdigest`. Any path segment matching this pattern is pruned in addition
 * to the named directories above.
 */
export const DOT_DIR_PATTERN = /^\./;

/** Per-document injection cap in bytes (AC-42). */
export const MAX_DOC_BYTES = 64 * 1024;

/** Total injected project-context budget in bytes, across all documents (AC-43). */
export const MAX_TOTAL_BYTES = 256 * 1024;

/**
 * Appended after a document's text is cut at `MAX_DOC_BYTES` (AC-42). Exact
 * wording is not contract-pinned (SPEC Q-3) — tests assert on presence /
 * intent ("truncated"), not this literal string.
 */
export const TRUNCATION_MARKER =
  '\n\n[... truncated: document exceeds 64 KiB injection limit ...]';

/** Bucket reported for a document that sits at the repository root (AC-4). */
export const ROOT_BUCKET = 'root';
