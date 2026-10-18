import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRunSummary } from "@devdigest/shared";
import messages from "../../../messages/en/multiAgent.json";
import runMessages from "../../../messages/en/multiAgentRun.json";

const replace = vi.fn();
const push = vi.fn();
const redirect = vi.fn();
let query = "";
let repos: { id: string; full_name: string }[] = [];
let active: { id: string; full_name: string } | null = null;
let pullsByRepo: Record<string, { id: string; number: number; title: string }[]> = {};
let runsByRepo: Record<string, MultiAgentRunSummary[]> = {};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(query),
  redirect: (url: string) => redirect(url),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, crumb }: { children: React.ReactNode; crumb: { label: string }[] }) => (
    <div>
      <nav aria-label="crumb">{crumb.map((c) => c.label).join(" › ")}</nav>
      {children}
    </div>
  ),
}));
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ activeRepo: active }) }));
vi.mock("@/lib/hooks/core", () => ({
  useRepos: () => ({ data: repos, isLoading: false }),
  usePulls: (repoId: string) => ({ data: pullsByRepo[repoId] ?? [], isLoading: false }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [0, 1, 2].map((i) => ({ id: `a${i}`, name: `Agent ${i}`, description: "d", enabled: true })) }),
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({ data: [] }),
  useMultiAgentRuns: ({ repoId, prId }: { repoId?: string | null; prId?: string | null }) => ({
    data: repoId ? (runsByRepo[repoId] ?? []) : Object.values(runsByRepo).flat().filter((r) => r.pr_id === prId),
    isLoading: false,
  }),
}));
vi.mock("@/lib/hooks/reviews", () => ({ useRunReview: () => ({ mutateAsync: vi.fn(), isPending: false }) }));

import GlobalConfigureRunPage from "./page";
import LegacyRedirect from "../repos/[repoId]/multi-agent/page";

const renderPage = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages, multiAgentRun: runMessages }}>
      <GlobalConfigureRunPage />
    </NextIntlClientProvider>,
  );

const summary = (id: string, over: Partial<MultiAgentRunSummary> = {}): MultiAgentRunSummary => ({
  id,
  repo_id: "r2",
  pr_id: "p2",
  pr_number: 482,
  pr_title: "Two PR",
  ran_at: new Date().toISOString(),
  status: "done",
  agent_count: 3,
  total_duration_ms: 12000,
  total_cost_usd: 0.04,
  ...over,
});

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  runsByRepo = {};
  redirect.mockReset();
  query = "";
  repos = [
    { id: "r1", full_name: "acme/one" },
    { id: "r2", full_name: "acme/two" },
  ];
  active = { id: "r2", full_name: "acme/two" };
  pullsByRepo = {
    r1: [{ id: "p1", number: 1, title: "One PR" }],
    r2: [{ id: "p2", number: 482, title: "Two PR" }],
  };
});
afterEach(cleanup);

describe("Global Configure run page", () => {
  it("shows the Global crumb and defaults to the active repo (else the first)", () => {
    renderPage();
    expect(screen.getByRole("navigation", { name: "crumb" })).toHaveTextContent("Global › Multi-Agent Review");
    expect(screen.getByRole("combobox", { name: "Repository" })).toHaveValue("r2");
    expect(screen.getByRole("option", { name: "#482 · Two PR" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure agents…" })).toHaveAttribute("href", "/agents");
    cleanup();

    active = null;
    renderPage();
    expect(screen.getByRole("combobox", { name: "Repository" })).toHaveValue("r1");
  });

  it("preselects repo and PR from ?repo= and ?pr=, then clears PR and agents on repo switch", async () => {
    query = "repo=r1&pr=1";
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole("combobox", { name: "Repository" })).toHaveValue("r1");
    expect(screen.getByRole("combobox", { name: "Pull request" })).toHaveValue("1");
    await user.click(screen.getByRole("checkbox", { name: /Agent 2/ }));
    expect(screen.getByRole("checkbox", { name: /Agent 2/ })).not.toBeChecked();

    await user.selectOptions(screen.getByRole("combobox", { name: "Repository" }), "r2");
    // Stays on Configure run (new=1) and drops ?pr= from the old repo.
    expect(replace).toHaveBeenCalledWith("/multi-agent-review?repo=r2&new=1");

    // Router is mocked: emulate the resulting URL to verify the cleared state.
    cleanup();
    query = "repo=r2&new=1";
    renderPage();
    expect(screen.getByRole("combobox", { name: "Pull request" })).toHaveValue("");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("lands on the repo's recent runs (latest first) linking to their results", () => {
    runsByRepo = { r2: [summary("m2", { status: "running" }), summary("m1", { pr_title: "Older PR" })] };
    renderPage();
    expect(screen.getByRole("heading", { name: "Recent multi-agent runs" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Run a Multi-Agent Review" })).not.toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/repos/r2/multi-agent/m2",
      "/repos/r2/multi-agent/m1",
    ]);
    expect(links[0]).toHaveTextContent("Latest run");
    expect(links[0]).toHaveTextContent("#482 · Two PR");
    expect(links[0]).toHaveTextContent("Running");
    expect(links[1]).not.toHaveTextContent("Latest run");
    expect(links[1]).toHaveTextContent("3 agents · 12s · $0.04");
  });

  it("New multi-agent review opens Configure run with a way back to the list", async () => {
    runsByRepo = { r2: [summary("m1")] };
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "New multi-agent review" }));
    expect(push).toHaveBeenCalledWith("/multi-agent-review?repo=r2&new=1");

    cleanup();
    query = "repo=r2&new=1";
    renderPage();
    expect(screen.getByRole("heading", { name: "Run a Multi-Agent Review" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to recent runs" })).toHaveAttribute(
      "href",
      "/multi-agent-review?repo=r2",
    );
  });

  it("opens Configure run directly for ?pr= deep-links and for repos without runs", () => {
    runsByRepo = { r2: [summary("m1")] };
    query = "repo=r2&pr=482";
    renderPage();
    expect(screen.getByRole("combobox", { name: "Pull request" })).toHaveValue("482");
    cleanup();

    query = "repo=r1";
    renderPage();
    expect(screen.getByRole("heading", { name: "Run a Multi-Agent Review" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "← Back to recent runs" })).not.toBeInTheDocument();
  });

  it("redirects the old repo-scoped route to the global URL", async () => {
    await LegacyRedirect({ params: Promise.resolve({ repoId: "r1" }), searchParams: Promise.resolve({ pr: "482" }) });
    expect(redirect).toHaveBeenCalledWith("/multi-agent-review?repo=r1&pr=482");
    await LegacyRedirect({ params: Promise.resolve({ repoId: "r1" }), searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenLastCalledWith("/multi-agent-review?repo=r1");
  });
});
