/* Shared test fixtures for the results page tests. */
import type { AgentColumn, MultiAgentRun } from "@devdigest/shared";

export function column(over: Partial<AgentColumn> & Pick<AgentColumn, "run_id" | "agent_id" | "agent_name">): AgentColumn {
  return {
    provider: "openai",
    model: "gpt-4.1",
    status: "done",
    error: null,
    last_log: null,
    verdict: "request_changes",
    score: 72,
    summary: "Looks risky",
    duration_ms: 8200,
    cost_usd: 0.0123,
    findings: [],
    ...over,
  };
}

export function makeRun(over: Partial<MultiAgentRun> = {}): MultiAgentRun {
  return {
    id: "m1",
    pr_id: "pr-uuid",
    repo_id: "repo1",
    status: "done",
    pr_number: 482,
    ran_at: new Date().toISOString(),
    agent_count: 2,
    total_duration_ms: 9100,
    total_cost_usd: 0.0246,
    columns: [
      column({
        run_id: "run-sec",
        agent_id: "a-sec",
        agent_name: "Security",
        findings: [
          { id: "f1", severity: "CRITICAL", category: "security", title: "SQL injection", file: "src/db.ts", start_line: 10, end_line: 12 },
        ],
      }),
      column({ run_id: "run-perf", agent_id: "a-perf", agent_name: "Performance", score: 90, findings: [] }),
    ],
    conflicts: [],
    ...over,
  };
}
