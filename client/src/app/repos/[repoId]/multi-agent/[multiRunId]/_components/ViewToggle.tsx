"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { ViewMode } from "../helpers";

/** Columns ⇄ Tabs switch (state lives in `?view=`). */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const t = useTranslations("multiAgentRun.view");
  return (
    <div role="group" aria-label={t("label")} style={{ display: "inline-flex", gap: 4 }}>
      {(["columns", "tabs"] as const).map((v) => (
        <Button
          key={v}
          kind={value === v ? "primary" : "secondary"}
          size="sm"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {t(v)}
        </Button>
      ))}
    </div>
  );
}
