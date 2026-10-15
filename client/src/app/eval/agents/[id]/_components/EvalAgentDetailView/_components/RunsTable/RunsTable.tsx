"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@devdigest/ui";
import type { EvalRunSummary } from "@devdigest/shared";
import { fmtCost, fmtPct } from "../../../../../../../../lib/eval-format";
import { fmtWhen } from "../../helpers";
import { s } from "../../styles";

interface Props {
  runs: EvalRunSummary[];
  selected: string[];
  onToggle: (id: string) => void;
}

export function RunsTable({ runs, selected, onToggle }: Props) {
  const t = useTranslations("eval");

  const statusText = (r: EvalRunSummary) =>
    r.status === "completed"
      ? r.traces_passed === r.traces_total
        ? t("history.status.passed")
        : t("history.status.failed")
      : r.status === "running"
        ? t("history.status.running")
        : t("history.status.errored", { reason: r.error_reason ?? "" });

  return (
    <div style={s.tableCard}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th} />
            <th style={s.th}>{t("history.columns.ranAt")}</th>
            <th style={s.th}>{t("history.columns.version")}</th>
            <th style={s.th}>{t("history.columns.recall")}</th>
            <th style={s.th}>{t("history.columns.precision")}</th>
            <th style={s.th}>{t("history.columns.citation")}</th>
            <th style={s.th}>{t("history.columns.traces")}</th>
            <th style={s.th}>{t("history.columns.cost")}</th>
            <th style={s.th}>{t("history.columns.status")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const label = [
              fmtWhen(r.ran_at),
              `v${r.agent_version}`,
              `${t("history.columns.recall")} ${fmtPct(r.recall)}`,
              `${t("history.columns.precision")} ${fmtPct(r.precision)}`,
              `${t("history.columns.citation")} ${fmtPct(r.citation_accuracy)}`,
              `${t("history.columns.traces")} ${t("metrics.tracesPassedValue", { passed: r.traces_passed, total: r.traces_total })}`,
              fmtCost(r.cost_usd),
              statusText(r),
            ].join(", ");
            return (
              <tr key={r.id}>
                <td style={s.td}>
                  <Checkbox
                    checked={selected.includes(r.id)}
                    disabled={r.status !== "completed"}
                    onChange={() => onToggle(r.id)}
                    label={<span style={s.srOnly}>{label}</span>}
                  />
                </td>
                <td style={s.td}>{fmtWhen(r.ran_at)}</td>
                <td style={s.td}>v{r.agent_version}</td>
                <td className="tnum" style={s.td}>{fmtPct(r.recall)}</td>
                <td className="tnum" style={s.td}>{fmtPct(r.precision)}</td>
                <td className="tnum" style={s.td}>{fmtPct(r.citation_accuracy)}</td>
                <td className="tnum" style={s.td}>
                  {t("metrics.tracesPassedValue", { passed: r.traces_passed, total: r.traces_total })}
                </td>
                <td className="tnum" style={s.td}>{fmtCost(r.cost_usd)}</td>
                <td style={s.td}>{statusText(r)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
