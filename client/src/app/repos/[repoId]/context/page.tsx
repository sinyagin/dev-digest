/* Route: /repos/:repoId/context — the Project Context document browser.
   Lists every discovered Markdown document in the repo's working tree
   (AC-1/AC-2's discovery, surfaced via useContextDocuments) and renders the
   selected one via a Preview/Edit toggle (T26): Preview is DocumentPreview's
   existing read-only Markdown render; Edit is DocumentEditor, which writes
   to the working tree ONLY via useWriteContextDocument (no git-commit/push
   capability anywhere in this feature). */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useContextDocument, useContextDocuments } from "@/lib/hooks/context";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { DocumentEditor } from "./_components/DocumentEditor";
import { DocumentList } from "./_components/DocumentList";
import { DocumentPreview } from "./_components/DocumentPreview";
import { SKELETON_ROWS } from "./constants";
import { sortDocuments } from "./helpers";
import { s } from "./styles";

type DocumentMode = "preview" | "edit";

export default function ContextPage() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: listing, isLoading, isError, refetch } = useContextDocuments(repoId);

  // Default to the first document once the listing loads; a user click
  // overrides the default for the rest of the session. No effect needed —
  // this is a plain derivation from `listing` + the (rare) explicit pick.
  const [explicitSelection, setExplicitSelection] = React.useState<string | null>(null);
  const documents = listing ? sortDocuments(listing.documents) : [];
  const selectedPath = explicitSelection ?? documents[0]?.path ?? null;

  // Preview/Edit mode for the selected document's panel (T26). Switching the
  // selected document always drops back to Preview — an in-progress edit of
  // one document shouldn't silently carry over to a different one.
  const [mode, setMode] = React.useState<DocumentMode>("preview");
  const selectDocument = (path: string) => {
    setExplicitSelection(path);
    setMode("preview");
  };

  const {
    data: content,
    isLoading: contentLoading,
    isError: contentError,
    refetch: refetchContent,
  } = useContextDocument(repoId, selectedPath);

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [{ label: repoName, mono: true }, { label: t("title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const cloneAvailable = listing?.summary.clone_available ?? true;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <h1 style={s.heading}>{t("title")}</h1>

        {isLoading && (
          <div style={s.list}>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <Skeleton key={i} height={64} />
            ))}
          </div>
        )}

        {isError && <ErrorState title={t("loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && listing && !cloneAvailable && (
          <EmptyState icon="Folder" title={t("notCloned.title")} body={t("notCloned.body")} />
        )}

        {!isLoading && !isError && listing && cloneAvailable && documents.length === 0 && (
          <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
        )}

        {!isLoading && !isError && listing && cloneAvailable && documents.length > 0 && (
          <>
            <p style={s.summaryLine}>{t("tokens", { count: listing.summary.estimated_tokens_total })}</p>
            <div style={s.layout}>
              <DocumentList documents={documents} selectedPath={selectedPath} onSelect={selectDocument} />
              {selectedPath && (
                <div style={s.documentPanel}>
                  <div style={s.modeToggle}>
                    <Button
                      kind="tertiary"
                      size="sm"
                      active={mode === "preview"}
                      onClick={() => setMode("preview")}
                    >
                      {t("mode.preview")}
                    </Button>
                    <Button kind="tertiary" size="sm" active={mode === "edit"} onClick={() => setMode("edit")}>
                      {t("mode.edit")}
                    </Button>
                  </div>
                  {mode === "preview" ? (
                    <DocumentPreview
                      path={selectedPath}
                      content={content}
                      isLoading={contentLoading}
                      isError={contentError}
                      onRetry={() => refetchContent()}
                    />
                  ) : (
                    <DocumentEditor
                      repoId={repoId}
                      path={selectedPath}
                      content={content}
                      isLoading={contentLoading}
                      isError={contentError}
                      onRetry={() => refetchContent()}
                    />
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
