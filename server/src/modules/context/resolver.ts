/**
 * Project Context module resolver (SPEC-01-project-context, T12).
 *
 * Pure orchestration: dedupes resolved document paths, reads each via an
 * injected reader, enforces the per-document and total byte budgets, and
 * fails soft on any read error. No `node:fs`, no `Container`, no Drizzle —
 * the reader is injected, which keeps this testable without a filesystem.
 */

import { MAX_DOC_BYTES, MAX_TOTAL_BYTES, TRUNCATION_MARKER } from './constants.js';

/**
 * Returns the longest prefix of `buf` that is both `<= maxBytes` AND ends on
 * a complete UTF-8 codepoint boundary. Scans forward decoding one codepoint
 * length at a time (cheap: bounded by `maxBytes`, 64 KiB) rather than
 * blindly slicing at `maxBytes` and calling `.toString('utf8')` — Node's
 * UTF-8 decoder substitutes U+FFFD (3 bytes) for a trailing partial
 * multi-byte sequence it can't decode, which can make the decoded-then-
 * re-encoded result up to 2 bytes LARGER than `maxBytes`. Trimming back to
 * the last complete codepoint first guarantees the truncated text segment
 * never exceeds `maxBytes`, with no replacement character involved.
 */
function truncateToUtf8Boundary(buf: Buffer, maxBytes: number): Buffer {
  if (buf.byteLength <= maxBytes) return buf;
  let i = 0;
  let boundary = 0;
  while (i < maxBytes) {
    const byte = buf[i]!;
    let len: number;
    if ((byte & 0x80) === 0x00) len = 1; // ASCII
    else if ((byte & 0xe0) === 0xc0) len = 2;
    else if ((byte & 0xf0) === 0xe0) len = 3;
    else if ((byte & 0xf8) === 0xf0) len = 4;
    else len = 1; // invalid lead/continuation byte landed on — advance by 1 to avoid looping forever
    if (i + len > maxBytes) break; // this codepoint doesn't fully fit — stop before it
    i += len;
    boundary = i;
  }
  return buf.subarray(0, boundary);
}

export interface ResolveProjectContextInput {
  /** Paths attached directly on the agent, in the agent's own order. */
  agentPaths: string[];
  /**
   * Paths attached via skills, one array per skill, in skill load order.
   * Callers must pre-filter to ENABLED skills only — this function applies
   * no enabled/disabled logic of its own.
   */
  skillPathLists: string[][];
  /** Injected reader. Must throw on any failure (missing/unreadable/etc). */
  read: (path: string) => Promise<string>;
}

export interface ResolveProjectContextResult {
  /** Injected document text, in resolved order, after any per-doc truncation. */
  specs: string[];
  /** Paths successfully read (including truncated ones), in resolved order. */
  read: string[];
  /** Paths that failed to read OR were omitted for exceeding the total budget. */
  missing: string[];
  /** Paths that were read successfully but had to be truncated (AC-42). */
  truncated: string[];
}

/**
 * Resolves an agent's project-context documents: dedupes agent + skill
 * paths (first-occurrence-wins, agent-first), reads each via `read`, and
 * applies the per-document (AC-42) and total (AC-43) byte budgets. Never
 * throws — any `read` failure is recorded in `missing` and resolution
 * continues (AC-25).
 */
export async function resolveProjectContext(
  input: ResolveProjectContextInput,
): Promise<ResolveProjectContextResult> {
  const { agentPaths, skillPathLists, read } = input;

  // Concat agent-first, then skills in order — THEN dedupe keeping the
  // position of the first occurrence. Concatenating in a different order,
  // or deduping before concatenating, gets AC-20's observable wrong.
  const concatenated = [...agentPaths, ...skillPathLists.flat()];
  const resolvedOrder: string[] = [];
  const seen = new Set<string>();
  for (const path of concatenated) {
    if (!seen.has(path)) {
      seen.add(path);
      resolvedOrder.push(path);
    }
  }

  const specs: string[] = [];
  const readPaths: string[] = [];
  const missing: string[] = [];
  const truncated: string[] = [];

  let cumulativeBytes = 0;
  let budgetExceeded = false;

  // Sequential (not Promise.all) to preserve resolved order deterministically
  // (AC-14, AC-23) and to let budget state short-circuit later reads.
  for (const path of resolvedOrder) {
    if (budgetExceeded) {
      missing.push(path);
      continue;
    }

    let text: string;
    try {
      text = await read(path);
    } catch {
      missing.push(path);
      continue;
    }

    // Truncate on the UTF-8 byte boundary, not the decoded string's char
    // boundary — slicing the JS string by index can split a multi-byte
    // UTF-8 sequence mid-codepoint and corrupt the text.
    const buf = Buffer.from(text, 'utf8');
    const wasTruncated = buf.byteLength > MAX_DOC_BYTES;
    const contributedText = wasTruncated
      ? truncateToUtf8Boundary(buf, MAX_DOC_BYTES).toString('utf8') + TRUNCATION_MARKER
      : text;
    const contributedBytes = Buffer.byteLength(contributedText, 'utf8');

    if (cumulativeBytes + contributedBytes > MAX_TOTAL_BYTES) {
      budgetExceeded = true;
      missing.push(path);
      continue;
    }

    cumulativeBytes += contributedBytes;
    specs.push(contributedText);
    readPaths.push(path);
    if (wasTruncated) {
      truncated.push(path);
    }
  }

  return { specs, read: readPaths, missing, truncated };
}
