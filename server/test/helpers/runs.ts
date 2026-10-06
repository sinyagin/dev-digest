import * as t from '../../src/db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import type { PgFixture } from './pg.js';

/**
 * `runReview` is fire-and-forget: the POST returns runIds immediately and each
 * agent's review is persisted in the background (the client subscribes to SSE).
 * Tests that assert on persisted reviews/findings/traces must first wait for the
 * background runs to finish. This polls `agent_runs` until every row for the PR
 * reaches a terminal status (done / failed / cancelled).
 */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export async function waitForPrRuns(
  db: PgFixture['handle']['db'],
  prId: string,
  opts: { expected?: number; timeoutMs?: number } = {},
): Promise<Array<typeof t.agentRuns.$inferSelect>> {
  const { expected, timeoutMs = 10_000 } = opts;
  const start = Date.now();
  for (;;) {
    const runs = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    const terminal = runs.filter((r) => TERMINAL.has(r.status ?? ''));
    // With an explicit `expected`, wait until that many runs finish (ignores any
    // extra rows, e.g. a trifecta scan). Otherwise wait for all rows to settle.
    const reachedExpected =
      expected != null
        ? terminal.length >= expected
        : runs.length > 0 && terminal.length === runs.length;
    // `run-executor.ts` writes `agent_runs.status = 'done'|'failed'|'cancelled'`
    // (via `completeAgentRun`) and THEN persists the `run_traces` row (via
    // `saveRunTrace`) as two separate sequential awaits in the same background
    // promise — there's no transaction tying them together. A poller that only
    // checks `status` can observe the terminal status the instant it commits,
    // before the trace row exists yet. Every caller of this helper immediately
    // reads back review/finding/trace data once it returns, so also wait for a
    // matching `run_traces` row per terminal run before declaring it done —
    // otherwise callers intermittently see a reached-terminal-status run whose
    // trace isn't readable yet (surfaces as a confusing "trace.prompt_assembly
    // is undefined" downstream failure, not a timeout).
    let done = false;
    if (reachedExpected && terminal.length > 0) {
      const traceRows = await db
        .select({ runId: t.runTraces.runId })
        .from(t.runTraces)
        .where(inArray(t.runTraces.runId, terminal.map((r) => r.id)));
      done = traceRows.length === terminal.length;
    } else {
      done = reachedExpected;
    }
    if (done) return runs;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitForPrRuns timed out after ${timeoutMs}ms: ${terminal.length}/${expected ?? runs.length} runs reached a terminal status`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}
