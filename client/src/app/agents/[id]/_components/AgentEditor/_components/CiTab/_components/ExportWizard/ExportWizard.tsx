/* ExportWizard — Target → Preview → Configure → Install (SPEC-04 AC-1..AC-20).
   All wizard state lives here so Back preserves every choice (AC-2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { CiFile, CiPostAs, CiPreview, CiTrigger } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useRepos } from "@/lib/hooks/core";
import {
  useCiExport,
  useCiExportZip,
  useCiPreview,
  useCiPreviewFile,
  useCiTargets,
} from "@/lib/hooks/ci";
import { DEFAULT_TRIGGERS, STEPS, downloadBlob, toInput, toggleTrigger, yamlError, type WizardConfig } from "./helpers";
import { TargetStep } from "./_components/TargetStep";
import { PreviewStep } from "./_components/PreviewStep";
import { ConfigureStep } from "./_components/ConfigureStep";
import { InstallStep, type InstallMode } from "./_components/InstallStep";
import { s } from "./styles";

const KNOWN_ERRORS = new Set([
  "no_token",
  "forbidden",
  "missing_workflow_scope",
  "not_found",
  "upstream_unavailable",
  "runner_bundle_missing",
]);

export function ExportWizard({
  agent,
  defaultRepo,
  onClose,
}: {
  agent: { id: string; name: string };
  /** `owner/name` of the active repo, pre-selected (AC-4). */
  defaultRepo: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("ci.exportWizard");
  const { data: repos = [] } = useRepos();
  const { data: targets = [] } = useCiTargets();
  const previewM = useCiPreview(agent.id);
  const fileM = useCiPreviewFile(agent.id);
  const exportM = useCiExport(agent.id);
  const zipM = useCiExportZip(agent.id);

  const [step, setStep] = React.useState(0);
  const [repo, setRepo] = React.useState(defaultRepo ?? "");
  const [triggers, setTriggers] = React.useState<CiTrigger[]>([...DEFAULT_TRIGGERS]);
  const [postAs, setPostAs] = React.useState<CiPostAs>("github_review");
  const [override, setOverride] = React.useState<string | null>(null);
  const [resetNotice, setResetNotice] = React.useState(false);
  const [preview, setPreview] = React.useState<CiPreview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState(false);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState<Record<string, string>>({});
  const [fileLoading, setFileLoading] = React.useState(false);
  const [fileError, setFileError] = React.useState(false);
  const [mode, setMode] = React.useState<InstallMode>("pr");
  const [done, setDone] = React.useState<InstallMode | null>(null);
  const [prUrl, setPrUrl] = React.useState<string | null>(null);
  const [installError, setInstallError] = React.useState<string | null>(null);
  const reqRef = React.useRef(0);
  const busyRef = React.useRef(false);
  const [busy, setBusy] = React.useState(false);

  const cfg: WizardConfig = { repo, triggers, postAs };

  const loadPreview = React.useCallback(
    async (next: WizardConfig) => {
      if (!next.repo) return;
      const id = ++reqRef.current;
      setPreviewLoading(true);
      setPreviewError(false);
      try {
        const p = await previewM.mutateAsync(toInput(next));
        if (id !== reqRef.current) return;
        setPreview(p);
        setSelectedPath((cur) => cur ?? p.files.find((f) => f.editable)?.path ?? p.files[0]?.path ?? null);
      } catch {
        if (id === reqRef.current) setPreviewError(true);
      } finally {
        if (id === reqRef.current) setPreviewLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewM.mutateAsync],
  );

  // Initial load for the pre-selected repo (also surfaces the AC-5 notice).
  React.useEffect(() => {
    if (defaultRepo) void loadPreview({ repo: defaultRepo, triggers: [...DEFAULT_TRIGGERS], postAs: "github_review" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeRepo = (next: string) => {
    setRepo(next);
    setOverride(null);
    setLoaded({});
    setSelectedPath(null);
    setPreview(null);
    void loadPreview({ ...cfg, repo: next });
  };

  /** AC-12: any Configure change regenerates the workflow; edits are reset with a notice. */
  const changeConfig = (next: WizardConfig) => {
    setTriggers(next.triggers);
    setPostAs(next.postAs);
    if (override !== null) {
      setOverride(null);
      setResetNotice(true);
    }
    void loadPreview(next);
  };

  const files = preview?.files ?? [];
  const selected: CiFile | null = files.find((f) => f.path === selectedPath) ?? null;
  const workflow = files.find((f) => f.editable) ?? null;
  const workflowText = override ?? workflow?.contents ?? "";
  const wfError = workflow ? yamlError(workflowText) : null;

  const selectFile = async (path: string) => {
    setSelectedPath(path);
    setFileError(false);
    const f = files.find((x) => x.path === path);
    if (!f || f.contents !== null || loaded[path] !== undefined) return;
    setFileLoading(true);
    try {
      const full = await fileM.mutateAsync({ ...toInput(cfg), path });
      setLoaded((m) => ({ ...m, [path]: full.contents ?? "" }));
    } catch {
      setFileError(true);
    } finally {
      setFileLoading(false);
    }
  };

  let text: string | null = null;
  if (selected) {
    text = selected.editable ? workflowText : (selected.contents ?? loaded[selected.path] ?? null);
  }

  const errorMessage = (e: unknown): string => {
    if (e instanceof ApiError && e.code && KNOWN_ERRORS.has(e.code)) return t(`errors.${e.code}`);
    return t("errors.generic", { message: e instanceof Error ? e.message : String(e) });
  };

  const install = async (m: InstallMode) => {
    if (busyRef.current) return; // double-click guard: exactly one request (AC-20)
    busyRef.current = true;
    setBusy(true);
    setInstallError(null);
    setDone(null);
    try {
      const extra = override !== null ? { workflow_override: override } : {};
      if (m === "pr") {
        const res = await exportM.mutateAsync(toInput(cfg, { action: "open_pr", ...extra }));
        setPrUrl(res.pr_url);
      } else {
        const blob = await zipM.mutateAsync(toInput(cfg, { action: "files", ...extra }));
        downloadBlob(blob, "devdigest-ci.zip");
      }
      setDone(m);
    } catch (e) {
      setInstallError(errorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const canContinue =
    step === 0
      ? repo !== ""
      : step === 1
        ? !!preview && !previewLoading && wfError === null
        : step === 2
          ? triggers.length > 0 && !previewLoading
          : false;

  const labels = STEPS.map((k) => t(`steps.${k}`));

  return (
    <Modal
      width={760}
      title={t("title")}
      subtitle={t("subtitle", { agentName: agent.name })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {step > 0 && (
            <Button kind="secondary" disabled={busy} onClick={() => setStep(step - 1)}>
              {t("back")}
            </Button>
          )}
          <span style={s.spacer} />
          {step < 3 ? (
            <Button kind="primary" disabled={!canContinue} onClick={() => setStep(step + 1)}>
              {t("continue")}
            </Button>
          ) : (
            <Button kind="secondary" onClick={onClose}>
              {t("close")}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.stepsWrap} data-testid="wizard-steps" data-current-step={labels[step]} aria-label={`${step + 1} / ${labels.length}`}>
        <ExportWizardSteps step={step} labels={labels} />
      </div>
      {step === 0 && (
        <TargetStep
          targets={targets}
          repos={repos}
          repo={repo}
          onRepo={changeRepo}
          existing={preview?.existing_installation ?? null}
        />
      )}
      {step === 1 && (
        <PreviewStep
          files={files}
          loading={previewLoading && !preview}
          error={previewError}
          selected={selected}
          onSelect={(p) => void selectFile(p)}
          text={text}
          textLoading={fileLoading}
          textError={fileError}
          onEdit={(v) => selected?.editable && setOverride(v)}
          yamlError={wfError}
        />
      )}
      {step === 2 && (
        <ConfigureStep
          triggers={triggers}
          onTrigger={(tr) => changeConfig({ ...cfg, triggers: toggleTrigger(triggers, tr) })}
          postAs={postAs}
          onPostAs={(p) => changeConfig({ ...cfg, postAs: p })}
          secrets={preview?.secrets ?? []}
          resetNotice={resetNotice}
        />
      )}
      {step === 3 && (
        <InstallStep
          repo={repo}
          fileCount={files.length}
          mode={mode}
          onMode={setMode}
          busy={busy}
          errorText={installError}
          done={done}
          prUrl={prUrl}
          onInstall={(m) => void install(m)}
        />
      )}
    </Modal>
  );
}
