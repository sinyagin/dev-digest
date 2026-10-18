import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { RunnerError } from './errors.js';

/**
 * Loads and VALIDATES the checked-in `.devdigest/agents/<slug>.yaml` manifest
 * (AC-30). The manifest is written by the studio's export flow
 * (`server/src/modules/ci/manifest.ts`) and is otherwise untrusted on-disk
 * content by the time it reaches CI — it is schema-validated with the same
 * `AgentManifest` Zod contract before any of its fields (system prompt, model,
 * ci_fail_on) are used to build a review. Fail clearly (a descriptive
 * `RunnerError`) rather than silently defaulting or partially trusting it.
 *
 * A repo can hold several exported agents side by side; the workflow names the
 * one to run via `DEVDIGEST_AGENT=<slug>`, so the file is addressed by slug,
 * never discovered by listing the directory.
 */

export type { AgentManifest } from '@devdigest/shared';

export interface FsDeps {
  readFile?: typeof readFileSync;
}

export interface LoadedManifest {
  manifest: AgentManifest;
  /** SHA-256 (hex) of the manifest file's exact bytes — recorded in the artifact. */
  sha256: string;
}

/** `<devdigestDir>/agents/<slug>.yaml`. */
export function manifestPathFor(devdigestDir: string, slug: string): string {
  return path.join(devdigestDir, 'agents', `${slug}.yaml`);
}

/** Read, parse, and Zod-validate the manifest at `manifestPath` (AC-30). */
export function loadAgentManifest(manifestPath: string, deps: FsDeps = {}): LoadedManifest {
  const readFile = deps.readFile ?? readFileSync;
  let raw: string;
  try {
    raw = readFile(manifestPath, 'utf8') as unknown as string;
  } catch (err) {
    throw new RunnerError(
      `Cannot read agent manifest at ${manifestPath}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new RunnerError(
      `Agent manifest at ${manifestPath} is not valid YAML: ${(err as Error).message}`,
    );
  }

  const result = AgentManifest.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new RunnerError(`Agent manifest at ${manifestPath} failed validation: ${issues}`);
  }
  return { manifest: result.data, sha256: createHash('sha256').update(raw).digest('hex') };
}

/** Convenience: load + validate the manifest for `slug`, and check it is that agent's. */
export function loadManifest(devdigestDir: string, slug: string, deps: FsDeps = {}): LoadedManifest {
  const manifestPath = manifestPathFor(devdigestDir, slug);
  const loaded = loadAgentManifest(manifestPath, deps);
  if (loaded.manifest.slug !== slug) {
    throw new RunnerError(
      `Agent manifest at ${manifestPath} declares slug '${loaded.manifest.slug}', expected '${slug}'`,
    );
  }
  return loaded;
}
