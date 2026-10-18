"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, type IconName } from "@devdigest/ui";
import { formatDuration } from "@/lib/multi-agent";
import type { AgentColumn } from "@devdigest/shared";

/** Child-run status; a parent run status (running | done | failed) is a subset. */
export type ColumnStatus = AgentColumn["status"];

const STATUS_STYLE: Record<ColumnStatus, { icon: IconName; color: string; bg: string }> = {
  running: { icon: "Clock", color: "var(--info)", bg: "var(--info-bg)" },
  done: { icon: "CheckCircle", color: "var(--ok)", bg: "var(--ok-bg)" },
  failed: { icon: "XCircle", color: "var(--crit)", bg: "var(--crit-bg)" },
  cancelled: { icon: "X", color: "var(--text-muted)", bg: "var(--bg-hover)" },
};

/** Icon + text status chip (never colour alone). */
export function StatusChip({ status, elapsedMs }: { status: ColumnStatus; elapsedMs?: number }) {
  const t = useTranslations("multiAgentRun.status");
  const st = STATUS_STYLE[status];
  const label =
    status === "running" && elapsedMs != null
      ? t("runningElapsed", { elapsed: formatDuration(elapsedMs) })
      : t(status);
  return (
    <Badge icon={st.icon} color={st.color} bg={st.bg}>
      {label}
    </Badge>
  );
}
