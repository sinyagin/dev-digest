import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { BriefReadResponse, PrBrief, ReviewRecord, Risk } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";

const mockUsePrBrief = vi.fn();
const mockUseGenerateBrief = vi.fn();
vi.mock("../../../../../../../lib/hooks/brief", () => ({
  usePrBrief: (...args: unknown[]) => mockUsePrBrief(...args),
  useGenerateBrief: (...args: unknown[]) => mockUseGenerateBrief(...args),
}));

import { PrBriefCard } from "./PrBriefCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, prReview: prReviewMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function makeReview(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "review1",
    pr_id: "pr1",
    agent_id: "agent1",
    run_id: "run1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: "This review's own summary — must NOT be shown; the brief's summary wins instead.",
    score: 72,
    model: "test-model",
    grounding: null,
    created_at: "2026-10-06T00:00:00.000Z",
    findings: [
      {
        id: "f1",
        severity: "CRITICAL",
        category: "bug",
        title: "Blocker finding",
        file: "src/auth.ts",
        start_line: 1,
        end_line: 1,
        rationale: "r",
        suggestion: null,
        confidence: 0.9,
        kind: "finding",
        trifecta_components: null,
        evidence: null,
        review_id: "review1",
        accepted_at: null,
        dismissed_at: null,
      },
    ],
    ...overrides,
  };
}

const HIGH_RISK_FILE = "src/middleware/auth-check.ts";
const LOW_RISK_FILE = "src/styles/theme.ts";

const HIGH_RISK: Risk = {
  kind: "security",
  title: "Auth bypass risk",
  explanation: "The new middleware skips the token check on one branch.",
  severity: "high",
  file_refs: [HIGH_RISK_FILE],
};

const LOW_RISK: Risk = {
  kind: "style",
  title: "Minor naming drift",
  explanation: "Renamed variable does not match the module's convention.",
  severity: "low",
  file_refs: [LOW_RISK_FILE],
};

function makeBrief(overrides: Partial<PrBrief> = {}): PrBrief {
  return {
    intent: null,
    blast: null,
    risks: { risks: [HIGH_RISK, LOW_RISK] },
    history: { history: [] },
    summary: "This PR refactors the rate limiter and touches billing calculations.",
    review_focus: [
      { file: "src/auth.ts", line: 42, reason: "Check the bypass branch carefully" },
      { file: "src/billing.ts", line: 10, reason: "Validate the billing calculation" },
      { file: "src/utils.ts", line: null, reason: "Confirm the rename is safe" },
    ],
    missing_context: ["intent"],
    generated_for_sha: "abc123",
    ...overrides,
  };
}

describe("PrBriefCard", () => {
  it("renders the Generate CTA and no risk/focus content when no brief has been generated", () => {
    mockUsePrBrief.mockReturnValue({
      data: { status: "not_generated" } satisfies BriefReadResponse,
      isLoading: false,
      isError: false,
    });
    mockUseGenerateBrief.mockReturnValue({ data: undefined, isError: false, isPending: false, mutate: vi.fn() });

    renderWithIntl(<PrBriefCard prId="pr1" onFocusFile={vi.fn()} />);

    expect(screen.getByRole("button", { name: briefMessages.card.generate })).toBeInTheDocument();
    expect(screen.queryByText(briefMessages.card.riskAreasLabel)).not.toBeInTheDocument();
    expect(screen.queryByText(briefMessages.card.reviewFocusLabel)).not.toBeInTheDocument();
  });

  it("renders a ready brief's summary, missing-context note, differently-coloured risks, and review focus in order, and calls onFocusFile on click", async () => {
    const user = userEvent.setup();
    const onFocusFile = vi.fn();
    const brief = makeBrief();
    mockUsePrBrief.mockReturnValue({
      data: { status: "ready", brief } satisfies BriefReadResponse,
      isLoading: false,
      isError: false,
    });
    mockUseGenerateBrief.mockReturnValue({ data: undefined, isError: false, isPending: false, mutate: vi.fn() });

    renderWithIntl(<PrBriefCard prId="pr1" onFocusFile={onFocusFile} />);

    // Summary + missing-context note
    expect(screen.getByText(brief.summary)).toBeInTheDocument();
    expect(screen.getByText(briefMessages.card.missingIntent)).toBeInTheDocument();

    // Both risk rows render a title and at least one file path, with
    // differently-coloured severity indicators.
    const highTitle = screen.getByText(HIGH_RISK.title);
    const lowTitle = screen.getByText(LOW_RISK.title);
    expect(screen.getByText(HIGH_RISK_FILE)).toBeInTheDocument();
    expect(screen.getByText(LOW_RISK_FILE)).toBeInTheDocument();
    const highIndicator = highTitle.previousElementSibling as HTMLElement;
    const lowIndicator = lowTitle.previousElementSibling as HTMLElement;
    expect(highIndicator).toHaveAttribute("aria-hidden", "true");
    expect(lowIndicator).toHaveAttribute("aria-hidden", "true");
    expect(highIndicator.getAttribute("style")).not.toEqual(lowIndicator.getAttribute("style"));

    // Review focus renders in exact array order (never re-sorted).
    const focusList = screen.getByRole("list");
    const focusButtons = within(focusList).getAllByRole("button");
    expect(focusButtons).toHaveLength(3);
    const [firstFocus, secondFocus, thirdFocus] = focusButtons as [HTMLElement, HTMLElement, HTMLElement];
    expect(firstFocus).toHaveTextContent("src/auth.ts:42");
    expect(secondFocus).toHaveTextContent("src/billing.ts:10");
    expect(thirdFocus).toHaveTextContent("src/utils.ts");
    // The null-line item's label fabricates no line number (no digits).
    expect(thirdFocus.textContent ?? "").not.toMatch(/\d/);

    await user.click(firstFocus);
    expect(onFocusFile).toHaveBeenCalledWith("src/auth.ts");
  });

  it("renders the exact noRisks copy when a ready brief has no risks", () => {
    mockUsePrBrief.mockReturnValue({
      data: { status: "ready", brief: makeBrief({ risks: { risks: [] }, missing_context: [] }) } satisfies BriefReadResponse,
      isLoading: false,
      isError: false,
    });
    mockUseGenerateBrief.mockReturnValue({ data: undefined, isError: false, isPending: false, mutate: vi.fn() });

    renderWithIntl(<PrBriefCard prId="pr1" onFocusFile={vi.fn()} />);

    expect(screen.getByText(briefMessages.noRisks)).toBeInTheDocument();
  });

  it("renders a combined VerdictBanner above the brief content when a latest review exists, using the brief's own summary as its body", () => {
    const brief = makeBrief();
    const review = makeReview();
    mockUsePrBrief.mockReturnValue({
      data: { status: "ready", brief } satisfies BriefReadResponse,
      isLoading: false,
      isError: false,
    });
    mockUseGenerateBrief.mockReturnValue({ data: undefined, isError: false, isPending: false, mutate: vi.fn() });

    renderWithIntl(<PrBriefCard prId="pr1" onFocusFile={vi.fn()} latestReview={review} />);

    // Verdict label + agent name + score render from the review.
    expect(screen.getByText(prReviewMessages.verdict.requestChanges)).toBeInTheDocument();
    expect(screen.getByText(review.agent_name as string)).toBeInTheDocument();
    expect(screen.getByText(String(review.score))).toBeInTheDocument();

    // The banner's body text is the brief's summary, never the review's own.
    expect(screen.getAllByText(brief.summary).length).toBeGreaterThan(0);
    expect(screen.queryByText(review.summary as string)).not.toBeInTheDocument();
  });

  it("renders no banner (and the rest of the card unaffected) when there is no latest review", () => {
    const brief = makeBrief();
    mockUsePrBrief.mockReturnValue({
      data: { status: "ready", brief } satisfies BriefReadResponse,
      isLoading: false,
      isError: false,
    });
    mockUseGenerateBrief.mockReturnValue({ data: undefined, isError: false, isPending: false, mutate: vi.fn() });

    renderWithIntl(<PrBriefCard prId="pr1" onFocusFile={vi.fn()} latestReview={null} />);

    expect(screen.queryByText(prReviewMessages.verdict.requestChanges)).not.toBeInTheDocument();
    expect(screen.getByText(brief.summary)).toBeInTheDocument();
    expect(screen.getByText(briefMessages.card.riskAreasLabel)).toBeInTheDocument();
    expect(screen.getByText(briefMessages.card.reviewFocusLabel)).toBeInTheDocument();
  });
});
