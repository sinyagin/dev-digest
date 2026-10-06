/**
 * T5 — tests for the Project Context module's clone-docs infrastructure
 * (SPEC-01-project-context). Exercises `walkMarkdown`, `resolveConfined`,
 * `readDocument`, `writeDocument`, and `cloneAvailable` against a real
 * temp-dir fixture built under `os.tmpdir()` — never under
 * `server/clones/**` (git-ignored runtime data) and never inside the repo
 * tree itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `fs.readFile` is wrapped in a `vi.fn` (actual implementation preserved via
// `importOriginal`) so AC-37's "no read occurs" assertions can check call
// counts — `node:fs/promises`'s named exports aren't configurable, so a bare
// `vi.spyOn(fsPromises, 'readFile')` throws "Cannot redefine property".
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ContextFsError,
  cloneAvailable,
  readDocument,
  resolveConfined,
  walkMarkdown,
  writeDocument,
} from '../src/modules/context/clone-docs.js';

const mockedReadFile = vi.mocked(readFile);

let fixtureRoot: string;
/** Tracks symlinks created in a test so cleanup can remove them without following them. */
let symlinksCreated: string[] = [];

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'devdigest-context-test-'));
  symlinksCreated = [];
  mockedReadFile.mockClear();
});

afterEach(async () => {
  // Remove tracked symlinks first (unlink never follows a symlink — it
  // removes the link itself), THEN remove the fixture dir. This avoids
  // `fs.rm(recursive)` ever needing to traverse into a symlink target that
  // may point outside the fixture.
  for (const link of symlinksCreated) {
    await unlink(link).catch(() => {});
  }
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('walkMarkdown', () => {
  it('finds root-level and nested .md files with correct repo-relative paths (AC-1, AC-3)', async () => {
    await writeFile(join(fixtureRoot, 'README.md'), '# root doc');
    await mkdir(join(fixtureRoot, 'docs', 'nested'), { recursive: true });
    await writeFile(join(fixtureRoot, 'docs', 'nested', 'guide.md'), '# nested doc');

    const found = await walkMarkdown(fixtureRoot);
    const paths = found.map((f) => f.path).sort();

    expect(paths).toEqual(['README.md', 'docs/nested/guide.md']);
    for (const entry of found) {
      expect(entry.size_bytes).toBeGreaterThan(0);
      expect(new Date(entry.updated_at).toString()).not.toBe('Invalid Date');
    }
  });

  it('never returns .md files placed under excluded directories (AC-2)', async () => {
    const excludedDirs = ['node_modules', '.git', 'dist', '.devdigest'];
    for (const dir of excludedDirs) {
      await mkdir(join(fixtureRoot, dir), { recursive: true });
      await writeFile(join(fixtureRoot, dir, 'hidden.md'), '# should never surface');
    }
    await writeFile(join(fixtureRoot, 'visible.md'), '# should surface');

    const found = await walkMarkdown(fixtureRoot);
    const paths = found.map((f) => f.path);

    expect(paths).toEqual(['visible.md']);
  });
});

describe('resolveConfined', () => {
  it('rejects a "../../../../etc/passwd"-style traversal without reading anything (AC-37)', async () => {
    const result = await resolveConfined(fixtureRoot, '../../../../etc/passwd');

    expect(result).toBeNull();
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it('rejects an absolute path like /etc/passwd without reading anything (AC-37)', async () => {
    const result = await resolveConfined(fixtureRoot, '/etc/passwd');

    expect(result).toBeNull();
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it('rejects a symlink inside the fixture that points outside it, without reading anything (AC-37)', async () => {
    const escapeTarget = await mkdtemp(join(tmpdir(), 'devdigest-context-escape-'));
    await writeFile(join(escapeTarget, 'secret.md'), '# outside the clone');
    const linkPath = join(fixtureRoot, 'escape-link');
    await symlink(escapeTarget, linkPath, 'dir');
    symlinksCreated.push(linkPath);

    const result = await resolveConfined(fixtureRoot, 'escape-link/secret.md');

    expect(result).toBeNull();
    expect(mockedReadFile).not.toHaveBeenCalled();

    await rm(escapeTarget, { recursive: true, force: true });
  });

  it('resolves a legitimate nested path inside the clone root', async () => {
    await mkdir(join(fixtureRoot, 'docs'), { recursive: true });
    await writeFile(join(fixtureRoot, 'docs', 'a.md'), '# a');

    const result = await resolveConfined(fixtureRoot, 'docs/a.md');

    expect(result).not.toBeNull();
  });
});

describe('cloneAvailable', () => {
  it('returns false for a non-existent directory path (AC-34)', async () => {
    expect(await cloneAvailable(join(fixtureRoot, 'does-not-exist'))).toBe(false);
  });

  it('returns true for an existing directory', async () => {
    expect(await cloneAvailable(fixtureRoot)).toBe(true);
  });
});

describe('readDocument', () => {
  it('throws ContextFsError for a binary file named *.md, while walkMarkdown still lists it (AC-10)', async () => {
    const binaryPath = join(fixtureRoot, 'something.md');
    // Invalid UTF-8 byte sequence (lone continuation byte) inside otherwise
    // plausible-looking content.
    await writeFile(binaryPath, Buffer.from([0x48, 0x69, 0xff, 0xfe, 0x00, 0x01]));

    const found = await walkMarkdown(fixtureRoot);
    expect(found.map((f) => f.path)).toContain('something.md');

    await expect(readDocument(fixtureRoot, 'something.md')).rejects.toSatisfy(
      (err: unknown) => err instanceof ContextFsError && err.code === 'invalid_utf8',
    );
  });

  it('throws ContextFsError when confinement fails, without touching the real filesystem target', async () => {
    await expect(readDocument(fixtureRoot, '../../../../etc/passwd')).rejects.toSatisfy(
      (err: unknown) => err instanceof ContextFsError && err.code === 'confinement',
    );
  });

  it('reads a valid UTF-8 document back correctly', async () => {
    await writeFile(join(fixtureRoot, 'valid.md'), '# Hello\n\nSome content.');
    const content = await readDocument(fixtureRoot, 'valid.md');
    expect(content).toBe('# Hello\n\nSome content.');
  });
});

describe('writeDocument', () => {
  it('writes a confined document (AC-24)', async () => {
    await writeFile(join(fixtureRoot, 'editable.md'), '# before');

    await writeDocument(fixtureRoot, 'editable.md', '# after');

    expect(await readDocument(fixtureRoot, 'editable.md')).toBe('# after');
  });

  it('rejects a write that escapes the clone root (AC-37)', async () => {
    await expect(writeDocument(fixtureRoot, '../../../../tmp/evil.md', 'pwned')).rejects.toSatisfy(
      (err: unknown) => err instanceof ContextFsError && err.code === 'confinement',
    );
  });
});
