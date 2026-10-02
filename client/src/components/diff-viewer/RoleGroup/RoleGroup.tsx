/* RoleGroup — one collapsible Smart Diff role section (core/tests/wiring/
   docs/boilerplate): an accordion header (icon, label, description, file
   count, and a dot+count of files-with-findings) over its FileCards. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import type { SmartDiffGroup, SmartDiffRole } from "@devdigest/shared";
import type { DiffCommentApi } from "../comments";
import type { DiffFindingApi } from "../findings";
import { chevronFor } from "../styles";
import { FileCard } from "../FileCard";

/** docs/boilerplate start collapsed; core/tests/wiring start open. */
const DEFAULT_COLLAPSED: Record<SmartDiffRole, boolean> = {
  core: false,
  tests: false,
  wiring: false,
  docs: true,
  boilerplate: true,
};

const ROLE_ICON: Record<SmartDiffRole, keyof typeof Icon> = {
  core: "Code",
  tests: "FlaskConical",
  wiring: "Wrench",
  docs: "FileText",
  boilerplate: "Boxes",
};

const ROLE_LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "coreLabel",
  tests: "testsLabel",
  wiring: "wiringLabel",
  docs: "docsLabel",
  boilerplate: "boilerplateLabel",
};

const ROLE_DESC_KEY: Record<SmartDiffRole, string> = {
  core: "coreDesc",
  tests: "testsDesc",
  wiring: "wiringDesc",
  docs: "docsDesc",
  boilerplate: "boilerplateDesc",
};

export function RoleGroup({
  group,
  byPath,
  commenting,
  findingApi,
}: {
  group: SmartDiffGroup;
  byPath: Map<string, PrFile>;
  commenting?: DiffCommentApi;
  findingApi?: DiffFindingApi;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(!DEFAULT_COLLAPSED[group.role]);
  const filesWithFindings = group.files.filter((f) => f.finding_lines.length > 0).length;
  const RoleIcon = Icon[ROLE_ICON[group.role]];

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "10px 12px",
          background: "var(--bg-elevated)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          font: "inherit",
        }}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <RoleIcon size={14} style={{ color: "var(--text-muted)" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {t(`smartDiff.${ROLE_LABEL_KEY[group.role]}`)}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t(`smartDiff.${ROLE_DESC_KEY[group.role]}`)}
        </span>
        <span style={{ flex: 1 }} />
        {filesWithFindings > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--warn)" }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--warn)" }} />
            <span className="tnum">{filesWithFindings}</span>
          </span>
        )}
        <span className="tnum" style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("smartDiff.filesCount", { count: group.files.length })}
        </span>
      </button>
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 10,
            background: "var(--bg-surface)",
            borderTop: "1px solid var(--border)",
          }}
        >
          {group.files.map((sf) => {
            const file = byPath.get(sf.path);
            if (!file) return null;
            return (
              <FileCard
                key={sf.path}
                file={file}
                commenting={commenting}
                hasFindings={sf.finding_lines.length > 0}
                findingApi={findingApi}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
