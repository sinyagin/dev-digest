import type { CSSProperties } from "react";

export const s = {
  stepsWrap: { padding: "16px 24px 0" } satisfies CSSProperties,
  body: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  h3: { fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: "0.04em", textTransform: "uppercase" } satisfies CSSProperties,
  card: { border: "1px solid var(--border-strong)", borderRadius: 8, padding: "12px 14px", background: "var(--bg-surface)" } satisfies CSSProperties,
  cardActive: { border: "1px solid var(--accent)" } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  notice: { fontSize: 13, padding: "10px 12px", borderRadius: 8, background: "var(--bg-hover)", color: "var(--text-primary)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--danger, #e5484d)" } satisfies CSSProperties,
  muted: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  fileBtn: { display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", border: "none", borderRadius: 6, background: "transparent", color: "var(--text-primary)", fontSize: 13, cursor: "pointer" } satisfies CSSProperties,
  fileBtnActive: { background: "var(--bg-hover)" } satisfies CSSProperties,
  code: { width: "100%", minHeight: 220, fontFamily: "var(--font-mono, monospace)", fontSize: 12, padding: 10, borderRadius: 7, border: "1px solid var(--border-strong)", background: "var(--bg-elevated)", color: "var(--text-primary)", boxSizing: "border-box" } satisfies CSSProperties,
  select: { width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 7, border: "1px solid var(--border-strong)", background: "var(--bg-elevated)", color: "var(--text-primary)" } satisfies CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 } satisfies CSSProperties,
} as const;
