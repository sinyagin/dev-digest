import type {
  AgentColumn,
  AgentEstimatesResponse,
  MultiAgentRun,
  MultiAgentRunList,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from './repository.js';
import { buildLocationGroups, deriveRunStatus, deriveTotals } from './multi-agent-grouping.js';

const DELETED_AGENT = 'Deleted agent';

/**
 * Read side of multi-agent runs (SPEC-04): computes a `MultiAgentRun` from
 * persisted runs/findings on every read, and the per-agent run estimates. Makes
 * no LLM call and writes nothing (AC-25).
 */
export class MultiAgentService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  async get(workspaceId: string, id: string): Promise<MultiAgentRun> {
    const parent = await this.repo.getMultiAgentRun(workspaceId, id);
    if (!parent) throw new NotFoundError('Multi-agent run not found');
    const pull = await this.repo.getPull(workspaceId, parent.prId);
    if (!pull) throw new NotFoundError('Multi-agent run not found');

    const children = await this.repo.childrenOfMultiAgentRun(parent.id);
    const reviewIds = children.flatMap((c) => (c.review ? [c.review.id] : []));
    const findingRows = await this.repo.findingsByReviewIds(reviewIds);

    const columns: AgentColumn[] = children.map(({ run, agentName, review }) => {
      const status = (run.status ?? 'failed') as AgentColumn['status'];
      const live = status === 'running' ? this.container.runBus.buffer(run.id) : [];
      return {
        run_id: run.id,
        agent_id: run.agentId ?? '',
        agent_name: run.agentId ? (agentName ?? DELETED_AGENT) : DELETED_AGENT,
        provider: run.provider,
        model: run.model,
        status,
        verdict: review?.verdict ?? null,
        score: review?.score ?? run.score ?? null,
        summary: review?.summary ?? null,
        duration_ms: run.durationMs,
        cost_usd: run.costUsd,
        error: run.error,
        last_log: status === 'running' ? (live.at(-1)?.msg ?? null) : null,
        findings: review
          ? findingRows
              .filter((f) => f.reviewId === review.id)
              .map((f) => ({
                id: f.id,
                severity: f.severity as AgentColumn['findings'][number]['severity'],
                category: f.category,
                title: f.title,
                file: f.file,
                start_line: f.startLine,
                end_line: f.endLine,
                kind: f.kind,
              }))
          : [],
      };
    });
    columns.sort((a, b) => a.agent_name.localeCompare(b.agent_name) || a.run_id.localeCompare(b.run_id));

    const summaries = columns.map((c) => ({
      status: c.status,
      duration_ms: c.duration_ms,
      cost_usd: c.cost_usd,
    }));
    return {
      id: parent.id,
      pr_id: parent.prId,
      repo_id: pull.repoId,
      status: deriveRunStatus(summaries),
      pr_number: pull.number,
      ran_at: parent.ranAt.toISOString(),
      agent_count: columns.length,
      ...deriveTotals(summaries),
      columns,
      conflicts: buildLocationGroups(columns),
    };
  }

  /** Recent runs, newest first (status + totals derived like `get`). */
  async list(workspaceId: string, opts: { repoId?: string; prId?: string; limit: number }): Promise<MultiAgentRunList> {
    const rows = await this.repo.listMultiAgentRuns(workspaceId, opts);
    return rows.map(({ parent, repoId, prNumber, prTitle, children }) => {
      const summaries = children.map((c) => ({
        status: c.status ?? 'failed',
        duration_ms: c.durationMs,
        cost_usd: c.costUsd,
      }));
      return {
        id: parent.id,
        repo_id: repoId,
        pr_id: parent.prId,
        pr_number: prNumber,
        pr_title: prTitle,
        ran_at: parent.ranAt.toISOString(),
        status: deriveRunStatus(summaries),
        agent_count: children.length,
        ...deriveTotals(summaries),
      };
    });
  }

  /** Per-agent estimates: every workspace agent, nulls + sample_size 0 when no done runs. */
  async estimates(workspaceId: string): Promise<AgentEstimatesResponse> {
    const [agents, stats] = await Promise.all([
      this.container.agentsRepo.list(workspaceId),
      this.repo.estimatesForWorkspace(workspaceId),
    ]);
    const byAgent = new Map(stats.map((s) => [s.agentId, s]));
    return agents.map((a) => {
      const s = byAgent.get(a.id);
      return {
        agent_id: a.id,
        avg_duration_ms: s?.avgDurationMs ?? null,
        avg_cost_usd: s?.avgCostUsd ?? null,
        sample_size: s?.sampleSize ?? 0,
      };
    });
  }
}
