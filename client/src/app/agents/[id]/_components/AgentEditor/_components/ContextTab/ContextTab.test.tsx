import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, ContextDocument } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

expect.extend(toHaveNoViolations);

const setAgentDocumentsMutate = vi.fn();
const updateAgentMutate = vi.fn();

const doc = (path: string, bucket: string, estimated_tokens: number): ContextDocument => ({
  path,
  bucket,
  size_bytes: 500,
  estimated_tokens,
  updated_at: "2026-01-01T00:00:00.000Z",
  used_by_agents: 0,
});

// 7 discovered documents; 2 are attached — exercises the "N of M attached" pill.
const DOCUMENTS: ContextDocument[] = [
  doc("specs/a.md", "specs", 10),
  doc("specs/b.md", "specs", 20),
  doc("docs/c.md", "docs", 30),
  doc("docs/d.md", "docs", 40),
  doc("README.md", "root", 50),
  doc("docs/e.md", "docs", 60),
  doc("docs/f.md", "docs", 70),
];
const ATTACHED_PATHS = ["specs/a.md", "docs/c.md"];

vi.mock("../../../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1" }),
}));

vi.mock("../../../../../../../lib/hooks/context", () => ({
  useContextDocuments: () => ({ data: { documents: DOCUMENTS }, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentContextDocuments: () => ({
    data: { paths: ATTACHED_PATHS },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSetAgentContextDocuments: () => ({ mutate: setAgentDocumentsMutate, isPending: false }),
}));

// ContextTab never imports useUpdateAgent — mocked purely to prove the save
// flow below never touches it (AC-15: attaching context must not create a
// new agent version via the general update endpoint).
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: updateAgentMutate, isPending: false }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setAgentDocumentsMutate.mockClear();
  updateAgentMutate.mockClear();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  skills_count: 0,
  enabled: true,
  version: 1,
};

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ContextTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("Agent Editor ContextTab", () => {
  it("shows the attached pill, the verbatim order/injection copy, and the ≈ token footer, and saves via the attachment mutation only", async () => {
    const user = userEvent.setup();
    renderWithIntl();

    // "2 of 7 attached" pill (AC-X: n/m counts).
    expect(screen.getByText("2 of 7 attached")).toBeInTheDocument();

    // AC-16: both strings appear character-exact, sourced straight from the
    // same messages file the component reads via useTranslations — not a
    // paraphrase and not a case-insensitive regex.
    expect(
      screen.getByText(
        "Order matters — earlier docs appear earlier in the assembled `## Project context` block.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Injected as an untrusted block (`## Project context`) into every run."),
    ).toBeInTheDocument();

    // Footer token total: only discovered+attached docs count (10 + 30 = 40).
    expect(screen.getByText("≈ 40 tokens")).toBeInTheDocument();

    // Attaching a third document saves through the agent-attachment
    // mutation, replacing the whole list — and never through the general
    // agent-update mutation.
    await user.click(screen.getByRole("checkbox", { name: "README.md" }));
    expect(setAgentDocumentsMutate).toHaveBeenCalledWith({
      paths: ["specs/a.md", "docs/c.md", "README.md"],
    });
    expect(updateAgentMutate).not.toHaveBeenCalled();
  });

  it("has zero WCAG 2.1 AA violations (AC-44)", async () => {
    const { container } = renderWithIntl();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
