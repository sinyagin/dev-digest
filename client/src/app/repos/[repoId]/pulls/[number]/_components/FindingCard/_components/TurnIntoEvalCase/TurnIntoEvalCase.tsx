/* TurnIntoEvalCase — mounted only after the "Turn into eval case" click so the
   query hooks never run for cards that are never opened. Writes nothing itself;
   persistence happens only on the modal's Save. */
"use client";

import { useTranslations } from "next-intl";
import type { EvalCaseDraft, EvalCaseInput } from "@devdigest/shared";
import { EvalCaseModal } from "@/components/eval/EvalCaseModal";
import { useEvalCase, useEvalCaseDraft } from "@/lib/hooks/eval";
import { evalErrorMessage } from "@/lib/eval-errors";
import { s } from "../../styles";

function toInput(d: EvalCaseDraft): EvalCaseInput {
  const { agent: _agent, source_triage: _triage, existing_case_id: _existing, ...input } = d;
  return input;
}

function ExistingCase({ draft, caseId, onClose }: { draft: EvalCaseDraft; caseId: string; onClose: () => void }) {
  const te = useTranslations("eval.modal");
  const tErr = useTranslations("eval.modal.errors");
  const existing = useEvalCase(caseId);
  if (existing.isError) return <p role="alert" style={s.evalHint}>{evalErrorMessage(existing.error, tErr)}</p>;
  if (!existing.data) return <p role="status" style={s.evalHint}>{te("loadingDraft")}</p>;
  const { id, name, input_diff, input_files, input_meta, expectation, source_finding_id, notes } = existing.data;
  const initial: EvalCaseInput = { name, input_diff, input_files, input_meta, expectation, source_finding_id, notes };
  return (
    <EvalCaseModal
      agentId={draft.agent.id}
      agentName={draft.agent.name}
      mode="edit"
      caseId={id}
      initial={initial}
      onClose={onClose}
    />
  );
}

export function TurnIntoEvalCase({ findingId, onClose }: { findingId: string; onClose: () => void }) {
  const te = useTranslations("eval.modal");
  const tErr = useTranslations("eval.modal.errors");
  const draft = useEvalCaseDraft(findingId, true);

  if (draft.isError) {
    return (
      <p role="alert" style={s.evalHint}>
        {evalErrorMessage(draft.error, tErr)}
      </p>
    );
  }
  if (!draft.data) return <p role="status" style={s.evalHint}>{te("loadingDraft")}</p>;

  const d = draft.data;
  if (d.existing_case_id) return <ExistingCase draft={d} caseId={d.existing_case_id} onClose={onClose} />;
  return (
    <EvalCaseModal
      agentId={d.agent.id}
      agentName={d.agent.name}
      mode="draft"
      initial={toInput(d)}
      onClose={onClose}
    />
  );
}
