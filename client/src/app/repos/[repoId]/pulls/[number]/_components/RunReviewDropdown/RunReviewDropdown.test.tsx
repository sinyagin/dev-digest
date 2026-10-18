import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

const push = vi.fn();
const mutateAsync = vi.fn();
let agents: { id: string; name: string; model: string; enabled: boolean }[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: agents }),
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({
    data: [{ agent_id: "a1", avg_duration_ms: 4000, avg_cost_usd: 0.01, sample_size: 3 }],
  }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync, isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

const THREE = [
  { id: "a1", name: "Security", model: "m", enabled: true },
  { id: "a2", name: "Perf", model: "m", enabled: true },
  { id: "a3", name: "Style", model: "m", enabled: false },
];

beforeEach(() => {
  agents = THREE;
  push.mockReset();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({ runs: [{ run_id: "r1" }], multi_agent_run_id: "mp1" });
});
afterEach(cleanup);

async function open() {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunReviewDropdown prId="pr1" repoId="r1" prNumber={482} />
    </NextIntlClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: /Run Review/ }));
  return user;
}

describe("RunReviewDropdown", () => {
  it("renders the picker, runs a single agent, then a multi-agent set", async () => {
    const user = await open();
    expect(screen.getByText("Pick agents to run")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByText("~4.0s")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all enabled agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run review" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Security" }));
    await user.click(screen.getByRole("button", { name: "Run review" }));
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentId: "a1" });
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Run Review/ }));
    await user.click(screen.getByRole("checkbox", { name: "Perf" }));
    await user.click(screen.getByRole("button", { name: "Run multi-agent review (2)" }));
    expect(mutateAsync).toHaveBeenLastCalledWith({ prId: "pr1", agentIds: ["a1", "a2"] });
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/mp1");
  });

  it("Clear resets, Configure navigates, and a failed run keeps the selection", async () => {
    const user = await open();
    await user.click(screen.getByRole("checkbox", { name: "Security" }));
    await user.click(screen.getByRole("checkbox", { name: "Perf" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("button", { name: "Run review" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Security" }));
    await user.click(screen.getByRole("checkbox", { name: "Perf" }));
    mutateAsync.mockRejectedValueOnce(new Error("Agent limit exceeded"));
    await user.click(screen.getByRole("button", { name: "Run multi-agent review (2)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Agent limit exceeded");
    expect(screen.getByRole("checkbox", { name: "Security" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Perf" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Configure agents…" }));
    expect(push).toHaveBeenCalledWith("/multi-agent-review?repo=r1&pr=482");
  });

  it("explains that multi-agent needs two agents when only one exists", async () => {
    agents = [THREE[0]!];
    await open();
    expect(screen.getByText(/Multi-agent review needs at least two agents/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage agents" })).toHaveAttribute("href", "/agents");
  });
});
