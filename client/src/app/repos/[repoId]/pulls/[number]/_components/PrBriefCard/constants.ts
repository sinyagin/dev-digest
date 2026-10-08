/** Constants for PrBriefCard. */

/** Risk severity → CSS colour token, following FindingCard/constants.ts's
 *  `SEV_COLOR` shape. Distinct tokens per severity so a `high` and a `low`
 *  risk are visually different at a glance. */
export const RISK_SEV_COLOR: Record<string, string> = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--info)",
};

/** Fallback colour for an unknown/free-form severity value. */
export const RISK_SEV_COLOR_FALLBACK = "var(--text-muted)";
