/* DocumentEditor — AC-24's editable counterpart to DocumentPreview. Edits a
   document's content in a plain textarea and saves it via
   `useWriteContextDocument()` (PUT /repos/:repoId/context/document), which
   writes the repo's working tree ONLY. This component has no git-commit or
   push capability at all — there is no call to any git/commit/push API
   anywhere here, by design (out of scope for this whole feature).

   Mandatory per AC-24: whenever Edit mode is active, the resync warning
   (`t("resyncWarning")`) is rendered unconditionally, visible without a
   hover/tooltip — `SimpleGitClient.sync` (server/src/adapters/git/simple-git.ts:77-88)
   runs `git reset --hard origin/<branch>` on every resync, which silently
   discards any uncommitted edit made here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Skeleton, Textarea } from "@devdigest/ui";
import type { ContextDocumentContent } from "@devdigest/shared";
import { useWriteContextDocument } from "@/lib/hooks/context";
import { useToast } from "@/lib/toast";
import { formatUpdatedAt } from "../../helpers";
import { EDITOR_ROWS } from "../../constants";
import { s } from "../../styles";

export function DocumentEditor({
  repoId,
  path,
  content,
  isLoading,
  isError,
  onRetry,
}: {
  repoId: string;
  path: string;
  content: ContextDocumentContent | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("context");
  const toast = useToast();
  const write = useWriteContextDocument();

  // Local draft, reset whenever the loaded document's identity/content
  // changes (switching documents, or a fresh fetch) — not derived state,
  // this mirrors ConfigTab's `skill.id`/`skill.version` reset effect.
  const [draft, setDraft] = React.useState(content?.content ?? "");
  React.useEffect(() => {
    setDraft(content?.content ?? "");
  }, [path, content?.content]);

  if (isLoading) {
    return (
      <div style={s.previewPanel}>
        <Skeleton height={18} width={240} />
        <Skeleton height={320} />
      </div>
    );
  }

  if (isError || !content) {
    return (
      <div style={s.previewPanel}>
        <ErrorState title={t("editor.loadError")} onRetry={onRetry} />
      </div>
    );
  }

  const dirty = draft !== content.content;

  const save = () => {
    const savePath = content.path;
    write.mutate(
      { repoId, path: savePath, content: draft },
      {
        onSuccess: () => toast.success(t("editor.savedToast", { path: savePath })),
        onError: () => toast.error(t("editor.saveError", { path: savePath })),
      },
    );
  };

  return (
    <div style={s.previewPanel}>
      <div style={s.previewHeader}>
        <span className="mono" style={s.previewPath}>
          {content.path}
        </span>
        <span style={s.previewMeta}>{formatUpdatedAt(content.updated_at)}</span>
      </div>

      {/* AC-24: always visible while editing, never conditional/hover-only. */}
      <div role="alert" style={s.editorWarning}>
        {t("resyncWarning")}
      </div>

      <Textarea value={draft} onChange={setDraft} rows={EDITOR_ROWS} mono />

      <div style={s.editorActions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={write.isPending || !dirty}>
          {write.isPending ? t("editor.saving") : t("editor.save")}
        </Button>
      </div>
    </div>
  );
}
