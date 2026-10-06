/** Constants for the Run Trace + Live Log drawer (A5). */

/** Drawer width (px). */
export const DRAWER_WIDTH = 720;

/** Live-log stream viewport height (px). */
export const LOG_HEIGHT = 420;

/** Tab keys (Trace / Live log). */
export const TABS = ["trace", "log"] as const;
export type TraceTab = (typeof TABS)[number];

/** Prompt-assembly block accent colours (by leg). */
export const PROMPT_COLORS = {
  system: "var(--text-muted)",
  skills: "var(--accent)",
  memory: "var(--warn)",
  repoMap: "var(--accent)",
  specs: "var(--text-secondary)",
  callers: "var(--warn)",
  user: "var(--ok)",
} as const;

/** Configuration-panel specs-status row accent colours (missing / truncated) —
    same "named CSS var per row kind" convention as PROMPT_COLORS, but for the
    specs_missing/specs_truncated rows rather than prompt-assembly blocks. */
export const SPECS_STATUS_COLORS = {
  missing: "var(--crit)",
  truncated: "var(--warn)",
} as const;
