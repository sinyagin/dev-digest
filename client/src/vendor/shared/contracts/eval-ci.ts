import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { Conformance, Provider, CiFailOn, MemoryKind } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `Conformance` lives in `knowledge.ts`; the Eval contracts moved to `eval.ts`.
 * Here we add the *API-facing* request/response shapes (records persisted in
 * `composed_reviews`, `ci_installations`, `ci_runs`, `conformance_checks`).
 */

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** PR events the generated workflow can trigger on (closed set — never free text). */
export const CiTrigger = z.enum(['opened', 'synchronize', 'reopened']);
export type CiTrigger = z.infer<typeof CiTrigger>;

/** How the runner publishes its result on the PR. */
export const CiPostAs = z.enum(['github_review', 'pr_comment', 'none']);
export type CiPostAs = z.infer<typeof CiPostAs>;

/** A target offered by `GET /ci/targets` (the registry; only `gha` in this slice). */
export const CiTargetOption = z.object({
  target: CiTarget,
  /** i18n key the client resolves, e.g. `ci.targets.gha`. */
  label_key: z.string(),
});
export type CiTargetOption = z.infer<typeof CiTargetOption>;

/**
 * One file in the CI bundle. `contents` is null for runner files in a preview
 * (fetched per file on demand); only the workflow is `editable`.
 */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string().nullable(),
  editable: z.boolean().default(false),
  size_bytes: z.number().int().nonnegative(),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService`) WRITES this shape to `.devdigest/agents/<slug>.yaml`;
 * the agent-runner READS it. Keeping one Zod schema for both ends guarantees the
 * formats never drift. `skills` are slugs resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  /** Manifest format marker (bumped only on a breaking manifest change). */
  format: z.literal('devdigest-agent/v1'),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  /** The agent version this manifest was exported from. */
  agent_version: z.number().int().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** One line of `.devdigest/memory.jsonl` — content-only, repo-scoped (D12). */
export const MemoryRecord = z.object({
  kind: MemoryKind,
  content: z.string(),
});
export type MemoryRecord = z.infer<typeof MemoryRecord>;

/** Body of preview / preview-file / export / export-zip (`repo` is `owner/name`). */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" is the zip flow. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: CiPostAs.default('github_review'),
  triggers: z.array(CiTrigger).min(1).default(['opened', 'synchronize']),
  /** The user-edited workflow, sent verbatim on install (D8). */
  workflow_override: z.string().optional(),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** Body of `POST /agents/:id/ci/preview/file` — fetch one file's contents. */
export const CiPreviewFileInput = CiExportInput.extend({ path: z.string().min(1) });
export type CiPreviewFileInput = z.infer<typeof CiPreviewFileInput>;
export type CiPreviewFileInputBody = z.input<typeof CiPreviewFileInput>;

/** Query of `GET /ci/secrets`. */
export const CiSecretsQuery = z.object({ repo: z.string().min(1) });
export type CiSecretsQuery = z.infer<typeof CiSecretsQuery>;

/** Query of `GET /ci/runs`. */
export const CiRunsQuery = z.object({ agent_id: z.string().uuid().optional() });
export type CiRunsQuery = z.infer<typeof CiRunsQuery>;

export const CiSecretState = z.enum(['ready', 'not_set', 'unknown']);
export type CiSecretState = z.infer<typeof CiSecretState>;

/** Status of one repository secret the workflow expects. */
export const CiSecretStatus = z.object({
  name: z.string(),
  status: CiSecretState,
});
export type CiSecretStatus = z.infer<typeof CiSecretStatus>;

/** Response of `POST /agents/:id/ci/preview`. */
export const CiPreview = z.object({
  files: z.array(CiFile),
  secrets: z.array(CiSecretStatus),
  /** A DIFFERENT agent already installed in the repo (AC-5), else null. */
  existing_installation: z.object({ agent_id: z.string(), agent_name: z.string() }).nullable(),
});
export type CiPreview = z.infer<typeof CiPreview>;

/** A persisted CI installation (mirrors `ci_installations`) + derived fields. */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
  triggers: z.array(CiTrigger),
  post_as: CiPostAs,
  exported_agent_version: z.number().int(),
  workflow_version: z.number().int(),
  pr_url: z.string().nullable(),
  /** Derived: exported agent version or workflow version differs from current (D13). */
  out_of_date: z.boolean(),
  /** Derived: the installation's newest ingested CI run, if any. */
  last_run: z.object({ status: z.string().nullable(), ran_at: z.string().nullable() }).nullable(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/ci/export` (the zip route streams bytes instead). */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

/** Typed export failures (the API error `code`). */
export const CiExportErrorCode = z.enum([
  'no_token',
  'forbidden',
  'missing_workflow_scope',
  'not_found',
  'upstream_unavailable',
  'runner_bundle_missing',
]);
export type CiExportErrorCode = z.infer<typeof CiExportErrorCode>;

/** Per-repository outcome of `POST /agents/:id/ci/republish` (AC-46). */
export const CiRepublishResult = z.object({
  results: z.array(
    z.object({
      installation_id: z.string(),
      repo: z.string(),
      ok: z.boolean(),
      pr_url: z.string().nullable(),
      error: z.object({ code: z.string(), message: z.string() }).nullable(),
    }),
  ),
});
export type CiRepublishResult = z.infer<typeof CiRepublishResult>;

/** Outcome of `POST /ci/runs/refresh` — errors are per installation, never fatal. */
export const CiRefreshResult = z.object({
  /** Runs inserted or updated this refresh. */
  ingested: z.number().int(),
  /** Of those, runs recorded as `failed` (no artifact / rejected / runner failure). */
  failed: z.number().int(),
  errors: z.array(
    z.object({ installation_id: z.string(), repo: z.string(), message: z.string() }),
  ),
});
export type CiRefreshResult = z.infer<typeof CiRefreshResult>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  /** Link to the GitHub Actions job/run. Render only when it starts with https://github.com/. */
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
  repo: z.string().nullable(),
  pr_url: z.string().nullable(),
  verdict: Verdict.nullable(),
  critical: z.number().int().nullable(),
  warning: z.number().int().nullable(),
  suggestion: z.number().int().nullable(),
  blockers: z.number().int().nullable(),
  commit_sha: z.string().nullable(),
  /** Why the run is `failed` (check name or runner error category); null otherwise. */
  failure_reason: z.string().nullable(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the runner (`devdigest-result.json`). Untrusted
 * third-party JSON on ingestion — the server verifies it (D6) before storing.
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative().nullish(),
  warning: z.number().int().nonnegative().nullish(),
  suggestion: z.number().int().nonnegative().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nonnegative().nullish(),
  /** Agent display name. */
  agent: z.string().max(200),
  pr_number: z.number().int().nullish(),
  status: z.enum(['succeeded', 'failed']),
  error_category: z.enum(['manifest', 'missing_secret', 'llm', 'github', 'internal']).nullish(),
  verdict: Verdict.nullable(),
  blockers: z.number().int().nonnegative(),
  agent_slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  agent_version: z.number().int().min(1),
  /** SHA-256 (hex) of the manifest file the run used. */
  manifest_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  model: z.string().max(200),
  dependencies: z.object({
    runner: z.string().max(100),
    reviewer_core: z.string().max(100),
    node: z.string().max(100),
  }),
  /** `owner/name` the run executed in. */
  repository: z.string().max(200),
  commit_sha: z.string().regex(/^[0-9a-f]{40,64}$/),
  workflow_run_id: z.number().int().nonnegative(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
