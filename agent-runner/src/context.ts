import { readFileSync } from 'node:fs';
import { RunnerError } from './errors.js';

/**
 * Resolves the PR context (owner/repo/number/title/body/fork) from the
 * GitHub-Actions-injected env vars + the standard `pull_request` event
 * payload — "the CI context" the runner assembles the diff + PR body/title
 * from (T8 action). The generated workflow (`server/src/modules/ci/workflow.ts`)
 * sets `GITHUB_REPOSITORY` and the `DEVDIGEST_*` vars explicitly — explicit env
 * always wins; `GITHUB_EVENT_PATH` (a default GitHub Actions runtime var,
 * always present) is the fallback for the PR number / head SHA and the only
 * source of the (untrusted, author-controlled) PR title/body and fork flag.
 */

export interface CiEnv {
  GITHUB_REPOSITORY?: string;
  /** Slug of the exported agent to run (`.devdigest/agents/<slug>.yaml`). */
  DEVDIGEST_AGENT?: string;
  DEVDIGEST_PR_NUMBER?: string;
  DEVDIGEST_HEAD_SHA?: string;
  DEVDIGEST_WORKFLOW_RUN_ID?: string;
  GITHUB_RUN_ID?: string;
  GITHUB_EVENT_PATH?: string;
  [key: string]: string | undefined;
}

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40,64}$/;

export interface PrContext {
  owner: string;
  repo: string;
  prNumber: number;
  /** PR title (untrusted, author-controlled). */
  title: string;
  /** PR body/description (untrusted, author-controlled). */
  body: string;
  /** True when the PR head is a fork — informational only; the workflow
   *  itself is responsible for never scheduling this job for fork PRs. */
  isFork: boolean;
  /** Lower-case head commit SHA the run reviewed (recorded in the artifact). */
  headSha: string;
  /** GitHub Actions run id (recorded in the artifact; ties it to the run). */
  workflowRunId: number;
}

interface PullRequestEventPayload {
  pull_request?: {
    number?: number;
    title?: string;
    body?: string | null;
    head?: { sha?: string; repo?: { fork?: boolean } | null };
  };
}

function readEventPayload(
  eventPath: string | undefined,
  readFile: typeof readFileSync,
): PullRequestEventPayload | null {
  if (!eventPath) return null;
  let raw: string;
  try {
    raw = readFile(eventPath, 'utf8') as unknown as string;
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as PullRequestEventPayload;
  } catch {
    return null;
  }
}

/** Resolve the PR context from env + (best-effort) event payload. */
export function resolvePrContext(
  env: CiEnv,
  readFile: typeof readFileSync = readFileSync,
): PrContext {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository || !REPO_RE.test(repository)) {
    throw new RunnerError(
      `GITHUB_REPOSITORY must be set to "owner/name" (got: ${JSON.stringify(repository)})`,
    );
  }
  const [owner, repo] = repository.split('/', 2) as [string, string];

  const event = readEventPayload(env.GITHUB_EVENT_PATH, readFile);
  const pr = event?.pull_request;

  // `||`, not `??`: an empty env var (e.g. an unset Actions expression) means
  // "not provided" and must fall back to the event payload.
  const prNumberRaw =
    env.DEVDIGEST_PR_NUMBER?.trim() || (pr?.number != null ? String(pr.number) : undefined);
  const prNumber = prNumberRaw ? Number(prNumberRaw) : NaN;
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new RunnerError(
      `DEVDIGEST_PR_NUMBER must resolve to a positive integer (env=${JSON.stringify(env.DEVDIGEST_PR_NUMBER)}, event pull_request.number=${JSON.stringify(pr?.number)})`,
    );
  }

  const headSha = (env.DEVDIGEST_HEAD_SHA?.trim() || pr?.head?.sha || '').toLowerCase();
  if (!SHA_RE.test(headSha)) {
    throw new RunnerError(
      `DEVDIGEST_HEAD_SHA must resolve to a commit SHA (got: ${JSON.stringify(headSha)})`,
    );
  }

  const runIdRaw = env.DEVDIGEST_WORKFLOW_RUN_ID?.trim() || env.GITHUB_RUN_ID?.trim();
  const workflowRunId = runIdRaw ? Number(runIdRaw) : NaN;
  if (!Number.isInteger(workflowRunId) || workflowRunId < 0) {
    throw new RunnerError(
      `DEVDIGEST_WORKFLOW_RUN_ID must resolve to a non-negative integer (got: ${JSON.stringify(runIdRaw)})`,
    );
  }

  return {
    owner,
    repo,
    prNumber,
    title: pr?.title ?? '',
    body: pr?.body ?? '',
    isFork: pr?.head?.repo?.fork ?? false,
    headSha,
    workflowRunId,
  };
}

/** The agent slug the workflow asked for (`DEVDIGEST_AGENT`), validated (AC-30). */
export function resolveAgentSlug(env: CiEnv): string {
  const slug = env.DEVDIGEST_AGENT?.trim();
  if (!slug || !SLUG_RE.test(slug)) {
    throw new RunnerError(
      `DEVDIGEST_AGENT must be an agent slug matching ${SLUG_RE} (got: ${JSON.stringify(env.DEVDIGEST_AGENT)})`,
    );
  }
  return slug;
}
