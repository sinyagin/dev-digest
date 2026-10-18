import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/multiAgent.json";
import runMessages from "../../../../messages/en/multiAgentRun.json";
import { NAV } from "@devdigest/ui";
import { activeKeyFor } from "@/components/app-shell/helpers";

const push = vi.fn();
const mutateAsync = vi.fn();
let pulls: { id: string; number: number; title: string }[] = [];
let agents: { id: string; name: string; description: string; enabled: boolean }[] = [];
let prRuns: Record<string, unknown[]> = {};
let estimates: { agent_id: string; avg_duration_ms: number | null; avg_cost_usd: number | null; sample_size: number }[] = [];

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/hooks/core", () => ({ usePulls: () => ({ data: pulls, isLoading: false }) }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: agents }) }));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({ data: estimates }),
  useMultiAgentRuns: ({ prId }: { prId?: string | null }) => ({ data: prId ? (prRuns[prId] ?? []) : undefined }),
}));
vi.mock("@/lib/hooks/reviews", () => ({ useRunReview: () => ({ mutateAsync, isPending: false }) }));

import { ConfigureRun } from "./ConfigureRun";

const mkAgents = (n: number, enabled = true) =>
  Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `Agent ${i}`, description: `desc ${i}`, enabled }));

beforeEach(() => {
  push.mockReset();
  mutateAsync.mockReset();
  prRuns = {};
  mutateAsync.mockResolvedValue({ runs: [], multi_agent_run_id: "mp1" });
  pulls = [{ id: "pr-uuid", number: 482, title: "Fix auth" }];
  agents = mkAgents(3);
  estimates = [{ agent_id: "a0", avg_duration_ms: 4000, avg_cost_usd: 0.02, sample_size: 2 }];
});
afterEach(cleanup);

function setup(prParam: string | null = null) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages, multiAgentRun: runMessages }}>
      <ConfigureRun repoId="r1" prParam={prParam} />
    </NextIntlClientProvider>,
  );
  return user;
}
const runBtn = () => screen.getByRole("button", { name: /^Run multi-agent review/ });

describe("Configure run", () => {
  it("offers (never auto-opens) the picked PR's latest run, ahead of configuring a new one", async () => {
    prRuns = {
      "pr-uuid": [{ id: "m9", repo_id: "r1", pr_id: "pr-uuid", status: "done", agent_count: 3, ran_at: new Date().toISOString() }],
    };
    const user = setup("482");
    expect(push).not.toHaveBeenCalled();
    const card = screen.getByRole("region", { name: "This pull request already has a multi-agent run" });
    expect(card).toHaveTextContent("Done");
    expect(card).toHaveTextContent("Latest run · 3 agents");
    expect(screen.getAllByRole("checkbox")).toHaveLength(3); // configuring stays available
    await user.click(screen.getByRole("button", { name: "View latest results" }));
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/m9");
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("shows no resume card when the picked PR has no run", () => {
    setup("482");
    expect(screen.queryByRole("button", { name: "View latest results" })).not.toBeInTheDocument();
  });

  it("shows the page texts and, with no PR, a disabled run button and no agent checkboxes", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Run a Multi-Agent Review" })).toBeInTheDocument();
    expect(screen.getByText(/they run in parallel and you compare/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "#482 · Fix auth" })).toBeInTheDocument();
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(runBtn()).toBeDisabled();
    expect(runBtn()).toHaveTextContent(/^Run multi-agent review$/);
  });

  it("pre-selects from ?pr, pre-checks enabled agents, shows estimates and the footer, and runs once", async () => {
    agents = [...mkAgents(2), { id: "off", name: "Off", description: "d", enabled: false }];
    const user = setup("482");
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: /Off/ })).not.toBeChecked();
    expect(screen.getByText("disabled")).toBeInTheDocument();
    expect(screen.getByText("4.0s · $0.02")).toBeInTheDocument();
    expect(screen.getAllByText("— · —").length).toBeGreaterThan(0);
    expect(screen.getByText(/parallel fan-out/)).toBeInTheDocument();
    expect(screen.getByText(/excludes 1 agent\(s\) without history/)).toBeInTheDocument();

    expect(runBtn()).toHaveTextContent("Run multi-agent review (2)");
    expect(runBtn()).toBeEnabled();
    await user.click(runBtn());
    await user.click(runBtn());
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr-uuid", agentIds: ["a0", "a1"] });
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/mp1");
  });

  it("needs two checked agents and toggles with the keyboard", async () => {
    const user = setup("482");
    await user.click(screen.getByRole("checkbox", { name: /Agent 1/ }));
    await user.click(screen.getByRole("checkbox", { name: /Agent 2/ }));
    expect(runBtn()).toBeDisabled();
    expect(screen.getByText("Pick at least two agents to compare")).toBeInTheDocument();
    screen.getByRole("checkbox", { name: /Agent 1/ }).focus();
    await user.keyboard(" ");
    expect(screen.getByRole("checkbox", { name: /Agent 1/ })).toBeChecked();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("checkbox", { name: /Agent 1/ })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /Agent 1/ }));
    await user.click(screen.getByRole("checkbox", { name: /Agent 2/ }));
    expect(runBtn()).toHaveTextContent("(3)");
  });

  it("caps Select all at 8 and blocks a 9th manual check", async () => {
    agents = mkAgents(10);
    const user = setup("482");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getAllByRole("checkbox").filter((c) => c.getAttribute("aria-checked") === "true")).toHaveLength(8);
    expect(screen.getByText("max 8 agents per run")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Agent 9/ }));
    expect(screen.getByRole("checkbox", { name: /Agent 9/ })).not.toBeChecked();
  });

  it("handles no PRs, a bad ?pr, fewer than two agents and a failed run", async () => {
    pulls = [];
    setup();
    expect(screen.getByText(/No pull requests in this repo yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Pull Requests" })).toHaveAttribute("href", "/repos/r1/pulls");
    cleanup();

    pulls = [{ id: "pr-uuid", number: 482, title: "Fix auth" }];
    setup("999");
    expect(screen.getByText("That pull request was not found")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("");
    cleanup();

    agents = mkAgents(1);
    setup("482");
    expect(screen.getByText(/Multi-agent review needs at least two agents/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage agents" })).toHaveAttribute("href", "/agents");
    cleanup();

    agents = mkAgents(3);
    mutateAsync.mockRejectedValueOnce(new Error("Too many agents"));
    const user = setup("482");
    await user.click(runBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many agents");
    expect(screen.getAllByRole("checkbox").every((c) => c.getAttribute("aria-checked") === "true")).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("Multi-Agent nav", () => {
  it("has a nav item and is active on configure and results URLs", () => {
    const keys = NAV.flatMap((g) => g.items.map((i) => i.key));
    expect(keys).toContain("multi-agent");
    const global = NAV.find((g) => g.section === "GLOBAL");
    expect(global?.items.find((i) => i.key === "multi-agent")?.href).toBe("/multi-agent-review");
    expect(NAV.find((g) => g.section === "WORKSPACE")?.items.some((i) => i.key === "multi-agent")).toBe(false);
    expect(activeKeyFor("/multi-agent-review")).toBe("multi-agent");
    expect(activeKeyFor("/repos/r/multi-agent")).toBe("multi-agent");
    expect(activeKeyFor("/repos/r/multi-agent/x")).toBe("multi-agent");
  });
});
