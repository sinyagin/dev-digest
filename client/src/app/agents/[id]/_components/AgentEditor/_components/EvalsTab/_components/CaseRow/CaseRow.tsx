"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, Modal } from "@devdigest/ui";
import type { EvalCase } from "@devdigest/shared";
import { useDeleteEvalCase, useEvalDryRun } from "@/lib/hooks/eval";
import { evalErrorMessage } from "@/lib/eval-errors";
import { caseLocation, caseState, expectedCount, findTag } from "../../helpers";
import { s } from "./styles";

const STATE_ICON = { pass: "CheckCircle", fail: "XCircle", errored: "AlertTriangle", neverRun: "Clock" } as const;
const STATE_COLOR = {
  pass: "var(--success)",
  fail: "var(--crit)",
  errored: "var(--warn)",
  neverRun: "var(--text-muted)",
} as const;

export function CaseRow({ agentId, item, onEdit }: { agentId: string; item: EvalCase; onEdit: () => void }) {
  const t = useTranslations("eval.evalsTab");
  const tm = useTranslations("eval.modal");
  const te = useTranslations("eval.modal.errors");
  const dryRun = useEvalDryRun(agentId);
  const del = useDeleteEvalCase(agentId);
  const [confirming, setConfirming] = useState(false);
  const state = caseState(item);
  const Ico = Icon[STATE_ICON[state]];
  const last = item.last_result;
  const mustNotFlag = item.expectation.type === "must_not_flag";

  return (
    <li style={s.row}>
      <div style={s.main}>
        <div style={s.titleRow}>
          {/* Expectation type as an explicit badge (text, not colour alone). */}
          <Badge
            color={mustNotFlag ? "var(--warn)" : "var(--accent-text)"}
            bg={mustNotFlag ? "var(--warn-bg)" : "var(--accent-bg)"}
          >
            {mustNotFlag ? t("expectType.mustNotFlag") : t("expectType.mustFind")}
          </Badge>
          {/* Case names are user input: rendered as text only. */}
          <span style={s.name}>{item.name}</span>
        </div>
        <span style={s.meta}>
          <span style={s.location}>{caseLocation(item)}</span>
          {!mustNotFlag && findTag(item) && ` · ${findTag(item)}`}
          {last && state !== "errored" &&
            ` · ${t("expectedGot", { expected: expectedCount(item), actual: last.findings_total })}`}
          {last && state === "errored" && ` · ${t("erroredReason", { reason: last.error_reason ?? "unknown" })}`}
        </span>
        {dryRun.isError && <span role="alert" style={s.error}>{evalErrorMessage(dryRun.error, te)}</span>}
      </div>
      <span style={{ ...s.state, color: STATE_COLOR[state] }}>
        <Ico size={14} />
        {t(`state.${state}`)}
      </span>
      <div style={s.actions}>
        <Button
          size="sm"
          icon="Play"
          loading={dryRun.isPending}
          onClick={() => dryRun.mutate({ case_id: item.id })}
          aria-label={`${t("run")}: ${item.name}`}
        >
          {t("run")}
        </Button>
        <Button size="sm" icon="Edit" onClick={onEdit} aria-label={`${t("edit")}: ${item.name}`}>
          {t("edit")}
        </Button>
        <Button size="sm" icon="Trash" onClick={() => setConfirming(true)} aria-label={`${t("delete")}: ${item.name}`}>
          {t("delete")}
        </Button>
      </div>
      {confirming && (
        <Modal
          width={420}
          title={t("delete")}
          onClose={() => setConfirming(false)}
          footer={
            <div style={s.confirmFoot}>
              <Button kind="ghost" onClick={() => setConfirming(false)}>
                {tm("cancel")}
              </Button>
              <Button
                kind="danger"
                loading={del.isPending}
                onClick={() => del.mutate(item.id, { onSettled: () => setConfirming(false) })}
              >
                {t("delete")}
              </Button>
            </div>
          }
        >
          <p style={s.confirmBody}>{t("deleteConfirm")}</p>
        </Modal>
      )}
    </li>
  );
}
