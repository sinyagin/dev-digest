import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import evalMessages from "../../../messages/en/eval.json";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement, qc = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — Turn into eval case", () => {
  const draft = {
    name: "stripe-key",
    input_diff: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+key",
    input_files: ["x.ts"],
    input_meta: { pr_number: 7, title: "PR", body: null },
    expectation: { type: "must_find", file: "x.ts", start_line: 1, end_line: 1 },
    notes: null,
    source_finding_id: null,
    agent: { id: "a1", name: "Security agent" },
    source_triage: "accepted",
    existing_case_id: null,
  };
  const existing = { ...draft, id: "c1", owner_kind: "agent", owner_id: "a1", name: "existing-case-name",
    created_at: "", updated_at: "", last_result: null, last_result_at: null };
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  function renderEval(f: FindingRecord) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ prReview: messages, eval: evalMessages }}>
          <FindingCard f={f} defaultExpanded onAction={() => {}} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  }

  it("is disabled with a hint when untriaged and enabled when accepted", () => {
    const { unmount } = renderEval(FINDING);
    const btn = screen.getByRole("button", { name: "Turn into eval case" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Accept or dismiss this finding first");
    expect(btn).toHaveAccessibleDescription("Accept or dismiss this finding first");
    unmount();
    renderEval({ ...FINDING, accepted_at: "2026-01-01T00:00:00Z" });
    expect(screen.getByRole("button", { name: "Turn into eval case" })).toBeEnabled();
  });

  it("opens the modal from the draft and Cancel issues no write requests", async () => {
    fetchMock.mockImplementation((url: string) => json(draft));
    renderEval({ ...FINDING, accepted_at: "2026-01-01T00:00:00Z" });
    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));
    expect(await screen.findByDisplayValue("stripe-key")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByDisplayValue("stripe-key")).not.toBeInTheDocument());
    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? "GET");
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.every((m) => m === "GET")).toBe(true);
  });

  it("opens edit mode when a case already exists for the finding", async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes("/eval-cases/c1") ? json(existing) : json({ ...draft, existing_case_id: "c1" }),
    );
    renderEval({ ...FINDING, dismissed_at: "2026-01-01T00:00:00Z" });
    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));
    expect(await screen.findByDisplayValue("existing-case-name")).toBeInTheDocument();
  });
});

describe("FindingCard — Learn", () => {
  it("posts to /findings/:id/learn, then reads Learned (disabled), also after remount", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ finding: FINDING, memory_id: "m1" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />, qc);

    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn into eval case" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Learn" }));

    const learned = await screen.findByRole("button", { name: "Learned" });
    expect(learned).toBeDisabled();
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/findings/f1/learn");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("POST");

    unmount();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />, qc);
    expect(screen.getByRole("button", { name: "Learned" })).toBeDisabled();
    vi.unstubAllGlobals();
  });
});
