/* UnanchoredFindings — footer list for findings whose cited line isn't among
   the currently rendered diff lines (the diff moved on since the review ran).
   Mirrors OutdatedComments so nothing is silently dropped. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { cs } from "../comments";
import type { DiffFindingApi } from "../findings";

export function UnanchoredFindings({
  findings,
  findingApi,
}: {
  findings: FindingRecord[];
  findingApi: DiffFindingApi;
}) {
  const t = useTranslations("shell");
  if (findings.length === 0) return null;
  return (
    <div style={cs.outdatedWrap}>
      <span style={cs.outdatedTitle}>
        {t("diffViewer.unanchoredFindingsTitle", { count: findings.length })}
      </span>
      {findings.map((f) => (
        <div key={f.id}>
          {findingApi.renderCard(f, {
            pending: findingApi.pending,
            onAction: (a) => findingApi.onAction(f.id, a),
          })}
        </div>
      ))}
    </div>
  );
}
