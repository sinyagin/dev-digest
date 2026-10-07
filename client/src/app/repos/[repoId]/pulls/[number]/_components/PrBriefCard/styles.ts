import type { CSSProperties } from "react";

/** Co-located styles for PrBriefCard. */
export const s = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  } satisfies CSSProperties,
  sectionTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  summaryText: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  missingNote: {
    fontSize: 12,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 6,
    padding: "6px 10px",
  } satisfies CSSProperties,
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  emptyHint: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  noRisks: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  error: {
    fontSize: 13,
    color: "var(--crit)",
    padding: 12,
  } satisfies CSSProperties,
  nothingToBrief: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  // ---- RiskRow ----
  riskRow: (color: string) =>
    ({
      display: "flex",
      flexDirection: "column",
      gap: 4,
      borderLeft: `3px solid ${color}`,
      paddingLeft: 10,
    }) satisfies CSSProperties,
  riskTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  riskIndicator: (color: string) =>
    ({
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: color,
      flexShrink: 0,
    }) satisfies CSSProperties,
  riskTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  riskFileRefs: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  // ---- ReviewFocusList ----
  focusList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  focusItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-elevated)",
    padding: "6px 10px",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  focusItemFile: {
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
} as const;
