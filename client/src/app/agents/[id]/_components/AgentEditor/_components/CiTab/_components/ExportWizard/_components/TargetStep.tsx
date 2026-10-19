import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { CiPreview, CiTargetOption, Repo } from "@devdigest/shared";
import { s } from "../styles";

/** Step 1 — registry cards + repo select (AC-3, AC-4, AC-5). */
export function TargetStep({
  targets,
  repos,
  repo,
  onRepo,
  existing,
}: {
  targets: readonly CiTargetOption[];
  repos: readonly Repo[];
  repo: string;
  onRepo: (fullName: string) => void;
  existing: CiPreview["existing_installation"];
}) {
  const t = useTranslations("ci.exportWizard");
  return (
    <div style={s.body}>
      <div style={s.h3}>{t("targetHeading")}</div>
      {targets.map((tg) => (
        <div key={tg.target} style={{ ...s.card, ...s.cardActive }}>
          <div style={s.row}>
            <strong>{t(`targets.${tg.target}`)}</strong>
            <Badge color="var(--ok)">{t("recommended")}</Badge>
          </div>
          <div style={s.muted}>{t(`targets.${tg.target}Desc`)}</div>
        </div>
      ))}
      <div>
        <label htmlFor="ci-wizard-repo" style={s.label}>
          {t("repoSelectLabel")}
        </label>
        <select id="ci-wizard-repo" style={s.select} value={repo} onChange={(e) => onRepo(e.target.value)}>
          <option value="">{t("repoSelectPlaceholder")}</option>
          {repos.map((r) => (
            <option key={r.id} value={r.full_name}>
              {r.full_name}
            </option>
          ))}
        </select>
        {repos.length === 0 && <div style={s.muted}>{t("noRepos")}</div>}
      </div>
      {existing && (
        <div role="note" style={s.notice}>
          {t("existingNotice", { agent: existing.agent_name })}
        </div>
      )}
    </div>
  );
}
