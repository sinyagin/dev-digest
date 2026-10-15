/**
 * EvalService (SPEC-03): application layer for eval cases, suite runs,
 * dry runs, compare and dashboards. No SQL here (EvalRepository), no Fastify,
 * no imports from other feature modules (narrow ports instead).
 *
 * Run lifecycle: startRun inserts a `running` row (the partial unique index
 * closes the race) and fires executeSuite in the background; the route never
 * awaits it. Only reconciliation (boot / stale pre-check) or the suite itself
 * moves a `running` row to a terminal state.
 */
import type {
  EvalAgentDetail,
  EvalCase,
  EvalCaseDraft,
  EvalCaseInput,
  EvalCaseOutcome,
  EvalCompare,
  EvalDashboard,
  EvalDryRunInput,
  EvalRunAllResult,
  EvalRunEstimate,
  EvalRunRecord,
  EvalRunSummary,
  LLMProvider,
} from '@devdigest/shared';
import { AppError, ConfigError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow, EvalCaseRow } from '../../db/rows.js';
import { EvalRepository } from './repository.js';
import {
  DETAIL_RUNS_LIMIT,
  EST_OUTPUT_TOKENS,
  INTERRUPTED_REASON,
  RECENT_RUNS_LIMIT,
  STALE_RUN_MS,
  TREND_LIMIT,
} from './constants.js';
import {
  caseRowToDto,
  caseRowToInput,
  isUniqueViolation,
  recordToSummary,
  runRowToRecord,
  runRowToSummary,
} from './helpers.js';
import type { EvalDeps, EvalLogger, EvalPorts } from './ports.js';
import { aggregate, erroredOutcome, scoreCase } from './scoring.js';
import { compareRuns, deltaPts, deriveBanner, latestTwoCompleted, toTrend } from './analytics.js';
import { buildDraft, checkExpectationGrounded } from './frozen-input.js';
import { executeCase, type EvalIdentity } from './executor.js';

type CaseUpdate = Partial<Omit<EvalCaseInput, 'source_finding_id'>>;

const unprocessable = (code: string, message: string, details?: unknown): AppError =>
  new AppError(code, message, 422, details);

export class EvalService {
  private readonly repo: EvalRepository;

  constructor(
    private readonly deps: EvalDeps,
    private readonly ports: EvalPorts,
    private readonly logger?: EvalLogger,
  ) {
    this.repo = new EvalRepository(deps.db);
  }

  // ---- drafts & cases ----------------------------------------------------

  /** Pre-fill for the "add as eval case" modal. No writes. */
  async getDraftForFinding(ws: string, findingId: string): Promise<EvalCaseDraft> {
    const ctx = await this.ports.findings.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== ws) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;
    if (!finding.acceptedAt && !finding.dismissedAt) {
      throw unprocessable('eval_finding_untriaged', 'Accept or dismiss the finding before saving it as an eval case');
    }
    const agent = review.agentId ? await this.ports.agents.getById(ws, review.agentId) : undefined;
    if (!agent) throw unprocessable('eval_finding_no_agent', 'The finding has no reviewing agent in this workspace');

    const files = await this.ports.findings.getPrFiles(pull.id);
    const prFile = files.find((f) => f.path === finding.file);
    const existing = await this.repo.cases.findCaseBySource(ws, agent.id, finding.id);
    return buildDraft({
      finding,
      pull,
      prFilePatch: prFile?.patch ?? null,
      agent: { id: agent.id, name: agent.name },
      existingCaseId: existing?.id ?? null,
    });
  }

  async createCase(ws: string, agentId: string, input: EvalCaseInput): Promise<EvalCase> {
    await this.requireAgent(ws, agentId);
    this.assertGrounded(input.input_diff, input.expectation);
    if (input.source_finding_id) {
      const ctx = await this.ports.findings.findingContext(input.source_finding_id);
      if (!ctx || ctx.pull.workspaceId !== ws) throw new NotFoundError('Source finding not found');
    }
    try {
      const row = await this.repo.cases.insertCase({
        workspaceId: ws,
        ownerKind: 'agent',
        ownerId: agentId,
        name: input.name,
        inputDiff: input.input_diff,
        inputFiles: input.input_files,
        inputMeta: input.input_meta,
        expectedOutput: input.expectation,
        sourceFindingId: input.source_finding_id ?? null,
        notes: input.notes ?? null,
      });
      return caseRowToDto(row);
    } catch (err) {
      if (isUniqueViolation(err) && input.source_finding_id) {
        const existing = await this.repo.cases.findCaseBySource(ws, agentId, input.source_finding_id);
        throw new AppError('eval_case_exists', 'An eval case already exists for this finding', 409, {
          case_id: existing?.id ?? null,
        });
      }
      throw err;
    }
  }

  async listCases(ws: string, agentId: string): Promise<EvalCase[]> {
    await this.requireAgent(ws, agentId);
    return (await this.repo.cases.listCasesByOwner(ws, agentId)).map(caseRowToDto);
  }

  async getCase(ws: string, id: string): Promise<EvalCase> {
    return caseRowToDto(await this.requireCase(ws, id));
  }

  /** Edits the case only; stored runs are never touched (AC-14). */
  async updateCase(ws: string, id: string, patch: CaseUpdate): Promise<EvalCase> {
    const existing = caseRowToDto(await this.requireCase(ws, id));
    this.assertGrounded(patch.input_diff ?? existing.input_diff, patch.expectation ?? existing.expectation);
    const row = await this.repo.cases.updateCase(ws, id, {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.input_diff !== undefined && { inputDiff: patch.input_diff }),
      ...(patch.input_files !== undefined && { inputFiles: patch.input_files }),
      ...(patch.input_meta !== undefined && { inputMeta: patch.input_meta }),
      ...(patch.expectation !== undefined && { expectedOutput: patch.expectation }),
      ...(patch.notes !== undefined && { notes: patch.notes ?? null }),
    });
    if (!row) throw new NotFoundError('Eval case not found');
    return caseRowToDto(row);
  }

  async deleteCase(ws: string, id: string): Promise<void> {
    if (!(await this.repo.cases.deleteCase(ws, id))) throw new NotFoundError('Eval case not found');
  }

  // ---- dry run -----------------------------------------------------------

  async dryRun(ws: string, agentId: string, body: EvalDryRunInput): Promise<EvalCaseOutcome> {
    const agent = await this.requireAgent(ws, agentId);
    let input: EvalCaseInput;
    let caseId: string | null = null;
    if ('case_id' in body) {
      const row = await this.requireCase(ws, body.case_id);
      if (row.ownerKind !== 'agent' || row.ownerId !== agentId) throw new NotFoundError('Eval case not found');
      input = caseRowToInput(row);
      caseId = row.id;
    } else {
      input = body.draft;
    }
    this.assertGrounded(input.input_diff, input.expectation);

    const identity = await this.buildIdentity(agent);
    const llm = await this.resolveLlm(agent);
    const meta = { case_id: caseId, name: input.name, expectation_type: input.expectation.type };
    const res = await executeCase(identity, input, llm);
    const outcome =
      'error' in res
        ? erroredOutcome(meta, res.error, 0)
        : scoreCase({
            kept: res.kept,
            droppedCount: res.dropped.length,
            expectation: input.expectation,
            caseMeta: meta,
            durationMs: res.durationMs,
            costUsd: res.costUsd,
          });
    if (caseId) await this.repo.cases.setLastResult(ws, caseId, outcome, new Date());
    return outcome;
  }

  // ---- runs --------------------------------------------------------------

  /** Read-only pre-run count + cost estimate. No LLM call. */
  async estimateRun(ws: string, agentId: string): Promise<EvalRunEstimate> {
    const agent = await this.requireAgent(ws, agentId);
    const cases = await this.repo.cases.listCasesByOwner(ws, agentId);
    if (cases.length === 0) return { cases: 0, executions: 0, est_cost_usd: 0 };
    const identity = await this.buildIdentity(agent);
    const base = identity.systemPrompt + identity.skillBodies.join('\n');
    let total: number | null = 0;
    for (const c of cases) {
      const input = caseRowToInput(c);
      const tokensIn = this.deps.tokenizer.count(
        base + input.input_diff + input.input_meta.title + (input.input_meta.body ?? ''),
      );
      const est = this.deps.priceBook.estimate(agent.model, tokensIn, EST_OUTPUT_TOKENS);
      total = total === null || est === null ? null : total + est;
    }
    return { cases: cases.length, executions: cases.length, est_cost_usd: total };
  }

  async startRun(ws: string, agentId: string): Promise<EvalRunRecord> {
    const agent = await this.requireAgent(ws, agentId);
    await this.repo.runs.reconcileStale(ws, agentId, new Date(Date.now() - STALE_RUN_MS));
    if (await this.repo.runs.runningRunForAgent(ws, agentId)) throw this.inFlight();

    const cases = await this.repo.cases.listCasesByOwner(ws, agentId);
    if (cases.length === 0) throw unprocessable('eval_no_cases', 'This agent has no eval cases to run');

    const llm = await this.resolveLlm(agent);
    const identity = await this.buildIdentity(agent);

    let run;
    try {
      run = await this.repo.runs.insertRun({
        workspaceId: ws,
        agentId,
        agentVersion: agent.version,
        caseIds: cases.map((c) => c.id),
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.inFlight();
      throw err;
    }

    // Fire-and-forget: never awaited by the caller (AC-15).
    void this.executeSuite(ws, run.id, cases, identity, llm).catch((err) => {
      this.logger?.warn({ runId: run.id, agentId, err: err instanceof Error ? err.name : 'unknown' }, 'eval suite failed');
      void this.repo.runs.failRun(run.id, 'internal_error').catch(() => undefined);
    });
    return runRowToRecord(run);
  }

  /** Sequential suite execution. Exposed (not private) so tests can await it deterministically. */
  async executeSuite(
    ws: string,
    runId: string,
    cases: EvalCaseRow[],
    identity: EvalIdentity,
    llm: LLMProvider,
  ): Promise<void> {
    const started = Date.now();
    const outcomes: EvalCaseOutcome[] = [];
    for (const row of cases) {
      let input: EvalCaseInput | null = null;
      try {
        input = caseRowToInput(row);
      } catch {
        input = null;
      }
      let outcome: EvalCaseOutcome;
      if (!input) {
        outcome = erroredOutcome(
          { case_id: row.id, name: row.name, expectation_type: 'must_find' },
          'invalid_case',
          0,
        );
      } else {
        const meta = { case_id: row.id, name: input.name, expectation_type: input.expectation.type };
        const res = await executeCase(identity, input, llm);
        outcome =
          'error' in res
            ? erroredOutcome(meta, res.error, 0)
            : scoreCase({
                kept: res.kept,
                droppedCount: res.dropped.length,
                expectation: input.expectation,
                caseMeta: meta,
                durationMs: res.durationMs,
                costUsd: res.costUsd,
              });
      }
      outcomes.push(outcome);
      await this.repo.runs.appendCaseOutcome(runId, outcome);
      await this.repo.cases.setLastResult(ws, row.id, outcome, new Date());
    }
    const agg = aggregate(outcomes);
    await this.repo.runs.completeRun(runId, {
      tracesPassed: agg.traces_passed,
      tracesTotal: agg.traces_total,
      casesErrored: agg.cases_errored,
      recall: agg.recall,
      precision: agg.precision,
      citationAccuracy: agg.citation_accuracy,
      durationMs: agg.duration_ms,
      costUsd: agg.cost_usd,
    });
    this.logger?.info(
      {
        runId,
        agentId: identity.agentId,
        version: identity.version,
        cases: cases.length,
        scored: agg.traces_total,
        errored: agg.cases_errored,
        recall: agg.recall,
        precision: agg.precision,
        citation: agg.citation_accuracy,
        costUsd: agg.cost_usd,
        durationMs: Date.now() - started,
      },
      'eval suite completed',
    );
  }

  /** Run every enabled agent that has cases. Never throws as a whole (AC-31). */
  async startAll(ws: string): Promise<EvalRunAllResult> {
    const agents = (await this.ports.agents.list(ws)).filter((a) => a.enabled);
    const counts = await this.repo.cases.countCasesByOwner(ws);
    const results: EvalRunAllResult['results'] = [];
    for (const a of agents) {
      if ((counts.get(a.id) ?? 0) < 1) continue;
      try {
        const run = await this.startRun(ws, a.id);
        results.push({ agent_id: a.id, agent_name: a.name, run_id: run.id, error: null });
      } catch (err) {
        const error =
          err instanceof AppError
            ? { code: err.code, message: err.message }
            : { code: 'internal_error', message: 'Failed to start the run' };
        results.push({ agent_id: a.id, agent_name: a.name, run_id: null, error });
      }
    }
    return { results };
  }

  async getRun(ws: string, id: string): Promise<EvalRunRecord> {
    const row = await this.repo.runs.getRun(ws, id);
    if (!row) throw new NotFoundError('Eval run not found');
    return runRowToRecord(row);
  }

  async listRuns(ws: string, agentId: string): Promise<EvalRunSummary[]> {
    await this.requireAgent(ws, agentId);
    return (await this.repo.runs.listRunsByAgent(ws, agentId, DETAIL_RUNS_LIMIT)).map(runRowToSummary);
  }

  async compare(ws: string, a: string, b: string): Promise<EvalCompare> {
    const [rowA, rowB] = await Promise.all([this.repo.runs.getRun(ws, a), this.repo.runs.getRun(ws, b)]);
    if (!rowA || !rowB) throw new NotFoundError('Eval run not found');
    if (rowA.agentId !== rowB.agentId) {
      throw unprocessable('eval_compare_mismatch', 'Runs must belong to the same agent');
    }
    const [promptA, promptB] = await Promise.all([
      this.promptFor(rowA.agentId, rowA.agentVersion),
      this.promptFor(rowB.agentId, rowB.agentVersion),
    ]);
    return compareRuns(runRowToRecord(rowA), runRowToRecord(rowB), promptA, promptB);
  }

  // ---- dashboards --------------------------------------------------------

  async dashboard(ws: string): Promise<EvalDashboard> {
    const [agents, counts, recent] = await Promise.all([
      this.ports.agents.list(ws),
      this.repo.cases.countCasesByOwner(ws),
      this.repo.runs.listRecentRuns(ws, RECENT_RUNS_LIMIT),
    ]);
    const summaries = await Promise.all(
      agents.map(async (a) => {
        const runs = (await this.repo.runs.listRunsByAgent(ws, a.id, TREND_LIMIT)).map(runRowToSummary);
        return {
          agent_id: a.id,
          name: a.name,
          model: a.model,
          provider: a.provider,
          cases_total: counts.get(a.id) ?? 0,
          last_run: runs[0] ?? null,
          trend: toTrend(runs, TREND_LIMIT),
        };
      }),
    );
    return {
      agents: summaries,
      recent_runs: recent.map((r) => ({ ...runRowToSummary(r), agent_name: r.agentName ?? '' })),
    };
  }

  async agentDetail(ws: string, agentId: string): Promise<EvalAgentDetail> {
    const agent = await this.requireAgent(ws, agentId);
    const [rows, counts] = await Promise.all([
      this.repo.runs.listRunsByAgent(ws, agentId, DETAIL_RUNS_LIMIT),
      this.repo.cases.countCasesByOwner(ws),
    ]);
    const records = rows.map(runRowToRecord);
    const { latest, previous } = latestTwoCompleted(records);
    const summaries = records.map(recordToSummary);
    return {
      agent: { id: agent.id, name: agent.name, model: agent.model, provider: agent.provider, version: agent.version },
      cases_total: counts.get(agentId) ?? 0,
      latest: latest ? recordToSummary(latest) : null,
      previous: previous ? recordToSummary(previous) : null,
      delta: {
        recall: deltaPts(previous?.recall ?? null, latest?.recall ?? null),
        precision: deltaPts(previous?.precision ?? null, latest?.precision ?? null),
        citation_accuracy: deltaPts(previous?.citation_accuracy ?? null, latest?.citation_accuracy ?? null),
      },
      trend: toTrend(summaries, TREND_LIMIT),
      runs: summaries,
      banner: deriveBanner(latest, previous),
    };
  }

  // ---- lifecycle ---------------------------------------------------------

  /** Boot: no suite survives a restart, so EVERY `running` row becomes errored/'interrupted' (Q5). */
  async reconcileOnBoot(): Promise<number> {
    return this.repo.runs.reconcileStale(null, null, new Date(Date.now() + 60_000));
  }

  // ---- internals ---------------------------------------------------------

  private inFlight(): AppError {
    return new AppError('eval_run_in_flight', 'A run for this agent is already in progress', 409);
  }

  private assertGrounded(inputDiff: string, expectation: EvalCaseInput['expectation']): void {
    const check = checkExpectationGrounded(inputDiff, expectation);
    if (!check.ok) throw unprocessable('eval_expectation_ungrounded', check.reason);
  }

  private async requireAgent(ws: string, agentId: string): Promise<AgentRow> {
    const agent = await this.ports.agents.getById(ws, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  private async requireCase(ws: string, id: string): Promise<EvalCaseRow> {
    const row = await this.repo.cases.getCase(ws, id);
    if (!row || row.ownerKind !== 'agent') throw new NotFoundError('Eval case not found');
    return row;
  }

  /** Missing provider key -> 422 (not the container's 500 ConfigError). Constructs, never calls. */
  private async resolveLlm(agent: AgentRow): Promise<LLMProvider> {
    try {
      return await this.deps.llm(agent.provider);
    } catch (err) {
      if (err instanceof ConfigError) {
        throw unprocessable('eval_provider_key_missing', `No API key configured for provider "${agent.provider}"`);
      }
      throw err;
    }
  }

  /** Identity = agent row + ENABLED linked skills only (mirrors run-executor). */
  private async buildIdentity(agent: AgentRow): Promise<EvalIdentity> {
    const linked = await this.ports.agents.linkedSkills(agent.id);
    return {
      agentId: agent.id,
      version: agent.version,
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      provider: agent.provider,
      strategy: agent.strategy,
      skillBodies: linked.filter((l) => l.skill.enabled).map((l) => l.skill.body),
    };
  }

  private async promptFor(agentId: string, version: number): Promise<string> {
    const v = await this.ports.agents.getVersion(agentId, version);
    const cfg = v?.configJson as { system_prompt?: unknown } | null | undefined;
    return typeof cfg?.system_prompt === 'string' ? cfg.system_prompt : '';
  }
}
