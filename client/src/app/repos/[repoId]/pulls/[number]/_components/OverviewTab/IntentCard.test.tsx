import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntentRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { IntentCard } from "./IntentCard";

afterEach(cleanup);

const BASE_INTENT: PrIntentRecord = {
  pr_id: "pr1",
  intent: "Add rate limiting to the public API.",
  in_scope: ["src/api/rate-limit.ts"],
  out_of_scope: ["auth"],
  context_gaps: [],
};

function renderWithIntent(data: PrIntentRecord) {
  const qc = new QueryClient();
  qc.setQueryData(["intent", "pr1"], data);
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <IntentCard prId="pr1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("IntentCard — context gaps", () => {
  it("renders no context-gaps section when the intent has none", () => {
    renderWithIntent(BASE_INTENT);
    expect(screen.getByText(BASE_INTENT.intent)).toBeInTheDocument();
    expect(screen.queryByText("Context gaps")).not.toBeInTheDocument();
  });

  it("surfaces unresolved PR-description links as context gaps, instead of silently hiding them", () => {
    renderWithIntent({
      ...BASE_INTENT,
      context_gaps: [
        { kind: "url", source: "https://example.com/spec.md", reason: "URL returned HTTP 404" },
      ],
    });
    expect(screen.getByText("Context gaps")).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/example\.com\/spec\.md/)).toBeInTheDocument();
    expect(screen.getByText(/URL returned HTTP 404/)).toBeInTheDocument();
  });
});
