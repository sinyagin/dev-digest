import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.0013, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

// A run that injected Project Context documents — one read, one skipped as
// missing, none truncated — for AC-28/AC-30/AC-31.
const TRACE_WITH_SPECS: RunTrace = {
  ...TRACE,
  prompt_assembly: {
    ...TRACE.prompt_assembly,
    specs: '<untrusted source="spec-1">\n# Foo\nSome spec text.\n</untrusted>',
  },
  specs_read: ["specs/foo.md"],
  specs_missing: ["specs/removed.md"],
};

// Mutable so individual tests can swap which trace the mocked hook returns.
let currentTrace: RunTrace = TRACE;

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: currentTrace, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  currentTrace = TRACE;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });

  it("falls back to \"none\" for specs read/missing/truncated without throwing, then lists them under distinct labels once a run actually injected project context (AC-31)", async () => {
    // A run with no specs_read and no specs_missing/specs_truncated fields at
    // all (absent, not empty arrays) must render "none" for every one of the
    // three rows and must not throw on the optional fields.
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getAllByText("none")).toHaveLength(3);

    cleanup();
    currentTrace = TRACE_WITH_SPECS;
    const user = userEvent.setup();
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    // One specs_read entry and one specs_missing entry render under visually
    // (colour) and textually ("Specs read" vs "Specs missing") distinct rows.
    const specsReadRow = screen.getByText("Specs read").closest("div")!;
    const specsMissingRow = screen.getByText("Specs missing").closest("div")!;
    expect(within(specsReadRow).getByText("specs/foo.md")).toBeInTheDocument();
    expect(within(specsMissingRow).getByText("specs/removed.md")).toBeInTheDocument();
    // specs_truncated is still absent on this fixture — "none", no throw.
    expect(screen.getByText("Specs truncated").closest("div")).toHaveTextContent("none");

    // AC-28: the Prompt assembly row's label appears character-exact,
    // including the em dash — this is the actual acceptance criterion
    // wording, so a case-insensitive/partial match would hide a typo.
    await user.click(screen.getByText("Prompt assembly"));
    const specsLabel = screen.getByText("Project context — attached specs (untrusted)");
    expect(specsLabel).toBeInTheDocument();

    // AC-30: that row offers a copy control and an "≈N tok" estimate, like
    // every other prompt-assembly row.
    const specsPromptRow = specsLabel.parentElement!;
    expect(within(specsPromptRow).getByText(/^≈\d+ tok$/)).toBeInTheDocument();
    expect(within(specsPromptRow).getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});
