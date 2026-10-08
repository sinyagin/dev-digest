import type { CSSProperties } from "react";

/** Co-located styles for ContextAttachmentPicker. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  filterRow: { marginBottom: 2 } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    listStyle: "none",
    margin: 0,
    padding: 0,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  toggleWrap: { flex: 1, minWidth: 0, display: "flex" } satisfies CSSProperties,
  path: {
    fontSize: 13,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  tokens: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0, whiteSpace: "nowrap" } satisfies CSSProperties,
  reorderGroup: { display: "flex", gap: 2, flexShrink: 0 } satisfies CSSProperties,
  empty: { padding: 24, textAlign: "center", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    color: "var(--text-secondary)",
    padding: "2px 2px 0",
  } satisfies CSSProperties,
  /** Visually hidden but still reachable by assistive tech — hosts the
      aria-live reorder announcement (AC-44). */
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
} as const;
