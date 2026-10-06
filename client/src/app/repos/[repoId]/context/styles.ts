import type { CSSProperties } from "react";

/** Co-located styles for the Project Context page + its list/preview panels. */
export const s = {
  page: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  heading: { fontSize: 22, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  summaryLine: { fontSize: 13, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  layout: { display: "flex", gap: 16, alignItems: "flex-start" } satisfies CSSProperties,

  // ---- DocumentList -------------------------------------------------------
  listPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 320,
    flexShrink: 0,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: (selected: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
    background: selected ? "var(--accent-bg)" : "var(--bg-elevated)",
    cursor: "pointer",
    textAlign: "left",
  }),
  rowIcon: { marginTop: 2, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  rowBody: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 } satisfies CSSProperties,
  rowPath: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  rowMeta: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  bucketTag: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    background: "var(--bg-hover)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  // ---- DocumentPreview ------------------------------------------------------
  previewPanel: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 20,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  previewHeader: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
    paddingBottom: 12,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  previewPath: { fontSize: 14, fontWeight: 650, color: "var(--text-primary)" } satisfies CSSProperties,
  previewMeta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  previewBody: { fontSize: 14, color: "var(--text-primary)" } satisfies CSSProperties,

  // ---- Preview/Edit toggle --------------------------------------------------
  documentPanel: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  modeToggle: { display: "flex", gap: 4 } satisfies CSSProperties,

  // ---- DocumentEditor --------------------------------------------------------
  // Always-visible resync warning (AC-24) — not a tooltip, not conditional.
  editorWarning: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg, rgba(234, 179, 8, 0.1))",
    color: "var(--text-primary)",
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  editorActions: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
};
