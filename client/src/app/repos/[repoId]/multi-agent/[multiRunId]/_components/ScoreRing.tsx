"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore } from "@devdigest/ui";

/** Score ring with its numeric value as text; "—" when there is no score. */
export function ScoreRing({ score, size = 44 }: { score: number | null; size?: number }) {
  const t = useTranslations("multiAgentRun.column");
  if (score == null) {
    return (
      <div
        role="img"
        aria-label={t("noScore")}
        className="tnum"
        style={{
          width: size,
          height: size,
          borderRadius: 99,
          border: "4px solid var(--bg-hover)",
          display: "grid",
          placeItems: "center",
          color: "var(--text-muted)",
          flexShrink: 0,
        }}
      >
        —
      </div>
    );
  }
  return (
    <div role="img" aria-label={t("score", { score })}>
      <CircularScore score={score} size={size} />
    </div>
  );
}
