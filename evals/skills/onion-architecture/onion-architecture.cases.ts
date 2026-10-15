import { fixtureReader, type SkillCase } from "../../src/index.js";

// Quality cases run with no tools (skillTask measures the SKILL.md content in isolation), so each
// prompt inlines a whole fixture module. bookmarks/digests/notifications are ported from the
// skill-creator answer key at .claude/skills/onion-architecture/evals/ — each has three planted
// layering violations and no comments pointing at them. `tags` is a correctly layered control
// module: it measures over-flagging, the cost a "flag everything" reviewer would hide.

const fx = fixtureReader(import.meta.url);

function modulePrompt(name: string, files: string[], ask: string): string {
  const code = files
    .map((f) => `// server/src/modules/${name}/${f}\n\`\`\`ts\n${fx(`${name}/${f}`)}\`\`\``)
    .join("\n\n");
  return `${ask}

Here are the module's files — treat them as already read, and answer directly from them (do not ask for tool access or more files).

${code}`;
}

export const cases: SkillCase[] = [
  {
    name: "bookmarks: flags route→DB and service→Fastify as CRITICAL, business rules in the repository",
    kind: "quality",
    prompt: modulePrompt(
      "bookmarks",
      ["routes.ts", "service.ts", "repository.ts", "helpers.ts"],
      "I just wrote a bookmarks module for the server — it's at server/src/modules/bookmarks/. Before I register it in modules/index.ts, review it and tell me what's structurally wrong with it and how to fix it.",
    ),
    // The skill's own severity vocabulary — a cheap gate before paying the judge.
    grounding: ["CRITICAL"],
    practices: [
      "flags routes.ts importing drizzle-orm / db/schema.js and querying container.db directly in the GET /bookmarks handler",
      "rates the route-queries-the-DB issue as CRITICAL",
      "flags service.ts importing FastifyRequest / taking the raw request (req.body, getContext(req)) in create()",
      "rates the service-depends-on-Fastify issue as CRITICAL",
      "flags repository.ts holding business rules (the 200-bookmark cap and/or the duplicate-bookmark ConflictError) that belong in the service",
      "proposes moving the list query out of the route into service + repository methods (e.g. service.list → repo.list)",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
  {
    name: "digests: flags inline adapter, cross-module repository import, raw Drizzle row leak",
    kind: "quality",
    prompt: modulePrompt(
      "digests",
      ["routes.ts", "service.ts", "repository.ts"],
      "Here's a new digests module at server/src/modules/digests/. It works locally but my teammate says it'll be painful to test and maintain. Review it and list the issues.",
    ),
    practices: [
      "flags the inline `new OctokitGitHubClient(token)` in service.ts and says to obtain it from the container (container.github()) instead",
      "flags service.ts importing another module's repository file (reviews/repository/review.repo.js) directly",
      "recommends going through the shared container repository (container.reviewRepo) for the cross-module read",
      "flags that a raw Drizzle DigestRow is returned through the service/route to the HTTP client without mapping to a DTO",
      "recommends a row→DTO mapper (e.g. toDigestDto in helpers.ts) and/or a @devdigest/shared contract for the response",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
  {
    name: "notifications: flags DTOs in the repository, service bypassing it, mixed aggregates",
    kind: "quality",
    prompt: modulePrompt(
      "notifications",
      ["routes.ts", "service.ts", "repository.ts"],
      "Review server/src/modules/notifications/ — does the code put things in the right places? List every problem you find.",
    ),
    practices: [
      "flags repository.ts importing @devdigest/shared DTO types and mapping rows to DTOs inside the repository",
      "recommends moving the row→DTO mapping into helpers.ts / the service",
      "flags service.ts markRead calling container.db.update(...) directly / importing drizzle-orm + db/schema, bypassing the repository",
      "flags repository.ts mixing two aggregates (notifications and notification preferences) and suggests splitting into per-entity repo files",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
  {
    name: "tags (correctly layered): does not fabricate layering violations",
    kind: "quality",
    prompt: modulePrompt(
      "tags",
      ["routes.ts", "service.ts", "repository.ts", "helpers.ts"],
      "Review server/src/modules/tags/ against our backend layering rules before I register it. Is anything in the wrong layer?",
    ),
    practices: [
      "does not report any CRITICAL or HIGH layering violation for this module — it does not invent a route→DB, service→Fastify, inline-adapter or DTO-leak finding that isn't in the code",
      "explicitly concludes the module respects the routes → service → repository layering (routes only call the service, the service holds the business rules, the repository is Drizzle-only)",
      "any remarks it does make are framed as optional / MEDIUM-or-lower suggestions, not as required fixes blocking registration",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
];
