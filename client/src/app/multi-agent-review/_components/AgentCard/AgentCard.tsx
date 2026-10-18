"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { agentAccent, formatCost, formatDuration } from "@/lib/multi-agent";
import { s } from "../../styles";

export function AgentCard({
  agent,
  checked,
  durationMs,
  costUsd,
  onToggle,
}: {
  agent: Agent;
  checked: boolean;
  durationMs: number | null;
  costUsd: number | null;
  onToggle: (checked: boolean) => void;
}) {
  const t = useTranslations("multiAgent.step2");
  const accent = agentAccent(agent.id);
  return (
    <div style={s.card(accent.color, checked)}>
      <div style={s.cardHead}>
        <Checkbox checked={checked} onChange={onToggle} label={`${accent.icon} ${agent.name}`} />
        {!agent.enabled && <span style={s.cardMeta}>{t("disabled")}</span>}
      </div>
      <p style={s.cardDesc}>{agent.description}</p>
      <span style={s.cardMeta}>
        {formatDuration(durationMs)} · {formatCost(costUsd)}
      </span>
    </div>
  );
}
