"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton } from "@devdigest/ui";
import type { ReviewRecord, Verdict } from "@devdigest/shared";
import { usePrBrief, useGenerateBrief } from "../../../../../../../lib/hooks/brief";
import { RiskRow } from "./RiskRow";
import { ReviewFocusList } from "./ReviewFocusList";
import { VerdictBanner } from "../VerdictBanner";
import { s } from "./styles";

interface PrBriefCardProps {
  prId: string | null;
  onFocusFile: (file: string) => void;
  /** Most recent `kind: 'review'` record for this PR, if any (sourced from
   *  `usePrReviews`, already queried higher up the tree — never fetched again
   *  here). When present and it has a verdict, a `VerdictBanner` renders above
   *  the rest of the card's content, with the banner's own body text replaced
   *  by the brief's `summary` instead of the review's. Optional/nullable so
   *  this stays a strict no-op (no banner, no error) when no review exists. */
  latestReview?: ReviewRecord | null;
}

/** The PR Why/Risk Brief panel: summary, risk areas, and review focus for a
 *  PR, backed by `usePrBrief`/`useGenerateBrief`. Early-return state machine:
 *  loading → not-generated (+ generate CTA) → nothing-to-brief → error →
 *  ready. The refresh control in the ready header always re-runs generation,
 *  unconditionally — there is no client-side staleness check. When `ready`
 *  and `latestReview` is given with a verdict, a `VerdictBanner` renders
 *  above everything else, showing that review's verdict/score/finding
 *  counts but the brief's own `summary` (never the review's) as its body
 *  text — absent a review (or a verdict-less one), nothing extra renders. */
export function PrBriefCard({ prId, onFocusFile, latestReview = null }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const briefQuery = usePrBrief(prId);
  const generateBrief = useGenerateBrief(prId);

  if (briefQuery.isLoading) {
    return (
      <div style={s.card}>
        <Skeleton height={16} width="30%" />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (briefQuery.isError) {
    return <div style={s.error}>{t("card.error")}</div>;
  }

  const data = briefQuery.data;

  // Not generated yet (or no data at all) — show only the empty hint and the
  // Generate CTA, no risk/focus content. The nothing-to-brief and error
  // sub-states below only apply once a generate attempt has actually run.
  if (!data || data.status === "not_generated") {
    if (generateBrief.data?.status === "nothing_to_brief") {
      return <div style={s.nothingToBrief}>{t("card.nothingToBrief")}</div>;
    }

    if (generateBrief.isError) {
      return <div style={s.error}>{t("card.error")}</div>;
    }

    return (
      <div style={s.card}>
        <p style={s.emptyHint}>{t("card.emptyHint")}</p>
        <Button kind="primary" size="sm" loading={generateBrief.isPending} onClick={() => generateBrief.mutate()}>
          {generateBrief.isPending ? t("card.generating") : t("card.generate")}
        </Button>
      </div>
    );
  }

  const { brief } = data;
  const risks = brief.risks.risks;
  const blockers = latestReview
    ? latestReview.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length
    : 0;

  return (
    <div style={s.card}>
      {latestReview?.verdict && (
        <VerdictBanner
          verdict={latestReview.verdict as Verdict}
          summary={brief.summary}
          score={latestReview.score}
          findingsCount={latestReview.findings.length}
          blockers={blockers}
          agentName={latestReview.agent_name}
        />
      )}

      <div style={s.sectionHeader}>
        <h3 style={s.sectionTitle}>{t("card.title")}</h3>
        <Button
          kind="ghost"
          size="sm"
          icon="RefreshCw"
          loading={generateBrief.isPending}
          aria-label={t("card.refreshAriaLabel")}
          onClick={() => generateBrief.mutate()}
        >
          {t("card.refresh")}
        </Button>
      </div>

      <div style={s.section}>
        <h4 style={s.sectionTitle}>{t("card.summaryLabel")}</h4>
        <p style={s.summaryText}>{brief.summary}</p>
      </div>

      {brief.missing_context.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {brief.missing_context.map((key) => (
            <div key={key} style={s.missingNote}>
              {key === "intent" ? t("card.missingIntent") : t("card.missingBlast")}
            </div>
          ))}
        </div>
      )}

      <div style={s.section}>
        <h4 style={s.sectionTitle}>{t("card.riskAreasLabel")}</h4>
        {risks.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {risks.map((risk) => (
              <RiskRow key={`${risk.kind}:${risk.title}`} risk={risk} />
            ))}
          </div>
        ) : (
          <div style={s.noRisks}>{t("noRisks")}</div>
        )}
      </div>

      <div style={s.section}>
        <h4 style={s.sectionTitle}>{t("card.reviewFocusLabel")}</h4>
        <ReviewFocusList items={brief.review_focus} onFocusFile={onFocusFile} />
      </div>
    </div>
  );
}
