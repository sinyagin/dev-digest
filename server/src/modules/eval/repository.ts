import type { Db } from '../../db/client.js';
import { EvalCaseRepo } from './repository/case.repo.js';
import { EvalRunRepo } from './repository/run.repo.js';

export type { EvalCaseRow, EvalCaseInsert, EvalCasePatch } from './repository/case.repo.js';
export type { EvalRunRow, EvalRunWithAgent, EvalRunMetrics } from './repository/run.repo.js';

/** Eval persistence facade: composes the case and run repositories. */
export class EvalRepository {
  readonly cases: EvalCaseRepo;
  readonly runs: EvalRunRepo;

  constructor(db: Db) {
    this.cases = new EvalCaseRepo(db);
    this.runs = new EvalRunRepo(db);
  }
}
