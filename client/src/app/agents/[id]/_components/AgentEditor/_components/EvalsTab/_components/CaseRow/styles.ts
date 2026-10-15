import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  main: { flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 3 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" } satisfies CSSProperties,
  location: { fontFamily: "var(--font-mono, monospace)" } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  state: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, minWidth: 90 } satisfies CSSProperties,
  actions: { display: "flex", gap: 6 } satisfies CSSProperties,
  confirmBody: { padding: 24, fontSize: 14 } satisfies CSSProperties,
  confirmFoot: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
  error: { color: "var(--crit)", fontSize: 12 } satisfies CSSProperties,
} as const;
