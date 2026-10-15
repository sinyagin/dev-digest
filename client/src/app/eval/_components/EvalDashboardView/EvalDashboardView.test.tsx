import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

const mutate = vi.fn();
const state: { dashboard: EvalDashboard; runAll: Record<string, unknown>; runs: Record<string, unknown> } = {
  dashboard: { agents: [], recent_runs: [] },
  runAll: {},
  runs: {},
};

vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../../lib/hooks/eval", () => ({
  useEvalDashboard: () => ({ data: state.dashboard, isLoading: false, isError: false, refetch: vi.fn() }),
  evalKeys: { dashboard: ["eval", "dashboard"] },
  useEvalRun: (id: string) => ({ data: state.runs[id], isError: false }),
  useRunAllEvals: () => ({ mutate, isPending: false, isError: false, data: undefined, ...state.runAll }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EvalDashboardView } from "./EvalDashboardView";

const point = (i: number, recall: number | null) => ({
  run_id: `r${i}`,
  ran_at: `2026-10-0${i}T10:00:00Z`,
  agent_version: i,
  recall,
  precision: 0.5,
  citation_accuracy: null,
  pass_rate: 0.5,
  cost_usd: null,
});

const run = (id: string, day: number, over: object = {}) => ({
  id,
  agent_id: "a1",
  agent_version: 2,
  status: "completed" as const,
  error_reason: null,
  ran_at: `2026-10-0${day}T10:00:00Z`,
  finished_at: null,
  case_ids: [],
  recall: 0.8,
  precision: 0.6,
  citation_accuracy: null,
  traces_passed: 3,
  traces_total: 4,
  cases_errored: 0,
  duration_ms: 1000,
  cost_usd: null,
  cases_done: 4,
  ...over,
});

function agent(id: string, name: string, cases: number, withRun: boolean) {
  return {
    agent_id: id,
    name,
    model: "gpt-4.1",
    provider: "openai",
    cases_total: cases,
    last_run: withRun ? run(`run-${id}`, 3, { agent_id: id }) : null,
    trend: withRun ? [point(1, 0.4), point(2, 0.8)] : [],
  };
}

const qc = new QueryClient();

function setup() {
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <EvalDashboardView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mutate.mockReset();
  state.runAll = {};
  state.runs = {};
  state.dashboard = {
    agents: [agent("a1", "Alpha", 4, true), agent("a2", "Beta", 2, false)],
    recent_runs: [
      { ...run("old", 1), agent_name: "Alpha" },
      { ...run("new", 5, { recall: 0.9 }), agent_name: "Beta" },
    ],
  };
});
afterEach(cleanup);

describe("EvalDashboardView", () => {
  it("lists agents in API order with metrics, sparkline, n/a for null, never-run text and the non-ranking note", () => {
    const { container } = setup();
    const rows = screen.getAllByRole("row");
    const alpha = rows.find((r) => within(r).queryByRole("link", { name: "Alpha" }))!;
    expect(within(alpha).getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/eval/agents/a1");
    expect(within(alpha).getByText("80%")).toBeInTheDocument();
    expect(within(alpha).getByText("60%")).toBeInTheDocument();
    expect(within(alpha).getByText("n/a")).toBeInTheDocument();
    expect(alpha.querySelector("svg")).not.toBeNull();
    const beta = rows.find((r) => within(r).queryByRole("link", { name: "Beta" }))!;
    expect(within(beta).getByText("never run")).toBeInTheDocument();
    expect(rows.indexOf(alpha)).toBeLessThan(rows.indexOf(beta));
    expect(screen.getByText(messages.dashboard.agents.nonRankingNote)).toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it("shows recent runs newest first with text values", () => {
    setup();
    const rows = screen.getAllByRole("row");
    const idxBeta = rows.findIndex((r) => within(r).queryByText("90%") !== null);
    const recentRows = rows.filter((r) => within(r).queryAllByText("v2").length > 0 && r.querySelectorAll("td").length === 5);
    expect(recentRows).toHaveLength(2);
    expect(idxBeta).toBeGreaterThan(-1);
    expect(within(recentRows[0]!).getByText("Beta")).toBeInTheDocument();
    expect(within(recentRows[1]!).getByText("Alpha")).toBeInTheDocument();
  });

  it("run all: confirm states executions, no POST until confirmed, per-agent failure shown", async () => {
    const user = userEvent.setup();
    const { rerender } = setup();
    await user.click(screen.getByRole("button", { name: "Run all agents" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Run 2 agents (6 executions)?")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Run all agents" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Run all agents" }));
    expect(mutate).toHaveBeenCalledTimes(1);

    state.runAll = {
      data: {
        results: [
          { agent_id: "a1", agent_name: "Alpha", run_id: "x", error: null },
          { agent_id: "a2", agent_name: "Beta", run_id: null, error: { code: "no_cases", message: "No eval cases" } },
        ],
      },
    };
    const view = () => (
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
          <EvalDashboardView />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
    rerender(view());
    expect(screen.getByText("Beta failed: No eval cases")).toBeInTheDocument();
    expect(screen.getByText("Alpha: Eval run started")).toBeInTheDocument();

    // progress per agent, then final state; dashboard refreshes once all started runs settle
    const spy = vi.spyOn(qc, "invalidateQueries");
    state.runs = { x: { status: "running", per_case: [{}, {}], case_ids: ["1", "2", "3", "4"] } };
    rerender(view());
    expect(screen.getByText("Alpha: 2 of 4 cases")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["eval", "dashboard"] });

    state.runs = { x: { status: "completed", per_case: [{}, {}, {}, {}], case_ids: ["1", "2", "3", "4"], traces_passed: 3, traces_total: 4 } };
    rerender(view());
    expect(screen.getByText("Alpha: Eval run finished: 3 of 4 passed")).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["eval", "dashboard"] }));
  });
});
