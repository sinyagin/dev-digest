import { useTranslations } from "next-intl";
import type { EvalRunSummary } from "@devdigest/shared";
import { fmtCost, fmtDuration, fmtPct } from "@/lib/eval-format";
import { runStatusKey } from "../../helpers";
import { s } from "./styles";

const COLUMNS = ["ranAt", "version", "recall", "precision", "citation", "traces", "cost", "duration", "status"] as const;

/** Run history, newest first (AC-41). */
export function RunHistory({ runs }: { runs: readonly EvalRunSummary[] }) {
  const t = useTranslations("eval");
  const sorted = [...runs].sort((a, b) => b.ran_at.localeCompare(a.ran_at));
  return (
    <table style={s.table}>
      <thead>
        <tr>
          {COLUMNS.map((c) => (
            <th key={c} scope="col" style={s.th}>
              {t(`history.columns.${c}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const key = runStatusKey(r);
          return (
            <tr key={r.id}>
              <td style={s.td}>{new Date(r.ran_at).toLocaleString()}</td>
              <td style={s.td}>v{r.agent_version}</td>
              <td style={s.td}>{fmtPct(r.recall)}</td>
              <td style={s.td}>{fmtPct(r.precision)}</td>
              <td style={s.td}>{fmtPct(r.citation_accuracy)}</td>
              <td style={s.td}>
                {t("metrics.tracesPassedValue", { passed: r.traces_passed, total: r.traces_total })}
              </td>
              <td style={s.td}>{fmtCost(r.cost_usd)}</td>
              <td style={s.td}>{fmtDuration(r.duration_ms)}</td>
              <td style={s.td}>
                {key === "errored"
                  ? t("history.status.errored", { reason: r.error_reason ?? "" })
                  : t(`history.status.${key}`)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
