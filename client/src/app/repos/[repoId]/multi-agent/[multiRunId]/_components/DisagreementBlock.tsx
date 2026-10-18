"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, SeverityBadge } from "@devdigest/ui";
import type { AgentColumn, Conflict } from "@devdigest/shared";
import { agentAccent } from "@/lib/multi-agent";
import { disagreementState } from "../helpers";

export interface DisagreementBlockProps {
  columns: AgentColumn[];
  conflicts: Conflict[];
  onlyConflicts: boolean;
  onOnlyConflictsChange: (v: boolean) => void;
}

/** Where agents disagree: one row per file:line group, one cell per agent. */
export function DisagreementBlock({
  columns,
  conflicts,
  onlyConflicts,
  onOnlyConflictsChange,
}: DisagreementBlockProps) {
  const t = useTranslations("multiAgentRun.disagreements");
  const state = disagreementState(columns, conflicts, onlyConflicts);

  return (
    <section
      aria-labelledby="disagreements-title"
      style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-elevated)" }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: 12 }}>
        <h2 id="disagreements-title" style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          {t("title")}
        </h2>
        <label style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={onlyConflicts}
            onChange={(e) => onOnlyConflictsChange(e.target.checked)}
          />
          {t("onlyConflicts")}
        </label>
      </header>

      {state.kind === "needsTwo" && (
        <p style={{ margin: 0, padding: "0 12px 12px", fontSize: 13, color: "var(--text-muted)" }}>
          {state.running > 0 ? t("needsTwoRunning", { running: state.running }) : t("needsTwo")}
        </p>
      )}
      {state.kind === "allAgree" && (
        <p style={{ margin: 0, padding: "0 12px 12px", fontSize: 13, color: "var(--text-muted)" }}>
          {t("allAgree")}
        </p>
      )}
      {state.kind === "rows" && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {state.rows.map((c) => (
            <li
              key={`${c.file}:${c.line}:${c.end_line}`}
              style={{ padding: 12, borderTop: "1px solid var(--border)" }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <span className="mono" style={{ fontSize: 12 }}>
                  {t("rowHeader", { file: c.file, start: c.line, end: c.end_line })}
                </span>
                <strong style={{ fontSize: 13 }}>{c.title}</strong>
                <Badge
                  color={c.conflict ? "var(--warn)" : "var(--ok)"}
                  bg={c.conflict ? "var(--warn-bg)" : "var(--ok-bg)"}
                >
                  {c.conflict ? t("conflictBadge") : t("agreeBadge")}
                </Badge>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {c.takes.map((take) => (
                  <div
                    key={take.agent_id}
                    style={{
                      flex: "1 1 200px",
                      borderLeft: `3px solid ${agentAccent(take.agent_id).color}`,
                      padding: "4px 10px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{take.persona}</span>
                    {take.verdict === "ignored" ? (
                      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("didNotFlag")}</span>
                    ) : (
                      <>
                        <span>
                          <SeverityBadge severity={take.verdict} />
                        </span>
                        <span style={{ fontSize: 13 }}>{take.note}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
