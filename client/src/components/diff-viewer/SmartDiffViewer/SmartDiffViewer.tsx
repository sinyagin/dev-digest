/* SmartDiffViewer — "Files changed" grouped by risk role (core/tests/wiring/
   docs/boilerplate) instead of GitHub's flat order. Reuses FileCard/CodeLine
   for the actual diff rendering (patch parsing + inline commenting
   unchanged); only the grouping, per-group collapse, and findings overlay
   are new. Deterministic — the grouping and finding_lines come from the
   server's GET /pulls/:id/smart-diff (no LLM call), this component just
   renders it. */
"use client";

import React from "react";
import type { PrFile } from "@/lib/types";
import type { SmartDiffResponse } from "@devdigest/shared";
import type { DiffCommentApi } from "../comments";
import type { DiffFindingApi } from "../findings";
import { s } from "../styles";
import { RoleGroup } from "../RoleGroup";

export function SmartDiffViewer({
  smartDiff,
  files,
  commenting,
  findingApi,
}: {
  smartDiff: SmartDiffResponse;
  files: PrFile[];
  commenting?: DiffCommentApi;
  findingApi?: DiffFindingApi;
}) {
  const byPath = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);

  if (smartDiff.groups.length === 0) return null;

  return (
    <div style={{ ...s.list, gap: 14 }}>
      {smartDiff.groups.map((group) => (
        <RoleGroup
          key={group.role}
          group={group}
          byPath={byPath}
          commenting={commenting}
          findingApi={findingApi}
        />
      ))}
    </div>
  );
}
