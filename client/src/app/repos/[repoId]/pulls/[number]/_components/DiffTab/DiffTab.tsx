"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Toggle } from "@devdigest/ui";
import { DiffViewer, SmartDiffViewer, type DiffCommentApi, type DiffFindingApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, useSmartDiff, useFindingAction } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import { FindingCard } from "../FindingCard";
import type { FindingRecord, PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** The latest review's findings — same set the server used to compute
     smart-diff's finding_lines, so counts and the inline cards always agree. */
  latestFindings?: FindingRecord[];
  repoFullName?: string | null;
  headSha?: string | null;
  /** Optional: when set, force-opens and scrolls to the matching file's card
     in whichever diff viewer (smart or plain) is currently rendered. */
  focusPath?: string | null;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  latestFindings,
  repoFullName,
  headSha,
  focusPath,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Smart order (files grouped by risk role) is the default view.
  const [smartOrder, setSmartOrder] = React.useState(true);
  const { data: smartDiff } = useSmartDiff(prId);
  const findingAction = useFindingAction();

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const findingsByPath = React.useMemo(() => {
    const m = new Map<string, FindingRecord[]>();
    for (const f of latestFindings ?? []) m.set(f.file, [...(m.get(f.file) ?? []), f]);
    return m;
  }, [latestFindings]);

  const findingApi: DiffFindingApi = {
    findingsForFile: (path) => findingsByPath.get(path) ?? [],
    pending: findingAction.isPending,
    onAction: (findingId, action) => findingAction.mutate({ findingId, action, prId: prId ?? undefined }),
    renderCard: (f, { pending, onAction }) => (
      <FindingCard
        f={f}
        defaultExpanded
        pending={pending}
        onAction={onAction}
        repoFullName={repoFullName}
        headSha={headSha}
      />
    ),
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
              {t(smartOrder ? "smartDiff.smartOrderLabel" : "smartDiff.originalOrderLabel")}
              <Toggle on={smartOrder} onChange={setSmartOrder} size={16} />
            </span>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {smartOrder && smartDiff ? (
        <SmartDiffViewer
          smartDiff={smartDiff}
          files={files}
          commenting={commenting}
          findingApi={findingApi}
          focusPath={focusPath}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} focusPath={focusPath} />
      )}
    </section>
  );
}
