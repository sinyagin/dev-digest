"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared";
import { ViewToggle } from "./ViewToggle";
import { summaryKind, totalCostLabel, totalDurationLabel, type ViewMode } from "../helpers";

export interface ResultsHeaderProps {
  run: MultiAgentRun;
  repoId: string;
  prTitle: string | null;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
}

export function ResultsHeader({ run, repoId, prTitle, view, onViewChange }: ResultsHeaderProps) {
  const t = useTranslations("multiAgentRun.header");
  const kind = summaryKind(run);
  const running = run.status === "running";
  const configureHref =
    `/multi-agent-review?repo=${repoId}` + (run.pr_number != null ? `&pr=${run.pr_number}` : "");

  const summary =
    kind === "noChildren"
      ? t("noChildren")
      : kind === "noneCompleted"
        ? t("noneCompleted")
        : t(running ? "summarySoFar" : "summary", {
            count: run.agent_count,
            duration: totalDurationLabel(run),
            cost: totalCostLabel(run),
          });

  return (
    <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
          {t("title", { count: run.agent_count })}
        </h1>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
          <ViewToggle value={view} onChange={onViewChange} />
          <Link href={configureHref} style={{ fontSize: 13, color: "var(--accent-text)" }}>
            {t("configure")}
          </Link>
        </span>
      </div>
      <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
        {prTitle ?? (run.pr_number != null ? t("prFallback", { number: run.pr_number }) : null)}
      </div>
      <div className="tnum" style={{ fontSize: 13, color: "var(--text-muted)" }}>
        {summary}
      </div>
    </header>
  );
}
