"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel } from "@devdigest/ui";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";
import { IntentCard } from "./IntentCard";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoFullName: string | null;
  headSha: string | null | undefined;
}

export function OverviewTab({ prBody, prId, repoFullName, headSha }: OverviewTabProps) {
  const t = useTranslations("prReview");
  const tBlast = useTranslations("blast");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
