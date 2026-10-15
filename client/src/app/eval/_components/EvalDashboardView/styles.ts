import type { CSSProperties } from "react";

/** Co-located styles for EvalDashboardView and its sub-components. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 14, marginBottom: 20 } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, margin: "28px 0 10px" } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 } satisfies CSSProperties,
  /* No overflow:hidden — it would clip popovers (client/INSIGHTS.md 2026-09-16). */
  tableCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "10px 14px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { padding: "10px 14px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" } satisfies CSSProperties,
  link: { color: "var(--text-primary)", fontWeight: 600, textDecoration: "none" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  results: { listStyle: "none", margin: "12px 0 0", padding: 0, fontSize: 13 } satisfies CSSProperties,
  resultError: { color: "var(--danger, #e5484d)" } satisfies CSSProperties,
  confirmBody: { padding: "20px 24px", fontSize: 14 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
