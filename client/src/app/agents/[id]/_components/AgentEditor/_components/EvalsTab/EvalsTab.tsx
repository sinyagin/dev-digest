/* EvalsTab — eval cases, suite runs, metrics and run history for one agent (SPEC-03). */
"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCase, EvalCaseInput } from "@devdigest/shared";
import { EvalCaseModal } from "@/components/eval/EvalCaseModal";
import { MetricTiles } from "@/components/eval/MetricTiles";
import { evalKeys, useEvalAgentDetail, useEvalCases, useEvalRun, useEvalRuns, useStartEvalRun } from "@/lib/hooks/eval";
import { caseToInput, emptyCaseInput, passingCount } from "./helpers";
import { CaseRow } from "./_components/CaseRow";
import { RunHistory } from "./_components/RunHistory";
import { RunAllConfirm } from "./_components/RunAllConfirm";
import { s } from "./styles";

type ModalState = { mode: "new"; initial: EvalCaseInput } | { mode: "edit"; initial: EvalCaseInput; caseId: string };

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval.evalsTab");
  const tl = useTranslations("eval");
  const { data: cases, isLoading: casesLoading } = useEvalCases(agent.id);
  const { data: detail } = useEvalAgentDetail(agent.id);
  const { data: runs } = useEvalRuns(agent.id);
  const start = useStartEvalRun(agent.id);

  const [runId, setRunId] = useState<string | null>(null);
  const [confirmingRunAll, setConfirmingRunAll] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const { data: activeRun } = useEvalRun(runId);
  const qc = useQueryClient();

  const runStatus = activeRun?.status;
  useEffect(() => {
    // Refresh tiles, history and case rows once the polled run settles
    // (global staleTime would otherwise keep them stale until remount).
    if (runStatus === "completed" || runStatus === "errored") {
      void qc.invalidateQueries({ queryKey: evalKeys.agentDetail(agent.id) });
      void qc.invalidateQueries({ queryKey: evalKeys.runs(agent.id) });
      void qc.invalidateQueries({ queryKey: evalKeys.cases(agent.id) });
    }
  }, [runStatus, qc, agent.id]);

  const list: EvalCase[] = cases ?? [];
  const history = runs ?? detail?.runs ?? [];
  const latest = detail?.latest ?? null;
  const hasCases = list.length > 0;

  const announce =
    activeRun?.status === "running"
      ? t("announceStarted")
      : activeRun?.status === "completed"
        ? t("announceFinished", { passed: activeRun.traces_passed, total: activeRun.traces_total })
        : activeRun?.status === "errored"
          ? t("announceFailed")
          : "";

  const onRunAll = () =>
    start.mutate(undefined, {
      onSuccess: (run) => setRunId(run.id),
      onSettled: () => setConfirmingRunAll(false),
    });

  return (
    <div style={s.wrap}>
      <div role="status" aria-live="polite" style={s.srOnly}>
        {announce}
      </div>

      <section style={s.section} aria-labelledby="evals-metrics">
        <div style={s.headRow}>
          <h2 id="evals-metrics" style={s.title}>{t("metricsTitle")}</h2>
          <span style={s.spacer} />
          <Link href={`/eval/agents/${agent.id}`} style={s.link}>
            {t("viewDashboard")} →
          </Link>
        </div>
        <p style={s.sub}>{t("metricsSubtitle")}</p>
        {!hasCases && !casesLoading && <p style={s.muted}>{t("emptyState")}</p>}
        {hasCases && !latest && <p style={s.muted}>{t("neverRunState")}</p>}
        {latest && (
          <>
            <MetricTiles latest={latest} delta={detail?.delta ?? null} showDeltas={detail?.previous != null} />
            {detail?.previous == null && <p style={s.muted}>{t("oneRunState")}</p>}
          </>
        )}
      </section>

      <section style={s.section} aria-labelledby="evals-cases">
        <div style={s.headRow}>
          <h2 id="evals-cases" style={s.title}>{t("casesHeading")}</h2>
          {hasCases && <span style={s.sub}>{t("passing", { passed: passingCount(list), total: list.length })}</span>}
          <span style={s.spacer} />
          <Button
            icon="Play"
            disabled={!hasCases || start.isPending || activeRun?.status === "running"}
            onClick={() => setConfirmingRunAll(true)}
          >
            {t("runAll")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={() => setModal({ mode: "new", initial: emptyCaseInput() })}>
            {t("newCase")}
          </Button>
        </div>
        {casesLoading ? (
          <Skeleton />
        ) : hasCases ? (
          <ul style={s.list}>
            {list.map((c) => (
              <CaseRow
                key={c.id}
                agentId={agent.id}
                item={c}
                onEdit={() => setModal({ mode: "edit", initial: caseToInput(c), caseId: c.id })}
              />
            ))}
          </ul>
        ) : (
          <p style={s.muted}>{t("emptyCases")}</p>
        )}
      </section>

      {history.length > 0 && (
        <section style={s.section} aria-labelledby="evals-history">
          <h2 id="evals-history" style={s.title}>{tl("history.heading")}</h2>
          <RunHistory runs={history} />
        </section>
      )}

      {confirmingRunAll && (
        <RunAllConfirm
          agentId={agent.id}
          starting={start.isPending}
          onConfirm={onRunAll}
          onClose={() => setConfirmingRunAll(false)}
        />
      )}
      {modal && (
        <EvalCaseModal
          agentId={agent.id}
          agentName={agent.name}
          mode={modal.mode}
          initial={modal.initial}
          caseId={modal.mode === "edit" ? modal.caseId : undefined}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
