import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalCaseInput, EvalDryRunResult } from "@devdigest/shared";
import messages from "../../../../messages/en/eval.json";
import { ApiError } from "@/lib/api";

const apiPost = vi.fn();
const apiPut = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, post: (...a: unknown[]) => apiPost(...a), put: (...a: unknown[]) => apiPut(...a) } };
});

import { EvalCaseModal } from "./EvalCaseModal";

const UUID = "11111111-1111-4111-8111-111111111111";

const initial: EvalCaseInput = {
  name: "stripe-key",
  input_diff: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+key",
  input_files: ["x.ts"],
  input_meta: { pr_number: 7, title: "PR", body: null },
  expectation: { type: "must_find", file: "x.ts", start_line: 1, end_line: 1 },
  notes: null,
  source_finding_id: UUID,
};

const result = (over: Partial<EvalDryRunResult> = {}): EvalDryRunResult => ({
  case_id: null,
  name: "stripe-key",
  expectation_type: "must_find",
  status: "scored",
  pass: true,
  error_reason: null,
  findings_total: 2,
  findings_matched: 1,
  grounding_kept: 2,
  grounding_total: 2,
  duration_ms: 1500,
  cost_usd: 0.0123,
  actual: [{ file: "x.ts", start_line: 1, end_line: 1, severity: "CRITICAL", category: "security", title: "Leaked key", matched: true }],
  ...over,
});

function setup(props: Partial<React.ComponentProps<typeof EvalCaseModal>> = {}) {
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <EvalCaseModal agentId="a1" agentName="Sec Agent" mode="draft" initial={initial} onClose={onClose} {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

const expectationBox = () => screen.getByDisplayValue(/"must_find"/) as HTMLTextAreaElement;

beforeEach(() => {
  apiPost.mockReset();
  apiPut.mockReset();
});
afterEach(cleanup);

describe("EvalCaseModal", () => {
  it("prefilled draft: Run case shows actual vs expected and pass/fail; Cancel closes without create", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce(result());
    const { onClose } = setup();

    await user.click(screen.getByRole("button", { name: "Run case" }));
    expect(await screen.findByText(/Expected 1, got 2/)).toBeInTheDocument();
    expect(screen.getAllByText("Pass").length).toBeGreaterThan(0);
    expect(screen.getByText("Leaked key")).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost.mock.calls[0]![0]).toContain("/dry-run");
    expect(apiPost.mock.calls[0]![1]).toHaveProperty("draft");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it("invalid expectation names the field and disables Save and Run case; skeleton restores a valid template", async () => {
    const user = userEvent.setup();
    setup();
    const box = expectationBox();

    await user.clear(box);
    await user.click(box);
    await user.paste('{"type":"bogus","file":"x.ts","start_line":1,"end_line":1}');
    expect(screen.getByText(/invalid JSON: type/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run case" })).toBeDisabled();

    await user.clear(box);
    await user.click(box);
    await user.paste('{"type":"must_find","file":"x.ts","start_line":1.5,"end_line":2}');
    expect(screen.getByText(/invalid JSON: start_line/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /skeleton/i }));
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("Save posts once and closes; a 422 reason is rendered inline", async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValueOnce(new ApiError("Finding is not grounded", 422));
    const { onClose } = setup();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Finding is not grounded")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    apiPost.mockResolvedValueOnce({ id: UUID });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(apiPost.mock.calls[1]![0]).toBe("/agents/a1/eval-cases");
  });

  it("edit mode issues PUT not POST", async () => {
    const user = userEvent.setup();
    apiPut.mockResolvedValueOnce({ id: UUID });
    const { onClose } = setup({ mode: "edit", caseId: UUID });

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect(apiPut.mock.calls[0]![0]).toBe(`/eval-cases/${UUID}`);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("<script> in name and actual finding title renders as text", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce(
      result({ actual: [{ file: "x.ts", start_line: 1, end_line: 1, severity: "CRITICAL", category: "c", title: "<script>alert(1)</script>", matched: false }] }),
    );
    setup({ initial: { ...initial, name: "<script>x</script>" } });

    expect(screen.getByDisplayValue("<script>x</script>")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run case" }));
    expect(await screen.findByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("Escape closes", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("notes are editable in edit mode and sent in the PUT body; in draft mode in the POST body", async () => {
    const user = userEvent.setup();
    apiPut.mockResolvedValueOnce({ id: UUID });
    setup({ mode: "edit", caseId: UUID, initial: { ...initial, notes: "old" } });
    const box = screen.getByPlaceholderText(/Why this case exists/);
    expect(box).toHaveValue("old");
    await user.clear(box);
    await user.type(box, "guards <b>keys</b>");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut.mock.calls[0]![1]).toMatchObject({ notes: "guards <b>keys</b>" });
    cleanup();

    apiPost.mockResolvedValueOnce({ id: UUID });
    setup();
    await user.type(screen.getByPlaceholderText(/Why this case exists/), "why");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost.mock.calls[0]![1]).toMatchObject({ notes: "why" });
  });
});
