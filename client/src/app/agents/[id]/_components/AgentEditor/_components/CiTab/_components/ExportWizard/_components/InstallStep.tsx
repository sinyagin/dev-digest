import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { safePrUrl } from "../helpers";
import { s } from "../styles";

export type InstallMode = "pr" | "zip";

/** Step 4 — PR or zip; typed errors stay here with zip still enabled (AC-15, AC-20). */
export function InstallStep({
  repo,
  fileCount,
  mode,
  onMode,
  busy,
  errorText,
  done,
  prUrl,
  onInstall,
}: {
  repo: string;
  fileCount: number;
  mode: InstallMode;
  onMode: (m: InstallMode) => void;
  busy: boolean;
  errorText: string | null;
  done: InstallMode | null;
  prUrl: string | null;
  onInstall: (m: InstallMode) => void;
}) {
  const t = useTranslations("ci.exportWizard");
  const link = safePrUrl(prUrl);
  return (
    <div style={s.body}>
      <label style={{ ...s.card, ...(mode === "pr" ? s.cardActive : {}) }}>
        <div style={s.row}>
          <input type="radio" name="ci-install-mode" checked={mode === "pr"} onChange={() => onMode("pr")} />
          <strong>{t("installPr")}</strong>
        </div>
        <div style={s.muted}>{t("installPrBody", { repo, count: fileCount })}</div>
      </label>
      <label style={{ ...s.card, ...(mode === "zip" ? s.cardActive : {}) }}>
        <div style={s.row}>
          <input type="radio" name="ci-install-mode" checked={mode === "zip"} onChange={() => onMode("zip")} />
          <strong>{t("installZip")}</strong>
        </div>
        <div style={s.muted}>{t("installZipBody", { repo })}</div>
      </label>
      {errorText && <div role="alert" style={s.error}>{errorText}</div>}
      {done && (
        <div role="status" style={s.notice}>
          <strong>{t("doneTitle")}</strong>{" "}
          {done === "zip" ? t("doneZip") : t("doneBody", { repo })}
          {done === "pr" && link && (
            <>
              {" "}
              <a href={link} target="_blank" rel="noopener noreferrer">
                {t("openPr")}
              </a>
            </>
          )}
        </div>
      )}
      <div>
        <Button kind="primary" disabled={busy} loading={busy} onClick={() => onInstall(mode)}>
          {busy ? t("installing") : mode === "pr" ? t("installPrAction") : t("installZipAction")}
        </Button>
      </div>
    </div>
  );
}
