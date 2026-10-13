"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { BarRow } from "@devdigest/ui";
import { fmtPct } from "../../../../../../lib/eval-format";
import { fmtWhen, newestFirst, type RecentRun } from "../../helpers";
import { s } from "../../styles";

export function RecentRunsTable({ runs }: { runs: RecentRun[] }) {
  const t = useTranslations("eval");
  const rows = newestFirst(runs);

  return (
    <div style={s.tableCard}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>{t("dashboard.agents.columns.agent")}</th>
            <th style={s.th}>{t("dashboard.table.ranAt")}</th>
            <th style={s.th}>{t("history.columns.version")}</th>
            <th style={{ ...s.th, minWidth: 320 }}>
              {t("dashboard.table.recall")} / {t("dashboard.table.precision")} / {t("dashboard.table.citation")}
            </th>
            <th style={s.th}>{t("dashboard.agents.columns.traces")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={s.td}>{r.agent_name}</td>
              <td style={s.td}>{fmtWhen(r.ran_at)}</td>
              <td style={s.td}>v{r.agent_version}</td>
              <td style={s.td}>
                <BarRow label={t("dashboard.table.recall")} value={r.recall ?? 0} max={1} suffix={fmtPct(r.recall)} />
                <BarRow label={t("dashboard.table.precision")} value={r.precision ?? 0} max={1} suffix={fmtPct(r.precision)} />
                <BarRow
                  label={t("dashboard.table.citation")}
                  value={r.citation_accuracy ?? 0}
                  max={1}
                  suffix={fmtPct(r.citation_accuracy)}
                />
              </td>
              <td className="tnum" style={s.td}>
                {r.traces_passed}/{r.traces_total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
