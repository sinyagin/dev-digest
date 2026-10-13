/* /eval — Eval Dashboard (SPEC-03 AC-42..45, AC-31). Agents are listed in API order and
   deliberately not ranked. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useEvalDashboard, useRunAllEvals } from "../../../../lib/hooks/eval";
import { evalErrorMessage } from "../../../../lib/eval-errors";
import { AgentRow } from "./_components/AgentRow";
import { RecentRunsTable } from "./_components/RecentRunsTable";
import { RunAllProgress } from "./_components/RunAllProgress";
import { RunAllConfirm } from "./_components/RunAllConfirm";
import { totalExecutions } from "./helpers";
import { s } from "./styles";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const te = useTranslations("eval.modal.errors");
  const { data, isLoading, isError, refetch } = useEvalDashboard();
  const runAll = useRunAllEvals();
  const [confirming, setConfirming] = React.useState(false);

  const agents = data?.agents ?? [];
  const recent = data?.recent_runs ?? [];

  const onConfirm = () => {
    runAll.mutate(undefined, { onSettled: () => setConfirming(false) });
  };

  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}>
      {confirming && (
        <RunAllConfirm
          agents={agents.length}
          executions={totalExecutions(agents)}
          pending={runAll.isPending}
          onConfirm={onConfirm}
          onCancel={() => setConfirming(false)}
        />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
          </div>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={agents.length === 0 || runAll.isPending}
            onClick={() => setConfirming(true)}
          >
            {runAll.isPending ? t("dashboard.running") : t("dashboard.runAllAgents")}
          </Button>
        </div>

        {runAll.isError && <ErrorState body={evalErrorMessage(runAll.error, te)} />}
        {runAll.data && <RunAllProgress results={runAll.data.results} />}

        {isLoading && (
          <div aria-label={t("dashboard.loading")}>
            <Skeleton height={160} />
          </div>
        )}
        {isError && <ErrorState body={t("dashboard.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && agents.length === 0 && (
          <EmptyState icon="FlaskConical" title={t("dashboard.noRuns")} />
        )}

        {agents.length > 0 && (
          <>
            <h2 style={s.h2}>{t("dashboard.agents.heading")}</h2>
            <p style={s.note}>{t("dashboard.agents.nonRankingNote")}</p>
            <div style={s.tableCard}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>{t("dashboard.agents.columns.agent")}</th>
                    <th style={s.th}>{t("dashboard.agents.columns.lastRun")}</th>
                    <th style={s.th}>{t("dashboard.agents.columns.traces")}</th>
                    <th style={s.th}>{t("dashboard.metricTrend")}</th>
                    <th style={s.th}>{t("dashboard.agents.columns.recall")}</th>
                    <th style={s.th}>{t("dashboard.agents.columns.precision")}</th>
                    <th style={s.th}>{t("dashboard.agents.columns.citation")}</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <AgentRow key={a.agent_id} agent={a} />
                  ))}
                </tbody>
              </table>
            </div>

            <h2 style={s.h2}>{t("dashboard.recentRunsAll")}</h2>
            {recent.length > 0 ? (
              <RecentRunsTable runs={recent} />
            ) : (
              <p style={s.note}>{t("dashboard.noRuns")}</p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
