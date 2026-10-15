import { describe, it, expect } from "vitest";
import { fmtPct, fmtDeltaPts, fmtCost, fmtDuration } from "./eval-format";

describe("eval-format", () => {
  it("formats percentages, with null as n/a", () => {
    expect(fmtPct(0.82)).toBe("82%");
    expect(fmtPct(0)).toBe("0%");
    expect(fmtPct(null)).toBe("n/a");
  });

  it("formats deltas with arrow and sign text", () => {
    expect(fmtDeltaPts(3)).toEqual({ arrow: "▲", text: "+3.0 pts", dir: "up" });
    expect(fmtDeltaPts(-2)).toEqual({ arrow: "▼", text: "−2.0 pts", dir: "down" });
    expect(fmtDeltaPts(0)).toEqual({ arrow: "", text: "±0 pts", dir: "flat" });
    expect(fmtDeltaPts(0.04).text).toBe("±0 pts");
    expect(fmtDeltaPts(null).text).toBe("n/a");
  });

  it("formats cost and duration", () => {
    expect(fmtCost(null)).toBe("n/a");
    expect(fmtCost(0.0042)).toBe("$0.0042");
    expect(fmtCost(1.234)).toBe("$1.23");
    expect(fmtDuration(850)).toBe("850ms");
    expect(fmtDuration(4200)).toBe("4.2s");
    expect(fmtDuration(125000)).toBe("2m 05s");
  });
});
