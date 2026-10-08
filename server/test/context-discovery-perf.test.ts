/**
 * T14 — performance test for the Project Context module's discovery walk
 * (SPEC-01-project-context, AC-41): "WHEN discovery runs against a working
 * tree of up to 20,000 files containing up to 500 Markdown documents, the
 * system shall return the listing in under 2,000 ms at p95."
 *
 * Builds a disposable fixture tree under `os.tmpdir()` — never under
 * `server/clones/**` (git-ignored runtime clone data) or inside the repo
 * tree itself — then times a single `walkMarkdown` call against it.
 *
 * Guarded generously: fixture generation itself (not the thing under test)
 * can be slow on a sandboxed/CI filesystem. If generation blows its own
 * budget, or fails outright, the perf assertion is SKIPPED rather than
 * failed — the intent is a meaningful performance signal, not a flaky gate
 * tied to unrelated disk I/O variance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { walkMarkdown } from '../src/modules/context/clone-docs.js';

const TOTAL_FILES = 20_000;
const MD_FILES = 500;
const DIR_COUNT = 100;
const FILES_PER_DIR = TOTAL_FILES / DIR_COUNT; // 200
const MD_PER_DIR = MD_FILES / DIR_COUNT; // 5

/**
 * Generous budget for *building* the fixture (not the walk itself). If a
 * sandboxed/CI disk can't generate ~20,000 small files within this window,
 * the environment — not `walkMarkdown` — is the bottleneck, so the perf
 * assertion below is skipped rather than failed.
 */
const GENERATION_BUDGET_MS = 45_000;

/** AC-41's actual budget for the discovery walk itself. */
const PERF_BUDGET_MS = 2_000;

let fixtureRoot: string | null = null;
let fixtureUsable = false;

beforeAll(async () => {
  try {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'devdigest-context-perf-'));
    const start = performance.now();

    for (let d = 0; d < DIR_COUNT; d++) {
      const dirPath = join(fixtureRoot, `dir-${d}`);
      await mkdir(dirPath, { recursive: true });

      const writes: Promise<void>[] = [];
      for (let f = 0; f < FILES_PER_DIR; f++) {
        const isMarkdown = f < MD_PER_DIR;
        const name = isMarkdown ? `doc-${f}.md` : `file-${f}.txt`;
        const content = isMarkdown ? `# doc ${d}-${f}\n\nfixture content.` : `fixture content ${d}-${f}`;
        writes.push(writeFile(join(dirPath, name), content));
      }
      await Promise.all(writes);
    }

    const generationElapsed = performance.now() - start;
    fixtureUsable = generationElapsed <= GENERATION_BUDGET_MS;
  } catch {
    // Fixture generation itself failed (disk pressure, permissions, …) —
    // leave fixtureUsable false so the test below skips cleanly.
    fixtureUsable = false;
  }
});

afterAll(async () => {
  if (fixtureRoot) {
    await rm(fixtureRoot, { recursive: true, force: true }).catch(() => {});
  }
});

describe('walkMarkdown performance', () => {
  it('discovers ~500 markdown files among ~20,000 files in under 2,000ms (AC-41)', async (ctx) => {
    if (!fixtureRoot || !fixtureUsable) {
      ctx.skip();
      return;
    }

    const start = performance.now();
    const found = await walkMarkdown(fixtureRoot);
    const elapsed = performance.now() - start;

    expect(found.length).toBe(MD_FILES);
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
  });
});
