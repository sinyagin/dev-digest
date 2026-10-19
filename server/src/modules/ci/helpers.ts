import { MemoryRecord, CiTrigger, Verdict } from '@devdigest/shared';
import type { CiInstallation, CiRun, CiSecretStatus, RepoRef } from '@devdigest/shared';
import type { CiInstallationRow, CiRunRow } from '../../db/rows.js';
import { WORKFLOW_VERSION } from './constants.js';

/** Row -> DTO mapping for the ci module (rows never cross the module boundary). */

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `owner/name` -> RepoRef, or null when malformed (callers answer 400 naming `repo`). */
export function parseRepo(full: string): RepoRef | null {
  if (!REPO_RE.test(full)) return null;
  const [owner, name] = full.split('/') as [string, string];
  if (owner === '.' || owner === '..' || name === '.' || name === '..') return null;
  return { owner, name };
}

/** One JSON line per record with ONLY `kind` and `content`; '' when there are none (AC-50). */
export function memoryJsonl(rows: { kind: string; content: string }[]): string {
  if (rows.length === 0) return '';
  const lines = rows.map((r) => JSON.stringify(MemoryRecord.parse({ kind: r.kind, content: r.content })));
  return `${lines.join('\n')}\n`;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function installationToDto(
  row: CiInstallationRow,
  currentAgentVersion: number,
  lastRun: { status: string | null; ranAt: Date | null } | undefined,
): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
    triggers: CiTrigger.array().catch([]).parse(row.triggers),
    post_as: row.postAs,
    exported_agent_version: row.exportedAgentVersion,
    workflow_version: row.workflowVersion,
    pr_url: row.prUrl,
    // D13: out of date when either differs from the current value.
    out_of_date:
      row.exportedAgentVersion !== currentAgentVersion || row.workflowVersion !== WORKFLOW_VERSION,
    last_run: lastRun ? { status: lastRun.status, ran_at: iso(lastRun.ranAt) } : null,
  };
}

export function runToDto(row: CiRunRow): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    pr_number: row.prNumber,
    ran_at: iso(row.ranAt),
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    agent: row.agentName,
    duration_s: row.durationMs == null ? null : row.durationMs / 1000,
    repo: row.repo,
    pr_url: row.prUrl,
    verdict: Verdict.safeParse(row.verdict).data ?? null,
    critical: row.critical,
    warning: row.warning,
    suggestion: row.suggestion,
    blockers: row.blockers,
    commit_sha: row.commitSha,
    failure_reason: row.failureReason,
  };
}

export function secretStatus(name: string, status: CiSecretStatus['status']): CiSecretStatus {
  return { name, status };
}
