/* RunReviewDropdown — "Run Review" popover. Pick one agent (single run, stays
   on the page), two or more (multi-agent run → results page), or run all
   enabled agents. Single/run-all kick off POST /pulls/:id/review and hand the
   runIds up so the parent can stream SSE live status. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useRunReview } from "@/lib/hooks/reviews";
import { useAgentEstimates } from "@/lib/hooks/multi-agent";
import { MAX_AGENTS, MIN_AGENTS, formatDuration } from "@/lib/multi-agent";
import { POPOVER_WIDTH } from "./constants";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  repoId,
  prNumber,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  repoId: string;
  prNumber: number;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a single/run-all run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when a single/run-all request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const run = useRunReview();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const all = agents ?? [];
  const hasEnabled = all.some((a) => a.enabled);
  const count = selected.length;
  const atCap = count >= MAX_AGENTS;
  const estimateById = new Map((estimates ?? []).map((e) => [e.agent_id, e]));

  // Close on outside mousedown (same behaviour as the kit Dropdown) and Escape.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (id: string, on: boolean) => {
    setError(null);
    setSelected((cur) => {
      if (!on) return cur.filter((x) => x !== id);
      if (cur.includes(id) || cur.length >= MAX_AGENTS) return cur;
      return [...cur, id];
    });
  };

  // Single-agent and run-all: stay on the page, stream status via callbacks.
  const kick = async (opts: { all?: boolean; agentId?: string }) => {
    setError(null);
    onRunStart?.();
    try {
      const res = await run.mutateAsync({ prId, ...opts });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      onRunSettled?.();
    }
  };

  const runMulti = async () => {
    setError(null);
    try {
      const res = await run.mutateAsync({ prId, agentIds: selected });
      setOpen(false);
      if (res.multi_agent_run_id) router.push(`/repos/${repoId}/multi-agent/${res.multi_agent_run_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onPrimary = () => (count === 1 ? kick({ agentId: selected[0] }) : runMulti());

  return (
    <div ref={rootRef} style={s.root}>
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? s.merged : undefined}
      >
        <Button
          kind={kind}
          size={size}
          iconRight="ChevronDown"
          icon="Sparkles"
          loading={run.isPending}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {run.isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>
      {open && (
        <div style={{ ...s.popover, width: POPOVER_WIDTH }} role="group" aria-label={t("runReview.pickAgents")}>
          {warnMerged && <p style={s.note}>{t("runReview.mergedWarning")}</p>}
          <div style={s.header}>
            <span style={s.heading}>{t("runReview.pickAgents")}</span>
            <Button kind="ghost" size="sm" onClick={() => setSelected([])}>
              {t("runReview.clear")}
            </Button>
          </div>

          {all.length < MIN_AGENTS && (
            <p style={s.note}>
              {t("runReview.needsTwo")}{" "}
              <Link href="/agents" style={s.link}>
                {t("runReview.manageAgents")}
              </Link>
            </p>
          )}

          <div style={s.list}>
            {all.map((a) => {
              const est = estimateById.get(a.id);
              const hint = est?.avg_duration_ms != null ? `~${formatDuration(est.avg_duration_ms)}` : "—";
              return (
                <div key={a.id} style={s.row}>
                  <Checkbox
                    checked={selected.includes(a.id)}
                    onChange={(v) => toggle(a.id, v)}
                    label={a.name}
                  />
                  <span style={s.hint}>{hint}</span>
                </div>
              );
            })}
          </div>
          {atCap && <p style={s.note}>{t("runReview.maxAgents", { max: MAX_AGENTS })}</p>}

          <Button kind="primary" size="sm" disabled={count === 0 || run.isPending} onClick={onPrimary}>
            {count >= MIN_AGENTS ? t("runReview.runMulti", { count }) : t("runReview.runSingle")}
          </Button>
          {error && (
            <p role="alert" style={s.error}>
              {error}
            </p>
          )}

          <div style={s.divider} />
          <button
            type="button"
            style={{ ...s.linkBtn, opacity: hasEnabled ? 1 : 0.6 }}
            onClick={() => kick({ all: true })}
          >
            {t("runReview.runAll")}
          </button>
          <button
            type="button"
            style={s.linkBtn}
            onClick={() => {
              setOpen(false);
              router.push(`/multi-agent-review?repo=${repoId}&pr=${prNumber}`);
            }}
          >
            {t("runReview.configureAgents")}
          </button>
        </div>
      )}
    </div>
  );
}
