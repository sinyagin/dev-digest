/* ContextTab — attach/detach + reorder this agent's Project Context
   documents. Document discovery is scoped to the active repository (the
   workspace's selected repo, via `useActiveRepo`), never to the agent
   itself — an agent has no repo of its own; the spec resolves "which
   repository a workspace-scoped agent lists from" as the active repo. The
   persisted attachment set (which paths + their order) IS scoped to the
   agent, via `useAgentContextDocuments`/`useSetAgentContextDocuments`.

   Save path: `useSetAgentContextDocuments` only — NEVER `useUpdateAgent`,
   which would bump `agent.version` and violate AC-15 (attaching context
   must not create a new agent version). Every `onChange` from the picker
   already carries the complete desired ordered path list (replace-all
   contract), so it is sent to the mutation unchanged. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ContextAttachmentPicker, attachedTokenSum } from "../../../../../../../components/context-attachments";
import { useAgentContextDocuments, useContextDocuments, useSetAgentContextDocuments } from "../../../../../../../lib/hooks/context";
import { useActiveRepo } from "../../../../../../../lib/repo-context";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
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
  } = useAgentContextDocuments(agent.id);
  const setDocuments = useSetAgentContextDocuments(agent.id);

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
  // visible row list, which never hides a missing attached row. A missing
  // path has no known size, so it contributes 0 to the token sum.
  const paths = attachment?.paths ?? [];
  const tokenSum = attachedTokenSum(documents, paths);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.tabs.context")}</h2>
        <span style={s.count}>{t("context.attachedCount", { n: paths.length, m: documents.length })}</span>
      </div>
      <p style={s.orderHint}>{t("context.orderHint")}</p>
      <p style={s.notice}>{t("context.injectionNotice")}</p>

      <ContextAttachmentPicker
        documents={documents}
        paths={paths}
        onChange={(nextPaths) => setDocuments.mutate({ paths: nextPaths })}
        saving={setDocuments.isPending}
      />

      <div style={s.tokensFooter}>{t("context.tokens", { tokens: tokenSum })}</div>
    </div>
  );
}
