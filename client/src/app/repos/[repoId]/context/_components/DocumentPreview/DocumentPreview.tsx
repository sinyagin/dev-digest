/* DocumentPreview — renders the currently-selected document's Markdown
   content read-only (AC-9). Document content is UNTRUSTED repository text:
   it goes through `@devdigest/ui`'s `Markdown` (react-markdown + remark-gfm,
   no rehype-raw/HTML passthrough, never dangerouslySetInnerHTML) so embedded
   HTML stays escaped rather than rendered. A per-document read failure
   (AC-10) is shown here only — it never blocks the rest of the listing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import type { ContextDocumentContent } from "@devdigest/shared";
import { formatUpdatedAt } from "../../helpers";
import { s } from "../../styles";

export function DocumentPreview({
  path,
  content,
  isLoading,
  isError,
  onRetry,
}: {
  path: string;
  content: ContextDocumentContent | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("context");

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
        <ErrorState title={t("readError", { path })} onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div style={s.previewPanel}>
      <div style={s.previewHeader}>
        <span className="mono" style={s.previewPath}>
          {content.path}
        </span>
        <span style={s.previewMeta}>{t("tokens", { count: content.estimated_tokens })}</span>
        <span style={s.previewMeta}>{formatUpdatedAt(content.updated_at)}</span>
      </div>
      <div style={s.previewBody}>
        <Markdown>{content.content}</Markdown>
      </div>
    </div>
  );
}
