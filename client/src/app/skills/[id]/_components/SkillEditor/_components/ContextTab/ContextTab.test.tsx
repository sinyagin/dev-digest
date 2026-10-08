import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, ContextDocument } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

expect.extend(toHaveNoViolations);

const setSkillDocumentsMutate = vi.fn();
const updateSkillMutate = vi.fn();

const doc = (path: string, bucket: string, estimated_tokens: number): ContextDocument => ({
  path,
  bucket,
  size_bytes: 500,
  estimated_tokens,
  updated_at: "2026-01-01T00:00:00.000Z",
  used_by_agents: 0,
});

const DOCUMENTS: ContextDocument[] = [doc("specs/public-api.md", "specs", 25), doc("docs/other.md", "docs", 15)];
const ATTACHED_PATHS = ["specs/public-api.md"];

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1" }),
}));

vi.mock("@/lib/hooks/context", () => ({
  useContextDocuments: () => ({ data: { documents: DOCUMENTS }, isLoading: false, isError: false, refetch: vi.fn() }),
  useSkillContextDocuments: () => ({
    data: { paths: ATTACHED_PATHS },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSetSkillContextDocuments: () => ({ mutate: setSkillDocumentsMutate, isPending: false }),
}));

// ContextTab never imports useUpdateSkill — mocked purely to prove the save
// flow below never touches it (AC-17: attaching context must not create a
// new skill version via the general update endpoint).
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: updateSkillMutate, isPending: false }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setSkillDocumentsMutate.mockClear();
  updateSkillMutate.mockClear();
});

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Flags weak PR descriptions",
  type: "rubric",
  source: "manual",
  body: "# Rule\nBe specific.",
  enabled: true,
  version: 2,
  evidence_files: null,
  agents_count: 1,
};

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ContextTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("Skill Editor ContextTab", () => {
  it("shows the attached pill, the verbatim inheritance hint, the exact SERIALIZES AS preview, and saves via the attachment mutation only", async () => {
    const user = userEvent.setup();
    renderWithIntl();

    // "{count} attached" pill (single-param form, unlike the Agent tab's "n
    // of m") — scoped to the header, since the shared picker's own footer
    // coincidentally renders the same text ("1 attached") for this fixture.
    const header = screen.getByText("Context").parentElement!;
    expect(within(header).getByText("1 attached")).toBeInTheDocument();

    // AC-18: character-exact, sourced from the same messages file the
    // component reads via useTranslations.
    expect(screen.getByText("Any agent using this skill inherits these documents.")).toBeInTheDocument();

    // AC-19: with specs/public-api.md attached, the preview shows the exact
    // heading followed by exactly one "- <path>" line.
    expect(screen.getByText("SERIALIZES AS")).toBeInTheDocument();
    const preview = screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent === "## Project specifications\n- specs/public-api.md");
    expect(preview).toBeInTheDocument();

    // Attaching the second document saves through the skill-attachment
    // mutation, replacing the whole list — never through the general
    // skill-update mutation.
    await user.click(screen.getByRole("checkbox", { name: "docs/other.md" }));
    expect(setSkillDocumentsMutate).toHaveBeenCalledWith({
      paths: ["specs/public-api.md", "docs/other.md"],
    });
    expect(updateSkillMutate).not.toHaveBeenCalled();
  });

  it("has zero WCAG 2.1 AA violations (AC-44)", async () => {
    const { container } = renderWithIntl();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
