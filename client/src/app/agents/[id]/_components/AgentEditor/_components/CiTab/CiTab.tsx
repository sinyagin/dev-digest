/* CiTab — CI deployment: installations, Fail CI on, run history (SPEC-04 AC-44..AC-48). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, FormField, SelectInput } from "@devdigest/ui";
import type { Agent, CiFailOn, CiRepublishResult } from "@devdigest/shared";
import { useActiveRepo } from "../../../../../../../lib/repo-context";
import { useUpdateAgent } from "../../../../../../../lib/hooks/agents";
import { useCiInstallations, useCiRepublish, useCiRuns } from "../../../../../../../lib/hooks/ci";
import { CiRunsTable, statusKey } from "@/components/ci-runs-table";
import { ExportWizard } from "./_components/ExportWizard";
import { s } from "./styles";

const FAIL_ON_VALUES: readonly CiFailOn[] = ["never", "critical", "warning"];

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const { activeRepo } = useActiveRepo();
  const { data: installs = [], isError, refetch } = useCiInstallations(agent.id);
  const { data: runs = [] } = useCiRuns(agent.id);
  const republish = useCiRepublish(agent.id);
  const update = useUpdateAgent();
  const [wizard, setWizard] = React.useState(false);
  const [results, setResults] = React.useState<CiRepublishResult["results"] | null>(null);

  // A stored `any` is shown as its own option (AC-47).
  const failOnValues: readonly CiFailOn[] = agent.ci_fail_on === "any" ? [...FAIL_ON_VALUES, "any"] : FAIL_ON_VALUES;
  const failOnOptions = failOnValues.map((v) => ({ value: v, label: t(`ciTab.failOn.${v}`) }));

  const onRepublish = () =>
    republish.mutate(undefined, { onSuccess: (r) => setResults(r.results) });

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.headerText}>
          <div style={s.h2}>{t("ciTab.heading")}</div>
          <div style={s.sub}>{t("ciTab.subtitle")}</div>
        </div>
        <Badge>{t("ciTab.activeIn", { count: installs.length })}</Badge>
        <Button kind="secondary" disabled={installs.length === 0 || republish.isPending} onClick={onRepublish}>
          {republish.isPending ? t("ciTab.updating") : t("ciTab.updateConfig")}
        </Button>
        <Button kind="primary" icon="Plus" onClick={() => setWizard(true)}>
          {t("ciTab.addToCi")}
        </Button>
      </div>

      {isError && <ErrorState body={t("ciTab.loadError")} onRetry={() => refetch()} />}
      {!isError && installs.length === 0 && <div style={s.sub}>{t("ciTab.empty")}</div>}

      <ul style={s.list} aria-label={t("ciTab.heading")}>
        {installs.map((i) => {
          const sk = statusKey(i.last_run?.status);
          return (
            <li key={i.id} style={s.item}>
              <div style={s.itemMain}>
                <div className="mono">{i.repo}</div>
                <div style={s.muted}>
                  {t(`exportWizard.targets.${i.target_type}`)} ·{" "}
                  {t("ciTab.versions", { workflow: i.workflow_version, agent: i.exported_agent_version })}
                </div>
                <div style={s.muted}>
                  {i.last_run
                    ? t("ciTab.lastRun", {
                        status: sk ? t(`runs.status.${sk}`) : (i.last_run.status ?? "—"),
                        time: i.last_run.ran_at ? new Date(i.last_run.ran_at).toLocaleString() : "—",
                      })
                    : t("ciTab.noRuns")}
                </div>
              </div>
              {i.out_of_date && <Badge color="var(--warn, #b7791f)">{t("ciTab.outOfDate")}</Badge>}
            </li>
          );
        })}
        <li>
          <button type="button" style={s.addRow} onClick={() => setWizard(true)}>
            + {t("ciTab.addRepository")}
          </button>
        </li>
      </ul>

      {results && (
        <div role="status">
          <div style={s.h3}>{t("ciTab.republishResults")}</div>
          <ul style={s.results}>
            {results.map((r) => (
              <li key={r.installation_id} style={r.ok ? undefined : s.error}>
                {r.ok
                  ? t("ciTab.republishOk", { repo: r.repo })
                  : t("ciTab.republishFailed", { repo: r.repo, message: r.error?.message ?? "" })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {republish.isError && <div role="alert" style={s.error}>{t("ciTab.loadError")}</div>}

      <div style={s.failOn}>
        <FormField label={t("ciTab.failOnLabel")} hint={t("ciTab.failOnHint")}>
          <SelectInput
            mono={false}
            value={agent.ci_fail_on}
            options={failOnOptions}
            onChange={(v) => update.mutate({ id: agent.id, patch: { ci_fail_on: v as CiFailOn } })}
          />
        </FormField>
      </div>

      <div>
        <div style={s.h3}>{t("runs.historyTitle")}</div>
        {runs.length === 0 ? (
          <div style={s.sub}>{t("runs.historyEmpty")}</div>
        ) : (
          <CiRunsTable runs={runs} showAgent={false} />
        )}
      </div>

      {wizard && (
        <ExportWizard
          agent={{ id: agent.id, name: agent.name }}
          defaultRepo={activeRepo?.full_name ?? null}
          onClose={() => setWizard(false)}
        />
      )}
    </div>
  );
}
