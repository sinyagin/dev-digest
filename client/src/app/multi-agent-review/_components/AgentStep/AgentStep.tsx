"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { Agent, AgentEstimate } from "@devdigest/shared";
import { MAX_AGENTS, MIN_AGENTS } from "@/lib/multi-agent";
import { AgentCard } from "../AgentCard";
import { s } from "../../styles";

export function AgentStep({
  hasPr,
  agents,
  estimates,
  checked,
  onToggle,
  onSelectAll,
  onClear,
}: {
  hasPr: boolean;
  agents: Agent[];
  estimates: AgentEstimate[];
  checked: string[];
  onToggle: (id: string, on: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const t = useTranslations("multiAgent.step2");
  const byId = new Map(estimates.map((e) => [e.agent_id, e]));
  const needsTwo = agents.length < MIN_AGENTS;

  return (
    <section style={{ ...s.step, opacity: hasPr ? 1 : 0.55 }} aria-disabled={!hasPr}>
      <h2 style={s.stepTitle}>{t("title")}</h2>
      {!hasPr ? (
        <div style={s.emptyCard}>
          <p style={s.emptyTitle}>{t("emptyTitle")}</p>
          <p style={s.muted}>{t("emptyBody")}</p>
        </div>
      ) : (
        <>
          {needsTwo && (
            <p style={s.muted}>
              {t("needsTwo")}{" "}
              <Link href="/agents" style={s.link}>
                {t("manageAgents")}
              </Link>
            </p>
          )}
          <div style={s.toolbar}>
            <Button kind="secondary" size="sm" onClick={onSelectAll}>
              {t("selectAll")}
            </Button>
            <Button kind="ghost" size="sm" onClick={onClear}>
              {t("clear")}
            </Button>
            {checked.length >= MAX_AGENTS && <span style={s.notice}>{t("max", { max: MAX_AGENTS })}</span>}
          </div>
          <div style={s.grid}>
            {agents.map((a) => {
              const e = byId.get(a.id);
              return (
                <AgentCard
                  key={a.id}
                  agent={a}
                  checked={checked.includes(a.id)}
                  durationMs={e?.avg_duration_ms ?? null}
                  costUsd={e?.avg_cost_usd ?? null}
                  onToggle={(on) => onToggle(a.id, on)}
                />
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
