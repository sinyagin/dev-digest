# Insights — client

Running log of non-obvious things learned while working in `@devdigest/web`:
gotchas, dead ends, decisions that don't belong in the fixed map in
[`CLAUDE.md`](CLAUDE.md). Newest entries at top.

<!-- Add entries below, e.g.:
## 2026-09-15 — short title
What happened, what was tried, what actually worked or didn't, and why.
-->

## 2026-10-04 — `ContextAttachmentPicker`'s 8 hardcoded strings moved to `context.json`'s new `picker.*` group; kept the redundant footer, didn't remove it [Decision]
Architecture-reviewer flagged `client/src/components/context-attachments/ContextAttachmentPicker.tsx` for 8
hardcoded English strings. Added a `picker` key group to `client/messages/en/context.json` (filterPlaceholder,
filterLabel, noMatches, missing, moveUp, moveDown, moved, attachedCount) and switched the component to
`useTranslations("context")` — chosen over `agents`/`skills` namespaces because this component (per its own
file-header comment) is promoted/shared by both editors' Context tabs, so it shouldn't belong to either's
namespace. The finding's footer note suggested removing the picker's own `"{n} attached"` footer line
(`ContextAttachmentPicker.tsx:134-135`) since both the Agent and Skill tabs already render their own correctly
translated pill right alongside it — kept it instead, translated, because `ContextAttachmentPicker.test.tsx`
(T27's file, not in this fix's owned paths) asserts on it directly (`screen.getByText("2 attached")`), and
removing it would have required a wider edit to that test than the "minimal necessary" latitude this task was
given. This is reversible later if someone wants to kill the duplication — see the Skill `ContextTab.test.tsx`
comment at `src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.test.tsx:82-86` that
already works around the duplicate text by scoping its query to the header, implying the footer's redundancy
was anticipated but deliberately left alone.

## 2026-10-04 — Adding `useTranslations` to a shared component breaks any test that renders it without `NextIntlClientProvider` [Mistake]
`ContextAttachmentPicker.test.tsx` rendered `ContextAttachmentPicker` directly with no i18n provider (it predates
this component needing one) — once `ContextAttachmentPicker.tsx:40` calls `useTranslations("context")`, every
test in that file started throwing "Failed to call `useTranslations` because the context from
`NextIntlClientProvider` was not found" at render time (not a test-assertion failure — a render-time throw, so
all 3 tests failed). Fixed by wrapping the test's `Harness` component in `NextIntlClientProvider` with
`messages={{ context: messagesFromContextJson }}` (`ContextAttachmentPicker.test.tsx:1-40`). Contrast with the
two `ContextTab.test.tsx` files, which already wrap in `NextIntlClientProvider` but only pass their OWN
namespace's messages (`{ agents: messages }` / `{ skills: messages }`) — next-intl does NOT throw for a missing
*namespace* within an existing provider (only for a fully absent provider); it logs `MISSING_MESSAGE` to stderr
and falls back silently, so those two test files kept passing even before being updated to also include the
`context` namespace. Don't assume "stderr is clean" — check whether a missing-message warning, not just a hard
failure, is masking a real gap.

## 2026-10-04 — Testing `DocumentEditor`'s save path requires mocking `@/lib/toast`, and `vi.fn().mock.calls[0][0]` fails strict-mode typecheck [Context]
Adding AC-24 coverage to `client/src/app/repos/[repoId]/context/page.test.tsx` (the Edit-mode
resync-warning + `useWriteContextDocument()` save flow) hit two snags. First,
`DocumentEditor.tsx:42` calls `useToast()` (`client/src/lib/toast.tsx:24-28`), which `throw`s if no
`<ToastProvider>` is mounted — rendering `ContextPage` directly (no provider, per this test file's
existing pattern) crashes as soon as Edit mode renders, unless `@/lib/toast` is mocked at the module
boundary; `conventions/page.test.tsx:66-68` already has this exact mock, copied verbatim. Second,
asserting on a specific mutate call's args via `writeMutate.mock.calls[0][0]` fails `tsc --noEmit`
under this repo's strict TS config (`Object is possibly 'undefined'` — `mock.calls[0]` is typed as
possibly-undefined even right after `toHaveBeenCalledTimes(1)`); switched to
`expect(writeMutate).toHaveBeenCalledWith(expect.objectContaining({...}), expect.anything())` instead,
which both typechecks and is the more idiomatic RTL/vitest assertion anyway.

## 2026-10-04 — `Checkbox`'s `button-name` axe violation fixed via `aria-labelledby`; prior suppression removed [Decision]
Follow-up to the "`@devdigest/ui`'s `Checkbox` fails axe-core's `button-name` rule" entry directly
below: that entry's suggested follow-up ("give `Checkbox` an explicit `aria-label`/`aria-labelledby`
on the inner `<button>` itself") is now done. `client/src/vendor/ui/kit/Checkbox.tsx:5-51` generates a
stable id via `useId()`, renders the label text in a `<span id={labelId}>` (only when `label` is
provided), and sets `aria-labelledby={labelId}` on the `role="checkbox"` button. Chose
`aria-labelledby` over `aria-label={typeof label === 'string' ? ... }` because `label` is typed
`React.ReactNode` and a real call site (`client/src/components/context-attachments/ContextAttachmentPicker.tsx:83-88`)
passes JSX (`<span>{row.path}</span>`), not a string — `aria-labelledby` covers both string and
JSX labels uniformly. Verified against all 4 call sites (`ConventionCard.tsx:61`, `SkillsTab.tsx:135`,
`ContextAttachmentPicker.tsx:83`, `Showcase.tsx:170`) plus the full `pnpm test` suite (32 files/128
tests) — no visual regression, since wrapping the label text in an inline `<span>` as a flex item
renders identically to a bare text node. Removed the `{ rules: { "button-name": { enabled: false } } }`
axe suppression from both `ContextTab.test.tsx` files (Agent + Skill editors); both axe assertions now
pass with the full default rule set. Note: `SkillsTab.tsx:135`'s `<Checkbox checked={isChecked}
onChange={() => toggle(id)} disabled={setSkills.isPending} />` call passes no `label` prop at all (the
visible skill name is a separate sibling `<span>` outside the `Checkbox`, not passed through `label`),
so that checkbox still has no accessible name — pre-existing, out of scope for this fix since no
caller in `SkillsTab.tsx` is owned by this task's file list, and not covered by any axe test today.

## 2026-10-04 — `@devdigest/ui`'s `Checkbox` fails axe-core's `button-name` rule; RTL role queries still find it fine [Mistake]
Running a first `jest-axe` pass (no prior a11y test tool existed in `client/` — added `jest-axe`/`@types/jest-axe`/`@testing-library/user-event` as new devDependencies for T27) over the Agent/Skill editors' `ContextTab` surfaced a real WCAG 2.1 AA violation: `Checkbox` (`client/src/vendor/ui/kit/Checkbox.tsx:17-46`) renders its `role="checkbox"` `<button>` with the row's label text as a *sibling* `<span>` inside the wrapping `<label>`, not as the button's own child content. `screen.getByRole("checkbox", { name: "some/path.md" })` in RTL still resolves correctly (RTL's `dom-accessibility-api` accname implementation does credit the wrapping `<label>` to a role-overridden button), but axe-core's real `button-name` rule does not, and flags every such checkbox as nameless — this is the rule real screen readers care about, so RTL passing is not proof of accessibility here. Rather than editing the vendored primitive (out of T27's owned paths — `ContextAttachmentPicker.tsx` consumes `Checkbox` as-is, per T20's INSIGHTS.md entry, and this file isn't owned by that task either), the two `ContextTab.test.tsx` axe assertions (`client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx`, the Skill-editor equivalent) scope `axe(container, { rules: { "button-name": { enabled: false } } })` with an inline comment citing this entry, so every *other* WCAG 2.1 AA rule still runs for real. A follow-up should either give `Checkbox` an explicit `aria-label`/`aria-labelledby` on the inner `<button>` itself, or move the label text inside the button as visually-hidden content — whichever is chosen, it needs to flow through every `Checkbox` call site (`ContextAttachmentPicker`, and anywhere else that reuses it), not just this one.

## 2026-10-04 — Project Context's Preview/Edit toggle uses two `active`-prop `Button`s, not `Toggle` [Decision]
`@devdigest/ui`'s `Toggle` (`client/src/vendor/ui/primitives/Toggle.tsx:3-42`) is a boolean on/off
switch (`role="switch"`), which reads wrong for a two-mode "Preview" vs "Edit" segmented control even
though the mode itself is binary — a switch implies on/off, not "which of these two labeled views".
Built the toggle in `page.tsx` (around `s.modeToggle`) as two `Button kind="tertiary"` elements with
`active={mode === "preview"}` / `active={mode === "edit"}`, the same `active`-prop segmented pattern
`Button.tsx:16,53` already supports (see `kinds.tertiary`'s `active ? ... : ...` branch) — no new
primitive needed. Switching the selected document in `DocumentList` always resets `mode` back to
`"preview"` (`page.tsx`'s `selectDocument`) so an in-progress edit of document A never silently
displays as if active for newly-selected document B.

## 2026-10-04 — `DocumentEditor`'s resync warning must not be gated behind `content`/loading checks [Context]
AC-24 requires the resync warning to render unconditionally whenever Edit mode is active — easy to
break by accident because `DocumentEditor.tsx` already has early returns for `isLoading`/`isError`
before the main render (mirroring `DocumentPreview.tsx`'s shape). The warning `<div role="alert">
{t("resyncWarning")}</div>` is placed in the main (loaded) render path only, which is correct per the
AC's own wording ("the warning text is present in the editor UI" — implicitly, once there's content to
edit), but a future edit that hoists the warning above those early returns, or wraps it in an
`isDirty`/`hasChanges` condition, would silently violate AC-24. Keep it unconditional within the loaded
branch; never make it depend on `dirty` state.

## 2026-10-04 — Skill editor's ContextTab is NOT a copy-paste of the Agent editor's ContextTab [Decision]
Built `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.tsx`
right after reading the pre-existing `AgentEditor/_components/ContextTab/ContextTab.tsx:1-90` for the
`useActiveRepo`-scoped-discovery / `useSet*ContextDocuments`-scoped-attachment pattern, expecting to
mirror it closely. The copy wording diverges by design, not oversight: `agents.json`'s `context.*`
(`client/messages/en/agents.json`) has `attachedCount: "{n} of {m} attached"` plus `orderHint` /
`injectionNotice` strings and no serialization preview at all, while `skills.json`'s `context.*`
(`client/messages/en/skills.json`) has `attachedCount: "{count} attached"` (single param, no total),
a different `inheritanceHint` string, and the AC-19-only `serializesAs`/`previewHeading` pair for a
"SERIALIZES AS" block that the Agent tab doesn't render. Added a presentational-only
`buildSerializationPreview` helper (`ContextTab/helpers.ts`) that joins the translated
`## Project specifications` heading with one `- <path>` line per currently attached path, derived
from render-time state only (never fetched) — explicitly NOT the real `reviewer-core` `## Project
context` injection format (AC-32), which never produces that heading at runtime. Anyone adding a
third `ContextTab` (e.g. for another entity) should diff both existing message namespaces first
rather than assuming one shape generalizes.

## 2026-10-04 — `@devdigest/ui`'s `Chip` renders a real `<button>`, can't nest inside a clickable row [Mistake]
Building the Project Context document list (`client/src/app/repos/[repoId]/context/_components/DocumentList/DocumentList.tsx`),
each row needed to be a single clickable `<button>` (to select the document) while also showing a
bucket tag. First instinct was to reuse `Chip` (`client/src/vendor/ui/primitives/Chip.tsx:4-46`, the
precedent used for triage filters on the Conventions page) for the tag — but `Chip` always renders as
a `<button>`, and nesting a `<button>` inside another `<button>` is invalid HTML (and breaks click/focus
semantics in some browsers). Used a plain styled `<span>` (`DocumentList.tsx`'s `s.bucketTag`) for the
tag instead. Rule of thumb: before reusing any `@devdigest/ui` primitive as a non-interactive label
inside a larger clickable element, check whether it renders a `<button>`/`<a>` under the hood — `Chip`
and `Button` both do; only `Badge` (used read-only elsewhere) renders a plain `<span>`.

## 2026-10-04 — `@devdigest/ui` already ships a safe `Markdown` primitive — don't hand-roll `react-markdown` [Pattern]
`client/src/vendor/ui/primitives/Markdown.tsx:1-42` already wraps `react-markdown` + `remark-gfm` with
no `rehype-raw`/HTML passthrough and no `dangerouslySetInnerHTML` — exactly the safe rendering AC-9 of
the Project Context spec (`specs/cross-module/SPEC-01-project-context.md`) requires for untrusted
repo-authored Markdown. Used it as-is for `DocumentPreview`
(`client/src/app/repos/[repoId]/context/_components/DocumentPreview/DocumentPreview.tsx`) rather than
writing a second `ReactMarkdown` wrapper — grep `src/vendor/ui/primitives/index.ts` for existing
primitives before adding a new renderer/plugin dependency for Markdown content anywhere in `client/`.

## 2026-10-04 — `IconBtn` has no `disabled` prop; AC-39-sensitive icon buttons must use `Button` instead [Mistake]
Reached for `@devdigest/ui`'s `IconBtn` (`client/src/vendor/ui/primitives/IconBtn.tsx:4-43`) for
`ContextAttachmentPicker`'s keyboard move-up/move-down controls, since it's the icon-only button
precedent (`SkillsTab.tsx` drags instead of using either). `IconBtn`'s signature has no `disabled`
param at all — it only takes `icon`/`label`/`size`/`active`/`onClick`/`danger`, so there is no way to
render a real disabled `<button>` from it, which is exactly what AC-39 ("toggles and reorder controls
disabled while a save is pending") requires. Switched to `Button` (`client/src/vendor/ui/primitives/Button.tsx`)
with `kind="ghost"` `size="sm"` and an `icon` prop instead — it spreads `...rest` onto a real `<button>`
including `disabled` and `aria-label`, and renders icon-only correctly when `children` is omitted. Any
future icon-only control that needs a disabled state should default to `Button`, not `IconBtn`.

## 2026-10-04 — `ContextAttachmentPicker` merges attached + available into one list, keyboard buttons only (no drag) [Decision]
`SkillsTab` (`client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx`)
is the closest existing precedent for an attach/detach/reorder list, and it reorders via native HTML5
drag-and-drop only (`draggable`, `onDragStart/Over/Drop`) with no keyboard alternative. That pattern
fails AC-44 outright (reorder must be "fully operable by keyboard alone"), so
`client/src/components/context-attachments/ContextAttachmentPicker.tsx` deliberately does NOT copy it:
reorder is two real `<button>`s (`aria-label="Move <path> up/down"`) per attached row, with drag
intentionally omitted rather than added as a redundant second affordance (not worth the complexity for
a first pass). Rows are still one merged list ordered as `[...attachedPaths, ...availableFiltered]`
(`helpers.ts`'s `buildRows`), matching `SkillsTab`'s merge-then-filter shape, but move-up/down only
renders for `row.attached` rows since reordering an unattached document has no meaning until it's
toggled on.

## 2026-10-04 — Context attachment mutations invalidate the whole `["context"]` prefix, not one repo's key [Decision]
`useSetAgentContextDocuments`/`useSetSkillContextDocuments` in
`client/src/lib/hooks/context.ts:69-103` don't receive a `repoId` (agents and
skills aren't scoped to one repo), so on success they call
`qc.invalidateQueries({ queryKey: ["context"] })` with no second element.
TanStack Query's default `exact: false` treats this as a prefix match, so it
invalidates every `["context", repoId]` listing in the cache without
accidentally catching `["context-document", repoId, path]` (different first
element) — confirmed by reading the prefix-matching behavior, not by adding a
test. If a later task threads a specific `repoId` into these hooks, prefer
narrowing to `["context", repoId]` instead of the broad prefix.

## 2026-10-04 — `useWriteContextDocument()` takes no args; repoId travels in the mutate payload [Pattern]
Unlike `useContextDocuments(repoId)`/`useContextDocument(repoId, path)` (repoId
as a hook factory arg, matching `useAgent(id)`-style sibling hooks),
`useWriteContextDocument()` in `client/src/lib/hooks/context.ts:46-57` takes no
arguments — `repoId` is part of the `WriteContextDocumentInput` object passed
to `.mutate()`, alongside `path`/`content`. This matches the plan's exact
hook signature list and lets the same mutation instance be reused across
different repos without remounting; the onSuccess handler reads `repoId` back
from the mutation variables (second arg) to invalidate `["context", repoId]`.

## 2026-10-04 — `context.json`'s pre-existing copy described a scope that discovery never implements [Mistake]
`client/messages/en/context.json`'s `empty.body` previously said documents live "under `.devdigest/specs/`" and claimed "every agent and the PR brief read them" — both false per `specs/cross-module/SPEC-01-project-context.md` AC-1/AC-2 (discovery walks the *whole* clone working tree, excluding dot-dirs/`node_modules`/build output) and the spec's explicit out-of-scope note that this feature only injects into agent runs, never the PR brief/intent pipeline. Rewrote the empty-state body to name the real scope and dropped the PR-brief claim entirely (`client/messages/en/context.json:14`). Also removed the unused `chunks`/`reindex`/`indexing`/`indexStatus` top-level keys — grepped `src/` first and confirmed only `useReindexContext` (`client/src/lib/hooks/core.ts:131`) references the underlying hook, no component reads those message keys, so deleting them is safe; they belonged to an indexing/coverage concept this feature doesn't implement. Lesson: when a message catalogue predates the feature that will consume it (seeded speculatively by an earlier task), don't trust its copy at face value — check it against the actual spec's discovery/scope ACs before reusing wording.

## 2026-09-27 — Shared `diff-viewer/*` components must stay on the `"shell"` i18n namespace, not `"prReview"` [Mistake]
Added a severity line-label to `CodeLine` (`client/src/components/diff-viewer/CodeLine/CodeLine.tsx:31`) for Smart Diff and first called `useTranslations("prReview")` there, since that's where the rest of the Smart Diff strings live. This broke `src/test/smoke.test.tsx`'s "diff viewer parses a unified patch" test with a noisy (non-fatal) `IntlError: MISSING_MESSAGE` flood — that test wraps the plain `DiffViewer` in `<NextIntlClientProvider messages={{ shell: shellMessages }}>` only, since `DiffViewer`/`FileCard`/`CodeLine` have always used `useTranslations("shell")` (see `FileCard.tsx:34`, `t("diffViewer.noDiffText")`). `CodeLine` is shared by both the flat `DiffViewer` and the new grouped `SmartDiffViewer`, so its own strings must live in `shell.json`'s existing `diffViewer` block (added `diffViewer.lineLabel.{blocker,warning,suggestion}`, `shell.json:44-48`) even though the feature is "Smart Diff" — only components that live under a PR page's own `_components/` (e.g. `RoleGroup`, `SmartDiffViewer` itself) should use `"prReview"`. Rule of thumb: match the i18n namespace to the *directory* (`src/components/diff-viewer/**` → `shell`; page `_components/**` → `prReview`), not to which feature added the string.

## 2026-09-27 — Two separate, unrelated "Intent" i18n homes: `brief.json`'s `block.intent` vs. `prReview.json`'s `intent.*` [Context]
`client/messages/en/brief.json` already has a `block.intent: "Intent"` label, but it's dead — unreferenced by any component, scaffolded for a not-yet-built "Brief" panel (confirmed via grep across `client/src`). When adding the Intent Layer's `IntentCard` (`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/IntentCard.tsx`), its `useTranslations("prReview")` call means its labels belong under a new `intent.*` namespace in `prReview.json`, not `brief.json` — don't try to reuse or consolidate with the `brief.json` stub; they're two independent features that happen to share the word "Intent". Also worth noting for anyone following a sibling fork's docs: that fork's client mirror of the feature-model registry lives at `lib/utils/featureModels.ts`; this repo's is `client/src/lib/feature-models.ts` (no `utils/` segment) — check the actual path before editing from memory of another repo's layout.

## 2026-09-20 — `z.number().default(0)` makes a contract field required, not optional, at the type level [Context]
`Agent.skills_count` and `Skill.agents_count` in `client/src/vendor/shared/contracts/knowledge.ts:132,197`
are declared `z.number().int().default(0)`. `.default()` only makes a field
optional on the schema's *input* (parse) side — the inferred TS type
(`z.infer<typeof Agent>`) still marks it non-optional, since a parsed value
always has it. Any object literal typed as `Agent`/`Skill` (test fixtures,
mock data) that predates this field now fails `tsc --noEmit` with "Property
'skills_count' is missing" even though at runtime `Schema.parse({})` would
happily fill in `0`. Pre-existing fixtures in `AgentEditor.test.tsx:18` and
`AgentCard.test.tsx:11` broke this way when another workstream added the
field — vitest itself still ran fine (no type-checking in the test
transform), only `pnpm typecheck` caught it. Takeaway: adding a `.default()`
field to a widely-fixture'd contract is not typecheck-safe without also
updating every existing literal of that type; grep for `: Agent = {` /
`: Skill = {`-style literals before landing the schema change.

## 2026-09-19 — one filter value drove two different scopes [Mistake]
`FindingsTab`'s `severityFilter` was passed to two places at once: down into
`ReviewRunAccordion` (correctly filters that run's own findings) and into a
local `visibleRuns = runs.filter(r => r.findings.some(f => f.severity ===
severityFilter))` that decided which run *cards* to render at all. Clicking
a severity chip therefore both filtered findings within a run **and** hid
entire run cards that had zero findings at that severity — a run with other,
non-matching findings vanished from the list instead of just showing 0
findings. Fix: delete the list-visibility filter entirely and always render
`runs` (`FindingsTab.tsx:167`); let the per-card `severityFilter` prop
passed into `SeverityCounters` (`FindingsTab.tsx:155`, already correct) be
the only consumer. Lesson: when a filter value is threaded through props
into a child that does its own filtering, don't *also* use that same value
to decide list membership one level up — pick one owner for "is this item
shown at all" vs. "what does this item show internally."

## 2026-09-16 — hover popovers on the PR list must use a portal [Context]
`pulls/styles.ts:86`'s `tableCard` has `overflow: hidden` (to clip the
table's rounded corners), which silently clips any normal
absolutely-positioned child that extends past a row — a hover-preview
popover (`FindingsCell`) rendered this way was invisible even though it
mounted correctly (confirmed via DOM/text queries) and had no console
errors. Fix: render it via `ReactDOM.createPortal(..., document.body)`
(`FindingsCell.tsx:99`) with `position: fixed` computed from the trigger's
`getBoundingClientRect()` at hover-open time, not as a normal child.
Anything else added to this page that needs to visually escape its row
(tooltips, dropdowns taller than the row) will hit the same clipping and
needs the same portal treatment.

## 2026-09-16 — `pnpm build` corrupts a concurrently-running `pnpm dev` [Mistake]
Process/tooling gotcha, not tied to a single source line (no code change
involved — see `client/package.json`'s `dev`/`build` scripts for the two
commands in question). Ran `pnpm build` (production `next build`) to sanity-check a change while a
`pnpm dev` server was already up on :3000 (started earlier by `scripts/dev.sh`).
Both commands write into the same `.next/` directory; afterward the dev server
500'd on every route with `Cannot find module './vendor-chunks/recharts@....js'`
— the dev runtime's chunk manifest had been overwritten mid-flight. Fix: kill
the port's listener (`lsof -ti:3000 -sTCP:LISTEN | xargs kill`), `rm -rf .next`,
restart `pnpm dev`. Takeaway: never run `pnpm build` against a `client/` that
already has a dev server running on the same checkout — use `pnpm typecheck`
(safe, no shared build output) for a quick sanity check instead, and only run
`pnpm build` if the dev server is stopped first (or in a separate worktree).
