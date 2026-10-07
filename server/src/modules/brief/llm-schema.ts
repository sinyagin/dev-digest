/**
 * `BriefDraft` — the module-local schema the MODEL actually fills in via
 * `llm.completeStructured(...)` in `service.ts`.
 *
 * Deliberately excludes `intent`, `blast`, `missing_context`, `history`, and
 * `generated_for_sha` — those are computed deterministically by our own
 * code (never authored by the LLM), the same discipline `intent/service.ts`
 * uses to keep `context_gaps` out of the LLM-facing `Intent` schema that
 * `intent/classifier.ts` fills (see `server/INSIGHTS.md`, 2026-09-29 —
 * "Intent's `context_gaps` kept out of the LLM-facing `Intent` schema on
 * purpose"). This is the mechanical guarantee behind AC-5.
 *
 * `risks`/`review_focus` are grounded (filtered against the PR's real
 * files/lines) by `grounding.ts` before any of this reaches `PrBrief`.
 */
import { z } from 'zod';
import { ReviewFocusItem, Risks } from '@devdigest/shared';

export const BriefDraft = z.object({
  summary: z.string(),
  risks: Risks,
  review_focus: z.array(ReviewFocusItem),
});
export type BriefDraft = z.infer<typeof BriefDraft>;
