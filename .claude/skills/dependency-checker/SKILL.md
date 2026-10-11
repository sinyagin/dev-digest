---
name: dependency-checker
version: 1.0.0
description: "Audits the npm dependencies of every DevDigest package
  (server, client, reviewer-core, e2e, mcp-server, evals): draws a Mermaid
  map of internal path-alias edges and external deps, measures each dep by
  type, category, own size, and transitive closure size, detects unused
  deps, version drift, duplicate installs, and diverged vendored copies of
  @devdigest/shared, then ends with a P0–P3 prioritized action list. Writes
  a structured report to reports/dependencies/<date>.md. Use for a
  dependency audit, a question like 'what does X pull in' or 'why is
  node_modules so big', unused or outdated packages, version mismatches
  between packages, a dependency diagram, or before adding or upgrading a
  dependency. Offline by default; it adds outdated and vulnerability checks
  only when the user asks to go online."
---

# Dependency Checker

Produces a dependency report for this repo that a developer can act on.
**The numbers come from a script; the judgment comes from you.** Never guess
a size, version, or count. Every number in the report must come from
`deps.json`.

Files in this skill:
- [scripts/collect-deps.mjs](scripts/collect-deps.mjs): a zero-dependency
  collector that emits one JSON document.
- [references/scoring.md](references/scoring.md): field meanings, usage
  signals, the P0–P3 rubric, and the recommendation format.
- [references/report-template.md](references/report-template.md): the exact
  report skeleton.

**See also:** [mermaid-diagram](../mermaid-diagram/SKILL.md) (diagram
syntax rules) · [security](../security/SKILL.md) (when the audit finds
vulnerabilities) · [typescript-expert](../typescript-expert/SKILL.md)
(path-alias and tsconfig questions).

## Repo facts the report must reflect

- This is **not** a workspace. Each package has its own `package.json`
  and lockfile: pnpm for `server`, `client`, `mcp-server`, and `evals`;
  npm for `reviewer-core` and `e2e`. Commands in recommendations must use
  the right manager per package.
- Code is shared through **tsconfig `paths`**, not npm:
  `server → @devdigest/reviewer-core`, `reviewer-core`/`mcp-server →
  server/src/vendor/shared`. `client` has its **own vendored copy** of
  `@devdigest/shared`, and those two copies must stay identical.
- `reviewer-core` pins `zod` through a path alias to its own
  `node_modules`. The script reports this as a `pins-external` edge.
- Never touch `server/clones/**` (runtime data). The script already skips it.

## Workflow

### 1. Collect

```bash
node .claude/skills/dependency-checker/scripts/collect-deps.mjs > <scratchpad>/deps.json
# add --online ONLY if the user asked for outdated/vulnerability checks
# (it runs `pnpm|npm outdated` and `audit` per package; needs network)
```

The run takes about 2 s offline, or about 15 s online. If it fails, show the error and stop. Do not
hand-estimate numbers instead.

### 2. Sanity-check the data
- A package with flag `not-installed` has `null` sizes. Report it as
  "not measured — run `npm --prefix <pkg> install`". Never fill in numbers.
- Scope the questions: "why is client so big" only needs §3, §4 (client),
  and §6, with recommendations limited to `client`. A full audit uses every
  section.

### 3. Verify before you accuse
For **every** dep whose notes include `possibly-unused`, and every
`string-literal` hit, run a targeted Grep for its name in that package
(excluding `node_modules`). Then classify it:
- **Confirmed unused**: no reference anywhere. Recommend removal.
- **Indirect**: the dep is a peer of another dep, or is loaded via a
  variable or a config. Keep it, and explain in the Notes column.

For every `vendoredCopies[].inSync === false`, run `diff` on one or two of
the `differingFiles` and summarize the drift in one line (e.g. "server has
`openrouter` provider, client doesn't").

### 4. Score
Apply [references/scoring.md](references/scoring.md) to produce the
recommendation list (ID, priority, package, finding, evidence, action,
effort, risk). One finding per row. Merge identical findings across
packages into a single `repo` row.

### 5. Write the report
Fill [references/report-template.md](references/report-template.md)
exactly. Diagram rules:
- One `subgraph` per package, titled with its prod-closure size.
- Internal path-alias edges are solid and labeled with the alias.
- For external deps, show the **top 5 prod deps per package by closure**,
  plus any dep in `versionDrift`. A dep shared by several packages is drawn
  once, with an edge from each consumer.
- `classDef drift` (red) for drift and out-of-sync vendored copies;
  `classDef heavy` (amber) for `dominates-prod-closure`.
- Keep it to 40 nodes or fewer. Quote labels that contain `@`, `/`, or spaces.

Save to `reports/dependencies/<YYYY-MM-DD>.md` (create the directory). If
that file exists, append `-2`, `-3`. Committing the report is the user's
call.

### 6. Reply in chat
Keep it short. Do not paste the whole report:
1. The file path.
2. The TL;DR bullets and the finding counts per priority.
3. A table of the P0 and P1 recommendations (ID, package, finding, action).
4. One line on what was **not** checked (offline mode, uninstalled packages).

## Rules
- **Read-only.** Never run `install`, `add`, `remove`, `update`, or
  `audit fix`. Recommendations are commands for the developer to run.
- Use the package's own manager in every suggested command.
- Disk size is not bundle size. Say so for `client` (see scoring.md).
- Don't recommend replacing a framework (`next`, `fastify`, `drizzle-orm`)
  only because it is heavy. That is not actionable.
- When the JSON has no data for a claim, leave the claim out.

<!-- ci evals smoke test — throwaway, do not merge -->
