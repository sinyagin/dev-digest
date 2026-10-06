/* DocumentList — every discovered Markdown document in the repo's working
   tree, one selectable row per document. Each row shows its bucket, size,
   token estimate, "used by N agents" count, and last-updated time (AC-8,
   AC-11). Purely presentational: selection state and data fetching live in
   the parent page. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { ContextDocument } from "@devdigest/shared";
import { bytesToKb, formatUpdatedAt } from "../../helpers";
import { s } from "../../styles";

export function DocumentList({
  documents,
  selectedPath,
  onSelect,
}: {
  documents: ContextDocument[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const t = useTranslations("context");

  return (
    <div style={s.listPanel}>
      <ul style={{ ...s.list, listStyle: "none", margin: 0, padding: 0 }}>
        {documents.map((doc) => {
          const selected = doc.path === selectedPath;
          return (
            <li key={doc.path}>
              <button
                type="button"
                onClick={() => onSelect(doc.path)}
                aria-current={selected ? "true" : undefined}
                style={s.row(selected)}
              >
                <Icon.FileText size={14} style={s.rowIcon} />
                <span style={s.rowBody}>
                  <span className="mono" style={s.rowPath}>
                    {doc.path}
                  </span>
                  <span style={s.rowMeta}>
                    <span style={s.bucketTag}>{t("bucketTag", { bucket: doc.bucket })}</span>
                    <span>{t("kb", { kb: bytesToKb(doc.size_bytes) })}</span>
                    <span>{t("tokens", { count: doc.estimated_tokens })}</span>
                    <span>{t("usedByAgents", { count: doc.used_by_agents })}</span>
                    <span>{formatUpdatedAt(doc.updated_at)}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
