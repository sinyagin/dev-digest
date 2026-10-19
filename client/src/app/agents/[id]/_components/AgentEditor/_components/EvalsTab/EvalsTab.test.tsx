import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, EvalAgentDetail, EvalCase, EvalRunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import { TABS } from "../../constants";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiDel = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...a: unknown[]) => apiGet(...a),
      post: (...a: unknown[]) => apiPost(...a),
      del: (...a: unknown[]) => apiDel(...a),
    },
  };
});

import { EvalsTab } from "./EvalsTab";

const AGENT = { id: "ag1", name: "Security Reviewer" } as Agent;

const mkCase = (over: Partial<EvalCase> = {}): EvalCase => ({
  id: "c1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "stripe-key",
  input_diff: "d",
  input_files: ["x.ts"],
  input_meta: { pr_number: null, title: "t", body: null },
  expectation: { type: "must_find", file: "x.ts", start_line: 1, end_line: 1, severity: "CRITICAL", category: "security" },
  source_finding_id: null,
  notes: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_result: null,
  last_result_at: null,
  ...over,
});

const outcome = (pass: boolean, total: number): EvalCase["last_result"] => ({
  case_id: "c1",
  name: "stripe-key",
  expectation_type: "must_find",
  status: "scored",
  pass,
  error_reason: null,
  findings_total: total,
  findings_matched: pass ? 1 : 0,
  grounding_kept: total,
  grounding_total: total,
  duration_ms: 10,
  cost_usd: null,
  actual: [],
});

const mkRun = (over: Partial<EvalRunSummary> = {}): EvalRunSummary => ({
  id: "r1",
  agent_id: "ag1",
  agent_version: 2,
  status: "completed",
  error_reason: null,
  ran_at: "2026-02-01T10:00:00Z",
  finished_at: "2026-02-01T10:01:00Z",
  case_ids: ["c1"],
  recall: 0.8,
  precision: 0.6,
  citation_accuracy: 0.9,
  traces_passed: 1,
  traces_total: 2,
  cases_errored: 0,
  duration_ms: 4200,
  cost_usd: 0.02,
  cases_done: 2,
  ...over,
});

function mockApi(opts: { cases: EvalCase[]; runs?: EvalRunSummary[]; previous?: EvalRunSummary | null }) {
  const runs = opts.runs ?? [];
  const detail: EvalAgentDetail = {
    agent: { id: "ag1", name: "Security Reviewer", model: "m", provider: "p", version: 2 },
    cases_total: opts.cases.length,
    latest: runs[0] ?? null,
    previous: opts.previous ?? null,
    delta: { recall: 5, precision: -2, citation_accuracy: 0 },
    trend: [],
    runs,
    banner: null,
  };
  apiGet.mockImplementation(async (path: string) => {
    if (path.endsWith("/eval-cases")) return opts.cases;
    if (path.endsWith("/eval-runs/estimate")) return { cases: opts.cases.length, executions: opts.cases.length, est_cost_usd: 0.5 };
    if (path.endsWith("/eval-runs")) return runs;
    if (path.startsWith("/eval/agents/")) return detail;
    if (path.startsWith("/eval-runs/")) return mkRun({ id: "run9", status: "completed", traces_passed: 2, traces_total: 2 });
    throw new Error(`unexpected GET ${path}`);
  });
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: messages, agents: agentsMessages }}>
        <EvalsTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiDel.mockReset();
});
afterEach(cleanup);

describe("EvalsTab", () => {
  it("comes after Config/Skills/Context (CI follows it)", () => {
    expect(TABS.map((x) => x.key)).toEqual(["config", "skills", "context", "evals", "ci"]);
  });

  it("shows tiles, N / M passing and rows with tag and expected/got", async () => {
    mockApi({
      cases: [mkCase({ last_result: outcome(false, 2) }), mkCase({ id: "c2", name: "ok-case", last_result: outcome(true, 1) })],
      runs: [mkRun()],
      previous: mkRun({ id: "r0" }),
    });
    setup();
    expect(await screen.findByText("1 / 2 passing")).toBeInTheDocument();
    expect(screen.getAllByText(/CRITICAL · security/).length).toBe(2);
    expect(screen.getByText(/expected 1 finding, got 2/)).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View dashboard/ })).toHaveAttribute("href", "/eval/agents/ag1");
    expect(screen.getAllByText("Recall").length).toBeGreaterThan(1);
  });

  it("Run all shows cases and estimate before POST; status announced via aria-live", async () => {
    const user = userEvent.setup();
    mockApi({ cases: [mkCase()], runs: [] });
    apiPost.mockResolvedValue(mkRun({ id: "run9", status: "running" }));
    setup();
    await screen.findByText("stripe-key");
    expect(apiGet.mock.calls.some((c) => String(c[0]).includes("/estimate"))).toBe(false);

    await user.click(screen.getByRole("button", { name: "Run all" }));
    expect(await screen.findByText("Run 1 case? Estimated cost $0.50.")).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Run all" }));
    expect(apiPost).toHaveBeenCalledWith("/agents/ag1/eval-runs", {});
    expect(await screen.findByText("Eval run finished: 2 of 2 passed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Eval run finished");
  });

  it("refetches detail, runs and cases once the polled run settles", async () => {
    const user = userEvent.setup();
    mockApi({ cases: [mkCase()], runs: [] });
    const base = apiGet.getMockImplementation()!;
    let settled = false;
    apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/eval-runs/")) {
        settled = true;
        return mkRun({ id: "run9", status: "completed", traces_passed: 2, traces_total: 2 });
      }
      if (path.endsWith("/eval-cases") && settled) return [mkCase({ name: "after-run" })];
      return base(path);
    });
    apiPost.mockResolvedValue(mkRun({ id: "run9", status: "running" }));
    setup();
    await screen.findByText("stripe-key");

    await user.click(screen.getByRole("button", { name: "Run all" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Run all" }));

    expect(await screen.findByText("after-run")).toBeInTheDocument();
    const count = (suffix: string) => apiGet.mock.calls.filter((c) => String(c[0]).endsWith(suffix)).length;
    expect(count("/eval-runs")).toBeGreaterThan(1);
    expect(apiGet.mock.calls.filter((c) => String(c[0]).startsWith("/eval/agents/")).length).toBeGreaterThan(1);
  });

  it("no cases: how-to text and no metric values", async () => {
    mockApi({ cases: [] });
    setup();
    expect(await screen.findByText(/No eval cases yet\. Turn an accepted/)).toBeInTheDocument();
    expect(screen.queryByText("Recall")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all" })).toBeDisabled();
  });

  it("cases but no run: never run", async () => {
    mockApi({ cases: [mkCase()], runs: [] });
    setup();
    expect(await screen.findByText("Never run")).toBeInTheDocument();
    expect(screen.getByText(/none has run yet/)).toBeInTheDocument();
  });

  it("errored run row shows the reason", async () => {
    mockApi({
      cases: [mkCase()],
      runs: [mkRun({ status: "errored", error_reason: "provider timeout", recall: null, precision: null, citation_accuracy: null })],
    });
    setup();
    expect(await screen.findByText("Errored: provider timeout")).toBeInTheDocument();
  });

  it("renders a hostile case name as text", async () => {
    mockApi({ cases: [mkCase({ name: "<img src=x onerror=alert(1)>" })] });
    setup();
    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("delete requires confirm", async () => {
    const user = userEvent.setup();
    mockApi({ cases: [mkCase()] });
    apiDel.mockResolvedValue(undefined);
    setup();
    await user.click(await screen.findByRole("button", { name: "Delete: stripe-key" }));
    expect(apiDel).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(apiDel).toHaveBeenCalledWith("/eval-cases/c1");
  });
});
