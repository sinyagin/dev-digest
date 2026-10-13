import { useTranslations } from "next-intl";
import type { EvalRunSummary } from "@devdigest/shared";
import { fmtDeltaPts, fmtPct, type DeltaPts } from "../../../lib/eval-format";
import { s } from "./styles";

/** Metric deltas in percentage points (null = not comparable). */
export interface MetricDeltas {
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
}

export interface MetricTilesProps {
  latest: EvalRunSummary | null;
  delta: MetricDeltas | null;
  showDeltas: boolean;
}

const DELTA_STYLE = { up: s.deltaUp, down: s.deltaDown, flat: s.deltaFlat, none: s.deltaFlat } as const;

function Tile({
  label,
  value,
  delta,
  deltaLabel,
}: {
  label: string;
  value: string;
  delta?: DeltaPts;
  deltaLabel?: string;
}) {
  return (
    <li style={s.tile}>
      <span style={s.label}>{label}</span>
      <span style={s.value}>{value}</span>
      {delta && (
        <span style={{ ...s.delta, ...DELTA_STYLE[delta.dir] }} aria-label={deltaLabel}>
          {delta.arrow ? `${delta.arrow} ${delta.text}` : delta.text}
        </span>
      )}
    </li>
  );
}

export function MetricTiles({ latest, delta, showDeltas }: MetricTilesProps) {
  const t = useTranslations("eval.metrics");
  if (!latest) return null;

  const withDelta = showDeltas && delta !== null;
  const tileDelta = (d: number | null): Pick<Parameters<typeof Tile>[0], "delta" | "deltaLabel"> => {
    if (!withDelta) return {};
    const f = fmtDeltaPts(d);
    const value = Math.abs(d ?? 0).toFixed(1);
    const deltaLabel =
      f.dir === "up" ? t("deltaUp", { value }) : f.dir === "down" ? t("deltaDown", { value }) : f.dir === "flat" ? t("deltaZero") : t("na");
    return { delta: f, deltaLabel };
  };

  return (
    <ul style={s.grid}>
      <Tile label={t("recall")} value={fmtPct(latest.recall)} {...tileDelta(delta?.recall ?? null)} />
      <Tile label={t("precision")} value={fmtPct(latest.precision)} {...tileDelta(delta?.precision ?? null)} />
      <Tile
        label={t("citationAccuracy")}
        value={fmtPct(latest.citation_accuracy)}
        {...tileDelta(delta?.citation_accuracy ?? null)}
      />
      <Tile
        label={t("tracesPassed")}
        value={t("tracesPassedValue", { passed: latest.traces_passed, total: latest.traces_total })}
      />
    </ul>
  );
}

export default MetricTiles;
