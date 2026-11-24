import type { ReactNode } from "react";
import { dayNum } from "../../shared/dates.ts";
import { eur, eurSigned, monthName, pct, pctSigned } from "../lib/format.ts";
import { usePrivate } from "../ui/privacy.ts";

const toneOf = (v: number): string => (Math.abs(v) < 0.005 ? "var(--ink2)" : v > 0 ? "var(--up)" : "var(--down)");

// Visualizaciones secundarias del diseño (reparto por grupos, rentabilidad mes a
// mes y por posición, franja de concentración, flujo de efectivo, lotes vendidos…).
// Todas en HTML/CSS con medidas en porcentajes: se adaptan solas al ancho.

// ── Reparto ────────────────────────────────────────────────────────────────

export type TreeItem = { key: string; name: string; value: number; group: string; color?: string };
export type TreeCell = { key: string; name: string; value: number; share: number; show: boolean; bg: string; bgHot: string };
export type TreeGroup = { name: string; total: number; share: number; cells: TreeCell[] };

/**
 * Columnas por grupo (ancho = peso) y, dentro, celdas por elemento (alto = peso).
 * Con `byColor` cada grupo usa su propio color al 44 %; si no, el acento en
 * intensidad decreciente según el tamaño del grupo.
 */
export function treeGroups(items: TreeItem[], byColor = false): TreeGroup[] {
  const total = items.reduce((s, it) => s + Math.max(0, it.value), 0);
  const map = new Map<string, { name: string; total: number; color?: string; items: TreeItem[] }>();
  for (const it of items) {
    if (!(it.value > 0)) continue;
    let g = map.get(it.group);
    if (!g) map.set(it.group, (g = { name: it.group, total: 0, color: it.color, items: [] }));
    g.items.push(it);
    g.total += it.value;
  }
  return [...map.values()]
    .sort((a, b) => b.total - a.total)
    .map((g, r) => {
      const col = byColor && g.color ? g.color : "var(--acc)";
      const strength = byColor ? 44 : ([60, 46, 35, 26, 19][r] ?? 16);
      return {
        name: g.name,
        total: g.total,
        share: total > 0 ? g.total / total : 0,
        cells: g.items
          .sort((a, b) => b.value - a.value)
          .map((it, j) => ({
            key: it.key,
            name: it.name,
            value: it.value,
            share: total > 0 ? it.value / total : 0,
            // Las celdas con menos del 10 % de su grupo no llevan rótulo: no cabría.
            show: it.value / g.total > 0.1,
            bg: `color-mix(in oklab, ${col} ${Math.max(8, Math.round(strength * (1 - 0.1 * j)))}%, var(--card))`,
            bgHot: `color-mix(in oklab, ${col} ${Math.min(strength + 28, 92)}%, var(--card))`,
          })),
      };
    });
}

/** Una fila por grupo sobre una base común: el largo es el peso del grupo y sus tramos, las posiciones. */
export function GroupRows({ groups, hot, onHover }: { groups: TreeGroup[]; hot: string | null; onHover: (cell: TreeCell | null) => void }) {
  if (!groups.length) return <div className="py-10 text-center text-mute">Sin posiciones que repartir.</div>;
  const top = groups[0]!.total;
  return (
    <div className="flex flex-col gap-1.5" onMouseLeave={() => onHover(null)}>
      {groups.map((g) => (
        <div key={g.name} className="grid items-center gap-3.5" style={{ gridTemplateColumns: "minmax(0,110px) minmax(0,1fr) 132px" }}>
          <span className="truncate font-semibold">{g.name}</span>
          <div className="h-[34px] border-l border-line2">
            <div className="flex h-full gap-[2px]" style={{ width: `${(g.total / top) * 100}%` }}>
              {g.cells.map((c) => (
                <div
                  key={c.key}
                  onMouseEnter={() => onHover(c)}
                  className="flex min-w-[2px] cursor-default items-center overflow-hidden rounded-[5px] text-[12px] transition-[background] duration-[180ms]"
                  style={{ flex: `${c.value} 1 0`, background: hot === c.key ? c.bgHot : c.bg }}
                >
                  {/* Solo se rotula lo que ocupa bastante de la fila más larga: lo demás no cabría. */}
                  <span className="truncate px-[9px] font-[550]" style={{ opacity: c.value / top > 0.13 ? 1 : 0 }}>
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <span className="text-right whitespace-nowrap">
            <span className="font-semibold">{pct(g.share)}</span> <span className="priv pl-1.5 text-[12px] text-mute">{eur(g.total, 0)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Rentabilidad mes a mes ─────────────────────────────────────────────────

const heatBg = (r: number): string => {
  if (Math.abs(r) < 0.0005) return "var(--wash)";
  // Intensidad del 10 al 65 % según la magnitud, saturando en ±6 %.
  const k = Math.min(1, Math.abs(r) / 0.06);
  return `color-mix(in oklab, var(${r > 0 ? "--up" : "--down"}) ${Math.round(10 + k * 55)}%, var(--card))`;
};
const heatText = (r: number) => (Math.abs(r) < 0.0005 ? "0,0" : (r > 0 ? "+" : "−") + (Math.abs(r) * 100).toFixed(1).replace(".", ","));

/** Una fila por año con doce columnas que salen de una línea cero; la cifra va en el lado libre. */
export function MonthColumns({ months }: { months: Array<{ month: string; ret: number }> }) {
  const byYear = new Map<number, Array<number | null>>();
  for (const { month, ret } of months) {
    const y = +month.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, Array<number | null>(12).fill(null));
    byYear.get(y)![+month.slice(5, 7) - 1] = ret;
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);
  const cols = "34px repeat(12, minmax(0, 1fr)) minmax(54px, 1.6fr)";
  const positive = months.filter((m) => m.ret > 0.0005).length;
  const best = months.reduce<(typeof months)[number] | null>((b, m) => (!b || m.ret > b.ret ? m : b), null);
  const worst = months.reduce<(typeof months)[number] | null>((b, m) => (!b || m.ret < b.ret ? m : b), null);
  const label = (ym: string) => `${monthName(+ym.slice(5, 7) - 1)} ${ym.slice(0, 4)}`;
  // La altura crece con la rentabilidad y se satura en el 5 %.
  const height = (r: number) => `${Math.max(6, Math.min(1, Math.abs(r) / 0.05) * 100)}%`;
  return (
    <>
      <div className="grid gap-[3px] pb-1.5 text-center text-[11px] text-mute" style={{ gridTemplateColumns: cols }}>
        <span />
        {Array.from({ length: 12 }, (_, m) => (
          <span key={m}>{monthName(m)}</span>
        ))}
        <span className="text-right">Año</span>
      </div>
      {years.map((y) => {
        const row = byYear.get(y)!;
        const total = row.reduce<number>((acc, r) => acc * (1 + (r ?? 0)), 1) - 1;
        return (
          <div key={y} className="grid h-[74px] gap-[3px] border-t border-line" style={{ gridTemplateColumns: cols }}>
            <span className="self-center text-[11.5px] text-mute">{y}</span>
            {row.map((r, m) => {
              const up = r != null && r > 0.0005;
              const down = r != null && r < -0.0005;
              const text = "absolute inset-x-0 text-center text-[10.5px] tracking-[-0.02em] whitespace-nowrap";
              return (
                <div key={m} className="grid grid-rows-2 rounded-[5px] py-[5px] transition-[background] duration-100 hover:bg-wash" title={r == null ? undefined : `${label(`${y}-${String(m + 1).padStart(2, "0")}`)}: ${heatText(r)} %`}>
                  <div className="relative">
                    {up && <div className="absolute inset-x-px bottom-0 rounded-t-[3px] bg-up" style={{ height: height(r) }} />}
                    {down && <span className={`${text} bottom-[3px] text-down`}>{heatText(r)}</span>}
                  </div>
                  <div className="relative border-t border-line2">
                    {down && <div className="absolute inset-x-px top-0 rounded-b-[3px] bg-down" style={{ height: height(r) }} />}
                    {up && <span className={`${text} top-[3px] text-up`}>{heatText(r)}</span>}
                  </div>
                </div>
              );
            })}
            <div className="self-center text-right">
              <span className="inline-block rounded-[7px] px-2 py-[5px] text-[12.5px] font-[650] whitespace-nowrap" style={{ background: heatBg(total) }}>
                {heatText(total)}
              </span>
            </div>
          </div>
        );
      })}
      {months.length > 0 && best && worst && (
        <div className="grid grid-cols-3 gap-5 border-t border-line pt-3.5">
          <div>
            <div className="text-[12px] text-mute">Meses en positivo</div>
            <div className="mt-[3px] text-[18px] font-[550] whitespace-nowrap" style={{ fontStretch: "106%" }}>
              {positive} <span className="text-[12.5px] font-normal text-mute">de {months.length}</span>
            </div>
            <div className="mt-[7px] flex h-1 gap-[2px]">
              <div className="rounded-[2px] bg-up" style={{ width: `${(positive / months.length) * 100}%` }} />
              <div className="flex-1 rounded-[2px] bg-down" />
            </div>
          </div>
          <div>
            <div className="text-[12px] text-mute">Mejor mes</div>
            <div className="mt-[3px] text-[18px] font-[550] whitespace-nowrap" style={{ fontStretch: "106%", color: best.ret > 0 ? "var(--up)" : "var(--down)" }}>
              {heatText(best.ret)} %
            </div>
            <div className="mt-0.5 text-[11.5px] text-mute">{label(best.month)}</div>
          </div>
          <div>
            <div className="text-[12px] text-mute">Peor mes</div>
            <div className="mt-[3px] text-[18px] font-[550] whitespace-nowrap" style={{ fontStretch: "106%", color: worst.ret < 0 ? "var(--down)" : "var(--up)" }}>
              {heatText(worst.ret)} %
            </div>
            <div className="mt-0.5 text-[11.5px] text-mute">{label(worst.month)}</div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Rentabilidad de cada posición ──────────────────────────────────────────

export type ReturnRow = { key: string; name: string; ret: number; gain: number; weight: number; onClick?: () => void };

/**
 * Barra horizontal desde una línea cero: el largo es el % sobre el coste (en
 * escala de raíz, para que +370 % no aplaste a +22 %) y el grosor, el peso en cartera.
 */
export function ReturnBars({ rows }: { rows: ReturnRow[] }) {
  if (!rows.length) return null;
  const root = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
  const pcts = rows.map((r) => r.ret * 100);
  const min = Math.min(0, ...pcts);
  const max = Math.max(1, ...pcts);
  const lo = root(min) * 1.08;
  const hi = root(max) * 1.05;
  const x = (v: number) => ((root(v) - lo) / (hi - lo)) * 100;
  const maxWeight = Math.max(...rows.map((r) => r.weight), 1e-9);
  const ticks: Array<{ left: number; label: string }> = [];
  let last = -99;
  for (const q of [-75, -50, -25, 0, 25, 100, 200, 400, 800]) {
    if (q < min || q > max) continue;
    const left = x(q);
    if (left - last > 9) {
      ticks.push({ left, label: q ? `${q > 0 ? "+" : "−"}${Math.abs(q)} %` : "0" });
      last = left;
    }
  }
  const cols = "minmax(0,140px) minmax(0,1fr) 150px";
  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: cols }}>
        <span />
        <div className="relative h-4">
          {ticks.map((t) => (
            <span key={t.label} className="absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-mute" style={{ left: `${t.left}%` }}>
              {t.label}
            </span>
          ))}
        </div>
        <span />
      </div>
      {[...rows]
        .sort((a, b) => b.ret - a.ret)
        .map((r) => {
          const h = Math.round(3 + 13 * Math.sqrt(r.weight / maxWeight));
          const tone = toneOf(r.gain);
          return (
            <div
              key={r.key}
              className={`grid items-center rounded-[6px] text-[12.5px] transition-[background] duration-100 hover:bg-wash ${r.onClick ? "cursor-pointer" : ""}`}
              style={{ gridTemplateColumns: cols }}
              onClick={r.onClick}
            >
              <span className="truncate pr-3">{r.name}</span>
              <div className="relative h-[26px]">
                <div className="absolute inset-y-0 border-l border-line2" style={{ left: `${x(0)}%` }} />
                <div
                  className="absolute top-1/2 min-w-[2px] rounded-[2px]"
                  style={{ left: `${Math.min(x(0), x(r.ret * 100))}%`, width: `${Math.abs(x(r.ret * 100) - x(0))}%`, height: h, marginTop: -h / 2, background: tone }}
                />
              </div>
              <span className="text-right whitespace-nowrap" style={{ color: tone }}>
                <span className="font-semibold">{pctSigned(r.ret)}</span> <span className="priv pl-1 text-[11.5px] opacity-75">{eurSigned(r.gain)}</span>
              </span>
            </div>
          );
        })}
      <p className="mt-2.5 text-[12px] text-pretty text-mute">El eje está comprimido (escala de raíz) para que una posición muy revalorizada no aplaste a las demás.</p>
    </>
  );
}

// ── Franja de concentración ────────────────────────────────────────────────

/** Un segmento por elemento con anchura = peso; el acento se va apagando. */
export function Strip({ items, hot, onHover, height = 38 }: { items: Array<{ key: string; value: number }>; hot: string | null; onHover: (key: string | null) => void; height?: number }) {
  return (
    <div className="flex gap-[3px]" style={{ height }} onMouseLeave={() => onHover(null)}>
      {items.map((it, i) => (
        <div
          key={it.key}
          onMouseEnter={() => onHover(it.key)}
          className="min-w-[2px] rounded-[5px] transition-[background] duration-150"
          style={{
            flex: `${Math.max(it.value, 0.0001)} 1 0`,
            background: hot === it.key ? "var(--acc)" : `color-mix(in oklab, var(--acc) ${Math.max(14, 62 - i * 5)}%, var(--card))`,
          }}
        />
      ))}
    </div>
  );
}

// ── Flujo de efectivo ──────────────────────────────────────────────────────

export type FlowDot = { key: string; date: string; amount: number; color: string; label: string };

/** En qué tramos se agrupa el flujo según lo largo que sea el periodo: meses, trimestres o años. */
export function flowBuckets(from: string, to: string): Array<{ key: string; label: string }> {
  const ym = (iso: string) => +iso.slice(0, 4) * 12 + (+iso.slice(5, 7) - 1);
  const [a, b] = [ym(from), ym(to)];
  const span = b - a + 1;
  const step = span <= 14 ? 1 : span <= 42 ? 3 : 12;
  const out: Array<{ key: string; label: string }> = [];
  for (let m = Math.floor(a / step) * step; m <= b; m += step) {
    const [y, mo] = [Math.floor(m / 12), m % 12];
    const yy = String(y).slice(2);
    out.push({ key: String(m), label: step === 1 ? (mo === 0 || out.length === 0 ? `${monthName(mo)} ${yy}` : monthName(mo)) : step === 3 ? `T${mo / 3 + 1} ${yy}` : String(y) });
  }
  return out;
}

/**
 * Una columna por mes: lo que entra se apila hacia arriba y lo que sale hacia
 * abajo desde una línea central. Cada tramo es una operación y su altura, el importe.
 */
export function FlowColumns({ dots, from, to, hot, onHover }: { dots: FlowDot[]; from: string; to: string; hot: string | null; onHover: (key: string | null) => void }) {
  const hidden = usePrivate();
  const buckets = flowBuckets(from, to);
  const span = buckets.length > 1 ? +buckets[1]!.key - +buckets[0]!.key : 1;
  const cols = buckets.map((b) => ({ ...b, ins: [] as FlowDot[], outs: [] as FlowDot[], inTotal: 0, outTotal: 0 }));
  const index = new Map(cols.map((c, i) => [c.key, i]));
  for (const dot of dots) {
    const m = +dot.date.slice(0, 4) * 12 + (+dot.date.slice(5, 7) - 1);
    const col = cols[index.get(String(Math.floor(m / span) * span)) ?? -1];
    if (!col) continue;
    if (dot.amount > 0) {
      col.ins.push(dot);
      col.inTotal += dot.amount;
    } else {
      col.outs.push(dot);
      col.outTotal -= dot.amount;
    }
  }
  // La pila más alta deja sitio encima para su cifra.
  const max = Math.max(1, ...cols.map((c) => Math.max(c.inTotal, c.outTotal))) * 1.25;
  const whole = (n: number) => eur(n, 0);
  const stack = (list: FlowDot[]) =>
    [...list]
      .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))
      .map((dot) => (
        <div
          key={dot.key}
          onMouseEnter={() => onHover(dot.key)}
          // El rótulo lleva el importe de la operación.
          title={hidden ? undefined : dot.label}
          className="w-full max-w-[72px] flex-none rounded-[3px] transition-opacity duration-150"
          style={{ height: `${(Math.abs(dot.amount) / max) * 100}%`, minHeight: 2, background: `color-mix(in oklab, ${dot.color} 78%, var(--card))`, opacity: hot && hot !== dot.key ? 0.35 : 1 }}
        />
      ));
  return (
    <div className="relative mt-3.5 flex gap-3 pl-11" onMouseLeave={() => onHover(null)}>
      <span className="absolute top-[92px] left-0 text-[11px] text-mute">entra</span>
      <span className="absolute top-[118px] left-0 text-[11px] text-mute">sale</span>
      {cols.map((c) => {
        const net = c.inTotal - c.outTotal;
        const any = c.inTotal > 0 || c.outTotal > 0;
        return (
          <div key={c.key} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex h-[112px] w-full flex-col-reverse items-center gap-px pb-px">
              {stack(c.ins)}
              <span className="priv pb-[3px] text-[11.5px] font-[550] whitespace-nowrap">{c.inTotal > 0 ? `+${whole(c.inTotal)}` : ""}</span>
            </div>
            <div className="w-full border-t border-line2" />
            <div className="flex h-[112px] w-full flex-col items-center gap-px pt-px">
              {stack(c.outs)}
              <span className="priv pt-[3px] text-[11.5px] font-[550] whitespace-nowrap text-ink2">{c.outTotal > 0 ? `−${whole(c.outTotal)}` : ""}</span>
            </div>
            <div className="mt-1.5 w-full border-t border-line pt-1.5 text-center whitespace-nowrap">
              <div className="text-[12px] text-ink2">{c.label}</div>
              <div className="truncate text-[11.5px]" style={{ color: !any ? "var(--mute)" : net >= 0 ? "var(--up)" : "var(--ink2)" }}>
                {any ? <>neto <span className="priv">{`${net < 0 ? "−" : "+"}${whole(Math.abs(net))}`}</span></> : "sin movimientos"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Lotes vendidos ─────────────────────────────────────────────────────────

/** `detail` (unidades y días) y `result` (ganancia) son datos del usuario: el modo privado los emborrona. */
export type LotBar = { key: string; name: string; from: string; to: string; detail: string; result: ReactNode; gain: number };

/** Una barra por lote, desde que se compró hasta que se vendió; el ejercicio va sombreado. */
export function LotsTimeline({ lots, year }: { lots: LotBar[]; year: number }) {
  const hidden = usePrivate();
  if (!lots.length) return <div className="py-6 text-mute">No hubo ventas en {year}.</div>;
  const first = lots.reduce((m, l) => (l.from < m ? l.from : m), `${year}-01-01`);
  const t0 = dayNum(`${first.slice(0, 4)}-${+first.slice(5, 7) <= 6 ? "01" : "07"}-01`);
  const t1 = dayNum(`${year + 1}-01-01`);
  const pos = (d: number) => ((d - t0) / (t1 - t0)) * 100;
  const years: number[] = [];
  for (let y = +first.slice(0, 4) + 1; y <= year; y++) years.push(y);
  return (
    <div className="relative pt-6 pb-1">
      <div className="absolute inset-y-0 right-0 rounded-lg bg-wash" style={{ left: `${pos(dayNum(`${year}-01-01`))}%` }}>
        <span className="absolute top-[5px] right-2.5 text-[11px] text-ink2">Ejercicio {year}</span>
      </div>
      {years.map((y) => (
        <div key={y} className="absolute inset-y-0 border-l border-dashed border-line2" style={{ left: `${pos(dayNum(`${y}-01-01`))}%` }}>
          <span className="absolute top-[5px] left-1.5 text-[11px] text-mute">{y}</span>
        </div>
      ))}
      {lots.map((l) => {
        const tone = l.gain >= 0 ? "var(--up)" : "var(--down)";
        const a = pos(dayNum(l.from));
        const w = Math.max(pos(dayNum(l.to)) - a, 0.6);
        return (
          <div key={l.key} className="relative h-10">
            <div
              title={hidden ? l.name : `${l.name} · ${l.detail}`}
              className="absolute inset-y-[5px] flex items-center gap-2.5 overflow-hidden rounded-lg px-3 text-[12.5px] whitespace-nowrap transition-transform duration-150 hover:-translate-y-px"
              style={{
                left: `${a}%`,
                width: `${w}%`,
                background: `color-mix(in oklab, ${tone} 20%, var(--card))`,
                border: `1px solid color-mix(in oklab, ${tone} 55%, var(--card))`,
              }}
            >
              <span className="font-[550]">{l.name}</span>
              <span className="priv text-ink2">{l.detail}</span>
              <span className="priv ml-auto font-semibold" style={{ color: tone }}>
                {l.result}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Miniaturas ─────────────────────────────────────────────────────────────

/** Trazado de una serie en un lienzo w×h (para sparklines y tendencias con área). */
export function sparkPath(values: ArrayLike<number>, w: number, h: number): string {
  const n = values.length;
  if (n < 2) return "";
  const step = Math.max(1, Math.floor(n / w));
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i += step) pts.push([i, values[i]!]);
  if (pts[pts.length - 1]![0] !== n - 1) pts.push([n - 1, values[n - 1]!]);
  for (const [, v] of pts) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  return pts.map(([i, v], k) => `${k ? "L" : "M"}${((i / (n - 1)) * w).toFixed(1)} ${(h - 1.5 - ((v - lo) / span) * (h - 3)).toFixed(1)}`).join("");
}

export function Spark({ values, color }: { values: ArrayLike<number>; color: string }) {
  return (
    <svg viewBox="0 0 72 22" className="h-[22px] w-[72px] justify-self-end" aria-hidden>
      <path d={sparkPath(values, 72, 22)} fill="none" stroke={color} strokeWidth={1.3} />
    </svg>
  );
}

/** Tendencia con área, que se estira al ancho disponible. */
export function Trend({ values, color, className = "" }: { values: ArrayLike<number>; color: string; className?: string }) {
  const d = sparkPath(values, 200, 44);
  return (
    <svg viewBox="0 0 200 44" preserveAspectRatio="none" className={className} aria-hidden>
      {d && <path d={`${d}L200 44L0 44Z`} fill={color} opacity={0.13} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Barra repartida ────────────────────────────────────────────────────────

/** `display` es el importe de la parte: el modo privado lo emborrona. */
export type Part = { key: string; label: string; value: number; color: string; display: ReactNode };

/** Un total repartido en partes: barra de 40 px y, debajo, cada cifra con su porcentaje. */
export function SplitBar({ parts, height = 40 }: { parts: Part[]; height?: number }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  if (!(total > 0)) return <div className="text-mute">Sin datos.</div>;
  return (
    <>
      <div className="flex gap-[3px]" style={{ height }}>
        {shown.map((p, i) => (
          <div
            key={p.key}
            title={p.label}
            style={{
              flex: `${p.value} 1 0`,
              background: p.color,
              borderRadius: `${i === 0 ? 8 : 3}px ${i === shown.length - 1 ? 8 : 3}px ${i === shown.length - 1 ? 8 : 3}px ${i === 0 ? 8 : 3}px`,
            }}
          />
        ))}
      </div>
      <div className="mt-3.5 flex flex-wrap gap-x-7 gap-y-3">
        {shown.map((p) => (
          <div key={p.key}>
            <div className="flex items-center gap-[7px] text-[12px] text-mute">
              <span className="size-2 rounded-[2px]" style={{ background: p.color }} />
              {p.label} · {pct(p.value / total)}
            </div>
            <div className="priv mt-[3px] text-[20px] font-[550]" style={{ fontStretch: "106%" }}>
              {p.display}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
