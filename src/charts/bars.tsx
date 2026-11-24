import { useMemo, useState, type ReactNode } from "react";
import { monthName, pct } from "../lib/format.ts";
import { niceTicks, scale, Tip, useWidth, type TipRow } from "./core.tsx";
import type { Series } from "./TimeChart.tsx";

// ── Columnas ───────────────────────────────────────────────────────────────

type ColumnsProps = {
  categories: string[];
  /** Título completo de cada categoría para el cuadro flotante. */
  titles?: string[];
  series: Series[];
  /** Colorea cada barra según su signo (una sola serie). */
  signed?: boolean;
  height?: number;
  format: (n: number) => string;
  formatAxis?: (n: number) => string;
};

/** Columnas apiladas con base común. Finas, con el extremo redondeado. */
export function Columns({ categories, titles, series, signed = false, height = 200, format, formatAxis = format }: ColumnsProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = categories.length;

  const geo = useMemo(() => {
    if (!width || !n) return null;
    let hi = 0;
    let lo = 0;
    for (let i = 0; i < n; i++) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.values[i] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    }
    if (hi === lo) hi = lo + 1;
    const ticks = niceTicks(lo, hi * 1.05, 3);
    const y = scale(Math.min(lo, ticks[0]!), Math.max(hi * 1.05, ticks[ticks.length - 1]!), height - 22, 8);
    const band = width / n;
    return { ticks, y, band, bar: Math.max(2, Math.min(22, band * 0.62)) };
  }, [categories, series, width, height, n]);

  const every = geo ? Math.max(1, Math.ceil(46 / geo.band)) : 1;

  let tip: { rows: TipRow[]; x: number } | null = null;
  if (geo && hover != null) {
    const rows: TipRow[] = series
      .map((s) => ({ color: signed ? undefined : s.color, label: s.label, value: format(s.values[hover] ?? 0) }))
      .reverse();
    if (series.length > 1) {
      rows.unshift({ label: "Total", value: format(series.reduce((a, s) => a + (s.values[hover] ?? 0), 0)), strong: true });
    }
    tip = { rows, x: geo.band * (hover + 0.5) };
  }

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {geo && (
        <svg width={width} height={height} className="block" role="img" aria-label="Importes por periodo">
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={width} y1={geo.y(t)} y2={geo.y(t)} stroke={t === 0 ? "var(--line-strong)" : "var(--line)"} />
              {t !== 0 && (
                <text x={0} y={geo.y(t) - 5} fontSize={11} fill="var(--muted)" className="num">
                  {formatAxis(t)}
                </text>
              )}
            </g>
          ))}
          {categories.map((c, i) => {
            const cx = geo.band * (i + 0.5);
            let pos = 0;
            let neg = 0;
            const segs = series.map((s) => {
              const v = s.values[i] ?? 0;
              const from = v >= 0 ? pos : neg;
              if (v >= 0) pos += v;
              else neg += v;
              return { s, v, from, to: from + v };
            });
            const last = segs.findLastIndex((g) => g.v !== 0);
            return (
              <g key={i} opacity={hover == null || hover === i ? 1 : 0.55}>
                {segs.map((g, k) => {
                  if (g.v === 0) return null;
                  const y1 = geo.y(Math.max(g.from, g.to));
                  const y2 = geo.y(Math.min(g.from, g.to));
                  // 2 px de superficie entre segmentos apilados.
                  const h = Math.max(1, y2 - y1 - (k > 0 && g.v > 0 ? 2 : 0));
                  const r = k === last ? Math.min(4, h, geo.bar / 2) : 0;
                  const x0 = cx - geo.bar / 2;
                  const fill = signed ? (g.v >= 0 ? "var(--up-fill)" : "var(--down-fill)") : g.s.color;
                  const d =
                    g.v >= 0
                      ? `M${x0},${y1 + h}V${y1 + r}q0,${-r} ${r},${-r}h${geo.bar - 2 * r}q${r},0 ${r},${r}V${y1 + h}Z`
                      : `M${x0},${y1}V${y1 + h - r}q0,${r} ${r},${r}h${geo.bar - 2 * r}q${r},0 ${r},${-r}V${y1}Z`;
                  return <path key={g.s.key} d={d} fill={fill} />;
                })}
                {i % every === 0 && (
                  <text x={cx} y={height - 5} fontSize={11} fill="var(--muted)" textAnchor="middle">
                    {c}
                  </text>
                )}
                <rect
                  x={geo.band * i}
                  y={0}
                  width={geo.band}
                  height={height - 20}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                />
              </g>
            );
          })}
        </svg>
      )}
      {tip && hover != null && <Tip x={tip.x} y={0} width={width} title={titles?.[hover] ?? categories[hover]!} rows={tip.rows} />}
    </div>
  );
}

// ── Barras ordenadas ───────────────────────────────────────────────────────

export type BarRow = { key: string; label: ReactNode; sub?: ReactNode; value: number; display: ReactNode; onClick?: () => void };

/**
 * Una barra por fila, de mayor a menor, en un solo tono. Con `diverging` las
 * barras parten de un cero central: ganancias a la derecha, pérdidas a la izquierda.
 */
export function RankedBars({ rows, diverging = false, color = "var(--s1)" }: { rows: BarRow[]; diverging?: boolean; color?: string }) {
  const maxPos = Math.max(0, ...rows.map((r) => r.value));
  const maxNeg = Math.max(0, ...rows.map((r) => -r.value));
  const span = Math.max(1e-9, diverging ? maxPos + maxNeg : maxPos);
  // El cero se coloca donde toca: si no hay pérdidas no se reserva media barra vacía.
  const zero = diverging ? (maxNeg / span) * 100 : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] items-center gap-x-4 gap-y-[9px] text-[13px]">
      {rows.map((r) => {
        const w = Math.max((Math.abs(r.value) / span) * 100, 0.6);
        const negative = diverging && r.value < 0;
        const body = (
          <>
            <div className="min-w-0">
              <div className="truncate">{r.label}</div>
              {r.sub && <div className="truncate text-[11.5px] text-muted">{r.sub}</div>}
            </div>
            <div className="relative h-[10px]">
              {diverging && <div className="absolute inset-y-[-3px] w-px bg-line-strong" style={{ left: `${zero}%` }} />}
              <div
                className="absolute inset-y-0"
                style={{
                  width: `${w}%`,
                  left: negative ? `${zero - w}%` : `${zero}%`,
                  background: diverging ? (negative ? "var(--down-fill)" : "var(--up-fill)") : color,
                  borderRadius: negative ? "4px 0 0 4px" : "0 4px 4px 0",
                }}
              />
            </div>
            <div className="num text-right">{r.display}</div>
          </>
        );
        return r.onClick ? (
          <button key={r.key} type="button" onClick={r.onClick} className="col-span-3 -mx-2 grid grid-cols-subgrid items-center rounded-md px-2 py-0.5 text-left hover:bg-wash">
            {body}
          </button>
        ) : (
          <div key={r.key} className="col-span-3 grid grid-cols-subgrid items-center">
            {body}
          </div>
        );
      })}
    </div>
  );
}

// ── Barra segmentada (un todo repartido en partes) ─────────────────────────

export type Part = { key: string; label: string; color: string; value: number };

/** Deja como mucho `max` partes: las menores se agrupan en «Otros». */
export function foldParts(parts: Part[], max = 6): Part[] {
  const sorted = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((s, p) => s + p.value, 0);
  return [...head, { key: "__other", label: "Otros", color: "var(--s0)", value: rest }];
}

export function SegmentedBar({ parts, format }: { parts: Part[]; format: (n: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <div className="text-muted">Sin datos que repartir.</div>;
  return (
    <div>
      <div ref={ref} className="flex h-7 gap-[2px]" role="img" aria-label={parts.map((p) => `${p.label}: ${pct(p.value / total)}`).join(", ")}>
        {parts.map((p) => {
          const share = p.value / total;
          const px = share * width;
          return (
            <div
              key={p.key}
              title={`${p.label}: ${format(p.value)} (${pct(share)})`}
              className="flex min-w-[3px] items-center overflow-hidden rounded-[4px] pl-2 text-[12px] font-semibold text-white"
              style={{ flexGrow: p.value, flexBasis: 0, background: p.color, color: p.color === "var(--s4)" ? "#0b0b0b" : "#fff" }}
            >
              {/* El porcentaje solo se imprime si cabe con holgura. */}
              {px >= 46 ? pct(share, 0) : ""}
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-[auto_1fr_auto] gap-x-2.5 gap-y-1.5 text-[13px]">
        {parts.map((p) => (
          <div key={p.key} className="col-span-3 grid grid-cols-subgrid items-center">
            <span className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
            <span className="truncate">{p.label}</span>
            <span className="num text-ink-2">{format(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Mapa de calor de rentabilidad mensual ──────────────────────────────────

/** Años en filas, meses en columnas. El color refuerza; la cifra siempre está escrita. */
export function ReturnHeatmap({ months }: { months: Array<{ month: string; ret: number }> }) {
  const byYear = new Map<number, Array<number | null>>();
  for (const { month, ret } of months) {
    const y = +month.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, Array<number | null>(12).fill(null));
    byYear.get(y)![+month.slice(5, 7) - 1] = ret;
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);
  const cell = (r: number | null, strong = false) => {
    if (r == null) return <div className="h-7" />;
    // Saturación máxima al ±8 %; por debajo del 0,05 % se queda neutro.
    const k = Math.min(1, Math.abs(r) / 0.08);
    const flat = Math.abs(r) < 0.0005;
    const tone = flat ? "transparent" : `color-mix(in srgb, var(${r > 0 ? "--up-fill" : "--down-fill"}) ${Math.round(10 + k * 42)}%, transparent)`;
    return (
      <div className={`num flex h-7 items-center justify-end rounded-[4px] px-1.5 text-[12px] ${strong ? "font-semibold" : ""}`} style={{ background: tone }}>
        {(flat ? "" : r > 0 ? "+" : "−") + (Math.abs(r) * 100).toFixed(1).replace(".", ",")}
      </div>
    );
  };
  return (
    <div className="grid grid-cols-[auto_repeat(12,minmax(0,1fr))_minmax(0,1.15fr)] gap-[2px] text-[12px]">
      <div />
      {Array.from({ length: 12 }, (_, m) => (
        <div key={m} className="pb-1 pr-1.5 text-right text-muted">
          {monthName(m)}
        </div>
      ))}
      <div className="pb-1 pr-1.5 text-right text-muted">Año</div>
      {years.map((y) => {
        const row = byYear.get(y)!;
        const total = row.reduce<number>((acc, r) => acc * (1 + (r ?? 0)), 1) - 1;
        return (
          <div key={y} className="col-span-full grid grid-cols-subgrid items-center">
            <div className="num pr-3 text-ink-2">{y}</div>
            {row.map((r, m) => (
              <div key={m}>{cell(r)}</div>
            ))}
            <div className="pl-1">{cell(total, true)}</div>
          </div>
        );
      })}
    </div>
  );
}
