/**
 * Change-detector rules on a stub filesystem — no model, no disk.
 *   pnpm vitest run src/ci/detect.test.ts
 */

import { describe, expect, test } from "vitest";
import { detect, parseWorkflowSkills, type Probe } from "./detect.js";

// Mirrors the repo shape: dependency-checker has evals; zod doesn't; architecture-reviewer-lite
// has evals but no .claude/agents file.
const probe: Probe = {
  hasEvals: (tier, n) =>
    tier === "skill" ? n === "dependency-checker" : ["architecture-reviewer", "architecture-reviewer-lite"].includes(n),
  artifactExists: (tier, n) => (tier === "skill" ? n !== "deleted-skill" : n !== "architecture-reviewer-lite"),
  listEvalNames: (tier) =>
    tier === "skill" ? ["dependency-checker"] : ["architecture-reviewer", "architecture-reviewer-lite"],
  workflowSkills: () => ["engineering-insights"],
};

describe("skills", () => {
  test("changed skill with evals runs; via .claude or evals/ path", () => {
    expect(detect([".claude/skills/dependency-checker/SKILL.md"], probe).skills).toEqual(["dependency-checker"]);
    expect(detect(["evals/skills/dependency-checker/dependency-checker.cases.ts"], probe).skills).toEqual([
      "dependency-checker",
    ]);
  });

  test("changed skill without evals is skipped, not run", () => {
    const d = detect([".claude/skills/zod/SKILL.md"], probe);
    expect(d.skills).toEqual([]);
    expect(d.skipped).toEqual([{ tier: "skill", name: "zod", reason: "no evals" }]);
    expect(d.runWorkflow).toBe(false);
  });

  test("a skill the workflow cases rely on also triggers the workflow tier", () => {
    const d = detect([".claude/skills/engineering-insights/SKILL.md"], probe);
    expect(d.runWorkflow).toBe(true);
    expect(d.skipped).toEqual([{ tier: "skill", name: "engineering-insights", reason: "no evals" }]);
  });
});

describe("agents", () => {
  test("changed agent with evals runs and triggers workflow", () => {
    const d = detect([".claude/agents/architecture-reviewer.md"], probe);
    expect(d.agents).toEqual(["architecture-reviewer"]);
    expect(d.runWorkflow).toBe(true);
  });

  test("agent without evals is skipped but still triggers workflow", () => {
    const d = detect([".claude/agents/security-reviewer.md"], probe);
    expect(d.agents).toEqual([]);
    expect(d.skipped).toEqual([{ tier: "agent", name: "security-reviewer", reason: "no evals" }]);
    expect(d.runWorkflow).toBe(true);
  });

  test("evals whose artifact is missing are skipped, not crashed", () => {
    const d = detect(["evals/agents/architecture-reviewer-lite/architecture-reviewer-lite.eval.ts"], probe);
    expect(d.agents).toEqual([]);
    expect(d.skipped).toEqual([{ tier: "agent", name: "architecture-reviewer-lite", reason: "artifact missing" }]);
  });

  test(".claude/agents/README.md is not an agent and triggers nothing", () => {
    const d = detect([".claude/agents/README.md"], probe);
    expect(d).toMatchObject({ agents: [], skipped: [], runWorkflow: false });
  });
});

describe("workflow tier", () => {
  test.each(["CLAUDE.md", "client/CLAUDE.md", "server/CLAUDE.md", ".claude/settings.json", "evals/workflow/x.cases.ts"])(
    "%s triggers it",
    (f) => expect(detect([f], probe).runWorkflow).toBe(true),
  );

  test("server/clones/** is ignored", () => {
    expect(detect(["server/clones/acme/repo/CLAUDE.md"], probe).runWorkflow).toBe(false);
  });

  test("unrelated changes trigger nothing", () => {
    const d = detect(["server/src/app.ts", "client/src/page.tsx", ""], probe);
    expect(d).toEqual({ skills: [], agents: [], runWorkflow: false, skipped: [] });
  });
});

describe("engine change / run_all", () => {
  test("evals/src change smoke-runs everything runnable, skipping the rest", () => {
    const d = detect(["evals/src/config.ts"], probe);
    expect(d.skills).toEqual(["dependency-checker"]);
    expect(d.agents).toEqual(["architecture-reviewer"]);
    expect(d.runWorkflow).toBe(true);
    expect(d.skipped).toEqual([{ tier: "agent", name: "architecture-reviewer-lite", reason: "artifact missing" }]);
  });

  test("all:true behaves like an engine change with no diff", () => {
    expect(detect([], probe, { all: true })).toMatchObject({
      skills: ["dependency-checker"],
      agents: ["architecture-reviewer"],
      runWorkflow: true,
    });
  });
});

describe("parseWorkflowSkills", () => {
  test("reads skill: and expectSkills: forms", () => {
    const src = `{ kind: "activation", skill: "engineering-insights" }, { expectSkills: ["zod", 'onion-architecture'] }`;
    expect(parseWorkflowSkills(src)).toEqual(["engineering-insights", "onion-architecture", "zod"]);
  });
});
