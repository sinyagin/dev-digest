import { parseDocument } from "yaml";
import type { CiExportInputBody, CiPostAs, CiTrigger } from "@devdigest/shared";

export const WORKFLOW_PATH_SUFFIX = ".github/workflows/devdigest-review.yml";
export const STEPS = ["target", "preview", "configure", "install"] as const;
export const ALL_TRIGGERS: readonly CiTrigger[] = ["opened", "synchronize", "reopened"];
export const DEFAULT_TRIGGERS: readonly CiTrigger[] = ["opened", "synchronize"];
export const POST_AS_OPTIONS: readonly { value: CiPostAs; key: string }[] = [
  { value: "github_review", key: "githubReview" },
  { value: "pr_comment", key: "prComment" },
  { value: "none", key: "none" },
];

export interface WizardConfig {
  repo: string;
  triggers: CiTrigger[];
  postAs: CiPostAs;
}

/** First YAML parse error message, or null when the text parses (AC-10). */
export function yamlError(text: string): string | null {
  const err = parseDocument(text).errors[0];
  return err ? err.message : null;
}

export function toInput(cfg: WizardConfig, extra: Partial<CiExportInputBody> = {}): CiExportInputBody {
  return { repo: cfg.repo, target: "gha", post_as: cfg.postAs, triggers: cfg.triggers, ...extra };
}

export function toggleTrigger(current: readonly CiTrigger[], trigger: CiTrigger): CiTrigger[] {
  const next = current.includes(trigger) ? current.filter((x) => x !== trigger) : [...current, trigger];
  // Keep canonical order so the request is stable.
  return ALL_TRIGGERS.filter((x) => next.includes(x));
}

/** Open the PR link only if it is a GitHub URL. */
export function safePrUrl(url: string | null | undefined): string | null {
  return url && url.startsWith("https://github.com/") ? url : null;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
