"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { AgentColumn, FindingActionKind, FindingRecord } from "@devdigest/shared";
import { FindingCard } from "@/components/finding-card";
import { agentAccent, formatCost, formatDuration } from "@/lib/multi-agent";
import { ScoreRing } from "./ScoreRing";
import { StatusChip } from "@/components/run-status-chip";
import type { DrawerTab } from "../helpers";

export interface AgentDetailProps {
  column: AgentColumn;
  /** Full records for this run (from the PR's reviews); undefined while loading. */
  findings: FindingRecord[] | undefined;
  elapsedMs: number;
  pendingFindingId: string | null;
  onOpenTrace: (runId: string, tab: DrawerTab) => void;
  onFindingAction: (findingId: string, action: FindingActionKind, reply?: string) => void;
}

/** Tabs mode body: summary card + the selected agent's FindingCards. */
export function AgentDetail({
  column,
  findings,
  elapsedMs,
  pendingFindingId,
  onOpenTrace,
  onFindingAction,
}: AgentDetailProps) {
  const t = useTranslations("multiAgentRun");
  const accent = agentAccent(column.agent_id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 12 }}>
      <section
        aria-label={column.agent_name}
        style={{
          display: "flex",
          gap: 14,
          alignItems: "flex-start",
          padding: 14,
          border: "1px solid var(--border)",
          borderTop: `3px solid ${accent.color}`,
          borderRadius: 8,
          background: "var(--bg-elevated)",
        }}
      >
        {column.status !== "failed" && (
          <ScoreRing score={column.status === "done" ? column.score : null} size={56} />
        )}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{column.agent_name}</h3>
            <StatusChip
              status={column.status}
              elapsedMs={column.status === "running" ? elapsedMs : undefined}
            />
          </div>
          {column.verdict && (
            <div style={{ fontSize: 13 }}>
              <strong>{t("tabs.verdict")}:</strong> {column.verdict}
            </div>
          )}
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
            {column.status === "failed" && column.error
              ? t("column.failedReason", { reason: column.error })
              : (column.summary ?? t("tabs.noSummary"))}
          </p>
          <div className="tnum" style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("column.meta", {
              duration: formatDuration(column.duration_ms),
              cost: formatCost(column.cost_usd),
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            kind="secondary"
            size="sm"
            aria-label={t("column.viewTraceFor", { agent: column.agent_name })}
            onClick={() => onOpenTrace(column.run_id, "trace")}
          >
            {t("column.viewTrace")}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            aria-label={t("column.logsFor", { agent: column.agent_name })}
            onClick={() => onOpenTrace(column.run_id, "log")}
          >
            {t("column.logs")}
          </Button>
        </div>
      </section>

      {column.status === "running" && column.last_log && (
        <p className="mono" style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
          {column.last_log}
        </p>
      )}
      {column.status === "done" && findings === undefined && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>{t("tabs.findingsLoading")}</p>
      )}
      {column.status === "done" && findings?.length === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>{t("tabs.noFindings")}</p>
      )}
      {findings?.map((f) => (
        <FindingCard
          key={f.id}
          f={f}
          defaultExpanded
          pending={pendingFindingId === f.id}
          onAction={(action, reply) => onFindingAction(f.id, action, reply)}
        />
      ))}
    </div>
  );
}
