/* ResumeRun — shown on Configure run when the picked PR already has a
   multi-agent run: a primary route to its latest results, ahead of (not
   instead of) configuring a new run. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { MultiAgentRunSummary } from "@devdigest/shared";
import { StatusChip } from "@/components/run-status-chip";
import { relativeTime } from "@/lib/relative-time";
import { s } from "../../styles";

export function ResumeRun({ run }: { run: MultiAgentRunSummary }) {
  const t = useTranslations("multiAgent.resume");
  const router = useRouter();
  return (
    <section style={s.resumeCard} aria-label={t("title")}>
      <div style={s.runMain}>
        <p style={s.emptyTitle}>{t("title")}</p>
        <span style={{ ...s.cardMeta, display: "inline-flex", gap: 8, alignItems: "center" }}>
          <StatusChip status={run.status} />
          <span className="tnum">{t("meta", { count: run.agent_count, when: relativeTime(run.ran_at) })}</span>
        </span>
        <span style={s.cardMeta}>{t("or")}</span>
      </div>
      <Button
        kind="primary"
        icon="ArrowRight"
        onClick={() => router.push(`/repos/${run.repo_id}/multi-agent/${run.id}`)}
      >
        {t("view")}
      </Button>
    </section>
  );
}
