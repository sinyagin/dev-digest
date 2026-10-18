import { useTranslations } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import { DASH, fmtCostUsd, fmtDurationS, fmtTime, safeGithubUrl, sortRuns, statusKey } from "./helpers";
import { s } from "./styles";

/** Findings cell: total plus per-severity breakdown when known. */
function Findings({ run }: { run: CiRun }) {
  const t = useTranslations("ci.runs");
  if (run.findings_count == null) return <>{DASH}</>;
  const parts = [
    run.critical != null ? t("severity.critical", { n: run.critical }) : null,
    run.warning != null ? t("severity.warning", { n: run.warning }) : null,
    run.suggestion != null ? t("severity.suggestion", { n: run.suggestion }) : null,
  ].filter(Boolean);
  return (
    <>
      {run.findings_count}
      {parts.length > 0 && <span style={s.muted}> ({parts.join(" · ")})</span>}
    </>
  );
}

/** CI runs table (AC-41). `showAgent` is false on the agent's CI tab (AC-48). */
export function CiRunsTable({ runs, showAgent = true }: { runs: readonly CiRun[]; showAgent?: boolean }) {
  const t = useTranslations("ci.runs");
  const cols = ["repo", "pullRequest", ...(showAgent ? ["agent"] : []), "verdict", "findings", "cost", "duration", "status", "timestamp", "job"];
  return (
    <div style={s.card}>
      <table style={s.table}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col" style={s.th}>
                {t(`table.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortRuns(runs).map((r) => {
            const prUrl = safeGithubUrl(r.pr_url);
            const jobUrl = safeGithubUrl(r.github_url);
            const sk = statusKey(r.status);
            const prLabel = r.pr_number != null ? `#${r.pr_number}` : DASH;
            return (
              <tr key={r.id}>
                <td style={s.td}>{r.repo ?? DASH}</td>
                <td style={s.td}>
                  {prUrl && r.pr_number != null ? (
                    <a href={prUrl} target="_blank" rel="noopener noreferrer" style={s.link}>
                      {prLabel}
                    </a>
                  ) : (
                    prLabel
                  )}
                </td>
                {showAgent && <td style={s.td}>{r.agent ?? DASH}</td>}
                <td style={s.td}>{r.verdict ?? DASH}</td>
                <td style={s.td}>
                  <Findings run={r} />
                </td>
                <td style={s.td}>{fmtCostUsd(r.cost_usd)}</td>
                <td style={s.td}>{fmtDurationS(r.duration_s)}</td>
                <td style={s.td}>{sk ? t(`status.${sk}`) : (r.status ?? DASH)}</td>
                <td style={s.td}>{fmtTime(r.ran_at)}</td>
                <td style={s.td}>
                  {jobUrl ? (
                    <a href={jobUrl} target="_blank" rel="noopener noreferrer" style={s.link}>
                      {t("view")}
                    </a>
                  ) : (
                    DASH
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
