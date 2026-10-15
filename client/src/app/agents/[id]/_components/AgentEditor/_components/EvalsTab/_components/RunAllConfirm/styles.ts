import type { CSSProperties } from "react";

export const s = {
  body: { padding: 24, fontSize: 14 } satisfies CSSProperties,
  foot: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
} as const;
