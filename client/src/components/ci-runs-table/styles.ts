import type { CSSProperties } from "react";

export const s = {
  card: { border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-surface)", overflowX: "auto" } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: { textAlign: "left", padding: "10px 14px", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" } satisfies CSSProperties,
  td: { padding: "10px 14px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" } satisfies CSSProperties,
  link: { color: "var(--accent-text)", textDecoration: "none" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
