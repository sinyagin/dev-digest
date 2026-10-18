/* ConfigureRun — step 1 (PR) + step 2 (agents) + run footer. State is local;
   server state comes from query hooks. Default selection is derived (enabled
   agents, capped at 8) until the user edits it. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePulls } from "@/lib/hooks/core";
import { useAgents } from "@/lib/hooks/agents";
import { useRunReview } from "@/lib/hooks/reviews";
import { useAgentEstimates, useMultiAgentRuns } from "@/lib/hooks/multi-agent";
import { MAX_AGENTS, aggregateEstimate, selectAllCapped } from "@/lib/multi-agent";
import { PrStep } from "./PrStep";
import { AgentStep } from "./AgentStep";
import { RunFooter } from "./RunFooter";
import { ResumeRun } from "./ResumeRun";
import { s } from "../styles";

export function ConfigureRun({
  repoId,
  prParam,
  repoPicker,
  back,
}: {
  repoId: string;
  prParam: string | null;
  /** Repository select shown left of the PR select; the page owns repo state. */
  repoPicker?: React.ReactNode;
  /** Optional link back to the recent-runs view, shown above the title. */
  back?: React.ReactNode;
}) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const { data: pullsData, isLoading: pullsLoading } = usePulls(repoId);
  const { data: agentsData } = useAgents();
  const { data: estimatesData } = useAgentEstimates();
  const run = useRunReview();
  const submitting = React.useRef(false);

  const pulls = pullsData ?? [];
  const agents = agentsData ?? [];
  const estimates = estimatesData ?? [];

  // `undefined` = the user hasn't picked yet, so the ?pr= param applies.
  const [picked, setPicked] = React.useState<string | undefined>(undefined);
  const wanted = picked ?? prParam ?? "";
  const pull = pulls.find((p) => String(p.number) === wanted) ?? null;
  const paramNotFound = picked === undefined && !!prParam && !pullsLoading && pull === null;
  // An existing run for the picked PR is offered (never auto-opened) so every
  // entrance can get back to it; Back still leaves the page.
  const { data: prRuns } = useMultiAgentRuns({ prId: pull?.id ?? null }, 1);
  const latestForPr = pull ? (prRuns?.[0] ?? null) : null;

  const [override, setOverride] = React.useState<string[] | null>(null);
  const checked = override ?? selectAllCapped(agents);
  const [error, setError] = React.useState<string | null>(null);

  const toggle = (id: string, on: boolean) => {
    setError(null);
    setOverride((cur) => {
      const base = cur ?? checked;
      if (!on) return base.filter((x) => x !== id);
      if (base.includes(id) || base.length >= MAX_AGENTS) return base;
      return [...base, id];
    });
  };

  const estimate = aggregateEstimate(
    checked.map((id) => estimates.find((e) => e.agent_id === id) ?? { avg_duration_ms: null, avg_cost_usd: null }),
  );

  const onRun = async () => {
    if (!pull?.id || submitting.current) return;
    submitting.current = true;
    setError(null);
    try {
      const res = await run.mutateAsync({ prId: pull.id, agentIds: checked });
      if (res.multi_agent_run_id) {
        // Stay locked after success: we are navigating away, so a late second
        // click must not start another run.
        router.push(`/repos/${repoId}/multi-agent/${res.multi_agent_run_id}`);
        return;
      }
      setError(t("footer.failed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("footer.failed"));
    }
    submitting.current = false;
  };

  return (
    <div style={s.page}>
      {back}
      <header>
        <h1 style={s.title}>{t("title")}</h1>
        <p style={s.subtitle}>{t("subtitle")}</p>
      </header>
      <PrStep
        repoId={repoId}
        pulls={pulls}
        loading={pullsLoading}
        value={pull ? String(pull.number) : ""}
        notFound={paramNotFound}
        repoPicker={repoPicker}
        onChange={(v) => {
          setPicked(v);
          setError(null);
        }}
      />
      {latestForPr ? <ResumeRun run={latestForPr} /> : null}
      <AgentStep
        hasPr={!!pull}
        agents={agents}
        estimates={estimates}
        checked={checked}
        onToggle={toggle}
        onSelectAll={() => setOverride(selectAllCapped(agents))}
        onClear={() => setOverride([])}
      />
      <RunFooter
        hasPr={!!pull}
        count={checked.length}
        estimate={estimate}
        pending={run.isPending}
        error={error}
        onRun={onRun}
      />
    </div>
  );
}
