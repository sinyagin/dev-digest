"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalBanner } from "@devdigest/shared";
import { bannerMetricKey } from "../../helpers";
import { s } from "../../styles";

/** Regression/improvement banner. A cause clause appears only when cases flipped (AC-47). */
export function Banner({ banner }: { banner: EvalBanner }) {
  const t = useTranslations("eval.banner");
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;

  const up = banner.direction === "up";
  const flipped = banner.flipped;

  return (
    <div role="status" style={s.banner}>
      <span style={s.bannerText}>
        <span style={up ? s.up : s.down} aria-hidden="true">
          {up ? "▲" : "▼"}{" "}
        </span>
        {t("message", {
          metric: t(`metrics.${bannerMetricKey(banner.metric)}`),
          direction: t(`direction.${banner.direction}`),
          delta: Math.abs(banner.delta_pts).toFixed(1),
          version: banner.version,
        })}
        {flipped.length > 0 && (
          <>
            {" · "}
            {t("cause", { cases: flipped.length })}
            {": "}
            {flipped.map((f) => f.name).join(", ")}
          </>
        )}
      </span>
      <button type="button" onClick={() => setDismissed(true)}>
        {t("dismiss")}
      </button>
    </div>
  );
}
