import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import shellMessages from "../../../../messages/en/shell.json";
import { FileCard } from "./FileCard";

afterEach(cleanup);

// jsdom doesn't implement scrollIntoView. Stub it per-test and restore the
// original (missing) value afterward so this doesn't leak into other test
// files that may share the same worker/jsdom realm (e.g. DiffTab.test.tsx's
// own scrollIntoView spy, which expects the property to be genuinely absent
// beforehand).
let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined;

beforeEach(() => {
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>{ui}</NextIntlClientProvider>);
}

// Additions+deletions exceed AUTO_EXPAND_MAX_LINES (200), so this file
// defaults to collapsed absent a matching focusPath.
const BIG_FILE: PrFile = {
  path: "src/big-file.ts",
  additions: 300,
  deletions: 0,
  patch: "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;",
};

describe("FileCard focusPath", () => {
  it("force-opens and scrolls into view when focusPath matches the file's path", () => {
    renderWithIntl(<FileCard file={BIG_FILE} focusPath={BIG_FILE.path} />);

    expect(screen.getByText("const c = 4;")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("leaves the default collapsed state unchanged, and never scrolls, when focusPath is absent or non-matching", () => {
    renderWithIntl(<FileCard file={BIG_FILE} />);
    expect(screen.queryByText("const c = 4;")).not.toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    cleanup();
    renderWithIntl(<FileCard file={BIG_FILE} focusPath="src/some-other-file.ts" />);
    expect(screen.queryByText("const c = 4;")).not.toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
