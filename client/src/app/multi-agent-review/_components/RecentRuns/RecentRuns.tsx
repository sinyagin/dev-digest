/* RecentRuns — the Multi-Agent Review landing view: this repo's recent
   multi-agent runs, newest first (the latest highlighted), each linking to its
   results page, plus the action that opens Configure run for a new one. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { MultiAgentRunSummary } from "@devdigest/shared";
import { StatusChip } from "@/components/run-status-chip";
import { formatCost, formatDuration } from "@/lib/multi-agent";
import { relativeTime } from "@/lib/relative-time";
import { s } from "../../styles";

export function RecentRuns({
  runs,
  repoPicker,
  onNew,
}: {
  runs: MultiAgentRunSummary[];
  /** Repository select; the page owns repo state. */
  repoPicker?: React.ReactNode;
  onNew: () => void;
}) {
  const t = useTranslations("multiAgent.recent");

  return (
    <div style={s.page}>
      <header style={s.headRow}>
        <div>
          <h1 style={s.title}>{t("title")}</h1>
          <p style={s.subtitle}>{t("subtitle")}</p>
        </div>
        <Button kind="primary" icon="Plus" onClick={onNew}>
          {t("new")}
        </Button>
      </header>
      {repoPicker ? <div style={s.selectRow}>{repoPicker}</div> : null}
      <ul style={s.runList} aria-label={t("listLabel")}>
        {runs.map((run, i) => (
          <li key={run.id}>
            <Link href={`/repos/${run.repo_id}/multi-agent/${run.id}`} style={s.runRow(i === 0)}>
              <span style={s.runMain}>
                {i === 0 ? <span style={s.latestTag}>{t("latest")}</span> : null}
                <span style={s.runTitle}>{t("pr", { number: run.pr_number, title: run.pr_title })}</span>
                <span className="tnum" style={s.cardMeta}>
                  {t("meta", {
                    count: run.agent_count,
                    duration: formatDuration(run.total_duration_ms),
                    cost: formatCost(run.total_cost_usd),
                    when: relativeTime(run.ran_at),
                  })}
                </span>
              </span>
              <StatusChip status={run.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
