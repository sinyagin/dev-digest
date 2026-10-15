import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentDetail, EvalCompare, EvalRunSummary } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/eval.json";

let detail: EvalAgentDetail;
let compare: EvalCompare;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: "a1", name: "Security" }] }),
}));
vi.mock("../../../../../../lib/hooks/eval", () => ({
  evalKeys: { agentDetail: (id: string) => ["eval", "agent", id] },
  useEvalAgentDetail: () => ({ data: detail, isLoading: false, isError: false, refetch: vi.fn() }),
  useEvalRunEstimate: () => ({ data: { cases: 3, executions: 3, est_cost_usd: 0.05 } }),
  useStartEvalRun: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useEvalRun: () => ({ data: undefined }),
  useEvalCompare: () => ({ data: compare, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { EvalAgentDetailView } from "./EvalAgentDetailView";

afterEach(cleanup);

const run = (id: string, at: string, over: Partial<EvalRunSummary> = {}): EvalRunSummary => ({
  id,
  agent_id: "a1",
  agent_version: 1,
  status: "completed",
  error_reason: null,
  ran_at: at,
  finished_at: at,
  case_ids: [],
  cases_done: 3,
  recall: 0.8,
  precision: 0.9,
  citation_accuracy: 1,
  traces_passed: 2,
  traces_total: 3,
  cases_errored: 0,
  duration_ms: 1000,
  cost_usd: 0.01,
  ...over,
});

const mkDetail = (runs: EvalRunSummary[], over: Partial<EvalAgentDetail> = {}): EvalAgentDetail => ({
  agent: { id: "a1", name: "Security", model: "m", provider: "p", version: 2 },
  cases_total: 3,
  latest: runs[0] ?? null,
  previous: runs[1] ?? null,
  delta: { recall: 5, precision: -2, citation_accuracy: 0 },
  trend: runs
    .slice()
    .reverse()
    .map((r) => ({
      run_id: r.id,
      ran_at: r.ran_at,
      agent_version: r.agent_version,
      recall: r.recall,
      precision: r.precision,
      citation_accuracy: r.citation_accuracy,
      pass_rate: 0.5,
      cost_usd: r.cost_usd,
    })),
  runs,
  banner: null,
  ...over,
});

const mkCompare = (over: Partial<EvalCompare> = {}): EvalCompare => ({
  old: {} as EvalCompare["old"],
  new: {} as EvalCompare["new"],
  common_cases: 2,
  metrics: {
    recall: { old: 0.5, new: 0.75, delta: 0.25 },
    precision: { old: 0.9, new: 0.8, delta: -0.1 },
    citation_accuracy: { old: 1, new: 1, delta: 0 },
    cost_usd: { old: 0.01, new: 0.02, delta: 0.01 },
  },
  case_set: { same: true, added: [], removed: [] },
  prompt: {
    old_version: 1,
    new_version: 2,
    unchanged: false,
    diff: [
      { op: "equal", line: "keep" },
      { op: "remove", line: "old line" },
      { op: "add", line: "<script>alert(1)</script>" },
    ],
  },
  ...over,
});

const R = [run("r3", "2026-01-03T00:00:00Z"), run("r2", "2026-01-02T00:00:00Z"), run("r1", "2026-01-01T00:00:00Z")];

const ui = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <EvalAgentDetailView agentId="a1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const compareBtn = () => screen.getByRole("button", { name: "Compare" });
const boxes = () => screen.getAllByRole("checkbox");

describe("EvalAgentDetailView", () => {
  it("Compare toggles by selection count; modal shows old/new/delta, diff as text, no Promote; Escape closes", async () => {
    detail = mkDetail(R);
    compare = mkCompare({ case_set: { same: false, added: [{ case_id: "c1", name: "new-case" }], removed: [{ case_id: "c2", name: "gone-case" }] } });
    const user = userEvent.setup();
    ui();

    expect(compareBtn()).toBeDisabled();
    await user.click(boxes()[0]!);
    expect(compareBtn()).toBeDisabled();
    // keyboard selection of the second row
    boxes()[1]!.focus();
    await user.keyboard(" ");
    expect(compareBtn()).toBeEnabled();
    await user.click(boxes()[2]!);
    expect(compareBtn()).toBeDisabled();
    await user.click(boxes()[2]!);

    compareBtn().focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("▲ +25.0 pts")).toBeInTheDocument();
    expect(within(dialog).getByText("▼ −10.0 pts")).toBeInTheDocument();
    expect(within(dialog).getByText("±0 pts")).toBeInTheDocument();
    expect(within(dialog).getByText(/1 case added, 1 case removed/)).toBeInTheDocument();
    expect(within(dialog).getByText(/new-case/)).toBeInTheDocument();
    expect(within(dialog).getByText(/gone-case/)).toBeInTheDocument();
    expect(within(dialog).getByText(/old line/).textContent).toContain("−");
    expect(within(dialog).getByText(/old line/).textContent).toContain("Removed");
    expect(within(dialog).getByText(/alert\(1\)/).textContent).toContain("<script>alert(1)</script>");
    expect(dialog.querySelector("script")).toBeNull();
    expect(screen.queryByRole("button", { name: /promote/i })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("same prompt version shows unchanged", async () => {
    detail = mkDetail(R);
    compare = mkCompare({ prompt: { old_version: 2, new_version: 2, unchanged: true, diff: [] } });
    const user = userEvent.setup();
    ui();
    await user.click(boxes()[0]!);
    await user.click(boxes()[1]!);
    await user.click(compareBtn());
    expect(screen.getByText("Prompt unchanged between these runs")).toBeInTheDocument();
  });

  it("banner: no cause without flips; names flipped case otherwise", () => {
    detail = mkDetail(R, { banner: { metric: "recall", direction: "down", delta_pts: 5, version: 2, flipped: [] } });
    const { unmount } = ui();
    expect(screen.getByText(/Recall down 5\.0 pts on v2/)).toBeInTheDocument();
    expect(screen.queryByText(/caused by/)).not.toBeInTheDocument();
    unmount();
    detail = mkDetail(R, {
      banner: {
        metric: "recall",
        direction: "down",
        delta_pts: 5,
        version: 2,
        flipped: [{ case_id: "c1", name: "stripe-key-leak", from_pass: true, to_pass: false }],
      },
    });
    ui();
    expect(screen.getByText(/caused by 1 case.*stripe-key-leak/)).toBeInTheDocument();
  });

  it("trend table equivalent present; one completed run: no deltas, note shown, compare disabled", () => {
    detail = mkDetail([R[0]!], { previous: null });
    ui();
    expect(screen.getByRole("table", { name: messages.detail.trendCaption })).toBeInTheDocument();
    expect(screen.queryByText(/pts$/)).not.toBeInTheDocument();
    expect(screen.getByText(messages.detail.secondRunNeeded)).toBeInTheDocument();
    expect(compareBtn()).toBeDisabled();
  });
});
