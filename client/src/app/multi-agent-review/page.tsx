/* Multi-Agent Review (global) — /multi-agent-review. Lands on the selected
   repo's recent multi-agent runs (latest highlighted, each linking to
   /repos/:repoId/multi-agent/:multiRunId) with a "New multi-agent review"
   action. Configure run (pick a PR + 2-8 agents, fan out) shows instead when
   ?new=1 or ?pr= is set, or when the repo has no runs yet. ?repo= / ?pr=
   pre-select. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { useRepos } from "@/lib/hooks/core";
import { useMultiAgentRuns } from "@/lib/hooks/multi-agent";
import { useActiveRepo } from "@/lib/repo-context";
import { ConfigureRun } from "./_components/ConfigureRun";
import { RecentRuns } from "./_components/RecentRuns";
import { s } from "./styles";

const BASE = "/multi-agent-review";
const repoUrl = (repoId: string, extra = "") => `${BASE}?repo=${encodeURIComponent(repoId)}${extra}`;

export default function GlobalConfigureRunPage() {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const search = useSearchParams();
  const { data: repos, isLoading } = useRepos();
  const { activeRepo } = useActiveRepo();

  const list = repos ?? [];
  const repoParam = search.get("repo");
  // Order: valid ?repo= > active repo > first repo.
  const repoId =
    list.find((r) => r.id === repoParam)?.id ?? list.find((r) => r.id === activeRepo?.id)?.id ?? list[0]?.id ?? null;

  const { data: runsData, isLoading: runsLoading } = useMultiAgentRuns({ repoId });
  const runs = runsData ?? [];
  const prParam = search.get("pr");
  const configureRequested = !!prParam || search.get("new") === "1";
  // No runs yet (or the list failed to load) → straight to Configure run.
  const showHistory = !configureRequested && runs.length > 0;

  const crumb = [{ label: t("crumb.global") }, { label: t("crumb.multiAgent") }];

  const repoPicker = (
    <select
      aria-label={t("step1.repoSelect")}
      style={s.select}
      value={repoId ?? ""}
      // Stay in the current view; a repo switch drops ?pr= (it belongs to the old repo).
      onChange={(e) => router.replace(repoUrl(e.target.value, configureRequested ? "&new=1" : ""))}
    >
      {list.map((r) => (
        <option key={r.id} value={r.id}>
          {r.full_name}
        </option>
      ))}
    </select>
  );

  const body = () => {
    if (isLoading) return <p style={{ ...s.muted, padding: "28px 32px" }}>{t("step1.loadingRepos")}</p>;
    if (repoId === null) return <p style={{ ...s.muted, padding: "28px 32px" }}>{t("step1.noRepos")}</p>;
    if (!configureRequested && runsLoading)
      return <p style={{ ...s.muted, padding: "28px 32px" }}>{t("recent.loading")}</p>;
    if (showHistory)
      // push (not replace): browser Back from Configure run returns to the list.
      return <RecentRuns runs={runs} repoPicker={repoPicker} onNew={() => router.push(repoUrl(repoId, "&new=1"))} />;
    return (
      // key = repo: switching repo remounts ConfigureRun, clearing PR + agent selection.
      <ConfigureRun
        key={repoId}
        repoId={repoId}
        prParam={prParam}
        repoPicker={repoPicker}
        back={
          runs.length > 0 ? (
            <Link href={repoUrl(repoId)} style={s.link}>
              {t("recent.back")}
            </Link>
          ) : null
        }
      />
    );
  };

  return <AppShell crumb={crumb}>{body()}</AppShell>;
}
