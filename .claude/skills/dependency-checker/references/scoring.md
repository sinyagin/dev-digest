# Scoring: categories, signals, priorities

How to turn `deps.json` into a prioritized recommendation list. Every
recommendation must trace back to a field in the JSON. If no field supports
a claim, don't make it.

## Dependency types (`deps[].type`)

| Type | Meaning | Ships to runtime? |
|------|---------|-------------------|
| `prod` | `dependencies` | Yes. Counts toward `sizes.prodClosure` |
| `dev` | `devDependencies` | No. Build, test, and typecheck only |
| `peer` | `peerDependencies` | Provided by the host; not walked |
| `optional` | `optionalDependencies` | Yes when installed; failures are tolerated |

## Categories (`deps[].category`)

The script assigns them from name patterns. You may re-label a dep that came
out as `other` if its purpose is obvious (e.g. `simple-git` is git
tooling, `graphology` is graph analysis). Say so in the Notes column.

`framework` · `http` · `db` · `llm-sdk` · `validation` · `ui` · `build` ·
`test` · `lint` · `types` · `cli-tool` · `other`

## Size fields

- `ownSize`: the package's own files on disk (apparent size, no nested `node_modules`).
- `closureSize`: own size plus every transitive runtime dependency, each
  counted once. This is the number that answers "what does adding X cost".
- `transitiveCount`: number of packages pulled in by X.
- `sizes.prodClosure`: everything reachable from `dependencies`.
- `sizes.devOnly`: what dev deps add on top of the prod closure.
- `sizes.nodeModules`: the full install on disk (pnpm: includes the `.pnpm` virtual store).

Disk size is **not** bundle size. For `client`, Next.js tree-shakes and
splits code, so a 115 MB `mermaid` closure does not mean 115 MB of JS
shipped to the browser. Frame client sizes as "install/CI cost" and, at
most, "bundle-size suspect".

## Usage signals (`deps[].usedVia`)

Strongest to weakest:
1. `import`: a static or dynamic import or a `require` in source. Used.
2. `types-for:<x>`: an `@types/*` package whose target is used. Used.
3. `script-bin:<bin>`: its binary appears in `package.json` scripts. Used.
4. `config-file:<path>`: a `<name>.config.*` or `.<name>rc` file exists. Used.
5. `string-literal:<file>`: the name appears as a quoted string (config keys,
   transport targets). Probably used. Confirm by reading that line.
6. `null` with note `possibly-unused`: no signal at all. **Verify with
   Grep before reporting.** It may be a peer that a sibling dep needs (e.g.
   `testcontainers` for `@testcontainers/postgresql`), or loaded through a
   variable path.

## Online fields (`packages[].online`, only with `--online`)

- `audit.findings[]` are deduped advisories. `exposure` is `prod` when any
  prod or optional dep's closure contains the vulnerable module, `dev` when
  only dev deps do, and `unknown` when the package isn't installed.
  `introducedBy` lists those declared deps. The fix is usually to bump
  *them*, not the transitive module.
- `audit.prodHighCritical` is the count to headline.
- `outdated[].majorBehind` is true when the major (or the `0.x` minor) differs from latest.

Exposure `prod` in `client` means the module is reachable from `next`'s
build toolchain (e.g. `postcss`, `sharp`). It is not necessarily shipped
to browsers. Say so instead of overstating.

## Priority rubric

Pick the **highest** priority whose condition holds.

### P0 Critical: fix before the next release
- `online.audit.findings[]` with `exposure: prod` and severity `high` or `critical`.
  Group these by `introducedBy` into one row per upgrade (e.g. "bump `next` to ≥15.5.24").
- `vendoredCopies[].inSync === false`: two copies of a shared contract have
  diverged, so client and server may disagree on the wire format.
- `versionDrift[].sharedContractRisk === true`: a major-version mismatch
  between packages that share code through a path alias (e.g. different
  `zod` majors on either side of `@devdigest/shared`).
- Package flag `missing-lockfile`: installs are not reproducible.

### P1 High: fix this sprint
- `possibly-unused` on a **prod** dep, confirmed by your Grep.
- Note `dev-tool-in-prod`: `@types/*`, a test, lint, or build tool listed in `dependencies`.
- Note `deprecated`.
- `online.outdated[].majorBehind` on a **prod** dep.
- `online.audit` finding with `exposure: prod` and severity `moderate`, or `exposure: dev` and severity `high`/`critical`.
- Note `declared-not-installed`: the lockfile and `node_modules` are out of sync.

### P2 Medium: plan it
- `possibly-unused` on a **dev** dep, confirmed.
- Note `dominates-prod-closure` (one dep is more than 25% of a package's prod
  closure). Recommend this only when a lighter alternative or lazy-loading
  realistically exists. Otherwise list the dep under Size breakdown and
  give no recommendation.
- `versionDrift` without `majorMismatch` on runtime deps (minor/patch skew).
- `duplicates` with `likelyHardlinked === false` and `wastedBytes` over 10 MB.
- Package flag `not-installed`: the package can't be measured.

### P3 Low: nice to have
- Patch or minor drift on tooling (`typescript`, `tsx`, `@types/node`).
- Note `unpinned-range`.
- `online.outdated` minor or patch updates.
- `duplicates` with `likelyHardlinked === true` (pnpm store: no real disk
  cost; mention only for consistency).

## Recommendation record

Every recommendation is one table row with all of these fields:

| Field | Rule |
|-------|------|
| ID | `DEP-01`, `DEP-02`, … in priority order |
| Priority | P0–P3 from the rubric above |
| Package | `server`, `client`, …, or `repo` for cross-package |
| Finding | One line saying what is wrong |
| Evidence | The numbers or fields from the JSON (`closure 21.4 MB, 25% of prod`) |
| Action | A concrete command or edit (`pnpm -C server remove @fastify/autoload`) |
| Effort | S (<30 min) · M (<½ day) · L (more) |
| Risk | What could break, or "none" |

Use the package's own manager in commands: `pnpm -C <pkg> …` for pnpm,
`npm --prefix <pkg> …` for npm. Never run them. They are advice only.
