import type { CSSProperties } from "react";

/** Co-located styles for RunReviewDropdown. */
export const s = {
  root: { position: "relative", display: "inline-block" },
  popover: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    padding: 10,
    zIndex: 40,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  heading: { fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" },
  list: { display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  hint: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 },
  note: { fontSize: 12, color: "var(--warn)", margin: 0 },
  error: { fontSize: 12, color: "var(--crit)", margin: 0 },
  divider: { height: 1, background: "var(--border)" },
  linkBtn: {
    background: "none",
    border: "none",
    padding: "6px 4px",
    textAlign: "left",
    fontSize: 14,
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  link: { color: "var(--accent)", fontSize: 13 },
  merged: { opacity: 0.6 },
} satisfies Record<string, CSSProperties>;
