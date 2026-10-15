/** Row -> DTO mapping for the eval module. jsonb columns are validated with the shared schemas. */
import {
  EvalCaseMeta,
  EvalCaseOutcome,
  EvalExpectation,
  type EvalCase,
  type EvalCaseInput,
  type EvalRunRecord,
  type EvalRunSummary,
} from '@devdigest/shared';
import { z } from 'zod';
import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';

const iso = (d: Date): string => d.toISOString();
const StringArray = z.array(z.string());
const Outcomes = z.array(EvalCaseOutcome);

export function caseRowToDto(row: EvalCaseRow): EvalCase {
  const lastResult = EvalCaseOutcome.safeParse(row.lastResult);
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff,
    input_files: StringArray.parse(row.inputFiles),
    input_meta: EvalCaseMeta.parse(row.inputMeta),
    expectation: EvalExpectation.parse(row.expectedOutput),
    source_finding_id: row.sourceFindingId ?? null,
    notes: row.notes ?? null,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    last_result: lastResult.success ? lastResult.data : null,
    last_result_at: row.lastResultAt ? iso(row.lastResultAt) : null,
  };
}

/** The frozen engine input of a stored case. */
export function caseRowToInput(row: EvalCaseRow): EvalCaseInput {
  return {
    name: row.name,
    input_diff: row.inputDiff,
    input_files: StringArray.parse(row.inputFiles),
    input_meta: EvalCaseMeta.parse(row.inputMeta),
    expectation: EvalExpectation.parse(row.expectedOutput),
    notes: row.notes,
    source_finding_id: row.sourceFindingId,
  };
}

export function runRowToRecord(row: EvalRunRow): EvalRunRecord {
  const perCase = Outcomes.safeParse(row.perCase);
  const caseIds = StringArray.safeParse(row.caseIds);
  return {
    id: row.id,
    agent_id: row.agentId,
    agent_version: row.agentVersion,
    status: row.status,
    error_reason: row.errorReason ?? null,
    ran_at: iso(row.ranAt),
    finished_at: row.finishedAt ? iso(row.finishedAt) : null,
    case_ids: caseIds.success ? caseIds.data : [],
    recall: row.recall ?? null,
    precision: row.precision ?? null,
    citation_accuracy: row.citationAccuracy ?? null,
    traces_passed: row.tracesPassed,
    traces_total: row.tracesTotal,
    cases_errored: row.casesErrored,
    duration_ms: row.durationMs ?? 0,
    cost_usd: row.costUsd ?? null,
    per_case: perCase.success ? perCase.data : [],
  };
}

export function recordToSummary(rec: EvalRunRecord): EvalRunSummary {
  const { per_case, ...rest } = rec;
  return { ...rest, cases_done: per_case.length };
}

export function runRowToSummary(row: EvalRunRow): EvalRunSummary {
  return recordToSummary(runRowToRecord(row));
}

/** Postgres unique_violation (23505), directly or wrapped as `cause` by the driver layer. */
export function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
    if ((cur as { code?: unknown }).code === '23505') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
