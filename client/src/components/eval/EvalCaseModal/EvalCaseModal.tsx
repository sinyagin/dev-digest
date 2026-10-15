"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Checkbox,
  FormField,
  Modal,
  Textarea,
  TextInput,
} from "@devdigest/ui";
import type { EvalCase, EvalCaseInput } from "@devdigest/shared";
import { evalErrorMessage } from "@/lib/eval-errors";
import {
  useCreateEvalCase,
  useEvalDryRun,
  useUpdateEvalCase,
} from "@/lib/hooks/eval";
import { EXPECTATION_SKELETON } from "./constants";
import {
  buildInput,
  checkExpectation,
  toFormState,
  type FormState,
} from "./helpers";
import { InputTabs } from "./_components/InputTabs";
import { ExpectationEditor } from "./_components/ExpectationEditor";
import { DryRunResult } from "./_components/DryRunResult";
import * as s from "./styles";

export interface EvalCaseModalProps {
  agentId: string;
  agentName: string;
  mode: "new" | "draft" | "edit";
  initial: EvalCaseInput;
  /** Required for mode "edit". */
  caseId?: string;
  onClose: () => void;
  /** Called with the persisted case after a successful Save, before onClose. */
  onSaved?: (saved: EvalCase) => void;
}

/**
 * Persists nothing until Save. "Run case" is a dry run; Cancel / Escape / close discard.
 */
export function EvalCaseModal({
  agentId,
  agentName,
  mode,
  initial,
  caseId,
  onClose,
  onSaved,
}: EvalCaseModalProps) {
  const t = useTranslations("eval.modal");
  const tc = useTranslations("eval.caseEditor");
  const te = useTranslations("eval.modal.errors");
  const [form, setForm] = useState<FormState>(() => toFormState(initial));
  const [runOnSave, setRunOnSave] = useState(false);
  const create = useCreateEvalCase(agentId);
  const update = useUpdateEvalCase(agentId);
  const dryRun = useEvalDryRun(agentId);

  const initialJson = useMemo(
    () => JSON.stringify(buildInput(toFormState(initial), initial)),
    [initial],
  );
  const check = checkExpectation(form.expectationText);
  const input = buildInput(form, initial);
  const valid = input !== null;
  const dirty = JSON.stringify(input) !== initialJson;
  const saving = create.isPending || update.isPending;

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const onRun = () => {
    if (!input) return;
    if (mode === "edit" && caseId && !dirty) dryRun.mutate({ case_id: caseId });
    else dryRun.mutate({ draft: input });
  };

  const onSave = async () => {
    if (!input || saving) return;
    try {
      const saved =
        mode === "edit" && caseId
          ? await update.mutateAsync({ id: caseId, input })
          : await create.mutateAsync(input);
      if (runOnSave && mode !== "edit") dryRun.mutate({ case_id: saved.id });
      onSaved?.(saved);
      onClose();
    } catch {
      // surfaced inline via mutation error state
    }
  };

  const saveError = create.error ?? update.error;
  const title =
    mode === "edit"
      ? tc("caseTitle", { name: initial.name })
      : mode === "new"
        ? tc("newCase")
        : t("header", { agent: agentName });

  const announce = dryRun.data
    ? dryRun.data.status === "errored"
      ? t("result.fail")
      : dryRun.data.pass
        ? t("result.pass")
        : t("result.fail")
    : "";

  return (
    <Modal
      width={1120}
      title={title}
      subtitle={agentName}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {mode !== "edit" && (
            <Checkbox
              checked={runOnSave}
              onChange={setRunOnSave}
              label={t("runOnSave")}
            />
          )}
          <div style={s.spacer} />
          <Button kind="ghost" type="button" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            kind="secondary"
            type="button"
            disabled={!valid}
            loading={dryRun.isPending}
            onClick={onRun}
          >
            {dryRun.isPending ? t("running") : t("runCase")}
          </Button>
          <Button
            kind="primary"
            type="button"
            disabled={!valid}
            loading={saving}
            onClick={() => void onSave()}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {/* Two columns (stack when narrow): the frozen input on the left, the
            expectation + dry-run result on the right, so the expected output is
            visible without scrolling past a long diff. */}
        <div style={s.column}>
          <FormField label={tc("nameLabel")} required>
            <TextInput
              value={form.name}
              placeholder={tc("namePlaceholder")}
              onChange={(v) => patch({ name: v })}
              aria-label={tc("nameLabel")}
            />
          </FormField>
          <FormField label={t("notes")}>
            <Textarea
              rows={3}
              value={form.notes}
              placeholder={t("notesPlaceholder")}
              onChange={(v) => patch({ notes: v })}
            />
          </FormField>
          <InputTabs value={form} onChange={patch} />
        </div>
        <div style={s.column}>
          <ExpectationEditor
            value={form.expectationText}
            check={check}
            onChange={(v) => patch({ expectationText: v })}
            onInsertSkeleton={() =>
              patch({
                expectationText: JSON.stringify(EXPECTATION_SKELETON, null, 2),
              })
            }
          />
          {dryRun.data && <DryRunResult result={dryRun.data} />}
          {dryRun.isError && (
            <p style={s.errorText} role="alert">
              {evalErrorMessage(dryRun.error, te)}
            </p>
          )}
          {saveError && (
            <p style={s.errorText} role="alert">
              {evalErrorMessage(saveError, te)}
            </p>
          )}
        </div>
        <div aria-live="polite" role="status" style={s.srOnly}>
          {announce}
        </div>
      </div>
    </Modal>
  );
}
