import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ciMessages from "../../../../../messages/en/ci.json";
import shellMessages from "../../../../../messages/en/shell.json";

let runs: unknown[] = [];
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../../lib/hooks/ci", () => ({
  useCiRuns: () => ({ data: runs, isLoading: false, isError: false, refetch: vi.fn() }),
  useCiRefresh: () => ({ mutate: vi.fn(), isPending: false, isError: false, data: undefined }),
}));

import { CiRunsView } from "./CiRunsView";

afterEach(cleanup);

const base = { ci_installation_id: null, pr_number: 7, status: "succeeded", findings_count: 3, cost_usd: 0.5, github_url: null, source: null, agent: "Sec", duration_s: 75, repo: "acme/api", pr_url: null, verdict: null, critical: 1, warning: 2, suggestion: 0, blockers: 0, commit_sha: null, failure_reason: null };

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages, shell: shellMessages }}>
      <CiRunsView />
    </NextIntlClientProvider>,
  );
}

describe("CiRunsView", () => {
  it("renders newest first, dashes for unknown values, links only to github.com (AC-41, AC-42)", () => {
    runs = [
      { ...base, id: "a", ran_at: "2026-01-01T00:00:00Z", cost_usd: null, duration_s: null, github_url: "https://evil.example/x", pr_url: "https://evil.example/pr" },
      { ...base, id: "b", ran_at: "2026-02-01T00:00:00Z", github_url: "https://github.com/acme/api/actions/runs/1", pr_url: "https://github.com/acme/api/pull/7" },
    ];
    renderView();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("$0.50");
    expect(rows[1]).toHaveTextContent("1m 15s");
    expect(rows[2]).toHaveTextContent("—");
    expect(screen.getAllByRole("link")).toHaveLength(2); // only the github.com row's PR + job links
    expect(screen.getByRole("columnheader", { name: "Agent" })).toBeInTheDocument();
  });

  it("shows the empty state with Refresh (AC-43)", () => {
    runs = [];
    renderView();
    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });
});
