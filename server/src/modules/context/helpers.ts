/**
 * Project Context module pure helpers (SPEC-01-project-context).
 *
 * No I/O, no Fastify, no Drizzle — safe to unit test without a repo clone or
 * a database.
 */

import { ROOT_BUCKET } from './constants.js';

/**
 * Converts an absolute path to a repository-relative, forward-slash path
 * with no leading `./` or `/` (AC-3).
 *
 * `root` is stripped as a prefix when present; otherwise `abs` is treated as
 * already-relative-ish input (e.g. `./specs/a.md` or `/specs/a.md`) and just
 * has its leading `./`/`/` normalised away. Backslashes are normalised to
 * forward slashes throughout so the result is always POSIX-style.
 */
export function toPosixRelative(root: string, abs: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedAbs = abs.replace(/\\/g, '/');

  let rel = normalizedAbs;
  if (normalizedRoot.length > 0 && normalizedAbs.startsWith(normalizedRoot)) {
    rel = normalizedAbs.slice(normalizedRoot.length);
  }

  // Strip any leading "./" segments, then any leading "/".
  rel = rel.replace(/^(\.\/)+/, '');
  rel = rel.replace(/^\/+/, '');

  return rel;
}

/**
 * Returns the first path segment of a repository-relative path as its
 * bucket, or `ROOT_BUCKET` when the document sits at the repository root
 * (AC-4). Deliberately an open set — no case normalisation, no mapping of
 * unknown names — an arbitrary directory name must survive unchanged so the
 * UI can render it as-is (AC-5).
 */
export function bucketFor(relPath: string): string {
  const slashIndex = relPath.indexOf('/');
  if (slashIndex === -1) {
    return ROOT_BUCKET;
  }
  return relPath.slice(0, slashIndex);
}

/** Estimates token count from byte size as `ceil(size_bytes / 4)` (AC-6). */
export function estimateTokens(sizeBytes: number): number {
  return Math.ceil(sizeBytes / 4);
}
