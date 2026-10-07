import type { ComponentProps } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiffResponse } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

const mutate = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSmartDiff: () => ({ data: SMART_DIFF }),
  useFindingAction: () => ({ mutate, isPending: false }),
}));

import { DiffTab } from "./DiffTab";

afterEach(cleanup);

const FILES: PrFile[] = [
  {
    path: "src/a.ts",
    additions: 2,
    deletions: 0,
    patch: "@@ -1,1 +1,3 @@\n const a = 1;\n+const b = 2;\n+const c = 3;",
  },
];

const SMART_DIFF: SmartDiffResponse = {
  groups: [
    {
      role: "core",
      files: [{ path: "src/a.ts", pseudocode_summary: null, additions: 2, deletions: 0, finding_lines: [3] }],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
};

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "Off-by-one",
    file: "src/a.ts",
    start_line: 3,
    end_line: 3,
    rationale: "Looks wrong.",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderTab(extraProps: Partial<ComponentProps<typeof DiffTab>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
      <DiffTab prId="pr1" filesCount={1} files={FILES} canComment latestFindings={FINDINGS} {...extraProps} />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab", () => {
  it("defaults to Smart order, grouping files under a role header", () => {
    renderTab();
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });

  it("toggling to Original order drops the role grouping but keeps the file", () => {
    renderTab();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Core")).not.toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });

  it("renders the inline finding card and wires Accept to useFindingAction().mutate", () => {
    renderTab();
    expect(screen.getByText("Off-by-one")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Accept"));
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr1" });
  });

  it("forwards focusPath to the rendered viewer, scrolling the matching file into view in both Smart and Original order", () => {
    // jsdom doesn't implement scrollIntoView at all — stub it directly rather
    // than spying on a nonexistent prototype method.
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    renderTab({ focusPath: "src/a.ts" });
    expect(scrollIntoView).toHaveBeenCalled();

    scrollIntoView.mockClear();
    fireEvent.click(screen.getByRole("switch")); // switch to the plain DiffViewer fallback
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
