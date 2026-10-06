/* ContextAttachmentPicker — the one shared attach/detach/reorder list used
   by both the Agent editor's and the Skill editor's Context tab (promoted
   per frontend-architecture: two unrelated features consume it). Pure
   presentational + local UI state: it takes the discovered documents, the
   persisted attached paths, and an onChange callback, and owns NO fetching
   and NO shadow copy of `paths` — the parent holds the mutation and is the
   single source of truth for the attached set, which is what keeps the
   Agent and Skill tabs' AC-39 (disable-while-saving) behaviour from drifting
   apart. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, TextInput } from "@devdigest/ui";
import type { ContextDocument } from "@devdigest/shared";
import { BUCKET_COLOR, UNKNOWN_BUCKET_COLOR } from "./constants";
import {
  attachedTokenSum,
  buildRows,
  formatTokenEstimate,
  moveAttachment,
  toggleAttachment,
} from "./helpers";
import { s } from "./styles";

export interface ContextAttachmentPickerProps {
  /** Every document discovered for the active repository. */
  documents: ContextDocument[];
  /** The persisted, ordered attached paths — owned by the parent. */
  paths: string[];
  /** Called with the complete desired ordered path list on every toggle or
      reorder (replace-all semantics, matching the attachment endpoints). */
  onChange: (paths: string[]) => void;
  /** True while the parent's attachment-save mutation is in flight. Every
      toggle and reorder control is disabled while this is true (AC-39). */
  saving: boolean;
}

export function ContextAttachmentPicker({ documents, paths, onChange, saving }: ContextAttachmentPickerProps) {
  const t = useTranslations("context");
  const [filter, setFilter] = React.useState("");
  const [announcement, setAnnouncement] = React.useState("");

  // Derived during render — never mirrored into state (derive, don't store).
  const rows = buildRows(documents, paths, filter);
  const tokenSum = attachedTokenSum(documents, paths);

  const handleToggle = (path: string) => {
    if (saving) return;
    onChange(toggleAttachment(paths, path));
  };

  const handleMove = (path: string, direction: "up" | "down") => {
    if (saving) return;
    const next = moveAttachment(paths, path, direction);
    if (next === paths) return;
    onChange(next);
    const position = next.indexOf(path) + 1;
    setAnnouncement(t("picker.moved", { path, position, total: next.length }));
  };

  return (
    <div style={s.wrap}>
      <div style={s.filterRow}>
        <TextInput
          value={filter}
          onChange={setFilter}
          placeholder={t("picker.filterPlaceholder")}
          aria-label={t("picker.filterLabel")}
          disabled={saving}
        />
      </div>

      {rows.length === 0 ? (
        <div style={s.empty}>{t("picker.noMatches")}</div>
      ) : (
        <ul style={s.list}>
          {rows.map((row) => {
            const isFirst = row.order === 0;
            const isLast = row.order === paths.length - 1;
            const bucketColor = row.document ? BUCKET_COLOR[row.document.bucket] ?? UNKNOWN_BUCKET_COLOR : UNKNOWN_BUCKET_COLOR;
            return (
              <li key={row.path} style={s.row}>
                <div style={s.toggleWrap}>
                  <Checkbox
                    checked={row.attached}
                    onChange={() => handleToggle(row.path)}
                    disabled={saving}
                    label={<span style={s.path}>{row.path}</span>}
                  />
                </div>

                {row.missing ? (
                  <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                    {t("picker.missing")}
                  </Badge>
                ) : (
                  <Badge color={bucketColor}>{row.document!.bucket}</Badge>
                )}

                {row.document && <span style={s.tokens}>{formatTokenEstimate(row.document.estimated_tokens)}</span>}

                {row.attached && (
                  <span style={s.reorderGroup}>
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="ArrowUp"
                      aria-label={t("picker.moveUp", { path: row.path })}
                      disabled={saving || isFirst}
                      onClick={() => handleMove(row.path, "up")}
                    />
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="ArrowDown"
                      aria-label={t("picker.moveDown", { path: row.path })}
                      disabled={saving || isLast}
                      onClick={() => handleMove(row.path, "down")}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Perceivable-to-screen-readers announcement of the last reorder (AC-44). */}
      <div role="status" aria-live="polite" style={s.visuallyHidden}>
        {announcement}
      </div>

      <div style={s.footer}>
        <span>{t("picker.attachedCount", { count: paths.length })}</span>
        <span>{formatTokenEstimate(tokenSum)}</span>
      </div>
    </div>
  );
}
