import { useState, type ReactNode } from "react";
import { dateShort, monthName } from "../lib/format.ts";
import { Swatch } from "../ui/kit.tsx";

// Gráfico principal del diseño: capas SVG en un lienzo 1000×300 que se estira
// (trazo sin escalar), rejilla y etiquetas en HTML, carril inferior de barras
// y cursor que cruza gráfico y carril. La geometría sigue caudal-viz.js.

const W = 1000;
const H = 300;

export type Row = { color: string; label: string; value: string };
type Layer = { d: string; fill?: string; opacity?: number; stroke?: string; width?: number; dash?: string; /** La línea principal: es la que hereda la onda del arranque. */ main?: boolean };
export type LaneBar = { up: number; down: number };

export type HeroModel = {
  /** Puntos dibujados (la serie se muestrea si es muy larga). */
  n: number;
  layers: Layer[];
  ticks: Array<{ top: number; label: string }>;
  xl: Array<{ left: number; label: string }>;
  lane: LaneBar[] | null;
  rowsAt: (k: number) => Row[];
  dotsAt: (k: number) => Array<{ top: number; color: string }>;
  dateAt: (k: number) => string;
  /** Índice en los datos originales del punto k. */
  src: (k: number) => number;
  markers: Array<{ left: number; top: number; filled: boolean; label: string }>;
  /** Posición horizontal de «hoy» en %, si el gráfico llega al futuro. */
  nowLeft: number | null;
};

type Frame = {
  idx: number[];
  n: number;
  x: (k: number) => string;
  Y: (v: number) => number;
  top: (v: number) => number;
  path: (vals: number[]) => string;
  back: (vals: number[]) => string;
  ticks: HeroModel["ticks"];
  xl: HeroModel["xl"];
};

/** Paso «redondo» (1, 2, 2,5 o 5 × 10ⁿ) para unas cuatro líneas de rejilla. */
function niceStep(span: number, target = 4): number {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
}

function frame(dates: string[], min: number, max: number, axis: (v: number) => string, zeroBased: boolean): Frame {
  const total = dates.length;
  // Con miles de días basta un punto cada dos píxeles.
  const stepSample = Math.max(1, Math.ceil(total / 520));
  const idx: number[] = [];
  for (let i = 0; i < total - 1; i += stepSample) idx.push(i);
  idx.push(total - 1);
  const n = idx.length;

  if (!(max > min)) max = min + 1;
  const step = niceStep(max - min);
  const lo = zeroBased ? Math.min(0, Math.floor(min / step) * step) : Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step || step;
  const x = (k: number) => ((k / Math.max(1, n - 1)) * W).toFixed(1);
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const top = (v: number) => (1 - (v - lo) / (hi - lo)) * 100;
  const path = (vals: number[]) => vals.map((v, k) => `${k ? "L" : "M"}${x(k)} ${Y(v).toFixed(1)}`).join("");
  const back = (vals: number[]) => {
    let d = "";
    for (let k = n - 1; k >= 0; k--) d += `L${x(k)} ${Y(vals[k]!).toFixed(1)}`;
    return d;
  };

  const ticks: Frame["ticks"] = [];
  for (let v = lo + step; v < hi - step * 1e-6; v += step) ticks.push({ top: top(v), label: axis(Math.abs(v) < step * 1e-9 ? 0 : v) });
  if (lo < 0 && !ticks.some((t) => Math.abs(t.top - top(0)) < 0.01)) ticks.push({ top: top(0), label: axis(0) });

  // Una etiqueta por cambio de mes, aclarada hasta que quepan.
  const starts: Array<{ left: number; y: number; m: number }> = [];
  for (let k = 1; k < n; k++) {
    const a = dates[idx[k - 1]!]!;
    const b = dates[idx[k]!]!;
    if (a.slice(0, 7) !== b.slice(0, 7)) starts.push({ left: (k / (n - 1)) * 100, y: +b.slice(0, 4), m: +b.slice(5, 7) - 1 });
  }
  const every = [1, 2, 3, 6, 12, 24, 60].find((s) => starts.length / s <= 13) ?? 120;
  const xl = starts
    .filter((s) => (every >= 12 ? s.m === 0 && s.y % (every / 12) === 0 : s.m % every === 0))
    .map((s) => ({ left: s.left, label: every >= 12 ? String(s.y) : s.m === 0 ? `${monthName(0)} ${String(s.y).slice(2)}` : monthName(s.m) }));

  return { idx, n, x, Y, top, path, back, ticks, xl };
}

/** Carril inferior: reparte la serie en ~60 tramos y normaliza las barras al mayor. */
function buildLane(f: Frame, total: number, of: (a: number, b: number) => LaneBar): LaneBar[] | null {
  const m = Math.min(60, total - 1);
  if (m < 2) return null;
  const raw: LaneBar[] = [];
  for (let j = 0; j < m; j++) raw.push(of(Math.round((j * (total - 1)) / m), Math.round(((j + 1) * (total - 1)) / m)));
  const mx = Math.max(1e-9, ...raw.map((b) => Math.max(b.up, b.down)));
  return raw.map((b) => ({ up: b.up / mx, down: b.down / mx }));
}

const minMax = (lists: number[][]): [number, number] => {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const l of lists) {
    for (const v of l) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 1];
};

type Common = {
  dates: string[];
  axis: (v: number) => string;
  /** Devuelve la barra del carril para el tramo [a, b] de los datos originales. */
  lane?: (a: number, b: number) => LaneBar;
  /** Fecha de hoy si la serie se extiende al futuro. */
  now?: string;
};

const nowLeftOf = (dates: string[], now?: string): number | null => {
  if (!now || dates.length < 2 || now <= dates[0]! || now >= dates[dates.length - 1]!) return null;
  let i = dates.findIndex((d) => d >= now);
  if (i < 0) i = dates.length - 1;
  return (i / (dates.length - 1)) * 100;
};

/** Dos líneas y la banda entre ambas: valor frente a aportado, o valor del inmueble frente a deuda. */
export function bandModel(
  o: Common & {
    top: ArrayLike<number>;
    base: ArrayLike<number>;
    rows: (i: number) => Row[];
    /** Desde cero aunque los valores no lleguen (deuda que se amortiza). */
    zeroBased?: boolean;
  },
): HeroModel {
  const pre = frame(o.dates, 0, 1, o.axis, false);
  const v = pre.idx.map((i) => o.top[i]!);
  const c = pre.idx.map((i) => o.base[i]!);
  const [lo, hi] = minMax([v, c]);
  const f = frame(o.dates, o.zeroBased ? 0 : lo, hi, o.axis, !!o.zeroBased);
  return {
    n: f.n,
    layers: [
      { d: `${f.path(c)}L${W} ${H}L0 ${H}Z`, fill: "var(--ink)", opacity: 0.04 },
      { d: `${f.path(v)}${f.back(c)}Z`, fill: "var(--acc)", opacity: 0.17 },
      { d: f.path(c), stroke: "var(--mute)", width: 1.1, dash: "4 4" },
      { d: f.path(v), stroke: "var(--acc)", width: 1.9, main: true },
    ],
    ticks: f.ticks,
    xl: f.xl,
    lane: o.lane ? buildLane(f, o.dates.length, o.lane) : null,
    rowsAt: (k) => o.rows(f.idx[k]!),
    dotsAt: (k) => [
      { top: f.top(v[k]!), color: "var(--acc)" },
      { top: f.top(c[k]!), color: "var(--mute)" },
    ],
    dateAt: (k) => o.dates[f.idx[k]!]!,
    src: (k) => f.idx[k]!,
    markers: [],
    nowLeft: nowLeftOf(o.dates, o.now),
  };
}

/** Áreas apiladas desde cero: el reparto a lo largo del tiempo. */
export function stackModel(o: Common & { series: Array<{ label: string; color: string; values: ArrayLike<number> }>; format: (v: number) => string }): HeroModel {
  const pre = frame(o.dates, 0, 1, o.axis, true);
  const m = o.series.length;
  const cum: number[][] = Array.from({ length: m + 1 }, () => []);
  pre.idx.forEach((i) => {
    let acc = 0;
    cum[0]!.push(0);
    o.series.forEach((s, k) => {
      acc += Math.max(0, s.values[i] ?? 0);
      cum[k + 1]!.push(acc);
    });
  });
  const f = frame(o.dates, 0, Math.max(1, ...cum[m]!), o.axis, true);
  const layers: Layer[] = [];
  for (let k = 0; k < m; k++) layers.push({ d: `${f.path(cum[k + 1]!)}${f.back(cum[k]!)}Z`, fill: o.series[k]!.color, opacity: 0.72 });
  for (let k = 1; k < m; k++) layers.push({ d: f.path(cum[k]!), stroke: "var(--panel)", width: 1.5 });
  layers.push({ d: f.path(cum[m]!), stroke: "var(--ink)", width: 1.5 });
  return {
    n: f.n,
    layers,
    ticks: f.ticks,
    xl: f.xl,
    lane: o.lane ? buildLane(f, o.dates.length, o.lane) : null,
    rowsAt: (k) => o.series.map((s) => ({ color: s.color, label: s.label, value: o.format(s.values[f.idx[k]!] ?? 0) })).reverse(),
    dotsAt: (k) =>
      cum
        .slice(1)
        .map((cm, j) => ({ top: f.top(cm[k]!), color: o.series[j]!.color }))
        .reverse(),
    dateAt: (k) => o.dates[f.idx[k]!]!,
    src: (k) => f.idx[k]!,
    markers: [],
    nowLeft: nowLeftOf(o.dates, o.now),
  };
}

/** Una sola línea con su área: rentabilidad acumulada (hasta la línea cero) o precio. */
export function lineModel(
  o: Common & {
    values: ArrayLike<number>;
    label: string;
    format: (v: number) => string;
    /** Área hasta cero y línea cero visible (rentabilidad). Sin esto, área hasta la base. */
    zero?: boolean;
    marks?: Array<{ i: number; filled: boolean; label: string }>;
  },
): HeroModel {
  const pre = frame(o.dates, 0, 1, o.axis, false);
  const t = pre.idx.map((i) => o.values[i]!);
  const [lo, hi] = minMax([t]);
  const pad = (hi - lo) * 0.06 || 1;
  const f = o.zero ? frame(o.dates, Math.min(lo, 0), Math.max(hi, 0), o.axis, true) : frame(o.dates, lo - pad, hi + pad, o.axis, false);
  const z = o.zero ? f.Y(0).toFixed(1) : String(H);
  const layers: Layer[] = [{ d: `${f.path(t)}L${W} ${z}L0 ${z}Z`, fill: "var(--acc)", opacity: o.zero ? 0.16 : 0.1 }];
  if (o.zero) layers.push({ d: `M0 ${z}H${W}`, stroke: "var(--line2)", width: 1 });
  layers.push({ d: f.path(t), stroke: "var(--acc)", width: 1.8 });
  // Cada marca se lleva al punto dibujado más cercano.
  const near = (i: number) => {
    let best = 0;
    for (let k = 1; k < f.n; k++) if (Math.abs(f.idx[k]! - i) < Math.abs(f.idx[best]! - i)) best = k;
    return best;
  };
  return {
    n: f.n,
    layers,
    ticks: f.ticks,
    xl: f.xl,
    lane: o.lane ? buildLane(f, o.dates.length, o.lane) : null,
    rowsAt: (k) => [{ color: "var(--acc)", label: o.label, value: o.format(t[k]!) }],
    dotsAt: (k) => [{ top: f.top(t[k]!), color: "var(--acc)" }],
    dateAt: (k) => o.dates[f.idx[k]!]!,
    src: (k) => f.idx[k]!,
    markers: (o.marks ?? []).map((mk) => {
      const k = near(mk.i);
      return { left: (k / Math.max(1, f.n - 1)) * 100, top: f.top(t[k]!), filled: mk.filled, label: mk.label };
    }),
    nowLeft: nowLeftOf(o.dates, o.now),
  };
}

export function HeroChart({
  model,
  height = 300,
  laneLabel,
  laneColors = ["var(--up)", "var(--down)"],
  onHover,
  footer,
}: {
  model: HeroModel | null;
  height?: number;
  laneLabel?: ReactNode;
  laneColors?: [string, string];
  /** Índice del punto bajo el cursor (en los datos originales) o null al salir. */
  onHover?: (srcIndex: number | null, k: number | null) => void;
  footer?: ReactNode;
}) {
  const [k, setK] = useState<number | null>(null);
  if (!model || model.n < 2) {
    return (
      <div className="mt-6 grid place-items-center rounded-2xl border border-dashed border-line2 text-mute" style={{ height }}>
        Aún no hay suficiente historia para dibujar la evolución.
      </div>
    );
  }
  const hover = k != null && k < model.n ? k : null;
  const frac = hover == null ? 0 : hover / (model.n - 1);
  const left = `${(frac * 100).toFixed(2)}%`;
  const bucket = hover != null && model.lane ? Math.min(model.lane.length - 1, Math.floor(frac * model.lane.length)) : -1;

  const move = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const next = Math.round(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * (model.n - 1));
    if (next !== k) {
      setK(next);
      onHover?.(model.src(next), next);
    }
  };
  const leave = () => {
    setK(null);
    onHover?.(null, null);
  };

  return (
    <>
      <div className="relative mt-6 mr-14 cursor-crosshair" onMouseMove={move} onMouseLeave={leave}>
        <div className="relative" style={{ height }}>
          {model.ticks.map((t, i) => (
            <div key={i} className="absolute inset-x-0 border-t border-line" style={{ top: `${t.top}%` }}>
              <span className="absolute -top-2 left-full pl-2 text-[11px] whitespace-nowrap text-mute">{t.label}</span>
            </div>
          ))}
          {/* Dos capas: lo de debajo (que en el arranque se descubre de izquierda a derecha) y la línea principal. */}
          {[false, true].map((main) => (
            <div key={String(main)} data-hero={main ? "line" : "under"} className="absolute inset-0">
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" role={main ? undefined : "img"} aria-label={main ? undefined : "Evolución en el tiempo"}>
                {model.layers
                  .filter((l) => !!l.main === main)
                  .map((l, i) => (
                    <path
                      key={i}
                      d={l.d}
                      fill={l.fill ?? "none"}
                      opacity={l.opacity ?? 1}
                      stroke={l.stroke ?? "none"}
                      strokeWidth={l.width ?? 0}
                      strokeDasharray={l.dash}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
              </svg>
            </div>
          ))}
          {model.nowLeft != null && (
            <div className="absolute inset-y-0 border-l border-dashed border-line2" style={{ left: `${model.nowLeft}%` }}>
              <span className="absolute bottom-1 left-1.5 text-[11px] text-ink2">hoy</span>
            </div>
          )}
          {model.markers.map((m, i) => (
            <span
              key={i}
              title={m.label}
              className="absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${m.left}%`,
                top: `${m.top}%`,
                background: m.filled ? "var(--ink)" : "var(--panel)",
                border: m.filled ? "none" : "1.5px solid var(--ink)",
                boxShadow: "0 0 0 2px var(--panel)",
              }}
            />
          ))}
        </div>

        {model.lane && (
          <>
            <div className="mt-3.5 text-[11px] text-mute">{laneLabel}</div>
            <div className="relative mt-1 flex h-[52px] gap-[2px]">
              <div className="absolute inset-x-0 top-1/2 border-t border-line2" />
              {model.lane.map((b, i) => (
                <div key={i} className="flex flex-1 flex-col transition-opacity duration-150" style={{ opacity: bucket < 0 || bucket === i ? 1 : 0.3 }}>
                  <div className="flex flex-1 items-end">
                    <div className="w-full rounded-t-[2px]" style={{ height: `${b.up * 100}%`, background: laneColors[0] }} />
                  </div>
                  <div className="flex-1">
                    <div className="w-full rounded-b-[2px]" style={{ height: `${b.down * 100}%`, background: laneColors[1] }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {hover != null && (
          <>
            <div className="pointer-events-none absolute inset-y-0 border-l border-ink2" style={{ left }}>
              <div className="absolute top-0 left-0 w-0" style={{ height }}>
                {model.dotsAt(hover).map((p, i) => (
                  <span
                    key={i}
                    className="absolute -left-[5px] -mt-[5px] size-[9px] rounded-full"
                    style={{ top: `${p.top}%`, background: p.color, boxShadow: "0 0 0 2px var(--panel)" }}
                  />
                ))}
              </div>
            </div>
            <div
              className="pointer-events-none absolute top-2.5 z-10 min-w-[200px] rounded-xl border border-line2 bg-raised px-3 py-2.5 text-[12px]"
              style={{ left, transform: frac < 0.5 ? "translateX(14px)" : "translateX(calc(-100% - 14px))", boxShadow: "var(--shadow-pop)" }}
            >
              <div className="mb-1.5 text-mute">{dateShort(model.dateAt(hover))}</div>
              {model.rowsAt(hover).map((r, i) => (
                <div key={i} className="flex items-center gap-2 py-[1.5px]">
                  <span className="size-[7px] shrink-0 rounded-[2px]" style={{ background: r.color }} />
                  <span className="flex-1 text-ink2">{r.label}</span>
                  <span className="pl-3.5 font-semibold">{r.value}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="relative mt-2 mr-14 h-4">
        {model.xl.map((x, i) => (
          <span key={i} className="absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-mute" style={{ left: `${x.left}%` }}>
            {x.label}
          </span>
        ))}
      </div>
      {footer}
    </>
  );
}

/** Leyenda con el valor de cada serie, a la derecha de la cifra principal. */
export function HeroLegend({ rows }: { rows: Row[] }) {
  return (
    <div className="flex min-w-[210px] flex-col gap-[3px] pb-1 text-[12.5px]">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <Swatch color={r.color} />
          <span className="flex-1 text-ink2">{r.label}</span>
          <span className="font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
