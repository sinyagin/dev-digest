import type { CSSProperties } from "react";

export const s = {
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "6px 10px",
    fontWeight: 600,
    color: "var(--text-secondary)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { padding: "6px 10px", borderBottom: "1px solid var(--border)", verticalAlign: "top" } satisfies CSSProperties,
} as const;
