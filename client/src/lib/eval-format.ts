/* eval-format.ts — pure display formatters for the eval pipeline UI. */

export type DeltaDir = "up" | "down" | "flat" | "none";

export interface DeltaPts {
  arrow: "▲" | "▼" | "";
  text: string;
  dir: DeltaDir;
}

/** Ratio (0..1) → "82%"; null/undefined/NaN → "n/a". */
export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${Math.round(v * 100)}%`;
}

/** Delta in percentage points → arrow + text. 0 (after rounding to 0.1) is "±0 pts". */
export function fmtDeltaPts(d: number | null | undefined): DeltaPts {
  if (d == null || !Number.isFinite(d)) return { arrow: "", text: "n/a", dir: "none" };
  const rounded = Math.round(Math.abs(d) * 10) / 10;
  if (rounded === 0) return { arrow: "", text: "±0 pts", dir: "flat" };
  if (d > 0) return { arrow: "▲", text: `+${rounded.toFixed(1)} pts`, dir: "up" };
  return { arrow: "▼", text: `−${rounded.toFixed(1)} pts`, dir: "down" };
}

/** USD cost; null → "n/a"; sub-cent amounts keep 4 decimals. */
export function fmtCost(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  if (v === 0) return "$0.00";
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

/** Milliseconds → "850ms" / "4.2s" / "2m 05s". */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "n/a";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
