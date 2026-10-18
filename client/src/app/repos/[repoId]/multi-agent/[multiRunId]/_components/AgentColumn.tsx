"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SeverityBadge } from "@devdigest/ui";
import type { AgentColumn as AgentColumnData } from "@devdigest/shared";
import { agentAccent, formatCost, formatDuration } from "@/lib/multi-agent";
import { StatusChip } from "@/components/run-status-chip";
import { ScoreRing } from "./ScoreRing";
import type { DrawerTab } from "../helpers";

export interface AgentColumnProps {
  column: AgentColumnData;
  elapsedMs: number;
  onOpenTrace: (runId: string, tab: DrawerTab) => void;
}

/** One agent's result column. No SSE here: status, elapsed and `last_log` only. */
export function AgentColumn({ column, elapsedMs, onOpenTrace }: AgentColumnProps) {
  const t = useTranslations("multiAgentRun.column");
  const accent = agentAccent(column.agent_id);
  const { status } = column;

  return (
    <section
      aria-label={column.agent_name}
      style={{
        flex: "1 1 260px",
        minWidth: 240,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderTop: `3px solid ${accent.color}`,
        borderRadius: 8,
      }}
    >
      <header style={{ display: "flex", gap: 10, alignItems: "center", padding: 12 }}>
        <span aria-hidden="true">{accent.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{column.agent_name}</h3>
          <div className="tnum" style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("meta", { duration: formatDuration(column.duration_ms), cost: formatCost(column.cost_usd) })}
          </div>
        </div>
        {status !== "failed" && <ScoreRing score={status === "done" ? column.score : null} />}
      </header>

      <div style={{ padding: "0 12px 8px" }}>
        <StatusChip status={status} elapsedMs={status === "running" ? elapsedMs : undefined} />
      </div>

      <div style={{ flex: 1, padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {status === "running" && (
          <p className="mono" style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
            {column.last_log ?? t("waiting")}
          </p>
        )}
        {status === "failed" && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--crit)" }}>
            {column.error ? t("failedReason", { reason: column.error }) : t("failedUnknown")}
          </p>
        )}
        {status === "cancelled" && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>{t("cancelledNote")}</p>
        )}
        {status === "done" && column.findings.length === 0 && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>{t("noFindings")}</p>
        )}
        {status === "done" && column.findings.length > 0 && (
          <ul
            aria-label={t("findingsList", { agent: column.agent_name })}
            style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}
          >
            {column.findings.map((f) => (
              <li key={f.id} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span>
                  <SeverityBadge severity={f.severity} />
                </span>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{f.title}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {f.file}:{f.start_line}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: 12,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Button
          kind="secondary"
          size="sm"
          aria-label={t("viewTraceFor", { agent: column.agent_name })}
          onClick={() => onOpenTrace(column.run_id, "trace")}
        >
          {t("viewTrace")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          aria-label={t("logsFor", { agent: column.agent_name })}
          onClick={() => onOpenTrace(column.run_id, "log")}
        >
          {t("logs")}
        </Button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
          {t("findingCount", { count: column.findings.length })}
        </span>
      </footer>
    </section>
  );
}
