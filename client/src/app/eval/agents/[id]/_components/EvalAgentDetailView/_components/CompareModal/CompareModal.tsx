"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Modal, Skeleton } from "@devdigest/ui";
import type { EvalMetricDelta } from "@devdigest/shared";
import { useEvalCompare } from "../../../../../../../../lib/hooks/eval";
import { fmtCost, fmtDeltaPts, fmtPct } from "../../../../../../../../lib/eval-format";
import { toPts } from "../../helpers";
import { s } from "../../styles";

interface Props {
  oldId: string;
  newId: string;
  onClose: () => void;
}

const DIFF_MARK = { equal: " ", add: "+", remove: "−" } as const;

/** Old-vs-new Compare. Read-only: there is deliberately no Promote control (AC-37). */
export function CompareModal({ oldId, newId, onClose }: Props) {
  const t = useTranslations("eval.compare");
  const { data, isLoading, isError, refetch } = useEvalCompare(oldId, newId);

  const ratioRow = (label: string, m: EvalMetricDelta) => {
    const d = fmtDeltaPts(toPts(m.delta));
    return (
      <tr key={label}>
        <th scope="row" style={s.td}>{label}</th>
        <td className="tnum" style={s.td}>{fmtPct(m.old)}</td>
        <td className="tnum" style={s.td}>{fmtPct(m.new)}</td>
        <td className="tnum" style={{ ...s.td, ...(d.dir === "up" ? s.up : d.dir === "down" ? s.down : undefined) }}>
          {d.arrow ? `${d.arrow} ${d.text}` : d.text}
        </td>
      </tr>
    );
  };

  const costRow = (m: EvalMetricDelta) => {
    const dir = m.delta == null ? "none" : m.delta > 0 ? "up" : m.delta < 0 ? "down" : "flat";
    const text =
      m.delta == null ? "n/a" : dir === "flat" ? "±0" : `${m.delta > 0 ? "+" : "−"}${fmtCost(Math.abs(m.delta))}`;
    return (
      <tr key="cost">
        <th scope="row" style={s.td}>{t("cost")}</th>
        <td className="tnum" style={s.td}>{fmtCost(m.old)}</td>
        <td className="tnum" style={s.td}>{fmtCost(m.new)}</td>
        <td className="tnum" style={s.td}>
          {dir === "up" ? "▲ " : dir === "down" ? "▼ " : ""}
          {text}
        </td>
      </tr>
    );
  };

  return (
    <Modal width={760} title={t("title")} onClose={onClose}>
      <div style={s.modalBody}>
        {isLoading && <Skeleton height={160} />}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {data && (
          <>
            <p style={s.note}>{t("commonCases", { count: data.common_cases })}</p>
            <div style={s.tableCard}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>{t("metric")}</th>
                    <th style={s.th}>{t("old")} · v{data.prompt.old_version}</th>
                    <th style={s.th}>{t("new")} · v{data.prompt.new_version}</th>
                    <th style={s.th}>{t("delta")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ratioRow(t("metrics.recall"), data.metrics.recall)}
                  {ratioRow(t("metrics.precision"), data.metrics.precision)}
                  {ratioRow(t("metrics.citationAccuracy"), data.metrics.citation_accuracy)}
                  {costRow(data.metrics.cost_usd)}
                </tbody>
              </table>
            </div>

            {!data.case_set.same && (
              <div role="note">
                <p style={s.note}>
                  {t("caseSetDiffers", { added: data.case_set.added.length, removed: data.case_set.removed.length })}
                </p>
                <ul style={s.note}>
                  {data.case_set.added.map((c) => (
                    <li key={`a-${c.case_id}`}>
                      {t("addedLabel")}: {c.name}
                    </li>
                  ))}
                  {data.case_set.removed.map((c) => (
                    <li key={`r-${c.case_id}`}>
                      {t("removedLabel")}: {c.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.prompt.unchanged ? (
              <p style={s.note}>{t("promptUnchanged")}</p>
            ) : (
              <pre className="mono" style={s.diff}>
                {data.prompt.diff.map((l, i) => (
                  <div key={i} style={l.op === "add" ? s.diffAdd : l.op === "remove" ? s.diffRemove : undefined}>
                    <span style={s.diffLabel}>
                      {l.op === "add" ? t("addedLabel") : l.op === "remove" ? t("removedLabel") : ""}
                    </span>
                    {DIFF_MARK[l.op]} {l.line}
                  </div>
                ))}
              </pre>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
