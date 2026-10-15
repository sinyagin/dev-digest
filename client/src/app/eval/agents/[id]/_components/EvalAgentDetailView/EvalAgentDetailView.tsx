/* /eval/agents/:id — Eval agent detail + old-vs-new Compare (SPEC-03 AC-34..36, 46, 47, 50, 57, 58). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Modal, SelectInput, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { MetricTiles } from "../../../../../../components/eval/MetricTiles";
import { useAgents } from "../../../../../../lib/hooks/agents";
import {
  evalKeys,
  useEvalAgentDetail,
  useEvalRun,
  useEvalRunEstimate,
  useStartEvalRun,
} from "../../../../../../lib/hooks/eval";
import { evalErrorMessage } from "../../../../../../lib/eval-errors";
import { fmtCost } from "../../../../../../lib/eval-format";
import { Banner } from "./_components/Banner";
import { CompareModal } from "./_components/CompareModal";
import { RunsTable } from "./_components/RunsTable";
import { TrendChart } from "./_components/TrendChart";
import { canCompare, completedCount, orderSelected, toggleSelected } from "./helpers";
import { s } from "./styles";

export function EvalAgentDetailView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const te = useTranslations("eval.modal.errors");
  const router = useRouter();
  const qc = useQueryClient();
  const { data: agents } = useAgents();
  const { data, isLoading, isError, refetch } = useEvalAgentDetail(agentId);
  const [confirming, setConfirming] = React.useState(false);
  const estimate = useEvalRunEstimate(agentId, confirming);
  const start = useStartEvalRun(agentId);
  const [runId, setRunId] = React.useState<string | null>(null);
  const run = useEvalRun(runId);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState(false);

  const runStatus = run.data?.status;
  React.useEffect(() => {
    // Refresh detail + history once the polled run settles.
    if (runStatus === "completed" || runStatus === "errored") {
      void qc.invalidateQueries({ queryKey: evalKeys.agentDetail(agentId) });
    }
  }, [runStatus, qc, agentId]);

  const runs = data?.runs ?? [];
  const pair = orderSelected(selected, runs);
  const enoughRuns = completedCount(runs) >= 2;

  const onConfirmRun = () => {
    start.mutate(undefined, {
      onSuccess: (r) => setRunId(r.id),
      onSettled: () => setConfirming(false),
    });
  };

  const announce =
    runStatus === "running" || (runId && !run.data)
      ? t("evalsTab.announceStarted")
      : runStatus === "completed" && run.data
        ? t("evalsTab.announceFinished", { passed: run.data.traces_passed, total: run.data.traces_total })
        : runStatus === "errored"
          ? t("evalsTab.announceFailed")
          : "";

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbSkillsLab") },
        { label: t("page.crumbEvalDashboard"), href: "/eval" },
        { label: data?.agent.name ?? t("page.crumbAgents") },
      ]}
    >
      {confirming && (
        <Modal
          width={440}
          title={t("detail.runEval")}
          onClose={() => setConfirming(false)}
          footer={
            <div style={s.footer}>
              <Button kind="ghost" size="sm" onClick={() => setConfirming(false)}>
                {t("modal.cancel")}
              </Button>
              <Button
                kind="primary"
                size="sm"
                disabled={!estimate.data || start.isPending}
                onClick={onConfirmRun}
              >
                {t("detail.runEval")}
              </Button>
            </div>
          }
        >
          <p style={s.confirmBody}>
            {estimate.data
              ? t("evalsTab.runAllConfirm", {
                  cases: estimate.data.cases,
                  cost: fmtCost(estimate.data.est_cost_usd),
                })
              : t("evalsTab.loadingEstimate")}
          </p>
        </Modal>
      )}

      {comparing && pair && (
        <CompareModal oldId={pair[0]} newId={pair[1]} onClose={() => setComparing(false)} />
      )}

      <div style={s.page}>
        <div style={s.header}>
          <label style={s.selector}>
            {t("detail.agentSelector")}
            <SelectInput
              mono={false}
              value={agentId}
              options={(agents ?? []).map((a) => ({ value: a.id, label: a.name }))}
              onChange={(id) => router.push(`/eval/agents/${id}`)}
            />
          </label>
          <div style={s.spacer} />
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={!data || data.cases_total === 0 || start.isPending || runStatus === "running"}
            onClick={() => setConfirming(true)}
          >
            {start.isPending || runStatus === "running" ? t("dashboard.running") : t("detail.runEval")}
          </Button>
        </div>

        <div aria-live="polite" role="status" style={s.announce}>
          {announce}
        </div>
        {start.isError && <ErrorState body={evalErrorMessage(start.error, te)} />}

        {isLoading && (
          <div aria-label={t("dashboard.loading")}>
            <Skeleton height={160} />
          </div>
        )}
        {isError && <ErrorState onRetry={() => refetch()} />}

        {data && data.cases_total === 0 && <EmptyState icon="FlaskConical" title={t("evalsTab.emptyState")} />}
        {data && data.cases_total > 0 && !data.latest && <p style={s.note}>{t("evalsTab.neverRunState")}</p>}

        {data && data.latest && (
          <>
            {data.banner && <Banner banner={data.banner} />}
            <MetricTiles latest={data.latest} delta={data.delta} showDeltas={data.previous !== null} />

            <h2 style={s.h2}>{t("detail.trendHeading")}</h2>
            <TrendChart trend={data.trend} />

            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <h2 style={{ ...s.h2, flex: 1 }}>{t("detail.runsHeading")}</h2>
              <Button kind="secondary" size="sm" disabled={!canCompare(selected)} onClick={() => setComparing(true)}>
                {t("detail.compare")}
              </Button>
            </div>
            {!enoughRuns && <p style={s.note}>{t("detail.secondRunNeeded")}</p>}
            <RunsTable
              runs={runs}
              selected={selected}
              onToggle={(id) => setSelected((cur) => toggleSelected(cur, id))}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
