import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CiFile } from '@devdigest/shared';
import {
  MEMORY_PATH,
  RUNNER_DIR,
  WORKFLOW_PATH,
  manifestPath,
  skillPath,
} from './constants.js';
import { runnerBundleMissing } from './errors.js';

/**
 * Assembles the repository bundle. The only I/O is reading the pre-built runner
 * directory (`agent-runner/dist`), copied flat under `.devdigest/runner/`.
 */

export interface RunnerFile {
  /** File name inside the dist directory (flat; never user input). */
  name: string;
  size: number;
}

/** The configured dir (`AppConfig.runnerDistDir`), else `<repo root>/agent-runner/dist`. */
export function runnerDistDir(configured?: string): string {
  if (configured) return resolve(configured);
  // src/modules/ci (or dist/modules/ci) -> ci, modules, src|dist, server, repo root.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../../agent-runner/dist');
}

/** Regular, non-hidden files of the dist dir. Missing / empty / no `index.js` => typed error. */
export async function listRunnerFiles(dir: string = runnerDistDir()): Promise<RunnerFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw runnerBundleMissing();
  }
  const files: RunnerFile[] = [];
  for (const name of entries.sort()) {
    if (name.startsWith('.')) continue;
    const s = await stat(join(dir, name));
    if (s.isFile()) files.push({ name, size: s.size });
  }
  if (!files.some((f) => f.name === 'index.js')) throw runnerBundleMissing();
  return files;
}

/** Read one runner file by NAME taken from `listRunnerFiles` (never a caller-supplied path). */
export async function readRunnerFile(name: string, dir: string = runnerDistDir()): Promise<string> {
  return readFile(join(dir, name), 'utf8');
}

export interface BundleInput {
  slug: string;
  manifestYaml: string;
  skills: { slug: string; body: string }[];
  memoryJsonl: string;
  workflow: string;
}

const size = (s: string): number => Buffer.byteLength(s, 'utf8');

/**
 * The full file list in a stable order. `runnerContents: false` (preview) leaves
 * runner `contents` null — they are fetched per file on demand (AC-7).
 */
export async function assembleBundle(
  input: BundleInput,
  opts: { runnerContents: boolean; runnerDir?: string },
): Promise<CiFile[]> {
  const dir = runnerDistDir(opts.runnerDir);
  const runner = await listRunnerFiles(dir);
  const files: CiFile[] = [
    {
      path: manifestPath(input.slug),
      contents: input.manifestYaml,
      editable: false,
      size_bytes: size(input.manifestYaml),
    },
    ...input.skills.map((s) => ({
      path: skillPath(s.slug),
      contents: s.body,
      editable: false,
      size_bytes: size(s.body),
    })),
    {
      path: MEMORY_PATH,
      contents: input.memoryJsonl,
      editable: false,
      size_bytes: size(input.memoryJsonl),
    },
  ];
  for (const f of runner) {
    files.push({
      path: `${RUNNER_DIR}/${f.name}`,
      contents: opts.runnerContents ? await readRunnerFile(f.name, dir) : null,
      editable: false,
      size_bytes: f.size,
    });
  }
  files.push({
    path: WORKFLOW_PATH,
    contents: input.workflow,
    editable: true,
    size_bytes: size(input.workflow),
  });
  return files;
}
