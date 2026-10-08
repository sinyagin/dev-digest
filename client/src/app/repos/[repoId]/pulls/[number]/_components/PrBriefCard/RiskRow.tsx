"use client";

import React from "react";
import type { Risk } from "@devdigest/shared";
import { RISK_SEV_COLOR, RISK_SEV_COLOR_FALLBACK } from "./constants";
import { s } from "./styles";

/** One risk entry: title, severity-coloured indicator, and its file refs. */
export function RiskRow({ risk }: { risk: Risk }) {
  const color = RISK_SEV_COLOR[risk.severity] ?? RISK_SEV_COLOR_FALLBACK;

  return (
    <div style={s.riskRow(color)}>
      <div style={s.riskTitleRow}>
        <span aria-hidden="true" style={s.riskIndicator(color)} />
        <span style={s.riskTitle}>{risk.title}</span>
      </div>
      {risk.file_refs.length > 0 && (
        <div style={s.riskFileRefs}>
          {risk.file_refs.map((file) => (
            <span key={file}>{file}</span>
          ))}
        </div>
      )}
    </div>
  );
}
