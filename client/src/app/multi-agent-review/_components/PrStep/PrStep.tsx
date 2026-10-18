"use client";

import type React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import { s } from "../../styles";

export function PrStep({
  repoId,
  pulls,
  loading,
  value,
  notFound,
  onChange,
  repoPicker,
}: {
  repoId: string;
  pulls: PrMeta[];
  loading: boolean;
  /** Selected PR number as a string, or "" for none. */
  value: string;
  /** The `?pr=` param did not match any PR of this repo. */
  notFound: boolean;
  onChange: (value: string) => void;
  /** Repository select rendered to the left of the PR select (global page). */
  repoPicker?: React.ReactNode;
}) {
  const t = useTranslations("multiAgent.step1");
  return (
    <section style={s.step}>
      <h2 style={s.stepTitle}>{t("title")}</h2>
      <div style={s.selectRow}>
      {repoPicker}
      {loading ? (
        <p style={s.muted}>{t("loading")}</p>
      ) : pulls.length === 0 ? (
        <p style={s.muted}>
          {t("none")}{" "}
          <Link href={`/repos/${repoId}/pulls`} style={s.link}>
            {t("viewPulls")}
          </Link>
        </p>
      ) : (
        <select aria-label={t("select")} style={s.select} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("placeholder")}</option>
          {pulls.map((p) => (
            <option key={p.number} value={String(p.number)}>
              #{p.number} · {p.title}
            </option>
          ))}
        </select>
      )}
      </div>
      {notFound && (
        <p role="status" style={s.notice}>
          {t("notFound")}
        </p>
      )}
    </section>
  );
}
