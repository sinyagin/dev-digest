import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiInstallationRow, CiRunRow } from '../../db/rows.js';
export type { CiInstallationRow, CiRunRow };

/**
 * ci data-access (Infrastructure). Owns `ci_installations` and `ci_runs`, and
 * writes the `agent_runs` (source='ci') + `run_traces` rows of an ingested run
 * in ONE transaction. Memory / pull-request lookups are read-only. Every query
 * is workspace-scoped (installations via their owning agent). No business rules.
 */

export interface UpsertInstallation {
  agentId: string;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  triggers: string[];
  postAs: 'github_review' | 'pr_comment' | 'none';
  exportedAgentVersion: number;
  workflowVersion: number;
  prUrl: string | null;
}

/** An installation joined to its (workspace-scoped) agent. */
export interface InstallationWithAgent {
  installation: CiInstallationRow;
  agentName: string;
  agentVersion: number;
}

/** Fields of an artifact-verified run; absent for no-artifact / rejected runs. */
export interface AcceptedRun {
  agentName: string;
  model: string;
  verdict: string | null;
  findingsCount: number;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  blockers: number;
  costUsd: number | null;
  durationMs: number | null;
  /** agent_runs.status: 'done' | 'failed'. */
  runStatus: 'done' | 'failed';
  error: string | null;
  /** The validated RunTrace document (stored as jsonb). */
  trace: unknown;
  prId: string | null;
}

export interface IngestRunInput {
  workspaceId: string;
  installationId: string;
  agentId: string;
  repo: string;
  workflowRunId: number;
  githubUrl: string;
  ranAt: Date;
  prNumber: number | null;
  prUrl: string | null;
  commitSha: string;
  /** ci_runs.status: running | succeeded | failed | no_findings. */
  status: string;
  failureReason: string | null;
  /** Agent name shown for runs with no accepted artifact (from the DB, not the artifact). */
  fallbackAgentName: string;
  accepted: AcceptedRun | null;
}

export type IngestOutcome = 'created' | 'updated' | 'unchanged';

export class CiRepository {
  constructor(private db: Db) {}

  // ---- installations -----------------------------------------------------

  /** One row per agent x repo x target: re-installing updates the row in place (AC-18). */
  async upsertInstallation(v: UpsertInstallation): Promise<CiInstallationRow> {
    const set = {
      installedAt: new Date(),
      triggers: v.triggers,
      postAs: v.postAs,
      exportedAgentVersion: v.exportedAgentVersion,
      workflowVersion: v.workflowVersion,
      prUrl: v.prUrl,
    };
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({ agentId: v.agentId, repo: v.repo, targetType: v.targetType, ...set })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo, t.ciInstallations.targetType],
        set,
      })
      .returning();
    return row!;
  }

  async installationsForAgent(agentId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId))
      .orderBy(t.ciInstallations.repo);
  }

  /** Every installation of the workspace's agents, newest first. */
  async installationsForWorkspace(workspaceId: string): Promise<InstallationWithAgent[]> {
    const rows = await this.db
      .select({
        installation: t.ciInstallations,
        agentName: t.agents.name,
        agentVersion: t.agents.version,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(desc(t.ciInstallations.installedAt));
    return rows;
  }

  /** The newest installation of a DIFFERENT agent of this workspace in `repo` (AC-5). */
  async otherAgentInstallation(
    workspaceId: string,
    repo: string,
    agentId: string,
  ): Promise<{ agentId: string; agentName: string } | undefined> {
    const rows = await this.db
      .select({ agentId: t.agents.id, agentName: t.agents.name })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.ciInstallations.repo, repo),
          sql`${t.ciInstallations.agentId} <> ${agentId}`,
        ),
      )
      .orderBy(desc(t.ciInstallations.installedAt))
      .limit(1);
    return rows[0];
  }

  /** Newest CI run per installation. */
  async lastRuns(
    installationIds: string[],
  ): Promise<Map<string, { status: string | null; ranAt: Date | null }>> {
    const out = new Map<string, { status: string | null; ranAt: Date | null }>();
    if (installationIds.length === 0) return out;
    const rows = await this.db
      .select({
        installationId: t.ciRuns.ciInstallationId,
        status: t.ciRuns.status,
        ranAt: t.ciRuns.ranAt,
      })
      .from(t.ciRuns)
      .where(inArray(t.ciRuns.ciInstallationId, installationIds))
      .orderBy(desc(t.ciRuns.ranAt));
    for (const r of rows) {
      if (r.installationId && !out.has(r.installationId)) {
        out.set(r.installationId, { status: r.status, ranAt: r.ranAt });
      }
    }
    return out;
  }

  // ---- runs --------------------------------------------------------------

  /** Stored CI runs, newest first. DB only — never touches GitHub (AC-40). */
  async listRuns(workspaceId: string, agentId?: string, limit = 200): Promise<CiRunRow[]> {
    if (agentId) {
      const rows = await this.db
        .select({ run: t.ciRuns })
        .from(t.ciRuns)
        .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
        .where(and(eq(t.ciRuns.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)))
        .orderBy(desc(t.ciRuns.ranAt))
        .limit(limit);
      return rows.map((r) => r.run);
    }
    return this.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.workspaceId, workspaceId))
      .orderBy(desc(t.ciRuns.ranAt))
      .limit(limit);
  }

  async existingRunStatuses(
    workspaceId: string,
    workflowRunIds: number[],
  ): Promise<Map<number, string | null>> {
    const out = new Map<number, string | null>();
    if (workflowRunIds.length === 0) return out;
    const rows = await this.db
      .select({ id: t.ciRuns.workflowRunId, status: t.ciRuns.status })
      .from(t.ciRuns)
      .where(
        and(eq(t.ciRuns.workspaceId, workspaceId), inArray(t.ciRuns.workflowRunId, workflowRunIds)),
      );
    for (const r of rows) out.set(r.id, r.status);
    return out;
  }

  /** The imported pull request (if any) for a repo + number, so `agent_runs.pr_id` can link. */
  async prIdFor(workspaceId: string, repoId: string, prNumber: number): Promise<string | null> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          eq(t.pullRequests.number, prNumber),
        ),
      );
    return row?.id ?? null;
  }

  /**
   * Store one workflow run. Idempotent on (workspace, workflow run id): a
   * per-run advisory lock serialises concurrent refreshes, so two of them can
   * never create duplicate `agent_runs` rows; an already-final run is left
   * untouched ('unchanged'), a `running` one is updated in place (AC-39).
   */
  async ingestRun(input: IngestRunInput): Promise<IngestOutcome> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`ci_run:${input.workspaceId}:${input.workflowRunId}`}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(t.ciRuns)
        .where(
          and(
            eq(t.ciRuns.workspaceId, input.workspaceId),
            eq(t.ciRuns.workflowRunId, input.workflowRunId),
          ),
        );
      if (existing && existing.status !== 'running') return 'unchanged';

      let agentRunId = existing?.agentRunId ?? null;
      const a = input.accepted;
      if (a) {
        const runValues = {
          workspaceId: input.workspaceId,
          agentId: input.agentId,
          prId: a.prId,
          ranAt: input.ranAt,
          provider: 'openrouter',
          model: a.model,
          durationMs: a.durationMs,
          tokensIn: null,
          tokensOut: null,
          costUsd: a.costUsd,
          status: a.runStatus,
          error: a.error,
          source: 'ci' as const,
          findingsCount: a.findingsCount,
          grounding: null,
          score: null,
          blockers: a.blockers,
        };
        if (agentRunId) {
          await tx.update(t.agentRuns).set(runValues).where(eq(t.agentRuns.id, agentRunId));
        } else {
          const [run] = await tx.insert(t.agentRuns).values(runValues).returning({ id: t.agentRuns.id });
          agentRunId = run!.id;
        }
        await tx
          .insert(t.runTraces)
          .values({ runId: agentRunId, trace: a.trace as object })
          .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace: a.trace as object } });
      }

      const runRow = {
        workspaceId: input.workspaceId,
        ciInstallationId: input.installationId,
        agentRunId,
        workflowRunId: input.workflowRunId,
        repo: input.repo,
        agentName: a?.agentName ?? input.fallbackAgentName,
        prNumber: input.prNumber,
        prUrl: input.prUrl,
        commitSha: input.commitSha,
        ranAt: input.ranAt,
        status: input.status,
        verdict: a?.verdict ?? null,
        findingsCount: a?.findingsCount ?? null,
        critical: a?.critical ?? null,
        warning: a?.warning ?? null,
        suggestion: a?.suggestion ?? null,
        blockers: a?.blockers ?? null,
        costUsd: a?.costUsd ?? null,
        durationMs: a?.durationMs ?? null,
        githubUrl: input.githubUrl,
        source: 'ci',
        failureReason: input.failureReason,
      };
      if (existing) {
        await tx.update(t.ciRuns).set(runRow).where(eq(t.ciRuns.id, existing.id));
        return 'updated';
      }
      await tx.insert(t.ciRuns).values(runRow);
      return 'created';
    });
  }

  // ---- memory (read-only) ------------------------------------------------

  /** `scope='repo'` memory rows of exactly this workspace + repo, stable order (AC-50). */
  async repoMemory(
    workspaceId: string,
    repoId: string,
  ): Promise<{ kind: string; content: string }[]> {
    return this.db
      .select({ kind: t.memory.kind, content: t.memory.content })
      .from(t.memory)
      .where(
        and(
          eq(t.memory.workspaceId, workspaceId),
          eq(t.memory.scope, 'repo'),
          eq(t.memory.repoId, repoId),
        ),
      )
      .orderBy(t.memory.createdAt, t.memory.id);
  }
}
