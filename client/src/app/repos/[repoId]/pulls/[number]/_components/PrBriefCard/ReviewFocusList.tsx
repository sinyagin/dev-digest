"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import { s } from "./styles";

/** Renders `review_focus` as an ordered list, in exact array order (never
 *  sorted — order is meaningful, it's the model's priority ranking). Each
 *  item is a clickable row that calls `onFocusFile(item.file)`. */
export function ReviewFocusList({
  items,
  onFocusFile,
}: {
  items: ReviewFocusItem[];
  onFocusFile: (file: string) => void;
}) {
  const t = useTranslations("brief");

  return (
    <ol style={s.focusList}>
      {items.map((item, index) => {
        const fileLabel = item.line === null ? item.file : `${item.file}:${item.line}`;
        // A null line must not be announced as "line null" / interpolate a
        // digit-bearing template — compose the aria-label manually instead
        // of always reaching for card.reviewFocusItemAriaLabel.
        const ariaLabel =
          item.line === null
            ? `${item.file}, ${item.reason}`
            : t("card.reviewFocusItemAriaLabel", { file: item.file, line: item.line, reason: item.reason });

        return (
          <li key={`${item.file}-${item.line ?? "nil"}-${index}`}>
            <button
              type="button"
              style={s.focusItem}
              aria-label={ariaLabel}
              onClick={() => onFocusFile(item.file)}
            >
              <span style={s.focusItemFile}>{fileLabel}</span>
              {" — "}
              {item.reason}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
