"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { AggregateEstimate } from "@/lib/multi-agent";
import { MIN_AGENTS, formatCost, formatDuration } from "@/lib/multi-agent";
import { s } from "../../styles";

export function RunFooter({
  hasPr,
  count,
  estimate,
  pending,
  error,
  onRun,
}: {
  hasPr: boolean;
  count: number;
  estimate: AggregateEstimate;
  pending: boolean;
  error: string | null;
  onRun: () => void;
}) {
  const t = useTranslations("multiAgent.footer");
  const ready = hasPr && count >= MIN_AGENTS;
  const label = ready ? t("runCount", { count }) : t("run");
  const hint = !hasPr ? t("pickPr") : count < MIN_AGENTS ? t("pickTwo") : null;

  return (
    <div style={s.footer}>
      <div style={s.footerInfo}>
        {hasPr && count > 0 && (
          <span>
            {estimate.none
              ? t("noEstimate")
              : t("estimate", {
                  duration: formatDuration(estimate.durationMs),
                  cost: formatCost(estimate.costUsd),
                })}
            {!estimate.none && estimate.excluded > 0 && ` · ${t("excludes", { count: estimate.excluded })}`}
          </span>
        )}
        {hint && <span>{hint}</span>}
        {error && (
          <p role="alert" style={s.error}>
            {error}
          </p>
        )}
      </div>
      <Link href="/agents" style={s.link}>
        {t("configureAgents")}
      </Link>
      <Button kind="primary" disabled={!ready || pending} loading={pending} onClick={onRun}>
        {pending ? t("running") : label}
      </Button>
    </div>
  );
}
