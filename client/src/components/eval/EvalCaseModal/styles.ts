import type React from "react";

export const body: React.CSSProperties = {
  padding: "16px 24px",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
  gap: 24,
  alignItems: "start",
};

export const column: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 };
export const footer: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
export const spacer: React.CSSProperties = { flex: 1 };
export const errorText: React.CSSProperties = { color: "var(--crit)", fontSize: 13, margin: "8px 0 0", whiteSpace: "pre-wrap" };
export const validText: React.CSSProperties = { color: "var(--text-muted)", fontSize: 12, marginTop: 6 };
export const invalidText: React.CSSProperties = { color: "var(--crit)", fontSize: 12, marginTop: 6 };
export const resultBox: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 12,
  marginTop: 8,
  fontSize: 13,
};
export const resultHead: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontWeight: 600 };
export const metaLine: React.CSSProperties = { color: "var(--text-secondary)", marginTop: 6 };
export const findingRow: React.CSSProperties = { marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" };
export const pre: React.CSSProperties = { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" };
export const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};
