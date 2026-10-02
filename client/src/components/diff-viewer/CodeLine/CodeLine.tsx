/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { LINE_SEV_COLOR, LINE_SEV_LABEL_KEY, worstFinding, type DiffFindingApi } from "../findings";
import { s, lineRowFor, lineSignFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  lineFindings,
  findingApi,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Smart Diff only: review findings whose start_line matches this rendered line. */
  lineFindings?: FindingRecord[];
  findingApi?: DiffFindingApi;
}) {
  const t = useTranslations("shell");
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;

  const worst = lineFindings?.length ? worstFinding(lineFindings) : undefined;
  const sevColor = worst ? LINE_SEV_COLOR[worst.severity] : undefined;
  const sevLabelKey = worst ? LINE_SEV_LABEL_KEY[worst.severity] : undefined;
  const row = lineRowFor(ln.kind);

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={sevColor ? { ...row, borderLeft: `3px solid ${sevColor}` } : row}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {sevLabelKey && (
          <span
            className="mono"
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: sevColor,
              padding: "0 12px 0 4px",
            }}
          >
            {t(`diffViewer.lineLabel.${sevLabelKey}`)}
          </span>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}

      {findingApi &&
        lineFindings?.map((f) => (
          <div key={f.id} style={cs.thread}>
            {findingApi.renderCard(f, {
              pending: findingApi.pending,
              onAction: (a) => findingApi.onAction(f.id, a),
            })}
          </div>
        ))}
    </div>
  );
}
