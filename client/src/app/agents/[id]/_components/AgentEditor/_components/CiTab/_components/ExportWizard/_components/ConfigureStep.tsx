import { useTranslations } from "next-intl";
import { Badge, Checkbox } from "@devdigest/ui";
import type { CiPostAs, CiSecretStatus, CiTrigger } from "@devdigest/shared";
import { ALL_TRIGGERS, POST_AS_OPTIONS } from "../helpers";
import { s } from "../styles";

/** Step 3 — triggers, post-as, secrets (AC-11..AC-14). */
export function ConfigureStep({
  triggers,
  onTrigger,
  postAs,
  onPostAs,
  secrets,
  resetNotice,
}: {
  triggers: readonly CiTrigger[];
  onTrigger: (t: CiTrigger) => void;
  postAs: CiPostAs;
  onPostAs: (p: CiPostAs) => void;
  secrets: readonly CiSecretStatus[];
  resetNotice: boolean;
}) {
  const t = useTranslations("ci.exportWizard");
  return (
    <div style={s.body}>
      <div style={s.h3}>{t("triggersHeading")}</div>
      {ALL_TRIGGERS.map((tr) => (
        <Checkbox key={tr} checked={triggers.includes(tr)} onChange={() => onTrigger(tr)} label={t(`triggers.${tr}`)} />
      ))}
      {triggers.length === 0 && <div role="alert" style={s.error}>{t("triggersRequired")}</div>}
      <div style={s.h3} id="ci-post-as">{t("postResultsLabel")}</div>
      <div role="radiogroup" aria-labelledby="ci-post-as" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {POST_AS_OPTIONS.map((o) => (
          <label key={o.value} style={s.row}>
            <input type="radio" name="ci-post-as" checked={postAs === o.value} onChange={() => onPostAs(o.value)} />
            <span>{t(`postAs.${o.key}`)}</span>
            {o.value === "github_review" && <Badge color="var(--ok)">{t("recommended")}</Badge>}
          </label>
        ))}
      </div>
      {resetNotice && <div role="status" style={s.notice}>{t("editsReset")}</div>}
      <div style={s.h3}>{t("secretsHeading")}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {secrets.map((sec) => (
          <li key={sec.name} style={s.row}>
            <span className="mono">{sec.name}</span>
            <Badge>{t(`secretStatus.${sec.status}`)}</Badge>
          </li>
        ))}
      </ul>
      <div style={s.muted}>{t("mergeHint")}</div>
    </div>
  );
}
