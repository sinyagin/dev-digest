"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalDryRunResult } from "@devdigest/shared";
import { fmtCost } from "@/lib/eval-format";
import * as s from "../../styles";

/** Dry-run outcome. Every string from the model/case renders as a text node (AC-54). */
export function DryRunResult({ result }: { result: EvalDryRunResult }) {
  const t = useTranslations("eval.modal");

  if (result.status === "errored") {
    return (
      <div style={s.resultBox}>
        <div style={{ ...s.resultHead, color: "var(--crit)" }}>
          <Icon.X size={14} />
          <span>{t("result.fail")}</span>
        </div>
        <pre style={s.pre}>{result.error_reason ?? ""}</pre>
      </div>
    );
  }

  const passed = result.pass === true;
  const PassIcon = passed ? Icon.Check : Icon.X;
  return (
    <div style={s.resultBox}>
      <div style={{ ...s.resultHead, color: passed ? "var(--ok, var(--accent))" : "var(--crit)" }}>
        <PassIcon size={14} />
        <span>{passed ? t("result.pass") : t("result.fail")}</span>
      </div>
      <div style={s.metaLine}>
        {t("result.expectedVsActual", { expected: 1, actual: result.findings_total })}
        {" · "}
        {t("result.matched", { count: result.findings_matched })}
        {" · "}
        {t("result.duration", { duration: (result.duration_ms / 1000).toFixed(1) })}
        {" · "}
        {t("result.cost", { cost: fmtCost(result.cost_usd) })}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {result.actual.map((f, i) => (
          <li key={`${f.file}:${f.start_line}:${i}`} style={s.findingRow}>
            <pre style={s.pre}>
              {`${f.file}:${f.start_line}-${f.end_line} · ${f.severity} · ${f.category}`}
            </pre>
            <pre style={s.pre}>{f.title}</pre>
            {f.matched && (
              <span style={{ display: "inline-flex", gap: 4, alignItems: "center", color: "var(--text-secondary)" }}>
                <Icon.Check size={12} />
                {t("result.matched", { count: 1 })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
