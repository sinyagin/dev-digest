#!/usr/bin/env node
// Dependency collector for the dependency-checker skill.
// Zero dependencies, Node >= 22. Read-only: never installs, never writes
// outside stdout. Every number in the final report must come from here.
//
// Usage: node collect-deps.mjs [--root <dir>] [--online] [--top <n>]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';

// ---------- CLI ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const ROOT = path.resolve(opt('--root', process.cwd()));
const ONLINE = flag('--online');
const TOP = Number(opt('--top', '10'));

const SKIP_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', 'out', 'coverage', 'clones',
  '.turbo', '.git', 'playwright-report', 'test-results', '.devdigest',
]);
const SRC_EXT = /\.(c|m)?(t|j)sx?$/;
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

// ---------- helpers ----------
const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};
// tsconfig allows comments + trailing commas
const readJsonc = (p) => {
  try {
    const txt = fs.readFileSync(p, 'utf8')
      .replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/.*$/gm, (m, s) => s ?? '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(txt);
  } catch { return null; }
};
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

export const human = (bytes) => {
  if (bytes == null) return null;
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
};
const major = (v) => {
  const m = /^\D*(\d+)\.(\d+)/.exec(v ?? '');
  if (!m) return null;
  // 0.x: the minor is the breaking component
  return m[1] === '0' ? `0.${m[2]}` : m[1];
};

// Size of a directory on disk (apparent size), never following symlinks.
// skipNested: exclude nested node_modules (npm layout) — those are
// counted in the closure, not in the package's own size.
const sizeCache = new Map();
function dirSize(dir, skipNested = true) {
  const key = `${dir}|${skipNested}`;
  if (sizeCache.has(key)) return sizeCache.get(key);
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (skipNested && e.name === 'node_modules') continue;
        stack.push(p);
      } else if (e.isFile()) {
        try { total += fs.lstatSync(p).size; } catch { /* ignore */ }
      }
    }
  }
  sizeCache.set(key, total);
  return total;
}

function hashDir(dir) {
  const h = crypto.createHash('sha1');
  const perFile = {};
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files.push(p);
    }
  };
  try { walk(dir); } catch { return null; }
  files.sort();
  for (const f of files) {
    const buf = fs.readFileSync(f);
    h.update(path.relative(dir, f));
    h.update(buf);
    perFile[path.relative(dir, f)] = crypto.createHash('sha1').update(buf).digest('hex');
  }
  return { hash: h.digest('hex').slice(0, 12), files: files.length, perFile };
}

// Node-style lookup: <dir>/node_modules/<name>, walking up — works for both
// pnpm (.pnpm/x@v/node_modules/<sibling>) and npm (flat / nested) layouts.
function resolvePkg(name, fromDir, stopAt) {
  let d = fromDir;
  while (true) {
    const cand = path.join(d, 'node_modules', name);
    if (exists(path.join(cand, 'package.json'))) return real(cand);
    if (d === stopAt || d === path.dirname(d)) return null;
    d = path.dirname(d);
  }
}

// Transitive closure of runtime deps (dependencies + installed optionals).
// peerDependencies are provided by the host, so not followed.
function closure(rootRealDir, stopAt) {
  const seen = new Set([rootRealDir]);
  const stack = [rootRealDir];
  while (stack.length) {
    const dir = stack.pop();
    const pj = readJson(path.join(dir, 'package.json')) ?? {};
    const names = [
      ...Object.keys(pj.dependencies ?? {}),
      ...Object.keys(pj.optionalDependencies ?? {}),
    ];
    for (const n of names) {
      const r = resolvePkg(n, dir, stopAt);
      if (r && !seen.has(r)) { seen.add(r); stack.push(r); }
    }
  }
  return seen;
}
// "<...>/node_modules/@scope/name" -> "@scope/name" (pnpm and npm layouts)
const nameFromPath = (p) => {
  const parts = p.split(path.sep);
  const i = parts.lastIndexOf('node_modules');
  return parts[i + 1]?.startsWith('@') ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1];
};
// `${pkgId}|${depName}` -> names of every package in that dep's closure.
// Used to tell which declared dep (prod or dev) drags in a vulnerable module.
const closureNames = new Map();
const sumSizes = (set) => [...set].reduce((a, d) => a + dirSize(d), 0);

// ---------- categories ----------
const CATEGORY_RULES = [
  ['types', /^@types\//],
  ['test', /^(vitest|jest|jest-.*|@vitest\/.*|@testing-library\/.*|jsdom|happy-dom|playwright|@playwright\/.*|supertest|msw|nock|agent-browser)$/],
  ['lint', /^(eslint.*|@eslint\/.*|@typescript-eslint\/.*|prettier.*|biome|@biomejs\/.*)$/],
  ['build', /^(typescript|tsx|ts-node|esbuild|vite|@vitejs\/.*|rollup|webpack|tsup|swc|@swc\/.*|postcss|tailwindcss|@tailwindcss\/.*|autoprefixer|drizzle-kit|@vercel\/ncc|turbo)$/],
  ['framework', /^(next|react|react-dom|fastify|express|koa|hono|@nestjs\/.*|next-intl)$/],
  ['http', /^(@fastify\/.*|fastify-.*|undici|axios|node-fetch|ky|got|@octokit\/.*|octokit)$/],
  ['db', /^(drizzle-orm|pg|postgres|@neondatabase\/.*|pgvector|kysely|prisma|@prisma\/.*|ioredis|redis)$/],
  ['llm-sdk', /^(@anthropic-ai\/.*|openai|@openai\/.*|ai|@ai-sdk\/.*|langchain|@langchain\/.*|@modelcontextprotocol\/.*|tiktoken|js-tiktoken)$/],
  ['validation', /^(zod|zod-.*|yup|joi|ajv|valibot|@sinclair\/typebox|fastify-type-provider-zod)$/],
  ['ui', /^(@tanstack\/react-query|lucide-react|recharts|mermaid|react-markdown|remark-.*|rehype-.*|clsx|tailwind-merge|@radix-ui\/.*|framer-motion)$/],
  ['cli-tool', /^(commander|yargs|chalk|ora|dotenv|pino.*|cross-env|concurrently)$/],
];
const categorize = (name) => CATEGORY_RULES.find(([, re]) => re.test(name))?.[0] ?? 'other';

// ---------- usage scan ----------
function listSourceFiles(pkgDir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.storybook') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
      else if (SRC_EXT.test(e.name) || e.name.endsWith('.css')) out.push(p);
    }
  };
  walk(pkgDir);
  return out;
}
const SPEC_RE = /(?:\bfrom\s+|\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?|\brequire\s*\(\s*|\bimport\s+|@import\s+|@plugin\s+|\bvi\.mock\s*\(\s*)['"]([^'"\n]+)['"]/g;
const KNOWN_BINS = { typescript: 'tsc', 'drizzle-kit': 'drizzle-kit', '@playwright/test': 'playwright' };
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pkgNameOf = (spec) => {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};
// @types/foo -> foo ; @types/scope__name -> @scope/name
const typesTarget = (name) => {
  const t = name.slice('@types/'.length);
  return t.includes('__') ? `@${t.replace('__', '/')}` : t;
};

function scanUsage(pkgDir, pkgJson, declared, aliasNames) {
  const counts = new Map(); const samples = new Map();
  let usesBuiltins = false; let hasTs = false;
  const texts = [];
  for (const f of listSourceFiles(pkgDir)) {
    if (/\.tsx?$/.test(f)) hasTs = true;
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    texts.push([f, txt]);
    for (const m of txt.matchAll(SPEC_RE)) {
      const spec = m[1];
      if (BUILTINS.has(spec) || spec.startsWith('node:')) { usesBuiltins = true; continue; }
      const n = pkgNameOf(spec);
      if (!n || aliasNames.has(spec) || aliasNames.has(n)) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
      const s = samples.get(n) ?? new Set();
      if (s.size < 3) s.add(path.relative(ROOT, f));
      samples.set(n, s);
    }
  }
  // tsconfig "types" / "extends" and package.json scripts (bin names)
  const tsconfig = readJsonc(path.join(pkgDir, 'tsconfig.json')) ?? {};
  for (const t of tsconfig.compilerOptions?.types ?? []) {
    const n = pkgNameOf(t); if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const scripts = Object.values(pkgJson.scripts ?? {}).join('\n');
  const scriptHits = new Map();
  for (const d of declared) {
    const depPj = readJson(path.join(pkgDir, 'node_modules', d.name, 'package.json'));
    const bins = typeof depPj?.bin === 'string' ? [depPj.name.split('/').pop()]
      : Object.keys(depPj?.bin ?? {});
    for (const b of bins) {
      if (new RegExp(`(^|[\\s;&|"'(])${escapeRe(b)}(\\s|$|["')])`, 'm').test(scripts)) {
        scriptHits.set(d.name, [...(scriptHits.get(d.name) ?? []), b]);
      }
    }
  }
  // Weaker signal: the package name as a quoted string anywhere in source
  // (config keys like 'jsdom', '@tailwindcss/postcss', pino transport targets).
  const stringHits = new Map();
  for (const d of declared) {
    if (counts.has(d.name)) continue;
    const re = new RegExp(`['"\`]${escapeRe(d.name)}(/[^'"\`]*)?['"\`]`);
    const hit = texts.find(([, t]) => re.test(t));
    if (hit) stringHits.set(d.name, path.relative(ROOT, hit[0]));
    // not installed -> no bin metadata; fall back to the name as a word in scripts
    const bin = KNOWN_BINS[d.name] ?? d.name;
    if (!scriptHits.has(d.name) && new RegExp(`(^|[\\s;&|])${escapeRe(bin)}(\\s|$)`, 'm').test(scripts)) {
      scriptHits.set(d.name, [bin]);
    }
  }
  return { counts, samples, scriptHits, stringHits, usesBuiltins, hasTs };
}

// ---------- discovery ----------
function discoverPackages() {
  const pkgs = [];
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const dir = path.join(ROOT, e.name);
    if (exists(path.join(dir, 'package.json'))) pkgs.push(dir);
  }
  if (exists(path.join(ROOT, 'package.json'))) pkgs.unshift(ROOT);
  return pkgs;
}

const ownerOf = (absPath, pkgDirs) =>
  pkgDirs.filter((d) => absPath === d || absPath.startsWith(d + path.sep))
    .sort((a, b) => b.length - a.length)[0] ?? null;

// ---------- per package ----------
function analyzePackage(dir, pkgDirs) {
  const pj = readJson(path.join(dir, 'package.json'));
  const id = path.relative(ROOT, dir) || '.';
  const manager = exists(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm'
    : exists(path.join(dir, 'package-lock.json')) ? 'npm'
    : exists(path.join(dir, 'yarn.lock')) ? 'yarn' : null;
  const nmDir = path.join(dir, 'node_modules');
  const installed = exists(nmDir);
  const flags = [];
  if (!manager) flags.push('missing-lockfile');
  if (!installed) flags.push('not-installed');

  // tsconfig path aliases -> internal edges
  const tsconfig = readJsonc(path.join(dir, 'tsconfig.json')) ?? {};
  const baseUrl = path.resolve(dir, tsconfig.compilerOptions?.baseUrl ?? '.');
  const aliases = [];
  for (const [alias, targets] of Object.entries(tsconfig.compilerOptions?.paths ?? {})) {
    if (alias.endsWith('/*')) continue; // the bare alias already carries the edge
    const target = path.resolve(baseUrl, targets[0].replace(/\/\*$/, ''));
    const intoNodeModules = target.split(path.sep).includes('node_modules');
    const owner = ownerOf(target, pkgDirs);
    aliases.push({
      alias,
      target: path.relative(ROOT, target),
      owner: owner ? (path.relative(ROOT, owner) || '.') : null,
      kind: intoNodeModules ? 'pins-external' : owner === dir ? 'vendored-self' : 'cross-package',
    });
  }
  const aliasNames = new Set(aliases.filter((a) => a.kind !== 'pins-external').map((a) => a.alias));

  const declared = [];
  for (const [field, type] of [
    ['dependencies', 'prod'], ['devDependencies', 'dev'],
    ['peerDependencies', 'peer'], ['optionalDependencies', 'optional'],
  ]) {
    for (const [name, range] of Object.entries(pj[field] ?? {})) declared.push({ name, range, type });
  }

  const usage = scanUsage(dir, pj, declared, aliasNames);
  const stopAt = dir;
  const prodSet = new Set(); const allSet = new Set();
  const deps = declared.map((d) => {
    const realDir = installed ? real(path.join(nmDir, d.name)) : null;
    const depPj = realDir ? readJson(path.join(realDir, 'package.json')) : null;
    let ownSize = null; let closureSize = null; let transitiveCount = null;
    if (realDir) {
      const c = closure(realDir, stopAt);
      closureNames.set(`${id}|${d.name}`, new Set([...c].map(nameFromPath)));
      ownSize = dirSize(realDir);
      closureSize = sumSizes(c);
      transitiveCount = c.size - 1;
      for (const x of c) { allSet.add(x); if (d.type === 'prod') prodSet.add(x); }
    }
    let importCount = usage.counts.get(d.name) ?? 0;
    let usedVia = importCount ? 'import' : null;
    if (!importCount && d.name.startsWith('@types/')) {
      const t = typesTarget(d.name);
      if (t === 'node' ? usage.usesBuiltins || usage.hasTs : usage.counts.get(t)) usedVia = `types-for:${t}`;
    }
    if (!usedVia && usage.scriptHits.has(d.name)) usedVia = `script-bin:${usage.scriptHits.get(d.name).join(',')}`;
    if (!usedVia) {
      const base = d.name.replace(/^@[^/]+\//, '');
      const cfg = fs.readdirSync(dir).find((f) => f.startsWith(`${base}.config.`) || f === `.${base}rc` || f.startsWith(`.${base}rc.`));
      if (cfg) usedVia = `config-file:${path.join(id, cfg)}`;
    }
    if (!usedVia && usage.stringHits.has(d.name)) usedVia = `string-literal:${usage.stringHits.get(d.name)}`;
    const category = categorize(d.name);
    const notes = [];
    if (d.type === 'prod' && ['types', 'test', 'lint', 'build'].includes(category)) notes.push('dev-tool-in-prod');
    if (/^(\*|latest|x)$/.test(d.range)) notes.push('unpinned-range');
    if (installed && !realDir && d.type !== 'peer' && d.type !== 'optional') notes.push('declared-not-installed');
    if (!usedVia && d.type !== 'peer') notes.push('possibly-unused');
    if (depPj?.deprecated) notes.push('deprecated');
    return {
      name: d.name, type: d.type, category, range: d.range,
      installed: depPj?.version ?? null,
      ownSize, ownSizeHuman: human(ownSize),
      closureSize, closureSizeHuman: human(closureSize),
      transitiveCount, importCount, usedVia,
      usedIn: [...(usage.samples.get(d.name) ?? [])],
      notes,
    };
  });

  const prodClosure = installed ? sumSizes(prodSet) : null;
  const allClosure = installed ? sumSizes(allSet) : null;
  const nodeModulesSize = installed ? dirSize(real(nmDir), false) : null;
  for (const d of deps) {
    if (d.type === 'prod' && prodClosure && d.closureSize / prodClosure > 0.25) d.notes.push('dominates-prod-closure');
  }
  deps.sort((a, b) => (b.closureSize ?? 0) - (a.closureSize ?? 0));

  return {
    id, name: pj.name ?? id, version: pj.version ?? null, dir: id,
    manager, installed, flags, engines: pj.engines ?? null,
    counts: Object.fromEntries(['prod', 'dev', 'peer', 'optional'].map((t) => [t, deps.filter((d) => d.type === t).length])),
    sizes: {
      prodClosure, prodClosureHuman: human(prodClosure),
      devOnly: installed ? allClosure - prodClosure : null,
      devOnlyHuman: installed ? human(allClosure - prodClosure) : null,
      nodeModules: nodeModulesSize, nodeModulesHuman: human(nodeModulesSize),
      prodPackageCount: installed ? prodSet.size : null,
      totalPackageCount: installed ? allSet.size : null,
    },
    aliases, deps,
  };
}

// ---------- online (opt-in) ----------
function runJson(cmd, cmdArgs, cwd) {
  try {
    return { data: JSON.parse(execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'] }) || '{}') };
  } catch (e) {
    // outdated/audit exit non-zero when they find something — stdout is still valid JSON
    if (e.stdout) { try { return { data: JSON.parse(e.stdout) }; } catch { /* fallthrough */ } }
    return { error: String(e.stderr || e.message).split('\n')[0].slice(0, 200) };
  }
}
function online(pkg) {
  if (!pkg.manager || pkg.manager === 'yarn') return { error: `unsupported manager: ${pkg.manager}` };
  const cwd = path.join(ROOT, pkg.dir);
  const out = pkg.manager === 'pnpm'
    ? runJson('pnpm', ['outdated', '--format', 'json'], cwd)
    : runJson('npm', ['outdated', '--json'], cwd);
  const aud = runJson(pkg.manager, ['audit', '--json'], cwd);
  const outdated = out.error ? { error: out.error } : Object.entries(out.data ?? {}).map(([name, v]) => ({
    name, current: v.current ?? null, wanted: v.wanted ?? null, latest: v.latest ?? null,
    majorBehind: major(v.current) != null && major(v.latest) != null && major(v.current) !== major(v.latest),
    deprecated: v.isDeprecated ?? false,
  }));
  let audit;
  if (aud.error) audit = { error: aud.error };
  else {
    const vulns = aud.data?.metadata?.vulnerabilities ?? {};
    // pnpm: advisories{} with findings[].paths ".>root>...>module"
    const pnpmRows = Object.values(aud.data?.advisories ?? {}).map((a) => ({
      module: a.module_name, severity: a.severity, title: a.title, url: a.url ?? null,
      patched: a.patched_versions ?? null,
      roots: (a.findings ?? []).flatMap((f) => f.paths ?? []).map((x) => x.split('>')[1]).filter(Boolean),
    }));
    // npm: vulnerabilities{} keyed by module, advisory objects inside `via`
    const npmRows = Object.values(aud.data?.vulnerabilities ?? {}).flatMap((v) => {
      const adv = (v.via ?? []).filter((x) => typeof x === 'object');
      const base = { module: v.name, severity: v.severity, patched: null, roots: v.isDirect ? [v.name] : [] };
      return adv.length ? adv.map((a) => ({ ...base, severity: a.severity ?? v.severity, title: a.title, url: a.url ?? null }))
        : [{ ...base, title: `via ${(v.via ?? []).join(', ')}`, url: null }];
    });
    const SEV = { critical: 4, high: 3, moderate: 2, low: 1, info: 0 };
    const typeOf = new Map(pkg.deps.map((d) => [d.name, d.type]));
    const seen = new Map();
    for (const r of [...pnpmRows, ...npmRows]) {
      const key = `${r.module}|${r.severity}|${r.title}`;
      if (seen.has(key)) continue;
      // which declared deps pull this module in (closure first, audit paths as fallback)
      const introducedBy = pkg.deps.filter((d) => closureNames.get(`${pkg.id}|${d.name}`)?.has(r.module)).map((d) => d.name);
      for (const root of r.roots) if (typeOf.has(root) && !introducedBy.includes(root)) introducedBy.push(root);
      const types = new Set(introducedBy.map((n) => typeOf.get(n)));
      const exposure = types.has('prod') || types.has('optional') ? 'prod' : types.size ? 'dev' : 'unknown';
      seen.set(key, {
        module: r.module, severity: r.severity, title: r.title, url: r.url, patched: r.patched,
        exposure, introducedBy: introducedBy.slice(0, 5),
      });
    }
    const findings = [...seen.values()].sort((a, b) => (SEV[b.severity] ?? 0) - (SEV[a.severity] ?? 0)
      || Number(b.exposure === 'prod') - Number(a.exposure === 'prod'));
    const prodHighCritical = findings.filter((f) => f.exposure === 'prod' && SEV[f.severity] >= 3).length;
    audit = { summary: vulns, prodHighCritical, findings };
  }
  return { outdated, audit };
}

// ---------- cross-package ----------
function crossPackage(packages) {
  const managerOf = new Map(packages.map((p) => [p.id, p.manager]));
  const byName = new Map();
  for (const p of packages) for (const d of p.deps) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push({ package: p.id, type: d.type, range: d.range, installed: d.installed, ownSize: d.ownSize });
  }

  // packages that share code via aliases form a "contract group"
  const groups = [];
  for (const p of packages) for (const a of p.aliases) {
    if (a.kind === 'cross-package') groups.push(new Set([p.id, a.owner]));
  }
  // packages vendoring the same alias name share a contract too
  const vendored = new Map();
  for (const p of packages) for (const a of p.aliases) {
    if (a.kind === 'vendored-self') {
      if (!vendored.has(a.alias)) vendored.set(a.alias, []);
      vendored.get(a.alias).push({ package: p.id, target: a.target });
    }
  }
  for (const list of vendored.values()) if (list.length > 1) groups.push(new Set(list.map((x) => x.package)));
  const sameGroup = (a, b) => groups.some((g) => g.has(a) && g.has(b));

  const versionDrift = [];
  const duplicates = [];
  for (const [name, uses] of byName) {
    if (uses.length < 2) continue;
    const inst = uses.filter((u) => u.installed);
    const versions = new Set(inst.map((u) => u.installed));
    const majors = new Set(inst.map((u) => major(u.installed)));
    if (versions.size > 1) {
      const majorMismatch = majors.size > 1;
      let sharedContractRisk = false;
      if (majorMismatch) {
        for (let i = 0; i < inst.length; i++) for (let j = i + 1; j < inst.length; j++) {
          if (major(inst[i].installed) !== major(inst[j].installed)
            && sameGroup(inst[i].package, inst[j].package)) sharedContractRisk = true;
        }
      }
      versionDrift.push({ name, majorMismatch, sharedContractRisk, uses: inst, notInstalledIn: uses.filter((u) => !u.installed).map((u) => u.package) });
    }
    // same name@version installed independently in several packages
    const byVer = new Map();
    for (const u of uses) if (u.installed) {
      byVer.set(u.installed, [...(byVer.get(u.installed) ?? []), u]);
    }
    for (const [ver, list] of byVer) if (list.length > 1) {
      const wasted = list.slice(1).reduce((a, u) => a + (u.ownSize ?? 0), 0);
      const managers = new Set(list.map((u) => managerOf.get(u.package)));
      duplicates.push({
        name, version: ver, packages: list.map((u) => u.package), wastedBytes: wasted, wastedHuman: human(wasted),
        // pnpm hardlinks files from its global store: apparent size is counted per copy,
        // physical disk is shared. Only npm/yarn copies are real extra bytes.
        likelyHardlinked: managers.size === 1 && managers.has('pnpm'),
      });
    }
  }
  versionDrift.sort((a, b) => Number(b.sharedContractRisk) - Number(a.sharedContractRisk) || Number(b.majorMismatch) - Number(a.majorMismatch));
  duplicates.sort((a, b) => b.wastedBytes - a.wastedBytes);

  const vendoredCopies = [];
  for (const [alias, list] of vendored) {
    if (list.length < 2) continue;
    const copies = list.map((x) => {
      let dir = path.join(ROOT, x.target);
      try { if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir); } catch { dir = path.dirname(dir); }
      return { ...x, dir: path.relative(ROOT, dir), ...(hashDir(dir) ?? { hash: null, files: 0 }) };
    });
    const hashes = new Set(copies.map((c) => c.hash));
    const allFiles = new Set(copies.flatMap((c) => Object.keys(c.perFile ?? {})));
    const differingFiles = [...allFiles].filter((f) => new Set(copies.map((c) => c.perFile?.[f] ?? 'missing')).size > 1).sort();
    for (const c of copies) delete c.perFile;
    vendoredCopies.push({ alias, inSync: hashes.size === 1 && !hashes.has(null), differingFiles, copies });
  }

  const internalEdges = packages.flatMap((p) => p.aliases.map((a) => ({ from: p.id, to: a.owner, via: a.alias, target: a.target, kind: a.kind })));

  // one row per name@version; packages that share it are listed together
  const heavyMap = new Map();
  for (const p of packages) for (const d of p.deps) {
    if (d.closureSize == null) continue;
    const key = `${d.name}@${d.installed}`;
    const row = heavyMap.get(key) ?? {
      name: d.name, version: d.installed, packages: [], types: new Set(), category: d.category,
      closureSize: d.closureSize, closureSizeHuman: d.closureSizeHuman, transitiveCount: d.transitiveCount,
    };
    row.packages.push(p.id); row.types.add(d.type);
    if (d.closureSize > row.closureSize) Object.assign(row, { closureSize: d.closureSize, closureSizeHuman: d.closureSizeHuman, transitiveCount: d.transitiveCount });
    heavyMap.set(key, row);
  }
  const heaviest = [...heavyMap.values()].map((r) => ({ ...r, types: [...r.types] }))
    .sort((a, b) => b.closureSize - a.closureSize).slice(0, TOP);

  const byCategory = {};
  for (const p of packages) for (const d of p.deps) {
    const c = (byCategory[d.category] ??= { count: 0, ownSize: 0 });
    c.count++; c.ownSize += d.ownSize ?? 0;
  }
  for (const c of Object.values(byCategory)) c.ownSizeHuman = human(c.ownSize);

  return { internalEdges, vendoredCopies, versionDrift, duplicates, heaviest, byCategory };
}

// ---------- main ----------
const pkgDirs = discoverPackages();
const t0 = Date.now();
const packages = pkgDirs.map((d) => analyzePackage(d, pkgDirs));
const cross = crossPackage(packages);
if (ONLINE) for (const p of packages) p.online = online(p);
const totalDisk = packages.reduce((a, p) => a + (p.sizes.nodeModules ?? 0), 0);

process.stdout.write(JSON.stringify({
  generatedAt: new Date().toISOString(),
  root: ROOT,
  mode: ONLINE ? 'online' : 'offline',
  durationMs: Date.now() - t0,
  summary: {
    packages: packages.length,
    installed: packages.filter((p) => p.installed).length,
    declaredDeps: packages.reduce((a, p) => a + p.deps.length, 0),
    totalNodeModules: totalDisk, totalNodeModulesHuman: human(totalDisk),
  },
  packages,
  ...cross,
}, null, 2) + '\n');
