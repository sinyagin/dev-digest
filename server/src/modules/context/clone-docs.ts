/**
 * Project Context module — clone-docs infrastructure (SPEC-01-project-context).
 *
 * The ONLY file in this feature that touches `node:fs`. Everything here is a
 * pure `node:fs`/`node:path` concern plus T4's helpers — no Drizzle, no
 * Fastify, no `@devdigest/shared` contracts. Downstream modules (service /
 * routes) import this file; they never call `node:fs` themselves for
 * clone-relative paths.
 *
 * Security note (AC-37): this is the one attacker-reachable filesystem
 * surface in the feature — a client supplies `path`, and it must never
 * escape the repo's clone root. `resolveConfined()` is the sole gate; every
 * read/write in this file goes through it. It rejects by comparing
 * `fs.realpath()` of the target (and, when the target doesn't exist yet, its
 * parent directory) against `fs.realpath()` of the clone root — a resolved,
 * symlink-aware comparison, never a string-prefix check on the unresolved
 * path. A naive prefix check on `path.resolve(root, relPath)` would pass a
 * symlink created inside the clone that points outside it (e.g. at
 * `/etc/passwd`); only comparing *realpaths* catches that.
 */
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { CONTEXT_EXCLUDED_DIRS, DOT_DIR_PATTERN, MARKDOWN_EXT } from './constants.js';
import { toPosixRelative } from './helpers.js';

/** Markdown files discovered per `readdir` syscall, before the stat batch resolves. */
const STAT_BATCH_SIZE = 50;

const EXCLUDED_DIR_SET: ReadonlySet<string> = new Set(CONTEXT_EXCLUDED_DIRS);

/**
 * Typed error for every confinement/readability failure in this file
 * (AC-10, AC-37). Downstream callers (T8/T12) should catch via
 * `instanceof ContextFsError` and branch on `.code`:
 *
 * - `'confinement'`  — the requested path resolves outside the clone root
 *   (traversal, absolute path, or an escaping symlink). No read/write was
 *   attempted.
 * - `'unreadable'`   — confinement passed, but the underlying `fs` call
 *   failed (ENOENT, EISDIR, permissions, …).
 * - `'invalid_utf8'` — confinement and the raw read both succeeded, but the
 *   bytes are not valid UTF-8 text (binary file, broken encoding).
 */
export class ContextFsError extends Error {
  constructor(
    message: string,
    public readonly code: 'confinement' | 'unreadable' | 'invalid_utf8',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ContextFsError';
  }
}

export interface MarkdownFileEntry {
  /** Repository-relative, forward-slash path (AC-3). */
  path: string;
  size_bytes: number;
  /** ISO 8601 timestamp of the file's mtime. */
  updated_at: string;
}

/**
 * `true` iff `cloneRoot` exists and is a directory (AC-34). Never throws —
 * any `stat` failure (missing path, permissions, not-a-directory) is `false`.
 */
export async function cloneAvailable(cloneRoot: string): Promise<boolean> {
  try {
    const info = await stat(cloneRoot);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Iterative (stack-based, not recursive — AC-41's 20k-file budget plus the
 * risk of a deep/looped tree rules out the call stack), depth-first walk of
 * `cloneRoot` collecting every `.md` file.
 *
 * Pruning (AC-2): a directory is skipped — never pushed onto the stack, so
 * never descended into — when its name is in `CONTEXT_EXCLUDED_DIRS` or
 * matches `DOT_DIR_PATTERN`. Symlinks (file or directory) are never
 * followed, which both avoids symlink loops and keeps the walk from ever
 * stepping outside the clone tree via a directory symlink.
 *
 * `stat` calls are batched via `Promise.allSettled` (bounded to
 * `STAT_BATCH_SIZE` at a time) rather than one unbounded `Promise.all` per
 * directory, or sequential awaits — mirrors the batching lesson in
 * `server/INSIGHTS.md` (`agent_skills` races aside, the general shape:
 * unbounded fan-out on large trees is the wrong shape, and a single
 * rejected promise must never take down the rest of the batch).
 */
export async function walkMarkdown(cloneRoot: string): Promise<MarkdownFileEntry[]> {
  const root = resolve(cloneRoot);
  const results: MarkdownFileEntry[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Unreadable directory (permissions, dangling symlink target, removed
      // mid-walk) — skip cleanly so the walk keeps making progress elsewhere,
      // same convention as repo-intel's walk.ts.
      continue;
    }

    const mdCandidates: string[] = [];

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // never follow symlinks — files or dirs

      if (entry.isDirectory()) {
        if (DOT_DIR_PATTERN.test(entry.name)) continue;
        if (EXCLUDED_DIR_SET.has(entry.name)) continue;
        stack.push(join(dir, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;
      if (extname(entry.name).toLowerCase() !== MARKDOWN_EXT) continue;
      mdCandidates.push(join(dir, entry.name));
    }

    for (let i = 0; i < mdCandidates.length; i += STAT_BATCH_SIZE) {
      const batch = mdCandidates.slice(i, i + STAT_BATCH_SIZE);
      const settled = await Promise.allSettled(batch.map((full) => stat(full)));
      settled.forEach((result, idx) => {
        if (result.status !== 'fulfilled') return; // one bad entry can't reject the batch
        const full = batch[idx]!;
        results.push({
          path: toPosixRelative(root, full),
          size_bytes: result.value.size,
          updated_at: result.value.mtime.toISOString(),
        });
      });
    }
  }

  // Stable order, independent of readdir/filesystem ordering.
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

/** `true` iff `candidate` is `root` itself or a path nested under it. Both must already be realpath'd. */
function isWithin(candidate: string, root: string): boolean {
  if (candidate === root) return true;
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  return candidate.startsWith(rootWithSep);
}

/**
 * Resolves `relPath` against `cloneRoot` and confines it there (AC-37).
 * Returns the resolved absolute path on success, or `null` when the request
 * must be rejected — traversal (`../..`), an absolute path that escapes the
 * root, or a symlink (file or any ancestor directory) that resolves outside
 * the clone.
 *
 * Confinement is checked via `fs.realpath()`, never a string-prefix check on
 * the unresolved `path.resolve()` result — a symlink living inside the
 * clone but pointing outside it would pass a naive prefix test and must
 * still be rejected here.
 *
 * `fs.realpath()` throws `ENOENT` on a path that doesn't exist yet, which
 * matters for the write path (the target file may not exist). So: resolve
 * the target, then realpath its *parent directory* (which must already
 * exist) separately from the — possibly nonexistent — final segment. If the
 * target itself does exist, its own realpath is also checked (catches a
 * symlink file sitting directly at the target path).
 */
export async function resolveConfined(cloneRoot: string, relPath: string): Promise<string | null> {
  const resolvedRoot = resolve(cloneRoot);
  let realRoot: string;
  try {
    realRoot = await realpath(resolvedRoot);
  } catch {
    return null; // clone root itself doesn't exist
  }

  const target = resolve(resolvedRoot, relPath);
  const parentDir = dirname(target);

  let realParent: string;
  try {
    realParent = await realpath(parentDir);
  } catch {
    return null; // parent directory doesn't exist — nothing to confine against
  }

  if (!isWithin(realParent, realRoot)) return null;

  // Target may or may not exist yet (write path). If it exists, resolve and
  // confine its own realpath too (catches a symlink file at the target).
  try {
    const realTarget = await realpath(target);
    if (!isWithin(realTarget, realRoot)) return null;
    return realTarget;
  } catch {
    // Doesn't exist yet — confined by the already-verified parent. Rebuild
    // the path from the parent's realpath so no unresolved segment remains.
    const base = target.slice(parentDir.length);
    return realParent + base;
  }
}

/**
 * Confined, UTF-8 whole-file read (AC-10, AC-37). Throws `ContextFsError`
 * when confinement fails (`'confinement'`), the underlying read fails
 * (`'unreadable'`), or the bytes are not valid UTF-8 (`'invalid_utf8'`).
 * Listing a document via `walkMarkdown` never calls this — content
 * unreadability never removes a document from the walk results.
 */
export async function readDocument(cloneRoot: string, relPath: string): Promise<string> {
  const confined = await resolveConfined(cloneRoot, relPath);
  if (!confined) {
    throw new ContextFsError(`Refused to read "${relPath}": path escapes the clone root`, 'confinement');
  }

  let buf: Buffer;
  try {
    buf = await readFile(confined);
  } catch (cause) {
    throw new ContextFsError(`Unable to read "${relPath}"`, 'unreadable', { cause });
  }

  try {
    // `fatal: true` is required — Buffer#toString('utf8') silently replaces
    // invalid byte sequences with U+FFFD instead of rejecting them, which
    // would make a binary file masquerade as a (garbled) valid document.
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (cause) {
    throw new ContextFsError(`"${relPath}" is not valid UTF-8 text`, 'invalid_utf8', { cause });
  }
}

/**
 * Confined whole-file write (AC-24). Throws `ContextFsError('confinement')`
 * when `relPath` escapes the clone root; throws `ContextFsError('unreadable')`
 * (reused as the generic "underlying fs call failed" code) if the write
 * itself fails after confinement passes.
 */
export async function writeDocument(
  cloneRoot: string,
  relPath: string,
  content: string,
): Promise<void> {
  const confined = await resolveConfined(cloneRoot, relPath);
  if (!confined) {
    throw new ContextFsError(`Refused to write "${relPath}": path escapes the clone root`, 'confinement');
  }

  try {
    await writeFile(confined, content, 'utf8');
  } catch (cause) {
    throw new ContextFsError(`Unable to write "${relPath}"`, 'unreadable', { cause });
  }
}

/**
 * Confined single-document `stat`, for callers (e.g. `ContextService.getDocument`)
 * that need just one path's working-tree mtime and would otherwise have to
 * reach for `node:fs` themselves or walk the whole tree via `walkMarkdown`
 * (wasteful against AC-41's 20k-file budget for a single-file lookup).
 * Reuses the same `resolveConfined()` gate as `readDocument`/`writeDocument`
 * — no new unconfined fs surface. Returns `null` — never throws — when the
 * path fails confinement or the underlying `stat` fails, so callers can
 * fall back to a best-effort value (e.g. "now") instead of failing the
 * whole response over metadata.
 */
export async function statDocument(cloneRoot: string, relPath: string): Promise<{ updated_at: string } | null> {
  const confined = await resolveConfined(cloneRoot, relPath);
  if (!confined) return null;

  try {
    const info = await stat(confined);
    return { updated_at: info.mtime.toISOString() };
  } catch {
    return null;
  }
}
