/* ContextTab — attach/detach + reorder this skill's Project Context
   documents, plus a presentational "SERIALIZES AS" preview of what the
   currently attached paths read like once serialized (AC-19). Document
   discovery is scoped to the active repository (the workspace's selected
   repo, via `useActiveRepo`) — a skill has no repo of its own, mirroring
   the Agent editor's ContextTab (`AgentEditor/_components/ContextTab`). The
   persisted attachment set (which paths + their order) IS scoped to the
   skill, via `useSkillContextDocuments`/`useSetSkillContextDocuments`.

   Save path: `useSetSkillContextDocuments` only — NEVER `useUpdateSkill`,
   which would bump `skill.version` and violate AC-17 (attaching context
   must not create a new skill version). Every `onChange` from the picker
   already carries the complete desired ordered path list (replace-all
   contract), so it is sent to the mutation unchanged.

   The "SERIALIZES AS" preview below is PURELY presentational — it is
   derived from the current `paths` during render and is never fetched from
   any endpoint. It shows the user what the attachment "reads like"; it is
   NOT the real run-time injection mechanism, which goes through
   reviewer-core's "## Project context" wrapper (AC-32) and never actually
   produces a "## Project specifications" heading anywhere at runtime. Keep
   these two concepts separate. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ContextAttachmentPicker, attachedTokenSum, formatTokenEstimate } from "@/components/context-attachments";
import { RepoNotFound } from "@/components/repo-not-found";
import { useContextDocuments, useSetSkillContextDocuments, useSkillContextDocuments } from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";
import { buildSerializationPreview } from "./helpers";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { repoId } = useActiveRepo();

  const {
    data: listing,
    isLoading: listingLoading,
    isError: listingError,
    refetch: refetchListing,
  } = useContextDocuments(repoId);
  const {
    data: attachment,
    isLoading: attachedLoading,
    isError: attachedError,
    refetch: refetchAttached,
  } = useSkillContextDocuments(skill.id);
  const setDocuments = useSetSkillContextDocuments(skill.id);

  if (!repoId) {
    return <RepoNotFound />;
  }

  if (listingLoading || attachedLoading) {
    return (
      <div style={s.skeletonWrap}>
        <Skeleton height={24} width={240} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (listingError || attachedError) {
    return (
      <ErrorState
        onRetry={() => {
          void refetchListing();
          void refetchAttached();
        }}
      />
    );
  }

  const documents = listing?.documents ?? [];
  // N (attached count) counts every persisted attached path, including ones
  // flagged missing from discovery — the pill must agree with the picker's
  // visible row list, which never hides a missing attached row.
  const paths = attachment?.paths ?? [];
  const tokenSum = attachedTokenSum(documents, paths);
  const preview = buildSerializationPreview(paths, t("context.previewHeading"));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.tabs.context")}</h2>
        <span style={s.count}>{t("context.attachedCount", { count: paths.length })}</span>
      </div>
      <p style={s.hint}>{t("context.inheritanceHint")}</p>

      <ContextAttachmentPicker
        documents={documents}
        paths={paths}
        onChange={(nextPaths) => setDocuments.mutate({ paths: nextPaths })}
        saving={setDocuments.isPending}
      />

      <div style={s.tokensFooter}>{formatTokenEstimate(tokenSum)}</div>

      <div style={s.previewPanel}>
        <div style={s.previewLabel}>{t("context.serializesAs")}</div>
        <pre style={s.previewPre}>{preview}</pre>
      </div>
    </div>
  );
}
