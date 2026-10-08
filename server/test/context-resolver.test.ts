/**
 * T12 — tests for the Project Context module's resolver (SPEC-01-project-context).
 * Uses a stub/mock `read` function — no real filesystem — to exercise
 * resolution order, dedupe, fail-soft behavior, and the per-document /
 * total byte budgets.
 */
import { describe, it, expect } from 'vitest';
import { resolveProjectContext } from '../src/modules/context/resolver.js';
import { MAX_DOC_BYTES, MAX_TOTAL_BYTES, TRUNCATION_MARKER } from '../src/modules/context/constants.js';

/** Builds a stub reader from a path -> content map; throws for unknown paths. */
function readerFrom(contents: Record<string, string>): (path: string) => Promise<string> {
  return async (path: string) => {
    if (!(path in contents)) {
      throw new Error(`not found: ${path}`);
    }
    return contents[path]!;
  };
}

describe('resolveProjectContext', () => {
  it('dedupes by first-occurrence, agent-first then skills in order (AC-20)', async () => {
    const read = readerFrom({ A: 'content A', B: 'content B' });

    const result = await resolveProjectContext({
      agentPaths: ['B'],
      skillPathLists: [['A', 'B']],
      read,
    });

    expect(result.read).toEqual(['B', 'A']);
    expect(result.specs).toEqual(['content B', 'content A']);
    expect(result.missing).toEqual([]);
  });

  it('resolver has no enabled/disabled filtering logic of its own — that\'s the caller\'s contract (not an AC-21 e2e test; see context-injection.it.test.ts for the real observable)', async () => {
    // The caller is responsible for excluding a disabled skill's paths
    // before calling resolveProjectContext. Here, "skill-disabled-doc" is
    // simply never passed in skillPathLists at all (as if the caller
    // already filtered it out) — confirm the resolver doesn't somehow
    // re-include it or otherwise behave differently because of it.
    const read = readerFrom({
      'agent-doc': 'agent content',
      'enabled-skill-doc': 'enabled skill content',
      'skill-disabled-doc': 'disabled skill content',
    });

    const result = await resolveProjectContext({
      agentPaths: ['agent-doc'],
      skillPathLists: [['enabled-skill-doc']],
      read,
    });

    expect(result.read).toEqual(['agent-doc', 'enabled-skill-doc']);
    expect(result.specs).toEqual(['agent content', 'enabled skill content']);
    expect(result.read).not.toContain('skill-disabled-doc');
    expect(result.missing).toEqual([]);
  });

  it('records an unreadable path in missing and resolves successfully rather than throwing (AC-25)', async () => {
    const read = readerFrom({ good: 'good content' });

    const result = await resolveProjectContext({
      agentPaths: ['good', 'deleted'],
      skillPathLists: [],
      read,
    });

    expect(result.read).toEqual(['good']);
    expect(result.specs).toEqual(['good content']);
    expect(result.missing).toEqual(['deleted']);
  });

  it('returns an empty specs array when every resolved path fails to read (AC-26)', async () => {
    const read = readerFrom({});

    const result = await resolveProjectContext({
      agentPaths: ['missing-1', 'missing-2'],
      skillPathLists: [['missing-3']],
      read,
    });

    expect(result.specs).toEqual([]);
    expect(result.read).toEqual([]);
    expect(result.missing).toEqual(['missing-1', 'missing-2', 'missing-3']);
  });

  it('truncates a document exceeding the per-document budget on a byte boundary, marking it in both read and truncated (AC-42)', async () => {
    // Deliberately a multi-byte UTF-8 character (3 bytes each), not ASCII —
    // a regression to a character-based slice (`text.slice(0, MAX_DOC_BYTES)`)
    // would produce a document roughly 3x the intended byte size, which this
    // fixture's exact byte-length assertions below would catch; an ASCII
    // fixture can't discriminate the two since chars == bytes for ASCII.
    const CHAR = '日';
    const CHAR_BYTES = Buffer.byteLength(CHAR, 'utf8'); // 3
    const targetBytes = 200 * 1024; // ~200 KiB, same margin over MAX_DOC_BYTES as before
    const oversized = CHAR.repeat(Math.ceil(targetBytes / CHAR_BYTES));
    const read = readerFrom({ big: oversized });

    const result = await resolveProjectContext({
      agentPaths: ['big'],
      skillPathLists: [],
      read,
    });

    expect(result.read).toEqual(['big']);
    expect(result.truncated).toEqual(['big']);
    expect(result.missing).toEqual([]);
    expect(result.specs).toHaveLength(1);

    const contributed = result.specs[0]!;
    expect(contributed.endsWith(TRUNCATION_MARKER)).toBe(true);
    const contributedBytes = Buffer.byteLength(contributed, 'utf8');
    // The text portion must land on the last complete multi-byte codepoint
    // boundary at or below MAX_DOC_BYTES — since every char here is a fixed
    // 3 bytes, that's the largest multiple of 3 not exceeding MAX_DOC_BYTES,
    // never MAX_DOC_BYTES itself (which would split the trailing char).
    const expectedTextBytes = Math.floor(MAX_DOC_BYTES / CHAR_BYTES) * CHAR_BYTES;
    const expectedBytes = expectedTextBytes + Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
    expect(contributedBytes).toBe(expectedBytes);
    // And the hard ceiling must hold regardless: never exceed the budget.
    expect(expectedTextBytes).toBeLessThanOrEqual(MAX_DOC_BYTES);
  });

  it('stops injecting once the cumulative total would exceed the total budget, recording the remainder as missing (AC-43)', async () => {
    // Four ~100 KiB docs (~400 KiB total) against a 256 KiB total budget —
    // each individually under the per-doc 64 KiB? No: use docs just under
    // the per-doc budget so truncation isn't what's limiting things here,
    // and the total budget is what kicks in.
    //
    // Multi-byte fixture, same reasoning as the AC-42 test above: a
    // character-based regression anywhere in the byte-budget bookkeeping
    // (e.g. counting `.length` instead of `Buffer.byteLength`) would
    // silently under-count by ~3x for these chars, letting far more than
    // the intended number of docs through — a plain ASCII fixture can't
    // catch that. Repeat count is chosen so each doc's actual BYTE size is
    // ~60 KiB (still under MAX_DOC_BYTES, so per-doc truncation never
    // kicks in here — only the total budget does), matching the original
    // ASCII fixture's byte size and margin.
    const CHAR = '日';
    const CHAR_BYTES = Buffer.byteLength(CHAR, 'utf8'); // 3
    const chunk = CHAR.repeat(Math.round((60 * 1024) / CHAR_BYTES)); // ~60 KiB in bytes, under MAX_DOC_BYTES
    const read = readerFrom({
      doc1: chunk,
      doc2: chunk,
      doc3: chunk,
      doc4: chunk,
      doc5: chunk,
      doc6: chunk,
      doc7: chunk,
    });

    const result = await resolveProjectContext({
      agentPaths: ['doc1', 'doc2', 'doc3', 'doc4', 'doc5', 'doc6', 'doc7'],
      skillPathLists: [],
      read,
    });

    const totalInjectedBytes = result.specs.reduce(
      (sum, text) => sum + Buffer.byteLength(text, 'utf8'),
      0,
    );
    expect(totalInjectedBytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expect(result.read.length).toBeLessThan(7);
    expect(result.missing.length).toBeGreaterThan(0);

    // Every path not in `read` must be in `missing`, and resolution order
    // must be preserved: once budget is exceeded, every subsequent path
    // (in resolved order) is omitted too.
    const allPaths = ['doc1', 'doc2', 'doc3', 'doc4', 'doc5', 'doc6', 'doc7'];
    for (const path of allPaths) {
      if (!result.read.includes(path)) {
        expect(result.missing).toContain(path);
      }
    }
    // The omission point should be contiguous from where it starts to the end.
    const firstMissingIndex = allPaths.findIndex((p) => result.missing.includes(p));
    for (let i = firstMissingIndex; i < allPaths.length; i++) {
      expect(result.missing).toContain(allPaths[i]);
    }
  });
});
