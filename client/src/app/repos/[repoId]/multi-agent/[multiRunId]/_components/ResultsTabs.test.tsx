/* Tabs + detail mode: summary card, FindingCard actions, AC-55 isolation, AC-76. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import maMessages from "../../../../../../../messages/en/multiAgentRun.json";
import prReview from "../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../messages/en/eval.json";
import runsMessages from "../../../../../../../messages/en/runs.json";
import { api } from "@/lib/api";
import { makeRun } from "./fixtures";

const EVIL = "<img src=x onerror=alert(1)>";

const finding: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: EVIL,
  file: "src/db.ts",
  start_line: 10,
  end_line: 12,
  rationale: "Unsanitised input reaches the query.",
  suggestion: null,
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "rev1",
  accepted_at: null,
  dismissed_at: null,
};
const reviews: ReviewRecord[] = [
  {
    id: "rev1", pr_id: "pr-uuid", agent_id: "a-sec", run_id: "run-sec", kind: "review",
    verdict: "request_changes", summary: "Looks risky", score: 72, model: "gpt-4.1",
    created_at: "2026-01-01T00:00:00Z", findings: [finding],
  },
];

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo1", multiRunId: "m1" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("view=tabs"),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/run-trace-drawer", () => ({ default: () => null }));
// Real useFindingAction / useLearnFinding (so invalidation is observable); only
// the page's data hooks are faked.
vi.mock("@/lib/hooks", async (orig) => ({
  ...(await orig<typeof import("@/lib/hooks")>()),
  useMultiAgentRun: () => ({ data: makeRun(), isLoading: false, error: null, refetch: vi.fn() }),
  usePulls: () => ({ data: [] }),
  usePrReviews: () => ({ data: reviews, refetch: vi.fn() }),
}));

import Page from "../page";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Tabs + detail mode", () => {
  it("shows the summary card, FindingCard actions, escapes hostile titles and accept does not touch the run query", async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, "post").mockResolvedValue({ finding });
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const refetch = vi.spyOn(qc, "refetchQueries");
    const { container } = render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider
          locale="en"
          messages={{ multiAgentRun: maMessages, prReview, eval: evalMessages, runs: runsMessages }}
        >
          <Page />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    // AC-51: summary card
    const card = screen.getByRole("region", { name: "Security" });
    expect(within(card).getByText("request_changes")).toBeInTheDocument();
    expect(within(card).getByText("Looks risky")).toBeInTheDocument();
    expect(within(card).getByText("8.2s · $0.01")).toBeInTheDocument();

    // AC-52 + AC-76: FindingCard with the hostile title as text
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(EVIL)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Learn/ })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Turn into eval case/ })).toBeInTheDocument();

    // AC-55: Accept posts, invalidates only the PR reviews, never the run
    await user.click(within(panel).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/findings/f1/accept", undefined));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    for (const [arg] of invalidate.mock.calls) {
      expect(arg?.queryKey).toEqual(["reviews", "pr-uuid"]);
    }
    for (const [arg] of refetch.mock.calls) {
      expect(arg?.queryKey).toEqual(["reviews", "pr-uuid"]);
    }
  });
});
