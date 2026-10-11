/**
 * CI entry point for the change detector (`pnpm eval:ci-detect`).
 *
 *   CHANGED_FILES=$'CLAUDE.md\n.claude/skills/zod/SKILL.md' pnpm eval:ci-detect
 *   EVAL_RUN_ALL=true pnpm eval:ci-detect        # manual run: every skill/agent + workflow
 *
 * Writes GitHub Actions step outputs to $GITHUB_OUTPUT (or stdout locally):
 *   skills / agents      JSON arrays for the job matrices
 *   run_workflow         "true" | "false"
 * and a human summary (with one "SKIP <tier>:<name> — <reason>" line per skipped artifact) to
 * stderr and $GITHUB_STEP_SUMMARY.
 */

import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_DIR, EVALS_DIR, SKILLS_DIR } from "../artifacts/paths.js";
import { detect, parseWorkflowSkills, type Probe, type Tier } from "./detect.js";

const evalsDir = (tier: Tier) => join(EVALS_DIR, `${tier}s`);

const probe: Probe = {
  hasEvals: (tier, name) => {
    const dir = join(evalsDir(tier), name);
    return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".eval.ts"));
  },
  artifactExists: (tier, name) =>
    tier === "skill" ? existsSync(join(SKILLS_DIR, name, "SKILL.md")) : existsSync(join(AGENTS_DIR, `${name}.md`)),
  listEvalNames: (tier) =>
    existsSync(evalsDir(tier))
      ? readdirSync(evalsDir(tier), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      : [],
  workflowSkills: () => {
    const dir = join(EVALS_DIR, "workflow");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".cases.ts"))
      .flatMap((f) => parseWorkflowSkills(readFileSync(join(dir, f), "utf8")));
  },
};

const changed = (process.env.CHANGED_FILES ?? "").split("\n");
const all = process.env.EVAL_RUN_ALL === "true";
const d = detect(changed, probe, { all });

const out = process.env.GITHUB_OUTPUT;
const write = (k: string, v: string) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));
write("skills", JSON.stringify(d.skills));
write("agents", JSON.stringify(d.agents));
write("run_workflow", String(d.runWorkflow));

const lines = [
  "── eval change detection ──",
  `changed files : ${changed.filter((f) => f.trim()).length}${all ? " (run_all)" : ""}`,
  `skills → run  : ${d.skills.join(", ") || "(none)"}`,
  `agents → run  : ${d.agents.join(", ") || "(none)"}`,
  `workflow tier : ${d.runWorkflow ? "run" : "skip"}`,
  ...d.skipped.map((s) => `SKIP ${s.tier}:${s.name} — ${s.reason}`),
];
console.error(lines.join("\n"));

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) appendFileSync(summary, ["### Eval change detection", "```", ...lines.slice(1), "```", ""].join("\n"));
