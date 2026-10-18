/* Regression: reviews fetched while children are running come back empty, so
   the page must refetch them when a column settles — otherwise Tabs mode says
   "no findings" for an agent whose column shows findings. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/multiAgentRun.json";
import { column, makeRun } from "./fixtures";

const refetchReviews = vi.fn();
let currentRun: MultiAgentRun;

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo1", multiRunId: "m1" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/run-trace-drawer", () => ({ default: () => null }));
vi.mock("@/lib/hooks", () => ({
  useMultiAgentRun: () => ({ data: currentRun, isLoading: false, error: null, refetch: vi.fn() }),
  usePulls: () => ({ data: [] }),
  usePrReviews: () => ({ data: [], refetch: refetchReviews }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import Page from "../page";

afterEach(() => {
  cleanup();
  refetchReviews.mockReset();
});

const cols = (secStatus: "running" | "done", perfStatus: "running" | "done") => [
  column({ run_id: "run-sec", agent_id: "a-sec", agent_name: "Security", status: secStatus }),
  column({ run_id: "run-perf", agent_id: "a-perf", agent_name: "Performance", status: perfStatus }),
];

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgentRun: messages }}>
      <Page />
    </NextIntlClientProvider>,
  );
}

describe("results page — reviews refetch", () => {
  it("refetches reviews each time another column settles, not on first render", () => {
    currentRun = makeRun({ status: "running", columns: cols("running", "running") });
    const { rerender } = renderPage();
    expect(refetchReviews).not.toHaveBeenCalled();

    currentRun = makeRun({ status: "running", columns: cols("done", "running") });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ multiAgentRun: messages }}>
        <Page />
      </NextIntlClientProvider>,
    );
    expect(refetchReviews).toHaveBeenCalledTimes(1);

    currentRun = makeRun({ status: "done", columns: cols("done", "done") });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ multiAgentRun: messages }}>
        <Page />
      </NextIntlClientProvider>,
    );
    expect(refetchReviews).toHaveBeenCalledTimes(2);
  });
});
