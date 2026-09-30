/**
 * Path/pattern constants for the Smart Diff classifier (`smart-diff.ts`).
 * Pure data — tune patterns here without touching the classification logic.
 * Checked most-specific-first: boilerplate, then tests, then wiring, then
 * docs, else core (the default). This CHECK order is fixed by the homework
 * spec and is NOT the same as the group DISPLAY order in `smart-diff.ts`.
 */

export const SPLIT_SUGGESTION_LINE_THRESHOLD = 400;

export const BOILERPLATE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)[^/]+\.lock$/,
  /(^|\/)pnpm-lock\.ya?ml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.generated\./,
  /\.min\.js$/,
];

export const TEST_PATH_PATTERNS: RegExp[] = [
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]s$/,
  /(^|\/)test\//,
  /(^|\/)tests\//,
  /(^|\/)__tests__\//,
  /(^|\/)e2e\//,
];

/** Basename-only — checked against the file's basename, any directory depth.
 *  DELIBERATE WIDENING beyond the homework's literal `index.ts`/`index.js`:
 *  the homework's own UI mockup shows bare `src/server.ts`/`src/config.ts`
 *  classified as "Wiring", and this repo's own real files
 *  (`server/src/platform/config.ts`, `.../container.ts`) don't match a
 *  literal `*.config.*` glob (that shape implies `name.config.ext`, e.g.
 *  `vite.config.ts`). See `server/test/reviews-smart-diff.test.ts` for the
 *  pinned cases this widening covers. */
export const WIRING_BASENAME_PATTERNS: RegExp[] = [
  /^index\.[cm]?[jt]sx?$/,
  /^server\.[cm]?[jt]sx?$/,
  /^config\.[cm]?[jt]sx?$/,
  /^container\.[cm]?[jt]sx?$/,
  /^app\.[cm]?[jt]sx?$/,
  /^main\.[cm]?[jt]sx?$/,
  /^bootstrap\.[cm]?[jt]sx?$/,
  /^setup\.[cm]?[jt]sx?$/,
];

export const WIRING_PATH_PATTERNS: RegExp[] = [
  /\.config\.[cm]?[jt]sx?$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)\.eslintrc/,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)docker-compose[^/]*\.ya?ml$/,
  /(^|\/)\.github\//,
  /(^|\/)\.claude\//,
];

export const DOCS_PATH_PATTERNS: RegExp[] = [
  /\.md$/i,
  /(^|\/)docs\//,
  /(^|\/)README([./]|$)/i,
  /(^|\/)CHANGELOG([./]|$)/i,
  /(^|\/)LICENSE([./]|$)/i,
];
