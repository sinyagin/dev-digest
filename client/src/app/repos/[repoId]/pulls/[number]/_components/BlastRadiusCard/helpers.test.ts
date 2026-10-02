import { describe, it, expect } from "vitest";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { aggregateCounts, degradedReasonLabel } from "./helpers";

const DATA: BlastRadiusResponse = {
  changed_symbols: [
    { name: "a", file: "a.ts", kind: "function" },
    { name: "b", file: "b.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "a",
      callers: [{ name: "callerA", file: "c.ts", line: 1 }],
      endpoints_affected: ["GET /x"],
      crons_affected: ["nightly"],
    },
    {
      symbol: "b",
      callers: [
        { name: "callerB", file: "d.ts", line: 2 },
        { name: "callerC", file: "e.ts", line: 3 },
      ],
      // Same endpoint/cron as group "a" — must be deduped, not double-counted.
      endpoints_affected: ["GET /x", "POST /y"],
      crons_affected: ["nightly"],
    },
  ],
  summary: "2 changed symbols, 3 callers across 2 endpoints and 1 cron affected.",
};

describe("aggregateCounts", () => {
  it("sums callers and dedups endpoints/crons shared across downstream groups", () => {
    expect(aggregateCounts(DATA)).toEqual({ symbols: 2, callers: 3, endpoints: 2, crons: 1 });
  });

  it("returns zeros for a result with no downstream groups", () => {
    expect(aggregateCounts({ ...DATA, changed_symbols: [], downstream: [] })).toEqual({
      symbols: 0,
      callers: 0,
      endpoints: 0,
      crons: 0,
    });
  });
});

describe("degradedReasonLabel", () => {
  it("maps every documented reason to a human label", () => {
    expect(degradedReasonLabel("flag_off")).toMatch(/disabled/i);
    expect(degradedReasonLabel("index_failed")).toMatch(/failed/i);
    expect(degradedReasonLabel("index_partial")).toMatch(/incomplete/i);
    expect(degradedReasonLabel("repo_too_large")).toMatch(/too large/i);
    expect(degradedReasonLabel("no_data")).toMatch(/no index data/i);
  });

  it("falls back to a generic message for an undefined reason", () => {
    expect(degradedReasonLabel(undefined)).toMatch(/unavailable/i);
  });
});
