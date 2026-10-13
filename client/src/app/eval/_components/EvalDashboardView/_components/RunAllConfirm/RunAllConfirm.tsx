"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";

/** Confirmation for run-all. Starts nothing itself — `onConfirm` is the only trigger. */
export function RunAllConfirm({
  agents,
  executions,
  pending,
  onConfirm,
  onCancel,
}: {
  agents: number;
  executions: number;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("eval");
  return (
    <Modal
      width={460}
      title={t("dashboard.runAllAgents")}
      onClose={onCancel}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button kind="ghost" size="sm" onClick={onCancel}>
            {t("modal.cancel")}
          </Button>
          <Button kind="primary" size="sm" disabled={pending} onClick={onConfirm}>
            {pending ? t("dashboard.running") : t("dashboard.runAllAgents")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: "20px 24px", fontSize: 14 }}>
        {t("dashboard.runAllAgentsConfirm", { agents, executions })}
      </div>
    </Modal>
  );
}
