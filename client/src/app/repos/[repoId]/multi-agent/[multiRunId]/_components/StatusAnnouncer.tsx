"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { AgentColumn, MultiAgentRun } from "@devdigest/shared";
import { statusChanges, statusMap, type ColumnStatus } from "../helpers";

/** Polite live region announcing column / run status changes between polls. */
export function StatusAnnouncer({
  columns,
  runStatus,
}: {
  columns: AgentColumn[];
  runStatus: MultiAgentRun["status"];
}) {
  const t = useTranslations("multiAgentRun");
  const prevColumns = React.useRef<Map<string, ColumnStatus> | null>(null);
  const prevRun = React.useRef<MultiAgentRun["status"] | null>(null);
  const [message, setMessage] = React.useState("");

  // The refs only hold the previous poll's statuses; the text itself is built
  // from the current vs previous payload, never from stored derived status.
  React.useEffect(() => {
    const parts: string[] = [];
    if (prevColumns.current) {
      for (const ch of statusChanges(prevColumns.current, columns)) {
        parts.push(t("announce.column", { agent: ch.agentName, status: t(`status.${ch.status}`) }));
      }
    }
    if (prevRun.current && prevRun.current !== runStatus && runStatus !== "running") {
      parts.push(
        t("announce.run", {
          status: t(runStatus === "done" ? "announce.runDone" : "announce.runFailed"),
        }),
      );
    }
    prevColumns.current = statusMap(columns);
    prevRun.current = runStatus;
    if (parts.length > 0) setMessage(parts.join(". "));
  }, [columns, runStatus, t]);

  return (
    <div aria-live="polite" role="status" style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
      {message}
    </div>
  );
}
