import type { CSSProperties } from "react";

/** Co-located styles for the Evals tab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 24, maxWidth: 960 } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  headRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  title: { fontSize: 15, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  sub: { fontSize: 13, color: "var(--text-secondary)", margin: 0 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  link: { fontSize: 13, color: "var(--accent)" } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
