"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Sparkline } from "@devdigest/ui";
import type { EvalAgentSummary } from "@devdigest/shared";
import { fmtPct } from "../../../../../../lib/eval-format";
import { fmtWhen, recallSeries } from "../../helpers";
import { s } from "../../styles";

export function AgentRow({ agent }: { agent: EvalAgentSummary }) {
  const t = useTranslations("eval");
  const run = agent.last_run;
  const series = recallSeries(agent.trend);

  return (
    <tr>
      <td style={s.td}>
        <Link href={`/eval/agents/${agent.agent_id}`} style={s.link}>
          {agent.name}
        </Link>
        <div className="mono" style={{ ...s.muted, fontSize: 12 }}>
          {agent.model}
        </div>
      </td>
      {run ? (
        <>
          <td style={s.td}>
            v{run.agent_version} · {fmtWhen(run.ran_at)}
          </td>
          <td className="tnum" style={s.td}>
            {run.traces_passed}/{run.traces_total}
          </td>
          <td style={s.td}>{series.length >= 2 ? <Sparkline data={series} /> : null}</td>
          <td className="tnum" style={s.td}>{fmtPct(run.recall)}</td>
          <td className="tnum" style={s.td}>{fmtPct(run.precision)}</td>
          <td className="tnum" style={s.td}>{fmtPct(run.citation_accuracy)}</td>
        </>
      ) : (
        <td colSpan={6} style={{ ...s.td, ...s.muted }}>
          {t("evalsTab.neverRun")}
        </td>
      )}
    </tr>
  );
}
