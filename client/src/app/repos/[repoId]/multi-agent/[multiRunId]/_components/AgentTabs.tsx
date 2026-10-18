"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { AgentColumn } from "@devdigest/shared";

export interface AgentTabsProps {
  columns: AgentColumn[];
  selectedRunId: string;
  onSelect: (runId: string) => void;
  /** id prefix tying each tab to its tabpanel. */
  idPrefix: string;
}

/** Local tablist: roving tabindex + Arrow/Home/End keys (kit Tabs has no tablist semantics). */
export function AgentTabs({ columns, selectedRunId, onSelect, idPrefix }: AgentTabsProps) {
  const t = useTranslations("multiAgentRun");
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  const label = (c: AgentColumn): string => {
    if (c.status === "done") {
      return c.score != null
        ? t("tabs.scored", { agent: c.agent_name, score: c.score })
        : c.agent_name;
    }
    return t("tabs.stateOnly", { agent: c.agent_name, status: t(`status.${c.status}`) });
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = columns.length - 1;
    const next =
      e.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next == null) return;
    e.preventDefault();
    const target = columns[next]!;
    onSelect(target.run_id);
    refs.current[target.run_id]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t("tabs.label")}
      style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}
    >
      {columns.map((c, i) => {
        const on = c.run_id === selectedRunId;
        return (
          <button
            key={c.run_id}
            ref={(el) => {
              refs.current[c.run_id] = el;
            }}
            role="tab"
            id={`${idPrefix}-tab-${c.run_id}`}
            aria-selected={on}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(c.run_id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: on ? 600 : 500,
              color: on ? "var(--text-primary)" : "var(--text-secondary)",
              borderBottom: `2px solid ${on ? "var(--accent)" : "transparent"}`,
            }}
          >
            {label(c)}
          </button>
        );
      })}
    </div>
  );
}
