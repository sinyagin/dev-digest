import { describe, expect, it } from "vitest";
import type { EvalCase } from "@devdigest/shared";
import { caseLocation, caseState } from "./helpers";

const base = { last_result: null } as unknown as EvalCase;
const withResult = (r: Partial<NonNullable<EvalCase["last_result"]>>) =>
  ({ ...base, last_result: { status: "scored", pass: true, ...r } }) as unknown as EvalCase;

describe("caseState", () => {
  it("no last result → neverRun", () => {
    expect(caseState(base)).toBe("neverRun");
  });
  it("errored execution (e.g. timeout) → errored, not neverRun", () => {
    expect(caseState(withResult({ status: "errored", pass: null, error_reason: "timeout" }))).toBe("errored");
  });
  it("scored pass / fail", () => {
    expect(caseState(withResult({ pass: true }))).toBe("pass");
    expect(caseState(withResult({ pass: false }))).toBe("fail");
  });
});

describe("caseLocation", () => {
  const withExp = (start_line: number, end_line: number) =>
    ({ expectation: { type: "must_not_flag", file: "client/src/a/KpiSection.jsx", start_line, end_line } }) as unknown as EvalCase;
  it("basename + range", () => {
    expect(caseLocation(withExp(10, 20))).toBe("KpiSection.jsx:10–20");
  });
  it("single line", () => {
    expect(caseLocation(withExp(46, 46))).toBe("KpiSection.jsx:46");
  });
});
