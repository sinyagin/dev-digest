"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel } from "@devdigest/ui";
import type { ReviewRecord } from "@devdigest/shared";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { PrBriefCard } from "../PrBriefCard";
import { s } from "./styles";
import { IntentCard } from "./IntentCard";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoFullName: string | null;
  headSha: string | null | undefined;
  onFocusFile: (file: string) => void;
  /** Most recent `kind: 'review'` record for this PR, if any — passed through
   *  to `PrBriefCard` for its optional combined verdict banner. Sourced from
   *  `usePrReviews`, already called by the page; never fetched again here. */
  latestReview?: ReviewRecord | null;
}

export function OverviewTab({ prBody, prId, repoFullName, headSha, onFocusFile, latestReview }: OverviewTabProps) {
  const t = useTranslations("prReview");
  const tBlast = useTranslations("blast");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PrBriefCard prId={prId} onFocusFile={onFocusFile} latestReview={latestReview} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
          gap: 20,
        }}
      >
        {prId && <IntentCard prId={prId} />}

        <Card pad style={{ marginBottom: 0 }}>
          <SectionLabel icon="Workflow">{tBlast("title")}</SectionLabel>
          <BlastRadiusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
        </Card>
      </div>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.descriptionLabel")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </div>
  );
}
