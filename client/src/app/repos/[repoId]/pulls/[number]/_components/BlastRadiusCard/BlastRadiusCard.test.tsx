import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";

const mockUseBlastRadius = vi.fn();
vi.mock("../../../../../../../lib/hooks/blast", () => ({
  useBlastRadius: (...args: unknown[]) => mockUseBlastRadius(...args),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ blast: messages }}>{ui}</NextIntlClientProvider>);
}

const BASE: BlastRadiusResponse = {
  changed_symbols: [{ name: "rateLimit", file: "src/middleware/ratelimit.ts", kind: "function" }],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [{ name: "handleWebhook", file: "src/api/public/webhooks.ts", line: 42 }],
      endpoints_affected: ["POST /webhooks"],
      crons_affected: [],
    },
  ],
  summary: "1 changed symbol, 1 caller across 1 endpoint affected.",
};

describe("BlastRadiusCard (smoke)", () => {
  it("renders the summary line, symbol block, caller and endpoint chip", () => {
    mockUseBlastRadius.mockReturnValue({ data: BASE, isLoading: false, isError: false });
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoFullName="acme/repo" headSha="deadbeef" />,
    );
    expect(screen.getByText("1 changed symbol, 1 caller across 1 endpoint affected.")).toBeInTheDocument();
    expect(screen.getByText(/rateLimit/)).toBeInTheDocument();
    expect(screen.getByText("src/api/public/webhooks.ts:42")).toBeInTheDocument();
    expect(screen.getByText("POST /webhooks")).toBeInTheDocument();
  });

  it("shows a no-callers line for a symbol with an empty downstream group", () => {
    mockUseBlastRadius.mockReturnValue({
      data: { ...BASE, downstream: [{ ...BASE.downstream[0], callers: [] }] },
      isLoading: false,
      isError: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoFullName="acme/repo" headSha="deadbeef" />);
    expect(screen.getByText("No callers found.")).toBeInTheDocument();
  });

  it("shows the empty state when there are no changed symbols", () => {
    mockUseBlastRadius.mockReturnValue({
      data: { changed_symbols: [], downstream: [], summary: "No changed symbols detected." },
      isLoading: false,
      isError: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoFullName="acme/repo" headSha="deadbeef" />);
    expect(screen.getByText("No blast radius data")).toBeInTheDocument();
  });

  it("shows a degraded badge with the human reason", () => {
    mockUseBlastRadius.mockReturnValue({
      data: { ...BASE, degraded: true, reason: "index_partial" },
      isLoading: false,
      isError: false,
    });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoFullName="acme/repo" headSha="deadbeef" />);
    expect(screen.getByText(/Degraded/)).toBeInTheDocument();
    expect(screen.getByText(/incomplete/i)).toBeInTheDocument();
  });

  it("shows an error state when the query fails", () => {
    mockUseBlastRadius.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoFullName="acme/repo" headSha="deadbeef" />);
    expect(screen.getByText("Failed to load blast radius")).toBeInTheDocument();
  });
});
