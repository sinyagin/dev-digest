/* /ci-runs — CI Runs page (SPEC-04 AC-41..43). Client view owns data + state. */
"use client";

import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useCiRuns, useCiRefresh } from "../../../../lib/hooks/ci";
import { CiRunsTable } from "@/components/ci-runs-table";
import { s } from "./styles";

export function CiRunsView() {
  const t = useTranslations("ci");
  const { data, isLoading, isError, refetch } = useCiRuns();
  const refresh = useCiRefresh();
  const runs = data ?? [];
  const refreshErrors = refresh.data?.errors ?? [];

  const refreshBtn = (
    <Button kind="secondary" size="sm" icon="RefreshCw" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
      {refresh.isPending ? t("runs.refreshing") : t("runs.refresh")}
    </Button>
  );

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("runs.title")}</h1>
            <div style={s.sub}>{t("runs.subtitle")}</div>
          </div>
          {runs.length > 0 && refreshBtn}
        </div>
        {refresh.isError && <ErrorState body={t("runs.refreshError")} />}
        {refreshErrors.length > 0 && (
          <ul role="alert" style={s.note}>
            {refreshErrors.map((e) => (
              <li key={e.installation_id}>
                {e.repo}: {e.message}
              </li>
            ))}
          </ul>
        )}
        {isLoading && <Skeleton height={160} />}
        {isError && <ErrorState body={t("runs.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && runs.length === 0 && (
          <EmptyState
            icon="GitPullRequest"
            title={t("runs.emptyTitle")}
            body={t("runs.emptyBody")}
            cta={t("runs.refresh")}
            onCta={() => refresh.mutate()}
            ctaLoading={refresh.isPending}
          />
        )}
        {runs.length > 0 && <CiRunsTable runs={runs} />}
      </div>
    </AppShell>
  );
}
