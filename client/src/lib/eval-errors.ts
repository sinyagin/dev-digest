import { ApiError } from "@/lib/api";

/** Server eval error code -> key under `eval.modal.errors`. */
const CODE_TO_KEY: Record<string, string> = {
  eval_finding_untriaged: "untriaged",
  eval_finding_no_agent: "noAgent",
  eval_expectation_ungrounded: "ungrounded",
  eval_no_cases: "noCases",
  eval_provider_key_missing: "providerKeyMissing",
  eval_run_in_flight: "runInFlight",
  eval_case_exists: "exists",
};

type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * Localised message for a known eval error code; falls back to the server
 * message (or String(e)) for unknown codes. `t` is scoped to `eval.modal.errors`.
 */
export function evalErrorMessage(e: unknown, t: Translate): string {
  if (e instanceof ApiError && e.code && CODE_TO_KEY[e.code]) {
    return t(CODE_TO_KEY[e.code]!, { reason: e.message });
  }
  return e instanceof Error ? e.message : String(e);
}
