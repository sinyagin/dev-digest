import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import type { Line } from "./helpers";
import { partitionFindingsToLines } from "./findings";

function finding(partial: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    review_id: "r1",
    severity: "WARNING",
    category: "bug",
    title: "Something's off",
    file: "src/a.ts",
    start_line: 10,
    end_line: 10,
    rationale: "because",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...partial,
  };
}

const lines: Line[] = [
  { kind: "hunk", text: "@@ -8,3 +8,3 @@" },
  { kind: "ctx", text: "unchanged", oldNo: 8, newNo: 8 },
  { kind: "add", text: "changed", newNo: 9 },
  { kind: "ctx", text: "unchanged", oldNo: 9, newNo: 10 },
];

describe("partitionFindingsToLines", () => {
  it("keys a finding whose start_line matches a rendered line", () => {
    const { byLine, unanchored } = partitionFindingsToLines([finding({ start_line: 9 })], lines);
    expect(byLine.get(9)?.map((f) => f.id)).toEqual(["f1"]);
    expect(unanchored).toEqual([]);
  });

  it("puts a finding whose start_line isn't rendered into unanchored instead of dropping it", () => {
    const { byLine, unanchored } = partitionFindingsToLines([finding({ start_line: 42 })], lines);
    expect(byLine.size).toBe(0);
    expect(unanchored.map((f) => f.id)).toEqual(["f1"]);
  });

  it("splits a mix of anchored and unanchored findings", () => {
    const anchored = finding({ id: "anchored", start_line: 8 });
    const stray = finding({ id: "stray", start_line: 99 });
    const { byLine, unanchored } = partitionFindingsToLines([anchored, stray], lines);
    expect(byLine.get(8)?.map((f) => f.id)).toEqual(["anchored"]);
    expect(unanchored.map((f) => f.id)).toEqual(["stray"]);
  });
});
