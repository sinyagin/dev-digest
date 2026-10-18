import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 1100 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  sub: { fontSize: 13, color: "var(--text-secondary)", marginTop: 2 } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-surface)" } satisfies CSSProperties,
  item: { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  itemMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  muted: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  addRow: { width: "100%", textAlign: "left", padding: "12px 16px", border: "none", background: "transparent", color: "var(--accent-text)", fontSize: 13, cursor: "pointer" } satisfies CSSProperties,
  results: { fontSize: 13, margin: 0, paddingLeft: 18 } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--danger, #e5484d)" } satisfies CSSProperties,
  failOn: { maxWidth: 320 } satisfies CSSProperties,
  h3: { fontSize: 14, fontWeight: 700, marginBottom: 8 } satisfies CSSProperties,
} as const;
