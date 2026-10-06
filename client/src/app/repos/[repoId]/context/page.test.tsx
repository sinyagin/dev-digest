import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { NextIntlClientProvider } from "next-intl";
import type { ContextListing, ContextDocumentContent } from "@devdigest/shared";
import messages from "../../../../../messages/en/context.json";

expect.extend(toHaveNoViolations);

// Mock at the hooks/network boundary only — everything below (sorting,
// Markdown rendering, EmptyState/ErrorState) is real.
let listingData: ContextListing | undefined;
let contentByPath: Record<string, ContextDocumentContent> = {};

// Spy on useContextDocuments itself (not just its return value) so AC-40's
// repoId-scoping assertion can check the exact args it was called with.
const useContextDocumentsSpy = vi.fn((repoId: string | null | undefined) => repoId);
const writeMutate = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

vi.mock("@/lib/hooks/context", () => ({
  useContextDocuments: (repoId: string | null | undefined) => {
    useContextDocumentsSpy(repoId);
    return { data: listingData, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useContextDocument: (_repoId: string | null | undefined, path: string | null | undefined) => ({
    data: path ? contentByPath[path] : undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useWriteContextDocument: () => ({
    mutate: writeMutate,
    isPending: false,
  }),
}));

import ContextPage from "./page";

afterEach(() => {
  cleanup();
  listingData = undefined;
  contentByPath = {};
  useContextDocumentsSpy.mockClear();
  writeMutate.mockClear();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextPage />
    </NextIntlClientProvider>,
  );
}

describe("Project Context page", () => {
  it("renders a multi-bucket listing with the root bucket first, shows the ≈ aggregate token total, and renders the selected document as formatted Markdown (not raw source)", async () => {
    const user = userEvent.setup();
    listingData = {
      documents: [
        { path: "README.md", bucket: "root", size_bytes: 200, estimated_tokens: 50, updated_at: "2026-01-01T00:00:00.000Z", used_by_agents: 1 },
        { path: "specs/foo.md", bucket: "specs", size_bytes: 400, estimated_tokens: 100, updated_at: "2026-01-02T00:00:00.000Z", used_by_agents: 0 },
        { path: "docs/guide.md", bucket: "docs", size_bytes: 300, estimated_tokens: 70, updated_at: "2026-01-03T00:00:00.000Z", used_by_agents: 2 },
      ],
      summary: { document_count: 3, estimated_tokens_total: 220, refreshed_at: "2026-01-03T00:00:00.000Z", clone_available: true },
    };
    contentByPath = {
      "README.md": {
        path: "README.md",
        content: "# Heading\n\n- item one\n- item two\n",
        size_bytes: 200,
        estimated_tokens: 50,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      "specs/foo.md": {
        path: "specs/foo.md",
        content: "## Foo spec\n\nSome body text.",
        size_bytes: 400,
        estimated_tokens: 100,
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    };

    renderWithIntl();

    // AC-1/AC-4: every discovered document lists, root bucket sorted first.
    // README.md is also the default-selected preview, so it renders twice
    // (list row + preview header) — everything else renders exactly once.
    expect(screen.getAllByText("README.md").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("specs/foo.md")).toBeInTheDocument();
    expect(screen.getByText("docs/guide.md")).toBeInTheDocument();

    // AC-7/AC-8: the aggregate total carries "≈" and equals the sum (50+100+70).
    expect(screen.getByText("≈220 tokens")).toBeInTheDocument();

    // README.md (root bucket, sorted first) is selected by default — its
    // Markdown renders as real elements, not raw "# Heading" source text.
    expect(await screen.findByRole("heading", { level: 1, name: "Heading" })).toBeInTheDocument();
    const listItem = screen.getByText("item one");
    expect(listItem.closest("li")).toBeInTheDocument();
    expect(screen.queryByText("# Heading")).not.toBeInTheDocument();
    expect(screen.queryByText(/^- item one/)).not.toBeInTheDocument();

    // Selecting a different document swaps the preview content.
    await user.click(screen.getByRole("button", { name: /specs\/foo\.md/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Foo spec" })).toBeInTheDocument();
    expect(screen.getByText("Some body text.")).toBeInTheDocument();
  });

  it("shows the not-cloned state with no role=\"alert\" anywhere on the page when clone_available is false (AC-34)", () => {
    listingData = {
      documents: [],
      summary: { document_count: 0, estimated_tokens_total: 0, refreshed_at: "2026-01-01T00:00:00.000Z", clone_available: false },
    };
    renderWithIntl();

    expect(screen.getByText("This repository hasn't been cloned yet")).toBeInTheDocument();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("shows the corrected empty-documents copy that names the real discovery scope, not the old .devdigest/specs wording (AC-35)", () => {
    listingData = {
      documents: [],
      summary: { document_count: 0, estimated_tokens_total: 0, refreshed_at: "2026-01-01T00:00:00.000Z", clone_available: true },
    };
    const { container } = renderWithIntl();

    expect(screen.getByText("No spec files yet")).toBeInTheDocument();
    expect(container.textContent).not.toContain("devdigest/specs");
  });

  it("switching to Edit mode always shows the mandatory resync-discards-edits warning, and saving routes through useWriteContextDocument (AC-24)", async () => {
    const user = userEvent.setup();
    listingData = {
      documents: [
        { path: "README.md", bucket: "root", size_bytes: 200, estimated_tokens: 50, updated_at: "2026-01-01T00:00:00.000Z", used_by_agents: 1 },
      ],
      summary: { document_count: 1, estimated_tokens_total: 50, refreshed_at: "2026-01-01T00:00:00.000Z", clone_available: true },
    };
    contentByPath = {
      "README.md": {
        path: "README.md",
        content: "# Heading\n\nBody text.",
        size_bytes: 200,
        estimated_tokens: 50,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    };

    renderWithIntl();

    // README.md is the default selection; switch its panel from Preview to Edit
    // via the mode toggle built in T26 (two `active`-prop Buttons, see page.tsx).
    await user.click(screen.getByRole("button", { name: messages.mode.edit }));

    // AC-24: the resync-discards-edits warning is mandatory and visible, not
    // hidden behind a hover/tooltip.
    const warning = await screen.findByText(messages.resyncWarning);
    expect(warning).toBeVisible();

    // Saving routes through useWriteContextDocument() — never a raw fetch or
    // a different write path. Edit the textarea so the Save button is enabled
    // (DocumentEditor disables Save while the draft matches loaded content).
    await user.type(screen.getByRole("textbox"), " more");
    await user.click(screen.getByRole("button", { name: messages.editor.save }));

    expect(writeMutate).toHaveBeenCalledTimes(1);
    expect(writeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: "r1", path: "README.md" }),
      expect.anything(),
    );
  });

  it("scopes the Project Context document listing to the active repo via useContextDocuments(repoId) (AC-40)", () => {
    listingData = {
      documents: [],
      summary: { document_count: 0, estimated_tokens_total: 0, refreshed_at: "2026-01-01T00:00:00.000Z", clone_available: true },
    };

    renderWithIntl();

    // useParams is mocked to repoId "r1" — the page must pass that straight
    // through to useContextDocuments, which is what keys the query
    // (["context", repoId]) to the active repo.
    expect(useContextDocumentsSpy).toHaveBeenCalledWith("r1");
  });

  it("has zero WCAG 2.1 AA violations (AC-44)", async () => {
    listingData = {
      documents: [
        { path: "README.md", bucket: "root", size_bytes: 200, estimated_tokens: 50, updated_at: "2026-01-01T00:00:00.000Z", used_by_agents: 1 },
        { path: "specs/foo.md", bucket: "specs", size_bytes: 400, estimated_tokens: 100, updated_at: "2026-01-02T00:00:00.000Z", used_by_agents: 0 },
      ],
      summary: { document_count: 2, estimated_tokens_total: 150, refreshed_at: "2026-01-01T00:00:00.000Z", clone_available: true },
    };
    contentByPath = {
      "README.md": {
        path: "README.md",
        content: "# Heading\n\nBody text.",
        size_bytes: 200,
        estimated_tokens: 50,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    };
    const { container } = renderWithIntl();
    await screen.findByRole("heading", { level: 1, name: "Heading" });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
