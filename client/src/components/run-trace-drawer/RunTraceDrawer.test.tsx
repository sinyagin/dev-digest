import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../messages/en/runs.json";

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

let traceEnabled: boolean[] = [];
let eventRunIds: string[][] = [];
let liveEvents: { t: string; kind: string; msg: string }[] = [];
vi.mock("@/lib/hooks/trace", () => ({
  useRunTrace: (_id: string, enabled = true) => {
    traceEnabled.push(enabled);
    return enabled ? { data: currentTrace, isLoading: false } : { data: undefined, isLoading: true };
  },
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: (ids: string[]) => {
    eventRunIds.push(ids);
    return { events: ids.length ? liveEvents : [], running: ids.length > 0 };
  },
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  currentTrace = TRACE;
  traceEnabled = [];
  eventRunIds = [];
  liveEvents = [];
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

describe("shared drawer (multi-agent additions)", () => {
  it("shows every Trace section and copies raw output", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" onClose={() => {}} findings={[]} />);
    for (const h of ["Configuration", "Stats", "Findings", "Prompt assembly", "Tool calls"]) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }
    await user.click(screen.getByRole("button", { name: /Copy raw output/ }));
    expect(writeText).toHaveBeenCalledWith(TRACE.raw_output);
  });

  it("initialTab=\"log\" shows persisted log lines, including a failed run's error line", () => {
    currentTrace = {
      ...TRACE,
      log: [...TRACE.log, { t: "01.20", kind: "error", msg: "Provider timed out" }],
    };
    renderWithIntl(<RunTraceDrawer runId="r1" initialTab="log" onClose={() => {}} />);
    expect(screen.getByText("Starting review with agent Security")).toBeInTheDocument();
    expect(screen.getByText("Provider timed out")).toBeInTheDocument();
  });

  it("running + Trace tab: pending note, no SSE, trace fetch enabled once running ends", () => {
    const { rerender } = renderWithIntl(
      <RunTraceDrawer runId="r1" initialTab="trace" running onClose={() => {}} />,
    );
    expect(screen.getByText(/Trace is written when the run completes/)).toBeInTheDocument();
    expect(eventRunIds.every((ids) => ids.length === 0)).toBe(true);
    expect(traceEnabled.every((e) => e === false)).toBe(true);
    rerender(
      <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
        <div data-theme="dark">
          <RunTraceDrawer runId="r1" initialTab="trace" running={false} onClose={() => {}} />
        </div>
      </NextIntlClientProvider>,
    );
    expect(traceEnabled.at(-1)).toBe(true);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("running + Log tab subscribes to the run's events", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" initialTab="log" running onClose={() => {}} />);
    expect(eventRunIds.at(-1)).toEqual(["r1"]);
  });

  it("renders streamed log lines in the live log while running (AC-60)", () => {
    liveEvents = [
      { t: "00.10", kind: "info", msg: "Fetching diff" },
      { t: "00.50", kind: "tool", msg: "Calling review_file" },
    ];
    renderWithIntl(<RunTraceDrawer runId="r1" initialTab="log" running onClose={() => {}} />);
    expect(screen.getByText("Fetching diff")).toBeInTheDocument();
    expect(screen.getByText("Calling review_file")).toBeInTheDocument();
    // The persisted trace log is not shown while streaming.
    expect(screen.queryByText("Starting review with agent Security")).not.toBeInTheDocument();
  });

  it("Escape closes and focus returns to the opener on unmount", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          {open && (
            <RunTraceDrawer
              runId="r1"
              onClose={() => {
                onClose();
                setOpen(false);
              }}
            />
          )}
        </>
      );
    }
    renderWithIntl(<Host />);
    const opener = screen.getByRole("button", { name: "opener" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
