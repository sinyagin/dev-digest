import { readFileSync, writeFileSync } from 'node:fs';
import type { LLMProvider, GitHubReviewPayload, CiResultArtifact, Verdict } from '@devdigest/shared';
import {
  reviewPullRequest,
  toReviewPayload,
  gateTriggered,
  countBlockers,
  wrapUntrusted,
} from '@devdigest/reviewer-core';
import { loadManifest } from './manifest.js';
import { loadSkillBodies } from './skills.js';
import { loadMemory } from './memory.js';
import { resolveAgentSlug, resolvePrContext, type CiEnv } from './context.js';
import { parseUnifiedDiff, stripIgnoredFiles } from './diff.js';
import { fetchPrDiff, postGithubReview, postPrComment, type FetchLike } from './github.js';
import { buildResultArtifact, type ArtifactContext, type ErrorCategory } from './artifact.js';
import { redact } from './credentials.js';
import { RunnerError } from './errors.js';

/**
 * `runCi` — the runner's single orchestration entry point (T8). Mirrors the
 * pipeline a local studio review runs (assemblePrompt/wrapUntrusted →
 * completeStructured → groundFindings, all INSIDE `reviewPullRequest`) so CI
 * and local stay in parity (AC-36): this file never re-implements or
 * hand-rolls any of that — it only resolves CI-specific inputs (manifest,
 * skills, memory, diff, PR context) and hands them to the SAME reviewer-core
 * engine the studio calls, then turns the grounded result into GitHub side
 * effects and the result artifact.
 *
 * Deterministic verdict + gate (D9): computed from `countBlockers`/
 * `gateTriggered` + the manifest's `ci_fail_on` against the GROUNDED findings —
 * never from `review.verdict` (the model's self-report), which is discarded.
 *
 * Exit codes (AC-29): 0 review completed + gate not tripped, 1 gate tripped,
 * 2 could not complete a review. Failure handling, by stage:
 *  - Pre-flight (AC-30) — CI context, agent slug, manifest, skills, GitHub
 *    token: exit 2, NO LLM call, NO artifact (nothing trustworthy to report).
 *  - After pre-flight (AC-32) — missing OpenRouter key, diff fetch, LLM/review,
 *    internal: exit 2, nothing posted, and a `status: 'failed'` artifact with
 *    the error category, so the studio records the failure.
 *  - Publishing (AC-32) — logged only; never changes the exit code and never
 *    blocks the artifact, which is written BEFORE posting.
 */

export type PostAs = 'github_review' | 'pr_comment' | 'none';

export interface RunCiDeps {
  /** Directory containing `agents/`, `skills/` and `memory.jsonl` (checked-in `.devdigest/`). */
  devdigestDir: string;
  env: CiEnv;
  /** Injected LLM provider — `OpenRouterProvider` in production, a stub in tests. */
  llm: LLMProvider;
  /** How to post the result — `'github_review' | 'pr_comment' | 'none'` (AC-32). */
  postAs: PostAs;
  /** Absolute path to write the `CiResultArtifact` JSON to. */
  resultPath: string;
  fetchImpl?: FetchLike;
  readFile?: typeof readFileSync;
  writeFile?: typeof writeFileSync;
  now?: () => number;
  /** Diagnostics sink (stderr in production). Never receives a secret. */
  log?: (msg: string) => void;
  /**
   * Override diff retrieval (tests supply a fixture diff directly instead of
   * hitting the GitHub API). Defaults to `fetchPrDiff` via the GitHub REST API.
   */
  fetchDiff?: (
    ctx: { owner: string; repo: string; prNumber: number },
    token: string,
    fetchImpl: FetchLike,
  ) => Promise<string>;
}

export interface RunCiSuccess {
  exitCode: 0 | 1;
  artifact: CiResultArtifact;
  /** `error` is set when publishing failed (the run itself still succeeded). */
  posted: { kind: PostAs; payload?: GitHubReviewPayload; error?: string };
  blockers: number;
  gateTriggered: boolean;
  error?: undefined;
}

export interface RunCiFailure {
  exitCode: 2;
  /** The `failed` artifact — null when pre-flight failed (or it could not be written). */
  artifact: CiResultArtifact | null;
  posted: null;
  blockers?: undefined;
  gateTriggered?: undefined;
  error: string;
}

export type RunCiResult = RunCiSuccess | RunCiFailure;

/** D10: the OpenRouter model id — `model` for openrouter agents, else `<provider>/<model>`. */
export function openRouterModel(provider: string, model: string): string {
  return provider === 'openrouter' ? model : `${provider}/${model}`;
}

/** D9: `request_changes` iff the gate tripped; else `comment` with findings, `approve` without. */
function deterministicVerdict(tripped: boolean, findingCount: number): Verdict {
  if (tripped) return 'request_changes';
  return findingCount > 0 ? 'comment' : 'approve';
}

export async function runCi(deps: RunCiDeps): Promise<RunCiResult> {
  const readFile = deps.readFile ?? readFileSync;
  const writeFile = deps.writeFile ?? writeFileSync;
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const fetchDiffImpl = deps.fetchDiff ?? fetchPrDiff;
  const log = deps.log ?? ((msg: string) => console.error(msg));

  // 1. Pre-flight (AC-30): resolve + validate everything BEFORE any LLM call.
  let preflight;
  try {
    const slug = resolveAgentSlug(deps.env);
    const ctx = resolvePrContext(deps.env, readFile);
    const { manifest, sha256 } = loadManifest(deps.devdigestDir, slug, { readFile });
    const skills = loadSkillBodies(deps.devdigestDir, manifest.skills, readFile);
    const githubToken = deps.env.GITHUB_TOKEN?.trim();
    if (!githubToken) throw new RunnerError('GITHUB_TOKEN is required to fetch the PR diff');
    preflight = { slug, ctx, manifest, sha256, skills, githubToken };
  } catch (err) {
    return { exitCode: 2, artifact: null, posted: null, error: (err as Error).message };
  }
  const { slug, ctx, manifest, sha256, skills, githubToken } = preflight;

  const openrouterKey = deps.env.OPENROUTER_API_KEY?.trim() ?? '';
  const secrets = [openrouterKey, githubToken];
  const model = openRouterModel(manifest.provider, manifest.model);
  const artifactCtx: ArtifactContext = {
    agent: manifest.name,
    agentSlug: slug,
    agentVersion: manifest.agent_version,
    manifestSha256: sha256,
    model,
    repository: `${ctx.owner}/${ctx.repo}`,
    commitSha: ctx.headSha,
    workflowRunId: ctx.workflowRunId,
    prNumber: ctx.prNumber,
    secrets,
  };
  const start = now();

  const writeArtifact = (artifact: CiResultArtifact) =>
    writeFile(deps.resultPath, `${JSON.stringify(artifact, null, 2)}\n`);

  // Every post-pre-flight failure: exit 2, nothing posted, a `failed` artifact.
  const fail = (category: ErrorCategory, err: unknown): RunCiFailure => {
    const error = `${category}: ${redact(err instanceof Error ? err.message : String(err), secrets).slice(0, 300)}`;
    let artifact: CiResultArtifact | null = null;
    try {
      artifact = buildResultArtifact(artifactCtx, {
        status: 'failed',
        errorCategory: category,
        durationMs: now() - start,
      });
      writeArtifact(artifact);
    } catch {
      log('[agent-runner] could not write the failed result artifact');
      artifact = null;
    }
    return { exitCode: 2, artifact, posted: null, error };
  };

  try {
    // 2. The only secret CI needs (D10). Checked here, not in pre-flight, so the
    //    studio sees a `missing_secret` failure instead of a missing artifact.
    if (!openrouterKey) return fail('missing_secret', 'OPENROUTER_API_KEY is not set');

    // 3. Assemble the diff from the CI context. Strip DevDigest's own exported
    //    artifacts (`.devdigest/**`, the generated workflow) BEFORE parse: the
    //    minified runner bundle would otherwise fail the whole review with a
    //    GitHub 422 "diff too large", and reviewing our own config is noise.
    let rawDiff: string;
    try {
      rawDiff = await fetchDiffImpl(ctx, githubToken, fetchImpl);
    } catch (err) {
      return fail('github', err);
    }
    const diff = parseUnifiedDiff(stripIgnoredFiles(rawDiff));

    // 4. Run the SAME engine the studio uses. `reviewPullRequest` internally
    //    calls `assemblePrompt`/`wrapUntrusted` (diff → `<untrusted
    //    source="diff">`, prDescription → `<untrusted source="pr-description">`,
    //    AC-21) and the mandatory `groundFindings()` gate (AC-22: an all-dropped
    //    result is a valid zero-finding review, not an error — it flows through
    //    normally below). Memory is repo content: fenced as untrusted here,
    //    since reviewer-core renders memory lines as-is (AC-31).
    const memory = loadMemory(deps.devdigestDir, readFile).map((m) =>
      wrapUntrusted('memory', `[${m.kind}] ${m.content}`),
    );
    let outcome;
    try {
      outcome = await reviewPullRequest({
        systemPrompt: manifest.system_prompt,
        model,
        diff,
        llm: deps.llm,
        strategy: manifest.strategy,
        skills,
        memory,
        prDescription: ctx.body,
        task: `Review PR #${ctx.prNumber}: ${ctx.title}`,
        sessionId: `ci-${ctx.workflowRunId}`,
      });
    } catch (err) {
      return fail('llm', err);
    }
    const durationMs = now() - start;

    // 5. Deterministic verdict/gate from GROUNDED findings + `ci_fail_on` (D9).
    const findings = outcome.review.findings;
    const payload = toReviewPayload(outcome.review, {
      failOn: manifest.ci_fail_on,
      diff,
      title: manifest.name,
    });
    const blockers = countBlockers(findings, manifest.ci_fail_on);
    const triggered = gateTriggered(findings, manifest.ci_fail_on);

    // 6. Build + write the artifact before posting, so a GitHub-side posting
    //    failure never loses the already-computed, already-grounded result.
    const artifact = buildResultArtifact(artifactCtx, {
      status: 'succeeded',
      findings,
      verdict: deterministicVerdict(triggered, findings.length),
      blockers,
      costUsd: outcome.costUsd,
      durationMs,
    });
    writeArtifact(artifact);

    // 7. Post per `post_as` (AC-32). A failure here is reported, never fatal.
    let postError: string | undefined;
    try {
      if (deps.postAs === 'github_review') {
        await postGithubReview(ctx, githubToken, payload, fetchImpl);
      } else if (deps.postAs === 'pr_comment') {
        await postPrComment(ctx, githubToken, payload.body, fetchImpl);
      }
      // 'none' → post nothing (exit-code only).
    } catch (err) {
      postError = redact((err as Error).message, secrets).slice(0, 300);
      log(`[agent-runner] publish failed: ${postError}`);
    }

    // 8. Exit 1 IFF the gate tripped (AC-29).
    return {
      exitCode: triggered ? 1 : 0,
      artifact,
      posted: { kind: deps.postAs, payload, ...(postError ? { error: postError } : {}) },
      blockers,
      gateTriggered: triggered,
    };
  } catch (err) {
    return fail('internal', err);
  }
}
