"use client";

import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { useEvalRunEstimate } from "@/lib/hooks/eval";
import { fmtCost } from "@/lib/eval-format";
import { s } from "./styles";

/** Mounted only while open, so the estimate is fetched on demand (D11), never on tab open. */
export function RunAllConfirm({
  agentId,
  starting,
  onConfirm,
  onClose,
}: {
  agentId: string;
  starting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("eval.evalsTab");
  const tm = useTranslations("eval.modal");
  const { data, isLoading } = useEvalRunEstimate(agentId, true);
  return (
    <Modal
      width={440}
      title={t("runAll")}
      onClose={onClose}
      footer={
        <div style={s.foot}>
          <Button kind="ghost" onClick={onClose}>
            {tm("cancel")}
          </Button>
          <Button kind="primary" icon="Play" loading={starting} disabled={!data || starting} onClick={onConfirm}>
            {t("runAll")}
          </Button>
        </div>
      }
    >
      <p style={s.body}>
        {isLoading || !data
          ? t("loadingEstimate")
          : t("runAllConfirm", { cases: data.cases, cost: fmtCost(data.est_cost_usd) })}
      </p>
    </Modal>
  );
}
