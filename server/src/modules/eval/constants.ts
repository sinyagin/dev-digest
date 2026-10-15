/** Eval module tunables (SPEC-03). */

/** A `running` row older than this is considered dead by startRun's pre-check. */
export const STALE_RUN_MS = 15 * 60_000;
/** Max trend points returned per agent. */
export const TREND_LIMIT = 20;
/** Recent runs listed on the dashboard. */
export const RECENT_RUNS_LIMIT = 20;
/** Run history rows loaded for the agent detail view. */
export const DETAIL_RUNS_LIMIT = 50;
/** Output-token assumption per case execution for the pre-run cost estimate. */
export const EST_OUTPUT_TOKENS = 1000;
/** Reason stamped on rows reconciled after a restart / stale detection. */
export const INTERRUPTED_REASON = 'interrupted';
