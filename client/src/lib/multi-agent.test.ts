import { describe, it, expect } from "vitest";
import {
  AGENT_PALETTE,
  agentAccent,
  aggregateEstimate,
  formatCost,
  formatDuration,
  selectAllCapped,
} from "./multi-agent";

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("multi-agent helpers", () => {
  it("aggregates max duration, summed cost and excluded count", () => {
    const r = aggregateEstimate([
      { avg_duration_ms: 4000, avg_cost_usd: 0.01 },
      { avg_duration_ms: 9000, avg_cost_usd: 0.02 },
      { avg_duration_ms: null, avg_cost_usd: null },
    ]);
    expect(r.durationMs).toBe(9000);
    expect(r.costUsd).toBeCloseTo(0.03);
    expect(r.excluded).toBe(1);
    expect(r.none).toBe(false);
    expect(aggregateEstimate([{ avg_duration_ms: null, avg_cost_usd: null }]).none).toBe(true);
  });

  it("palette is accessible and accents are stable", () => {
    for (const p of AGENT_PALETTE) expect(contrast(p.color, p.textColor)).toBeGreaterThanOrEqual(4.5);
    expect(agentAccent("abc")).toEqual(agentAccent("abc"));
  });

  it("caps select-all at 8 enabled agents and formats nulls", () => {
    const agents = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, enabled: true }));
    agents.push({ id: "off", enabled: false });
    expect(selectAllCapped(agents)).toHaveLength(8);
    expect(formatDuration(null)).toBe("—");
    expect(formatCost(null)).toBe("—");
    expect(formatDuration(4200)).toBe("4.2s");
  });
});
