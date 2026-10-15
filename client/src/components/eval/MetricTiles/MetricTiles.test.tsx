import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRunSummary } from "@devdigest/shared";
import messages from "../../../../messages/en/eval.json";
import { MetricTiles } from "./MetricTiles";

afterEach(cleanup);

const run = (over: Partial<EvalRunSummary> = {}): EvalRunSummary => ({
  recall: 0.8,
  precision: 0.9,
  citation_accuracy: 1,
  traces_passed: 7,
  traces_total: 8,
  cases_errored: 0,
  duration_ms: 1000,
  cost_usd: 0.01,
  id: "r1",
  agent_id: "a1",
  agent_version: 1,
  status: "completed",
  error_reason: null,
  ran_at: "2026-01-01T00:00:00Z",
  finished_at: "2026-01-01T00:00:01Z",
  case_ids: [],
  cases_done: 8,
  ...over,
});

const ui = (props: Parameters<typeof MetricTiles>[0]) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <MetricTiles {...props} />
    </NextIntlClientProvider>,
  );

describe("MetricTiles", () => {
  it("null metric renders n/a and null latest renders nothing", () => {
    const { unmount } = ui({ latest: run({ recall: null }), delta: null, showDeltas: false });
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    unmount();
    ui({ latest: null, delta: null, showDeltas: true });
    expect(screen.queryByText(messages.metrics.recall)).not.toBeInTheDocument();
  });

  it("negative delta shows arrow and text; showDeltas false hides deltas", () => {
    const delta = { recall: -2, precision: 3, citation_accuracy: 0 };
    const { unmount } = ui({ latest: run(), delta, showDeltas: true });
    expect(screen.getByText("▼ −2.0 pts")).toHaveAttribute("aria-label", "down 2.0 points");
    expect(screen.getByText("▲ +3.0 pts")).toHaveAttribute("aria-label", "up 3.0 points");
    expect(screen.getByText("±0 pts")).toHaveAttribute("aria-label", "no change");
    unmount();
    ui({ latest: run(), delta, showDeltas: false });
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument();
  });

  it("traces tile shows 7/8", () => {
    ui({ latest: run(), delta: null, showDeltas: true });
    expect(screen.getByText("7/8")).toBeInTheDocument();
    expect(screen.getByText(messages.metrics.tracesPassed)).toBeInTheDocument();
  });
});
