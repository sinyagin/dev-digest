"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MonoLink, Skeleton } from "@devdigest/ui";
import { useBlastRadius } from "../../../../../../../lib/hooks/blast";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { aggregateCounts, degradedReasonLabel, endpointPillStyle, relativeDate } from "./helpers";
import { s } from "./styles";

interface BlastRadiusCardProps {
  prId: string | null | undefined;
  repoFullName: string | null;
  headSha: string | null | undefined;
}

export function BlastRadiusCard({ prId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError } = useBlastRadius(prId);

  if (isLoading) return <Skeleton height={120} />;
  if (isError) return <div style={s.error}>{t("error")}</div>;
  if (!data) return null;

  if (data.changed_symbols.length === 0) {
    return (
      <div style={s.empty}>
        <div>{t("emptyTitle")}</div>
        <div style={s.emptyBody}>{t("emptyBody")}</div>
      </div>
    );
  }

  const counts = aggregateCounts(data);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={s.summaryBar}>
        <span>
          {counts.symbols} {t("stat.symbols")}
        </span>
        <span>
          {counts.callers} {t("stat.callers")}
        </span>
        <span>
          {counts.endpoints} {t("stat.endpoints")}
        </span>
        {counts.crons > 0 && (
          <span>
            {counts.crons} {t("stat.crons")}
          </span>
        )}
        {data.degraded && (
          <span style={s.degradedBadge}>
            {t("degradedBadge")}: {degradedReasonLabel(data.reason)}
          </span>
        )}
      </div>

      <p style={s.summaryText}>{data.summary}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.downstream.map((d) => (
          <div key={d.symbol} style={s.symbolBlock}>
            <div style={s.symbolHeader}>
              <span style={s.symbolName}>&lt;&gt; {d.symbol}()</span>
              <span style={s.callerCount}>{t("callerCount", { count: d.callers.length })}</span>
            </div>

            {d.callers.length === 0 ? (
              <div style={s.noCallers}>{t("noCallersForSymbol")}</div>
            ) : (
              d.callers.map((c) => {
                const href =
                  repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, c.file, c.line) : undefined;
                return (
                  <div key={`${c.file}:${c.line}`} style={s.callerRow}>
                    <MonoLink href={href}>
                      {c.file}:{c.line}
                    </MonoLink>
                  </div>
                );
              })
            )}

            {(d.endpoints_affected.length > 0 || d.crons_affected.length > 0) && (
              <div style={s.chipRow}>
                {d.endpoints_affected.map((e) => (
                  <span key={e} style={{ ...s.endpointChip, ...endpointPillStyle(e) }}>
                    {e}
                  </span>
                ))}
                {d.crons_affected.map((c) => (
                  <span key={c} style={s.cronChip}>
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {data.priorPrs && data.priorPrs.length > 0 && (
        <details style={s.priorPrsDetails}>
          <summary>
            {t("priorPrsLabel")} ({data.priorPrs.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {data.priorPrs.map((pr) => (
              <div key={pr.id} style={s.priorPrRow}>
                <span>#{pr.number}</span>
                <span style={s.priorPrTitle}>{pr.title}</span>
                {pr.openedAt && <span style={s.priorPrDate}>{relativeDate(pr.openedAt)}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
