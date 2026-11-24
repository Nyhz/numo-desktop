import { useMemo, useState } from "react";
import { dateShort } from "../lib/format.ts";
import { niceTicks, scale, timeTicks, Tip, useWidth, type TipRow } from "./core.tsx";

export type Series = { key: string; label: string; color: string; values: ArrayLike<number> };
export type Marker = { i: number; kind: "buy" | "sell"; label: string };

type Props = {
  /** Fecha ISO de cada punto. */
  dates: string[];
  series: Series[];
  /** Apila las series (reparto a lo largo del tiempo). */
  stacked?: boolean;
  /** Línea de referencia sin relleno, p. ej. lo aportado. */
  reference?: { label: string; values: ArrayLike<number> };
  /** Compras y ventas señaladas sobre la primera serie. */
  markers?: Marker[];
  height?: number;
  format: (n: number) => string;
  formatAxis?: (n: number) => string;
  /** Eje desde cero aunque no se apile. */
  zero?: boolean;
  totalLabel?: string;
};

const PAD = { top: 10, bottom: 24 };

export function TimeChart({
  dates,
  series,
  stacked = false,
  reference,
  markers,
  height = 260,
  format,
  formatAxis = format,
  zero = false,
  totalLabel = "Total",
}: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = dates.length;

  const geo = useMemo(() => {
    if (!width || n < 2) return null;
    // Con miles de días no hace falta un punto por día: uno por cada ~1,5 px.
    const step = Math.max(1, Math.ceil(n / (width / 1.5)));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i += step) idx.push(i);
    idx.push(n - 1);

    const tops: number[][] = [];
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    const acc = new Float64Array(idx.length);
    for (const s of series) {
      const top = idx.map((i, k) => {
        const v = s.values[i] ?? 0;
        if (stacked) acc[k]! += v;
        return stacked ? acc[k]! : v;
      });
      tops.push(top);
      for (const v of top) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const refVals = reference ? idx.map((i) => reference.values[i] ?? 0) : null;
    for (const v of refVals ?? []) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (stacked || zero) lo = Math.min(lo, 0);
    if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
    if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.06;
    const ticks = niceTicks(lo === 0 ? 0 : lo - pad, hi + pad, 4);
    const y0 = Math.min(lo === 0 ? 0 : lo - pad, ticks[0]!);
    const y1 = Math.max(hi + pad, ticks[ticks.length - 1]!);
    const x = scale(0, n - 1, 1, width - 1);
    const y = scale(y0, y1, height - PAD.bottom, PAD.top);
    const line = (vals: number[]) => vals.map((v, k) => `${k ? "L" : "M"}${x(idx[k]!).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const area = (top: number[], base: number[] | null) => {
      const down = base
        ? base.map((v, k) => `L${x(idx[k]!).toFixed(1)},${y(v).toFixed(1)}`).reverse().join("")
        : `L${x(idx[idx.length - 1]!).toFixed(1)},${y(y0).toFixed(1)}L${x(idx[0]!).toFixed(1)},${y(y0).toFixed(1)}`;
      return `${line(top)}${down}Z`;
    };
    return { idx, tops, refVals, ticks, x, y, y0, line, area, xticks: timeTicks(dates, width) };
  }, [dates, series, stacked, reference, zero, width, height, n]);

  if (n < 2) {
    return (
      <div ref={ref} className="flex items-center justify-center text-muted" style={{ height }}>
        Aún no hay suficiente historia para dibujar la evolución.
      </div>
    );
  }

  const onMove = (e: React.PointerEvent) => {
    if (!geo) return;
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left - 1) / Math.max(1, width - 2)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  let tip: { rows: TipRow[]; x: number; ys: Array<{ y: number; color: string }> } | null = null;
  if (geo && hover != null) {
    const rows: TipRow[] = [];
    const ys: Array<{ y: number; color: string }> = [];
    let total = 0;
    series.forEach((s) => {
      const v = s.values[hover] ?? 0;
      total += v;
      ys.push({ y: geo.y(stacked ? total : v), color: s.color });
      rows.push({ color: s.color, label: s.label, value: format(v) });
    });
    if (stacked) {
      rows.reverse();
      if (series.length > 1) rows.unshift({ label: totalLabel, value: format(total), strong: true });
    }
    if (reference) rows.push({ color: "var(--muted)", label: reference.label, value: format(reference.values[hover] ?? 0) });
    tip = { rows, x: geo.x(hover), ys };
  }

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {geo && (
        <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="Evolución en el tiempo">
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={width} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--line)" />
              <text x={0} y={geo.y(t) - 5} fontSize={11} fill="var(--muted)" className="num">
                {formatAxis(t)}
              </text>
            </g>
          ))}
          {geo.xticks.map((t) => (
            <text key={t.i} x={geo.x(t.i)} y={height - 6} fontSize={11} fill="var(--muted)" textAnchor="middle">
              {t.label}
            </text>
          ))}

          {series.map((s, k) => (
            <g key={s.key}>
              <path
                d={geo.area(geo.tops[k]!, stacked && k > 0 ? geo.tops[k - 1]! : null)}
                fill={s.color}
                opacity={stacked ? 0.2 : 0.1}
              />
              <path d={geo.line(geo.tops[k]!)} fill="none" stroke={s.color} strokeWidth={stacked ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {geo.refVals && (
            <path d={geo.line(geo.refVals)} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeLinejoin="round" />
          )}

          {markers?.map((m, k) => {
            const v = series[0]?.values[m.i] ?? 0;
            return (
              <circle
                key={k}
                cx={geo.x(m.i)}
                cy={geo.y(v)}
                r={4.5}
                fill={m.kind === "buy" ? "var(--ink)" : "var(--surface)"}
                stroke={m.kind === "buy" ? "var(--surface)" : "var(--ink)"}
                strokeWidth={2}
              >
                <title>{m.label}</title>
              </circle>
            );
          })}

          {tip && (
            <g pointerEvents="none">
              <line x1={tip.x} x2={tip.x} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--line-strong)" />
              {tip.ys.map((p, k) => (
                <circle key={k} cx={tip!.x} cy={p.y} r={4} fill={p.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}
          <rect
            x={0}
            y={0}
            width={width}
            height={height - PAD.bottom}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {tip && hover != null && <Tip x={tip.x} y={4} width={width} title={dateShort(dates[hover]!)} rows={tip.rows} />}
    </div>
  );
}

/** Línea mínima sin ejes, para acompañar a una cifra. */
export function Sparkline({ values, width = 96, height = 26, color = "var(--ink-2)" }: { values: ArrayLike<number>; width?: number; height?: number; color?: string }) {
  const n = values.length;
  if (n < 2) return <svg width={width} height={height} />;
  const step = Math.max(1, Math.floor(n / width));
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i += step) pts.push([i, values[i]!]);
  pts.push([n - 1, values[n - 1]!]);
  for (const [, v] of pts) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const x = scale(0, n - 1, 1, width - 4);
  const y = scale(lo, hi === lo ? lo + 1 : hi, height - 3, 3);
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r={2.5} fill={color} />
    </svg>
  );
}
