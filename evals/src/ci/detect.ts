/**
 * CI change detector for the harness evals — pure logic, no fs. `detect-cli.ts` wires it to the
 * real filesystem and GitHub Actions outputs; `detect.test.ts` drives it with a stub probe.
 *
 *   .claude/skills/<n>/**  OR  evals/skills/<n>/**   → skill <n>   (content tier)
 *   .claude/agents/<n>.md  OR  evals/agents/<n>/**   → agent <n>   (tool tier)
 *   any CLAUDE.md, an agent, .claude/settings.json, a skill the workflow cases rely on,
 *   evals/workflow/**, the engine                    → workflow tier
 *   an engine change                                 → every skill/agent that has evals (smoke)
 *
 * A touched artifact that can't run is NOT a failure — it lands in `skipped` with a reason, so the
 * job prints a visible "SKIP" line and stays green:
 *   - "no evals"         nothing under evals/<tier>/<n>/*.eval.ts
 *   - "artifact missing" evals exist but .claude/<tier>/<n> doesn't (e.g. a deleted skill, or an
 *                        A/B variant like architecture-reviewer-lite that only exists locally)
 */

export type Tier = "skill" | "agent";

/** Filesystem lookups the detector needs — injected so the logic stays testable. */
export interface Probe {
  /** Does evals/<tier>s/<name>/ contain at least one *.eval.ts? */
  hasEvals(tier: Tier, name: string): boolean;
  /** Does .claude/skills/<name>/SKILL.md or .claude/agents/<name>.md exist? */
  artifactExists(tier: Tier, name: string): boolean;
  /** Every name with an evals/<tier>s/<name>/ folder — used for the engine-change smoke run. */
  listEvalNames(tier: Tier): string[];
  /** Skills the workflow cases assert on (`skill:` / `expectSkills`). */
  workflowSkills(): string[];
}

export interface Skip {
  tier: Tier;
  name: string;
  reason: "no evals" | "artifact missing";
}

export interface Detection {
  skills: string[];
  agents: string[];
  runWorkflow: boolean;
  skipped: Skip[];
}

const SKILL_RE = [/^\.claude\/skills\/([^/]+)\//, /^evals\/skills\/([^/]+)\//];
const AGENT_RE = [/^\.claude\/agents\/([^/]+)\.md$/, /^evals\/agents\/([^/]+)\//];

/** Changes to the eval engine itself — re-run everything that has evals. */
const ENGINE_RE = [
  /^evals\/src\//,
  /^evals\/package\.json$/,
  /^evals\/pnpm-lock\.yaml$/,
  /^evals\/vitest\.config\.ts$/,
  /^evals\/proxy\//,
  /^\.github\/workflows\/evals\.yml$/,
];

/** Runtime clone data is git-ignored, but guard anyway: a cloned repo's CLAUDE.md is not ours. */
const IGNORED_RE = /^server\/clones\//;

/** `.claude/agents/README.md` documents the folder; it is not an agent. */
const NOT_ARTIFACT = "README";

function collect(files: string[], res: RegExp[]): string[] {
  const names = new Set<string>();
  for (const f of files) {
    for (const re of res) {
      const m = f.match(re);
      if (m && m[1] !== NOT_ARTIFACT) names.add(m[1]);
    }
  }
  return [...names].sort();
}

export function detect(changedFiles: string[], probe: Probe, opts: { all?: boolean } = {}): Detection {
  const changed = changedFiles.map((f) => f.trim()).filter((f) => f && !IGNORED_RE.test(f));
  const engineChanged = opts.all || changed.some((f) => ENGINE_RE.some((re) => re.test(f)));

  const changedSkills = collect(changed, SKILL_RE);
  const changedAgents = collect(changed, AGENT_RE);

  const skipped: Skip[] = [];
  const select = (tier: Tier, touched: string[]): string[] => {
    const names = new Set(touched);
    if (engineChanged) for (const n of probe.listEvalNames(tier)) names.add(n);
    const run: string[] = [];
    for (const name of [...names].sort()) {
      if (!probe.hasEvals(tier, name)) skipped.push({ tier, name, reason: "no evals" });
      else if (!probe.artifactExists(tier, name)) skipped.push({ tier, name, reason: "artifact missing" });
      else run.push(name);
    }
    return run;
  };

  const skills = select("skill", changedSkills);
  const agents = select("agent", changedAgents);

  const workflowSkills = new Set(probe.workflowSkills());
  const runWorkflow =
    engineChanged ||
    changed.some(
      (f) =>
        f === "CLAUDE.md" ||
        f.endsWith("/CLAUDE.md") ||
        (/^\.claude\/agents\/.+\.md$/.test(f) && f !== ".claude/agents/README.md") ||
        f === ".claude/settings.json" ||
        /^evals\/workflow\//.test(f),
    ) ||
    changedSkills.some((s) => workflowSkills.has(s));

  return { skills, agents, runWorkflow, skipped };
}

/** Pull skill names out of workflow case source (`skill: "x"`, `expectSkills: ["x", "y"]`). */
export function parseWorkflowSkills(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/\bskill:\s*["']([^"']+)["']/g)) names.add(m[1]);
  for (const m of source.matchAll(/\bexpectSkills:\s*\[([^\]]*)\]/g)) {
    for (const s of m[1].matchAll(/["']([^"']+)["']/g)) names.add(s[1]);
  }
  return [...names].sort();
}
