import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { s } from "../styles";

/** Step 2 — file list + contents; only the workflow is editable (AC-6, AC-7, AC-10). */
export function PreviewStep({
  files,
  loading,
  error,
  selected,
  onSelect,
  text,
  textLoading,
  textError,
  onEdit,
  yamlError,
}: {
  files: readonly CiFile[];
  loading: boolean;
  error: boolean;
  selected: CiFile | null;
  onSelect: (path: string) => void;
  /** Current contents of the selected file (null while not loaded). */
  text: string | null;
  textLoading: boolean;
  textError: boolean;
  onEdit: (v: string) => void;
  yamlError: string | null;
}) {
  const t = useTranslations("ci.exportWizard");
  if (loading) return <div style={s.body}>{t("generating")}</div>;
  if (error) return <div style={s.body} role="alert"><span style={s.error}>{t("previewFailed")}</span></div>;
  return (
    <div style={s.body}>
      <div style={s.h3}>{t("filesHeading")}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              style={{ ...s.fileBtn, ...(selected?.path === f.path ? s.fileBtnActive : {}) }}
              aria-pressed={selected?.path === f.path}
              onClick={() => onSelect(f.path)}
            >
              <span className="mono">{f.path}</span>
              {f.editable && <Badge>{t("editable")}</Badge>}
              <span style={{ ...s.muted, marginLeft: "auto" }}>{t("sizeBytes", { size: f.size_bytes })}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div>
          <div className="mono" style={s.label}>
            {selected.path}
          </div>
          {textLoading && <div style={s.muted}>{t("loadingFile")}</div>}
          {textError && <div role="alert" style={s.error}>{t("fileLoadFailed")}</div>}
          {text !== null && (
            <textarea
              aria-label={selected.editable ? t("workflowEditLabel") : t("fileContentsLabel", { path: selected.path })}
              aria-invalid={selected.editable && yamlError !== null}
              style={s.code}
              value={text}
              readOnly={!selected.editable}
              onChange={(e) => onEdit(e.target.value)}
            />
          )}
          {selected.editable && yamlError && (
            <div role="alert" style={s.error}>
              {t("yamlError", { message: yamlError })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
