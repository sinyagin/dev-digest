import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocument } from "@devdigest/shared";
import messages from "../../../messages/en/context.json";
import { ContextAttachmentPicker } from "./ContextAttachmentPicker";

afterEach(cleanup);

/* A controlled harness: ContextAttachmentPicker is presentational — the
   parent (an Agent/Skill Context tab in production) owns `paths` and feeds
   back the picker's onChange. Mirroring that contract here (rather than a
   bare onChange spy) is what lets the filter/toggle/reorder flows actually
   re-render with the next state, the same way a real Context tab would. */
function Harness({
  documents,
  initialPaths,
  saving = false,
  onChange,
}: {
  documents: ContextDocument[];
  initialPaths: string[];
  saving?: boolean;
  onChange?: (paths: string[]) => void;
}) {
  const [paths, setPaths] = React.useState(initialPaths);
  return (
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextAttachmentPicker
        documents={documents}
        paths={paths}
        saving={saving}
        onChange={(next) => {
          onChange?.(next);
          setPaths(next);
        }}
      />
    </NextIntlClientProvider>
  );
}

const doc = (overrides: Partial<ContextDocument>): ContextDocument => ({
  path: "docs/readme.md",
  bucket: "docs",
  size_bytes: 500,
  estimated_tokens: 120,
  updated_at: "2026-01-01T00:00:00.000Z",
  used_by_agents: 0,
  ...overrides,
});

const DOCS: ContextDocument[] = [
  doc({ path: "docs/readme.md", bucket: "docs", estimated_tokens: 120 }),
  doc({ path: "specs/foo.md", bucket: "specs", estimated_tokens: 80 }),
  doc({ path: "specs/bar.md", bucket: "specs", estimated_tokens: 50 }),
  // "rfc" is deliberately absent from BUCKET_COLOR (constants.ts only knows
  // specs/docs/insights/adr/root) — exercises AC-5's fallback path, not the
  // spec's own illustrative "adr" example, which this component already
  // recognizes.
  doc({ path: "rfc/0001-caching.md", bucket: "rfc", estimated_tokens: 40 }),
];

/** Tab from the currently focused element until `target` is reached, the
    same way a keyboard-only user would — never jump focus with `.focus()`
    and never click. Bounded so a broken tab order fails loudly. */
async function tabUntilFocused(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  for (let i = 0; i < 30; i++) {
    if (document.activeElement === target) return;
    await user.tab();
  }
  throw new Error(`Could not reach ${target.outerHTML} via Tab within 30 presses`);
}

function attachedOrder(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((li) => li.textContent?.match(/docs\/[abc]\.md/)?.[0])
    .filter((p): p is string => !!p);
}

describe("ContextAttachmentPicker", () => {
  it("filters by path while keeping attached and missing rows visible, shows an unrecognised bucket's tag and ≈ token estimates, and toggles attach/detach", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // "specs/missing.md" is attached but absent from `documents` — AC-36.
    render(<Harness documents={DOCS} initialPaths={["docs/readme.md", "specs/missing.md"]} onChange={onChange} />);

    // Initial render: every row is present, including the missing one, and
    // the unrecognised "rfc" bucket still renders a visible tag (AC-5).
    expect(screen.getByRole("checkbox", { name: "docs/readme.md" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "specs/missing.md" })).toBeChecked();
    expect(screen.getByText("missing")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "rfc/0001-caching.md" })).not.toBeChecked();
    expect(screen.getByText("rfc")).toBeInTheDocument();

    // Every rendered token figure uses the explicit "≈" estimate (AC-8),
    // never an unqualified exact count.
    for (const el of screen.getAllByText(/tokens$/)) {
      expect(el).toHaveTextContent(/^≈\d+ tokens$/);
    }
    // Footer total: specs/missing.md is attached but undiscovered, so it
    // contributes 0 — only docs/readme.md's 120 counts. Scoped to the
    // footer specifically since a row can show the same figure.
    const footer = screen.getByText("2 attached").parentElement!;
    expect(within(footer).getByText("≈120 tokens")).toBeInTheDocument();

    // Case-insensitive substring filter on path (uppercase query).
    await user.type(screen.getByLabelText("Filter documents by path"), "SPECS");
    expect(screen.getByRole("checkbox", { name: "specs/foo.md" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "specs/bar.md" })).toBeInTheDocument();
    // Attached rows are never hidden by the filter, even when they don't match it.
    expect(screen.getByRole("checkbox", { name: "docs/readme.md" })).toBeInTheDocument();
    // An unattached, non-matching document IS hidden.
    expect(screen.queryByRole("checkbox", { name: "rfc/0001-caching.md" })).not.toBeInTheDocument();

    // Attach a newly-filtered-in document.
    await user.click(screen.getByRole("checkbox", { name: "specs/foo.md" }));
    expect(onChange).toHaveBeenLastCalledWith(["docs/readme.md", "specs/missing.md", "specs/foo.md"]);
    expect(screen.getByRole("checkbox", { name: "specs/foo.md" })).toBeChecked();

    // Detach the missing (undiscovered) attached document — it must remain
    // clickable/detachable despite not being in `documents` (AC-36).
    await user.click(screen.getByRole("checkbox", { name: "specs/missing.md" }));
    expect(onChange).toHaveBeenLastCalledWith(["docs/readme.md", "specs/foo.md"]);
    expect(screen.queryByText("missing")).not.toBeInTheDocument();
  });

  it("reorders attached documents up and down using only the keyboard (AC-44)", async () => {
    const user = userEvent.setup();
    const DOCS3 = [
      doc({ path: "docs/a.md", bucket: "docs" }),
      doc({ path: "docs/b.md", bucket: "docs" }),
      doc({ path: "docs/c.md", bucket: "docs" }),
    ];
    render(<Harness documents={DOCS3} initialPaths={["docs/a.md", "docs/b.md", "docs/c.md"]} />);

    expect(attachedOrder()).toEqual(["docs/a.md", "docs/b.md", "docs/c.md"]);

    // Tab (never click) to "Move docs/b.md up" and activate with Enter.
    const moveUp = screen.getByRole("button", { name: "Move docs/b.md up" });
    await tabUntilFocused(user, moveUp);
    await user.keyboard("{Enter}");
    expect(attachedOrder()).toEqual(["docs/b.md", "docs/a.md", "docs/c.md"]);

    // Tab to "Move docs/b.md down" (now first) and activate with Space.
    const moveDown = screen.getByRole("button", { name: "Move docs/b.md down" });
    await tabUntilFocused(user, moveDown);
    await user.keyboard(" ");
    expect(attachedOrder()).toEqual(["docs/a.md", "docs/b.md", "docs/c.md"]);

    // The screen-reader announcement reflects the last move.
    expect(screen.getByRole("status")).toHaveTextContent(/Moved docs\/b\.md to position 2 of 3/);
  });

  it("disables every toggle, filter, and reorder control while a save is pending (AC-39)", () => {
    const DOCS3 = [
      doc({ path: "docs/a.md", bucket: "docs" }),
      doc({ path: "docs/b.md", bucket: "docs" }),
      doc({ path: "docs/c.md", bucket: "docs" }),
    ];
    render(<Harness documents={DOCS3} initialPaths={["docs/a.md", "docs/b.md", "docs/c.md"]} saving />);

    expect(screen.getByLabelText("Filter documents by path")).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toBeDisabled();
    }
    // "Move docs/b.md up/down" would normally be enabled (b is neither first
    // nor last) — saving must disable them regardless of position.
    expect(screen.getByRole("button", { name: "Move docs/b.md up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move docs/b.md down" })).toBeDisabled();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});
