import type { EvalExpectation } from "@devdigest/shared";

export type InputTabKey = "diff" | "files" | "prMeta";

export const INPUT_TABS: readonly InputTabKey[] = ["diff", "files", "prMeta"];

/** Template inserted by the "Finding skeleton" button (AC-6). Must satisfy EvalExpectation. */
export const EXPECTATION_SKELETON: EvalExpectation = {
  type: "must_find",
  file: "src/example.ts",
  start_line: 1,
  end_line: 1,
  severity: "WARNING",
  category: "security",
  title: "Describe the expected finding",
};
