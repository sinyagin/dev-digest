import type { Finding, Verdict } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import runnerPkg from '../package.json' with { type: 'json' };
import reviewerCorePkg from '../../reviewer-core/package.json' with { type: 'json' };
import { redact } from './credentials.js';
import { RunnerError } from './errors.js';

/**
 * Builds the `devdigest-result.json` artifact (`CiResultArtifact`) the
 * generated workflow uploads and the studio ingests (verifying it first, D6).
 * Written for EVERY run that got past pre-flight (AC-32) — `succeeded` with the
 * grounded counts, or `failed` with an error category — so a failed CI review
 * is recorded instead of looking like a missing artifact.
 *
 * Never carries diff text or a secret: free-text fields (agent name, model id)
 * are credential-scrubbed and length-capped before validation.
 */

/** Read from the package.json files at build time (ncc inlines them), so they can't go stale. */
export const RUNNER_VERSION: string = runnerPkg.version;
export const REVIEWER_CORE_VERSION: string = reviewerCorePkg.version;

export type ErrorCategory = NonNullable<CiResultArtifact['error_category']>;

/** Fields known once the manifest + CI context are resolved — shared by both outcomes. */
export interface ArtifactContext {
  agent: string;
  agentSlug: string;
  agentVersion: number;
  manifestSha256: string;
  model: string;
  repository: string;
  commitSha: string;
  workflowRunId: number;
  prNumber: number;
  /** Literal secret values to scrub from free-text fields. */
  secrets: readonly string[];
}

export type ArtifactOutcome =
  | {
      status: 'succeeded';
      findings: Finding[];
      verdict: Verdict;
      blockers: number;
      costUsd: number | null;
      durationMs: number;
    }
  | { status: 'failed'; errorCategory: ErrorCategory; durationMs: number };

function severityCounts(findings: Finding[]): { critical: number; warning: number; suggestion: number } {
  const counts = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) {
    if (f.severity === 'CRITICAL') counts.critical++;
    else if (f.severity === 'WARNING') counts.warning++;
    else counts.suggestion++;
  }
  return counts;
}

export function buildResultArtifact(ctx: ArtifactContext, outcome: ArtifactOutcome): CiResultArtifact {
  const base = {
    agent: redact(ctx.agent, ctx.secrets).slice(0, 200),
    agent_slug: ctx.agentSlug,
    agent_version: ctx.agentVersion,
    manifest_sha256: ctx.manifestSha256,
    model: redact(ctx.model, ctx.secrets).slice(0, 200),
    dependencies: { runner: RUNNER_VERSION, reviewer_core: REVIEWER_CORE_VERSION, node: process.versions.node },
    repository: ctx.repository,
    commit_sha: ctx.commitSha,
    workflow_run_id: ctx.workflowRunId,
    pr_number: ctx.prNumber,
  };
  const candidate =
    outcome.status === 'succeeded'
      ? {
          ...base,
          ...severityCounts(outcome.findings),
          status: 'succeeded' as const,
          error_category: null,
          verdict: outcome.verdict,
          findings_count: outcome.findings.length,
          blockers: outcome.blockers,
          cost_usd: outcome.costUsd,
          duration_ms: outcome.durationMs,
        }
      : {
          ...base,
          status: 'failed' as const,
          error_category: outcome.errorCategory,
          verdict: null,
          findings_count: 0,
          critical: 0,
          warning: 0,
          suggestion: 0,
          blockers: 0,
          cost_usd: null,
          duration_ms: outcome.durationMs,
        };
  const result = CiResultArtifact.safeParse(candidate);
  if (!result.success) {
    // Should be unreachable — every field above is shaped to the schema. If
    // this ever fires it's a genuine internal bug, not a user/config error.
    throw new RunnerError(
      `Internal error: built result artifact failed CiResultArtifact validation: ${result.error.message}`,
    );
  }
  return result.data;
}
