import type { CSSProperties } from "react";

/** Co-located styles for ContextTab. */
export const s = {
  wrap: { maxWidth: 760, display: "flex", flexDirection: "column" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", marginBottom: 4, gap: 16 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  count: { marginLeft: "auto", fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  orderHint: { fontSize: 12, color: "var(--text-muted)", marginBottom: 4 } satisfies CSSProperties,
  notice: { fontSize: 12, color: "var(--text-muted)", marginBottom: 14 } satisfies CSSProperties,
  tokensFooter: {
    fontSize: 12,
    color: "var(--text-secondary)",
    textAlign: "right",
    marginTop: 6,
  } satisfies CSSProperties,
  skeletonWrap: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 } satisfies CSSProperties,
} as const;
