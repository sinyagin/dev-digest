/* Multi-Agent Review results — /repos/:repoId/multi-agent/:multiRunId.
   Columns ⇄ Tabs (?view=), disagreement block, one shared RunTraceDrawer.
   Columns have no SSE: status / elapsed / last_log only; the live log lives in
   the drawer's Log tab. */
"use client";

import React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { ApiError } from "@/lib/api";
import { useFindingAction, useMultiAgentRun, usePrReviews, usePulls } from "@/lib/hooks";
import { ResultsHeader } from "./_components/ResultsHeader";
import { AgentColumn } from "./_components/AgentColumn";
import { AgentTabs } from "./_components/AgentTabs";
import { AgentDetail } from "./_components/AgentDetail";
import { DisagreementBlock } from "./_components/DisagreementBlock";
import { StatusAnnouncer } from "./_components/StatusAnnouncer";
import { parseView, type DrawerTab, type ViewMode } from "./helpers";
import { useElapsed } from "./useElapsed";

interface Selection {
  runId: string;
  tab: DrawerTab;
}

function ResultsPage() {
  const t = useTranslations("multiAgentRun");
  const { repoId, multiRunId } = useParams<{ repoId: string; multiRunId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const view = parseView(search.get("view"));

  const { data: run, isLoading, error, refetch } = useMultiAgentRun(multiRunId);
  const { data: pulls } = usePulls(run?.repo_id);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(run?.pr_id);
  const findingAction = useFindingAction();

  // Reviews are fetched once; a child that finishes after that writes its
  // findings later, so refetch whenever another column settles.
  const settledCount = run?.columns.filter((c) => c.status !== "running").length ?? 0;
  const prevSettled = React.useRef(settledCount);
  React.useEffect(() => {
    if (settledCount > prevSettled.current) void refetchReviews();
    prevSettled.current = settledCount;
  }, [settledCount, refetchReviews]);

  const [onlyConflicts, setOnlyConflicts] = React.useState(true);
  const [selectedAgent, setSelectedAgent] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<Selection | null>(null);

  const running = run?.status === "running";
  const elapsedMs = useElapsed(run?.ran_at ?? "", !!running);

  const crumb = [
    { label: t("crumb.multiAgent"), href: `/multi-agent-review?repo=${repoId}` },
    { label: run?.pr_number != null ? `#${run.pr_number}` : "…", mono: true },
  ];

  const setView = (v: ViewMode) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("view", v);
    router.replace(`/repos/${repoId}/multi-agent/${multiRunId}?${sp.toString()}`);
  };

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div role="status" aria-label={t("loading")} style={{ padding: "28px 32px", display: "grid", gap: 16 }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={240} />
        </div>
      </AppShell>
    );
  }

  if (error instanceof ApiError && error.status === 404) {
    return (
      <AppShell crumb={crumb}>
        <EmptyState icon="Search" title={t("notFound.title")} body={t("notFound.body")} />
        <div style={{ textAlign: "center" }}>
          <Link href={`/multi-agent-review?repo=${repoId}`} style={{ color: "var(--accent-text)" }}>
            {t("notFound.cta")}
          </Link>
        </div>
      </AppShell>
    );
  }

  if (!run) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen title={t("loadError")} body={error?.message} onRetry={() => void refetch()} />
      </AppShell>
    );
  }

  const prTitle = pulls?.find((p) => p.id === run.pr_id)?.title ?? null;
  const columns = run.columns;
  const activeColumn = columns.find((c) => c.run_id === selectedAgent) ?? columns[0] ?? null;
  const recordsFor = (runId: string) =>
    reviews ? reviews.filter((r) => r.run_id === runId).flatMap((r) => r.findings) : undefined;

  const openTrace = (runId: string, tab: DrawerTab) => setSelection({ runId, tab });
  const drawerColumn = selection ? columns.find((c) => c.run_id === selection.runId) : undefined;

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 1400, margin: "0 auto" }}>
        <ResultsHeader run={run} repoId={repoId} prTitle={prTitle} view={view} onViewChange={setView} />
        <StatusAnnouncer columns={columns} runStatus={run.status} />

        {view === "columns" ? (
          <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
            {columns.map((c) => (
              <AgentColumn key={c.run_id} column={c} elapsedMs={elapsedMs} onOpenTrace={openTrace} />
            ))}
          </div>
        ) : (
          activeColumn && (
            <div>
              <AgentTabs
                columns={columns}
                selectedRunId={activeColumn.run_id}
                onSelect={setSelectedAgent}
                idPrefix="agent"
              />
              <div
                role="tabpanel"
                id="agent-panel"
                aria-labelledby={`agent-tab-${activeColumn.run_id}`}
              >
                <AgentDetail
                  column={activeColumn}
                  findings={recordsFor(activeColumn.run_id)}
                  elapsedMs={elapsedMs}
                  pendingFindingId={
                    findingAction.isPending ? (findingAction.variables?.findingId ?? null) : null
                  }
                  onOpenTrace={openTrace}
                  onFindingAction={(findingId, action, reply) =>
                    findingAction.mutate({ findingId, action, reply, prId: run.pr_id })
                  }
                />
              </div>
            </div>
          )
        )}

        <DisagreementBlock
          columns={columns}
          conflicts={run.conflicts}
          onlyConflicts={onlyConflicts}
          onOnlyConflictsChange={setOnlyConflicts}
        />
      </div>

      {selection && drawerColumn && (
        <RunTraceDrawer
          key={`${selection.runId}:${selection.tab}`}
          runId={selection.runId}
          agentName={drawerColumn.agent_name}
          prNumber={run.pr_number ?? null}
          findings={recordsFor(selection.runId)}
          running={drawerColumn.status === "running"}
          initialTab={selection.tab}
          onClose={() => setSelection(null)}
        />
      )}
    </AppShell>
  );
}

export default function MultiAgentResultsPage() {
  return (
    <React.Suspense fallback={null}>
      <ResultsPage />
    </React.Suspense>
  );
}
