import type { CSSProperties } from "react";

/** Co-located styles for MetricTiles. */
export const s = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  tile: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: 14,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--surface, transparent)",
  } satisfies CSSProperties,
  label: { fontSize: 12, color: "var(--text-muted, inherit)" } satisfies CSSProperties,
  value: { fontSize: 24, fontWeight: 600 } satisfies CSSProperties,
  delta: { fontSize: 12, fontWeight: 500 } satisfies CSSProperties,
  /** Colour is an extra cue only; the arrow and words carry the meaning. */
  deltaUp: { color: "var(--success, inherit)" } satisfies CSSProperties,
  deltaDown: { color: "var(--danger, inherit)" } satisfies CSSProperties,
  deltaFlat: { color: "var(--text-muted, inherit)" } satisfies CSSProperties,
} as const;
