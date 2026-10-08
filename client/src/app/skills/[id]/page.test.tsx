import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, ContextDocument } from "@devdigest/shared";
import messages from "../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

/* Regression test for a bug in this page (now fixed): page.tsx used to
   hardcode its own VALID_TABS array to validate ?tab=, out of sync with
   SkillEditor/constants.ts's TABS. When a "Context" tab was added to TABS,
   clicking it updated the URL but the page's own gate silently rejected
   "context" and fell back to "config" on the next render. The fix derives
   VALID_TABS from TABS.map(t => t.key) directly. Mirrors
   agents/[id]/page.test.tsx 1:1 (see that file's comment for the full
   rationale on why the reactive next/navigation mock matters here).

   SkillEditor.test.tsx (if any) and ContextTab.test.tsx render the inner
   components directly with an explicit tab="context" prop, bypassing this
   page's own URL-param-driven validation entirely — which is exactly how
   this bug slipped through. These tests instead render the real page and
   drive the tab switch through a real, reactive next/navigation mock so
   the page's own VALID_TABS gate is actually exercised. */

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

const doc = (path: string, bucket: string, estimated_tokens: number): ContextDocument => ({
  path,
  bucket,
  size_bytes: 500,
  estimated_tokens,
  updated_at: "2026-01-01T00:00:00.000Z",
  used_by_agents: 0,
});

// 2 discovered documents, 1 attached — just enough to render the picker and
// exercise the "{count} attached" pill without errors.
const DOCUMENTS: ContextDocument[] = [doc("specs/public-api.md", "specs", 25), doc("docs/other.md", "docs", 15)];
const ATTACHED_PATHS = ["specs/public-api.md"];

const updateSkillMutate = vi.fn();
const deleteSkillMutate = vi.fn();
const setSkillDocumentsMutate = vi.fn();

// A reactive next/navigation mock. router.replace() parses the target URL's
// ?tab= and publishes it into a tiny external store; useSearchParams() is a
// real hook (via useSyncExternalStore) subscribed to that store — so
// clicking a real tab button causes a real re-render with the new search
// params, mirroring how Next's actual router drives useSearchParams()
// consumers. A static mock (fixed return value) would let this test "pass"
// by construction even if the real VALID_TABS bug reproduced, since the
// page's derived `tab` would never actually need to follow a URL update.
vi.mock("next/navigation", () => {
  let store = new URLSearchParams();
  const listeners = new Set<() => void>();
  const subscribe = (onStoreChange: () => void) => {
    listeners.add(onStoreChange);
    return () => listeners.delete(onStoreChange);
  };
  const getSnapshot = () => store;
  const setStoreFromUrl = (url: string) => {
    const qs = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    store = new URLSearchParams(qs);
    listeners.forEach((listener) => listener());
  };
  const replace = vi.fn((url: string) => setStoreFromUrl(url));
  const push = vi.fn();
  return {
    useParams: () => ({ id: "sk1" }),
    useRouter: () => ({ replace, push }),
    useSearchParams: () => useSyncExternalStore(subscribe, getSnapshot),
    // Test-only escape hatch — not a real Next export — so each test starts
    // from a clean "no ?tab=" URL instead of leaking state across tests.
    __resetSearchParamsForTests: () => setStoreFromUrl(""),
  };
});

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: [SKILL] }),
  useSkill: () => ({ data: SKILL, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: updateSkillMutate, isPending: false, isSuccess: false, data: undefined }),
  useDeleteSkill: () => ({ mutate: deleteSkillMutate, isPending: false }),
}));

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

// Imported as a namespace (not a named import) so `tsc` — which only knows
// the real next/navigation's exported types, not this file's runtime mock —
// doesn't reject the test-only `__resetSearchParamsForTests` escape hatch.
import * as mockedNavigation from "next/navigation";
import SkillEditorPage from "./page";

const resetSearchParamsForTests = () =>
  (mockedNavigation as unknown as { __resetSearchParamsForTests: () => void }).__resetSearchParamsForTests();

afterEach(() => {
  cleanup();
  resetSearchParamsForTests();
  updateSkillMutate.mockClear();
  deleteSkillMutate.mockClear();
  setSkillDocumentsMutate.mockClear();
});

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillEditorPage />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillEditorPage ?tab= regression", () => {
  it("defaults to the Config tab when there is no ?tab= in the URL", () => {
    renderPage();

    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("clicking the real Context tab button swaps the Config UI for the Context UI via the ?tab= URL flow", async () => {
    const user = userEvent.setup();
    renderPage();

    // Sanity: Config is the default/initial render.
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();

    // Click the REAL Tabs button (not <SkillEditor tab="context" ... />
    // directly) — this is exactly the path the fixed bug lived in:
    // onChange -> onTab -> router.replace(`/skills/sk1?tab=context`) ->
    // page.tsx re-derives `tab` from useSearchParams() against VALID_TABS.
    await user.click(screen.getByRole("button", { name: "Context" }));

    // The Config-only UI must be gone...
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
    expect(screen.queryByText("Name")).not.toBeInTheDocument();

    // ...and the Context tab's own content is now rendered — this is
    // exactly what silently failed to render pre-fix, since the page fell
    // back to "config" instead of accepting "context". Assert on both the
    // verbatim inheritance hint and the "{count} attached" pill (single-
    // param form, unlike the Agent tab's "n of m" — see skills.json's
    // context.attachedCount).
    expect(await screen.findByText("Any agent using this skill inherits these documents.")).toBeInTheDocument();
    expect(screen.getByText(/\d+ attached/i)).toBeInTheDocument();
  });
});
