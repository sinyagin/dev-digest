import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RunnerError } from './errors.js';

/**
 * Loads the checked-in `.devdigest/skills/<slug>.md` bodies referenced by the
 * manifest's `skills` slugs, in order. These are RESOLVED skill bodies (not
 * slugs) — `reviewPullRequest` (reviewer-core) takes strings, exactly like the
 * studio resolves slugs to DB rows before calling the same engine (AC-36
 * parity: both callers hand the engine already-resolved bodies).
 *
 * Slugs come from a repo file, so anything that could escape
 * `.devdigest/skills/` (path separators, `..`) is refused before any read.
 */
const SKILL_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function loadSkillBodies(
  devdigestDir: string,
  slugs: readonly string[],
  readFile: typeof readFileSync = readFileSync,
): string[] {
  return slugs.map((slug) => {
    if (!SKILL_SLUG_RE.test(slug) || slug.includes('..')) {
      throw new RunnerError(`Invalid skill slug in manifest: '${slug}'`);
    }
    const skillPath = path.join(devdigestDir, 'skills', `${slug}.md`);
    try {
      return readFile(skillPath, 'utf8') as unknown as string;
    } catch (err) {
      throw new RunnerError(
        `Skill file for slug '${slug}' not found at ${skillPath}: ${(err as Error).message}`,
      );
    }
  });
}
