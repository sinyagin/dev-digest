/* AC-66 — the column actions really mount the shared RunTraceDrawer. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import maMessages from "../../../../../../../messages/en/multiAgentRun.json";
import runsMessages from "../../../../../../../messages/en/runs.json";
import { makeRun } from "./fixtures";

const traceFor = (agent: string): RunTrace => ({
  config: { agent, version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.0013, findings: 1, grounding: "1/1 passed" },
  prompt_assembly: { system: "sys", skills: "", memory: null, specs: null, user: "usr" },
  tool_calls: [],
  raw_output: "{}",
  memory_pulled: [],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: `Starting review with agent ${agent}` },
    { t: "00.90", kind: "result", msg: `${agent} finished grounding` },
  ],
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo1", multiRunId: "m1" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks/trace", () => ({
  useRunTrace: (runId: string) => ({
    data: traceFor(runId === "run-sec" ? "Security" : "Performance"),
    isLoading: false,
  }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));
vi.mock("@/lib/hooks", () => ({
  useMultiAgentRun: () => ({ data: makeRun(), isLoading: false, error: null, refetch: vi.fn() }),
  usePulls: () => ({ data: [] }),
  usePrReviews: () => ({ data: [], refetch: vi.fn() }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

import Page from "../page";

afterEach(cleanup);

describe("AC-66 results page opens the shared drawer", () => {
  it("View trace and Logs mount ONE drawer for that run; another agent replaces it; Escape closes", async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={{ multiAgentRun: maMessages, runs: runsMessages }}>
        <Page />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // 1. View trace -> trace tab with Configuration + Stats
    const traceBtn = screen.getByRole("button", { name: "View trace for Security" });
    await user.click(traceBtn);
    let dialog = screen.getByRole("dialog");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(dialog).toHaveTextContent("Security");
    expect(dialog).toHaveTextContent("#482");
    expect(within(dialog).getAllByText("Configuration").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Stats").length).toBeGreaterThan(0);
    expect(within(dialog).queryByPlaceholderText("Filter log…")).not.toBeInTheDocument();

    // 2. Logs for the same agent -> Log tab content with the fixture lines
    await user.click(screen.getByRole("button", { name: "Logs for Security" }));
    dialog = screen.getByRole("dialog");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(dialog).getByPlaceholderText("Filter log…")).toBeInTheDocument();
    expect(within(dialog).getByText(/Starting review with agent Security/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Security finished grounding/)).toBeInTheDocument();

    // 3. Another agent replaces the drawer (still exactly one dialog)
    await user.click(screen.getByRole("button", { name: "View trace for Performance" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent("Performance");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Security");

    // 4. Escape closes and focus returns to a column action button
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const active = document.activeElement as HTMLElement;
    expect(active.tagName).toBe("BUTTON");
    expect(active).toHaveAccessibleName(/^(View trace|Logs) for /);
  });
});
