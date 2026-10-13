"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { LineChart } from "@devdigest/ui";
import type { EvalTrendPoint } from "@devdigest/shared";
import { fmtPct } from "../../../../../../../../lib/eval-format";
import { fmtWhen, trendSeries } from "../../helpers";
import { s } from "../../styles";

/** Line chart (3 series) plus an equivalent, screen-reader-reachable table (AC-46, AC-57). */
export function TrendChart({ trend }: { trend: EvalTrendPoint[] }) {
  const t = useTranslations("eval");
  const series = [
    { name: t("metrics.recall"), color: "var(--accent)", data: trendSeries(trend, "recall") },
    { name: t("metrics.precision"), color: "var(--success, #2da44e)", data: trendSeries(trend, "precision") },
    { name: t("metrics.citationAccuracy"), color: "var(--warning, #d29922)", data: trendSeries(trend, "citation_accuracy") },
  ];

  return (
    <figure style={{ margin: 0 }}>
      <div aria-hidden="true">
        <LineChart series={series} yMin={0} yMax={1} />
      </div>
      <table style={s.srOnly}>
        <caption>{t("detail.trendCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("history.columns.ranAt")}</th>
            <th scope="col">{t("history.columns.version")}</th>
            <th scope="col">{t("history.columns.recall")}</th>
            <th scope="col">{t("history.columns.precision")}</th>
            <th scope="col">{t("history.columns.citation")}</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((p) => (
            <tr key={p.run_id}>
              <td>{fmtWhen(p.ran_at)}</td>
              <td>v{p.agent_version}</td>
              <td>{fmtPct(p.recall)}</td>
              <td>{fmtPct(p.precision)}</td>
              <td>{fmtPct(p.citation_accuracy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
