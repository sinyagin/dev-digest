/** Known bucket → accent colour for the bucket tag. Purely cosmetic — AC-5
    requires an unrecognised bucket (e.g. `adr`) to still render a visible
    tag, never be hidden/erroring/discarded, so lookups must always fall back
    to UNKNOWN_BUCKET_COLOR rather than throwing or omitting the tag. */
export const BUCKET_COLOR: Record<string, string> = {
  specs: "#3b82f6",
  docs: "#10b981",
  insights: "#f59e0b",
  adr: "#8b5cf6",
  root: "var(--text-secondary)",
};

export const UNKNOWN_BUCKET_COLOR = "var(--text-secondary)";
