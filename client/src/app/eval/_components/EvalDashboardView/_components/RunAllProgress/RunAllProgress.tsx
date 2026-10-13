"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import type { EvalRunAllResult } from "@devdigest/shared";
import { evalKeys, useEvalRun } from "../../../../../../lib/hooks/eval";
import { s } from "../../styles";

type Result = EvalRunAllResult["results"][number];

/** One started run: polls it (useEvalRun, 2s while running) and reports progress, then the final state. */
function StartedRunRow({ result, runId, onSettled }: { result: Result; runId: string; onSettled: (id: string) => void }) {
  const t = useTranslations("eval");
  const { data: run, isError } = useEvalRun(runId);
  const settled = isError || (run != null && run.status !== "running");

  React.useEffect(() => {
    if (settled) onSettled(runId);
  }, [settled, runId, onSettled]);

  let text: string;
  let failed = false;
  if (isError || run?.status === "errored") {
    failed = true;
    const reason = run?.error_reason;
    text = `${result.agent_name}: ${t("evalsTab.announceFailed")}${reason ? ` — ${reason}` : ""}`;
  } else if (run?.status === "completed") {
    text = `${result.agent_name}: ${t("evalsTab.announceFinished", { passed: run.traces_passed, total: run.traces_total })}`;
  } else if (run) {
    text = t("dashboard.agentProgress", {
      agent: result.agent_name,
      done: run.per_case.length,
      total: run.case_ids.length,
    });
  } else {
    text = `${result.agent_name}: ${t("dashboard.runAllStarted")}`;
  }
  return <li style={failed ? s.resultError : undefined}>{text}</li>;
}

/** Per-agent run-all report (AC-31): start failures, live progress and final state; refreshes the dashboard once all settle. */
export function RunAllProgress({ results }: { results: Result[] }) {
  const t = useTranslations("eval");
  const qc = useQueryClient();
  const [settled, setSettled] = React.useState<ReadonlySet<string>>(new Set());
  const startedCount = results.filter((r) => r.run_id != null).length;

  const onSettled = React.useCallback((id: string) => {
    setSettled((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  React.useEffect(() => {
    if (startedCount > 0 && settled.size >= startedCount) {
      void qc.invalidateQueries({ queryKey: evalKeys.dashboard });
    }
  }, [settled, startedCount, qc]);

  return (
    <ul style={s.results} aria-live="polite">
      {results.map((r) =>
        r.error || r.run_id == null ? (
          <li key={r.agent_id} style={s.resultError}>
            {t("dashboard.agentFailure", { agent: r.agent_name, reason: r.error?.message ?? "" })}
          </li>
        ) : (
          <StartedRunRow key={r.agent_id} result={r} runId={r.run_id} onSettled={onSettled} />
        ),
      )}
    </ul>
  );
}
