import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/multiAgentRun.json";
import { ApiError } from "@/lib/api";
import { column, makeRun } from "./fixtures";

const h = vi.hoisted(() => ({
  run: undefined as unknown,
  error: null as unknown,
  query: "",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo1", multiRunId: "m1" }),
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(h.query),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/run-trace-drawer", () => ({ default: () => null }));
vi.mock("@/lib/hooks", () => ({
  useMultiAgentRun: () => ({
    data: h.error ? undefined : h.run,
    isLoading: false,
    error: h.error,
    refetch: vi.fn(),
  }),
  usePulls: () => ({ data: [{ id: "pr-uuid", number: 482, title: "Harden login" }] }),
  usePrReviews: () => ({ data: [], refetch: vi.fn() }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

import Page from "../page";

const ui = () => (
  <NextIntlClientProvider locale="en" messages={{ multiAgentRun: messages }}>
    <Page />
  </NextIntlClientProvider>
);
const setRun = (r: MultiAgentRun) => {
  h.run = r;
};

class ForbiddenEventSource {
  constructor() {
    throw new Error("EventSource must not be constructed by the results page");
  }
}

beforeEach(() => {
  h.run = makeRun();
  h.error = null;
  h.query = "";
  h.replace.mockClear();
  vi.stubGlobal("EventSource", ForbiddenEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const four = (): MultiAgentRun =>
  makeRun({
    status: "running",
    agent_count: 4,
    total_cost_usd: null,
    columns: [
      column({ run_id: "r1", agent_id: "a1", agent_name: "Security", status: "running", score: null, duration_ms: null, cost_usd: null, last_log: "reading src/db.ts" }),
      column({ run_id: "r2", agent_id: "a2", agent_name: "Performance", status: "done", score: 88, findings: [] }),
      column({ run_id: "r3", agent_id: "a3", agent_name: "Style", status: "failed", score: null, error: "provider timeout" }),
      column({ run_id: "r4", agent_id: "a4", agent_name: "Tests", status: "cancelled", score: null }),
    ],
  });

describe("multi-agent results page", () => {
  it("renders per-column elements, statuses, last_log, failed reason, header and never opens SSE", () => {
    setRun(four());
    render(ui());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Multi-Agent Review · 4 selected agents · parallel",
    );
    expect(screen.getByText("Harden login")).toBeInTheDocument();
    expect(screen.getByText(/4 agents · parallel fan-out · 9\.1s so far · — so far/)).toBeInTheDocument();

    const sec = screen.getByRole("region", { name: "Security" });
    expect(within(sec).getByText(/^Running · /)).toBeInTheDocument();
    expect(within(sec).getByText("reading src/db.ts")).toBeInTheDocument();
    expect(within(sec).getByRole("button", { name: "View trace for Security" })).toBeInTheDocument();
    expect(within(sec).getByRole("button", { name: "Logs for Security" })).toBeInTheDocument();
    expect(within(sec).getByRole("img", { name: "Score unavailable" })).toHaveTextContent("—");

    const perf = screen.getByRole("region", { name: "Performance" });
    expect(within(perf).getByText("Done")).toBeInTheDocument();
    expect(within(perf).getByRole("img", { name: "Score 88" })).toHaveTextContent("88");
    expect(within(perf).getByText("No findings")).toBeInTheDocument();

    const style = screen.getByRole("region", { name: "Style" });
    expect(within(style).getByText("Failed")).toBeInTheDocument();
    expect(within(style).getByText("Failed: provider timeout")).toBeInTheDocument();
    expect(within(style).queryByRole("img")).not.toBeInTheDocument();

    expect(within(screen.getByRole("region", { name: "Tests" })).getByText("Cancelled")).toBeInTheDocument();
  });

  it("announces a finished agent when a poll flips it to done and shows its findings", () => {
    setRun(four());
    const { rerender } = render(ui());
    const next = four();
    next.columns[0] = column({
      run_id: "r1",
      agent_id: "a1",
      agent_name: "Security",
      findings: [
        { id: "f1", severity: "WARNING", category: "bug", title: "Unchecked input", file: "src/a.ts", start_line: 4, end_line: 5 },
      ],
    });
    setRun(next);
    rerender(ui());

    expect(screen.getByRole("status")).toHaveTextContent("Security: Done");
    const sec = screen.getByRole("region", { name: "Security" });
    expect(within(sec).getByText("Unchecked input")).toBeInTheDocument();
    expect(within(sec).getByText("src/a.ts:4")).toBeInTheDocument();
    expect(within(sec).getByText("Warning")).toBeInTheDocument();
    expect(within(sec).getByText("1 finding")).toBeInTheDocument();
  });

  it("toggles the view through ?view= and starts in Tabs when the URL says so", async () => {
    const user = userEvent.setup();
    render(ui());
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tabs" }));
    expect(h.replace).toHaveBeenCalledWith("/repos/repo1/multi-agent/m1?view=tabs");
    cleanup();

    h.query = "view=tabs";
    render(ui());
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    // the disagreement block is present in both modes
    expect(screen.getByRole("region", { name: "Where agents disagree" })).toBeInTheDocument();
  });

  it("renders disagreement rows, 'did not flag', the conflicts filter and empty states; escapes untrusted text", async () => {
    const user = userEvent.setup();
    const evil = "<img src=x onerror=alert(1)>";
    const run = makeRun({
      agent_count: 3,
      columns: [
        column({
          run_id: "r1", agent_id: "a1", agent_name: "Security",
          findings: [{ id: "f1", severity: "CRITICAL", category: "bug", title: evil, file: "src/a.ts", start_line: 1, end_line: 2 }],
        }),
        column({ run_id: "r2", agent_id: "a2", agent_name: "Performance" }),
        column({ run_id: "r3", agent_id: "a3", agent_name: "Style" }),
      ],
      conflicts: [
        {
          file: "src/a.ts", line: 1, end_line: 2, conflict: true, title: "Bad query",
          takes: [
            { agent_id: "a1", persona: "Security", verdict: "CRITICAL", note: evil, finding_ids: ["f1"] },
            { agent_id: "a2", persona: "Performance", verdict: "ignored", note: "", finding_ids: [] },
            { agent_id: "a3", persona: "Style", verdict: "ignored", note: "", finding_ids: [] },
          ],
        },
        {
          file: "src/b.ts", line: 5, end_line: 9, conflict: false, title: "Same view",
          takes: [
            { agent_id: "a1", persona: "Security", verdict: "WARNING", note: "n", finding_ids: ["f2"] },
            { agent_id: "a2", persona: "Performance", verdict: "WARNING", note: "n", finding_ids: ["f3"] },
          ],
        },
      ],
    });
    setRun(run);
    const { container } = render(ui());

    const block = screen.getByRole("region", { name: "Where agents disagree" });
    expect(within(block).getByText("src/a.ts:1-2")).toBeInTheDocument();
    expect(within(block).getByText("Bad query")).toBeInTheDocument();
    expect(within(block).getAllByText("did not flag")).toHaveLength(2);
    expect(within(block).getByText("Conflict")).toBeInTheDocument();
    expect(within(block).queryByText("src/b.ts:5-9")).not.toBeInTheDocument();
    expect(within(block).getAllByRole("listitem")).toHaveLength(1);

    // escaped text in a column and in a take cell, no <img>
    expect(screen.getAllByText(evil).length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector("img")).toBeNull();

    // toggle off: only the number of rows changes
    await user.click(screen.getByRole("checkbox", { name: "Show only conflicts" }));
    expect(within(block).getByText("src/b.ts:5-9")).toBeInTheDocument();
    expect(within(block).getAllByText("Agree")).toHaveLength(1);
    expect(within(block).getAllByText("did not flag")).toHaveLength(2);
    cleanup();

    // all agree
    setRun(makeRun({ conflicts: [run.conflicts[1]!] }));
    render(ui());
    expect(screen.getByText(/All participating agents agree/)).toBeInTheDocument();
    cleanup();

    // needs two, with running count
    setRun(four());
    render(ui());
    expect(screen.getByText(/At least two finished agents are needed.*1 still running/)).toBeInTheDocument();
  });

  it("shows not-found with a Configure link on 404, and the empty run summaries", () => {
    h.error = new ApiError("nope", 404);
    render(ui());
    expect(screen.getByText("Multi-agent run not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure run" })).toHaveAttribute("href", "/multi-agent-review?repo=repo1");
    cleanup();

    h.error = null;
    setRun(makeRun({ status: "failed", total_cost_usd: null, columns: [column({ run_id: "r1", agent_id: "a1", agent_name: "Security", status: "failed", score: null, error: "x" })] }));
    render(ui());
    expect(screen.getByText("No agent completed")).toBeInTheDocument();
    cleanup();

    setRun(makeRun({ columns: [], agent_count: 0 }));
    render(ui());
    expect(screen.getByText("This multi-agent run has no remaining agent runs")).toBeInTheDocument();
  });

  it("Tabs mode follows the tablist pattern with roving tabindex and arrow keys", async () => {
    const user = userEvent.setup();
    h.query = "view=tabs";
    render(ui());
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Security · 72", "Performance · 90"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");
    tabs[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab")[1]).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Performance");
    await user.keyboard("{Home}");
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
  });
});
