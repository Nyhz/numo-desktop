import type { ReactNode } from "react";
import { dayNum } from "../../shared/dates.ts";
import { monthName, pct } from "../lib/format.ts";

// Visualizaciones secundarias del diseño (mapa de reparto, mapa de calor,
// coste→valor, franja de concentración, flujo de efectivo, lotes vendidos…).
// Todas en HTML/CSS con medidas en porcentajes: se adaptan solas al ancho.

// ── Mapa de reparto ────────────────────────────────────────────────────────

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

export function TreeMap({ groups, hot, onHover, height = 250 }: { groups: TreeGroup[]; hot: string | null; onHover: (cell: TreeCell | null) => void; height?: number }) {
  if (!groups.length) return <div className="py-10 text-center text-mute">Sin posiciones que repartir.</div>;
  return (
    <div className="flex gap-1" onMouseLeave={() => onHover(null)}>
      {groups.map((g) => (
        <div key={g.name} className="flex min-w-0 flex-col gap-1.5" style={{ flex: `${g.total} 1 0` }}>
          <div className="flex items-baseline gap-1.5 overflow-hidden text-[12px] whitespace-nowrap">
            <span className="font-semibold">{g.name}</span>
            <span className="text-mute">{pct(g.share)}</span>
          </div>
          <div className="flex flex-col gap-[3px]" style={{ height }}>
            {g.cells.map((c) => (
              <div
                key={c.key}
                onMouseEnter={() => onHover(c)}
                className="min-h-[3px] overflow-hidden rounded-[6px] px-[9px] py-[5px] text-[12px] leading-[1.25] transition-[background] duration-[180ms]"
                style={{ flex: `${c.value} 1 0`, background: hot === c.key ? c.bgHot : c.bg }}
              >
                <div className="flex gap-2" style={{ opacity: c.show ? 1 : 0 }}>
                  <span className="min-w-0 flex-1 truncate font-[550]">{c.name}</span>
                  <span className="whitespace-nowrap text-ink2">{pct(c.share)}</span>
                </div>
              </div>
            ))}
          </div>
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

export function Heatmap({ months }: { months: Array<{ month: string; ret: number }> }) {
  const byYear = new Map<number, Array<number | null>>();
  for (const { month, ret } of months) {
    const y = +month.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, Array<number | null>(12).fill(null));
    byYear.get(y)![+month.slice(5, 7) - 1] = ret;
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);
  const cols = "34px repeat(12, minmax(0, 1fr)) minmax(0, 1.3fr)";
  const positive = months.filter((m) => m.ret > 0.0005).length;
  const best = months.reduce<(typeof months)[number] | null>((b, m) => (!b || m.ret > b.ret ? m : b), null);
  const worst = months.reduce<(typeof months)[number] | null>((b, m) => (!b || m.ret < b.ret ? m : b), null);
  const label = (ym: string) => `${monthName(+ym.slice(5, 7) - 1)} ${ym.slice(0, 4)}`;
  return (
    <>
      <div className="grid gap-[2px] text-center text-[11.5px]" style={{ gridTemplateColumns: cols }}>
        <span />
        {Array.from({ length: 12 }, (_, m) => (
          <span key={m} className="pb-[3px] text-mute">
            {monthName(m)}
          </span>
        ))}
        <span className="text-mute">Año</span>
      </div>
      {years.map((y) => {
        const row = byYear.get(y)!;
        const total = row.reduce<number>((acc, r) => acc * (1 + (r ?? 0)), 1) - 1;
        return (
          <div key={y} className="mt-[3px] grid gap-[2px] text-center text-[11px] tracking-[-0.01em]" style={{ gridTemplateColumns: cols }}>
            <span className="self-center text-left text-mute">{y}</span>
            {row.map((r, m) =>
              r == null ? (
                <span key={m} />
              ) : (
                <span key={m} className="rounded-[6px] py-[11px] font-medium transition-transform duration-100 hover:scale-[1.14]" style={{ background: heatBg(r) }}>
                  {heatText(r)}
                </span>
              ),
            )}
            <span className="rounded-[6px] py-[11px] font-[650]" style={{ background: heatBg(total) }}>
              {heatText(total)}
            </span>
          </div>
        );
      })}
      {months.length > 0 && best && worst && (
        <div className="mt-4 flex flex-wrap gap-x-[22px] gap-y-1 border-t border-line pt-3.5 text-[12.5px] text-ink2">
          <span>
            <span className="text-[18px] font-[550] text-ink" style={{ fontStretch: "106%" }}>
              {positive}
            </span>{" "}
            de {months.length} meses en positivo
          </span>
          <span>
            mejor <span className="font-[550] text-up">{heatText(best.ret)} %</span> · {label(best.month)}
          </span>
          <span>
            peor <span className="font-[550] text-down">{heatText(worst.ret)} %</span> · {label(worst.month)}
          </span>
        </div>
      )}
    </>
  );
}

// ── De coste a valor ───────────────────────────────────────────────────────

export type DumbRow = { key: string; name: string; from: number; to: number; right: ReactNode; onClick?: () => void };

/** Una fila por elemento en una escala común: punto hueco = origen, punto relleno = destino. */
export function Dumbbell({ rows, axis, toneOf }: { rows: DumbRow[]; axis: (v: number) => string; toneOf: (row: DumbRow) => string }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.max(r.from, r.to)));
  const mag = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((m) => (m * mag) / 2).find((s) => max / s <= 3.2) ?? mag * 5;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v < top - step * 1e-6; v += step) ticks.push(v);
  const cols = "minmax(0, 140px) minmax(0, 1fr) 148px";
  const p = (v: number) => `${(v / top) * 100}%`;
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: cols }}>
        <span />
        <div className="relative h-4">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-mute" style={{ left: p(t) }}>
              {t ? axis(t) : "0"}
            </span>
          ))}
        </div>
        <span />
      </div>
      {rows.map((r) => {
        const tone = toneOf(r);
        return (
          <div
            key={r.key}
            onClick={r.onClick}
            className={`grid items-center rounded-[6px] py-[5px] text-[12.5px] transition-colors duration-100 hover:bg-wash ${r.onClick ? "cursor-pointer" : ""}`}
            style={{ gridTemplateColumns: cols }}
          >
            <span className="truncate pr-3">{r.name}</span>
            <div className="relative h-4 border-l border-line2">
              <div className="absolute top-[7px] h-[2px] opacity-60" style={{ left: p(Math.min(r.from, r.to)), width: p(Math.abs(r.to - r.from)), background: tone }} />
              <span className="absolute top-1 -ml-1 size-2 rounded-full border-[1.5px] border-mute bg-card" style={{ left: p(r.from) }} />
              <span className="absolute top-[3px] -ml-[5px] size-2.5 rounded-full" style={{ left: p(r.to), background: tone }} />
            </div>
            <span className="text-right whitespace-nowrap" style={{ color: tone }}>
              {r.right}
            </span>
          </div>
        );
      })}
    </div>
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

/**
 * Un círculo por operación sobre un eje temporal: arriba si entra dinero, abajo
 * si sale; el diámetro crece con la raíz del importe. Los que coinciden en
 * fecha se apilan.
 */
export function FlowChart({ dots, from, to, hot, onHover, height = 190 }: { dots: FlowDot[]; from: string; to: string; hot: string | null; onHover: (key: string | null) => void; height?: number }) {
  const t0 = dayNum(from);
  const t1 = Math.max(t0 + 1, dayNum(to));
  const pos = (d: string) => ((dayNum(d) - t0) / (t1 - t0)) * 100;
  // El tamaño se escala al mayor importe visible para que quepa siempre.
  const biggest = Math.max(1, ...dots.map((d) => Math.abs(d.amount)));
  const k = 29 / Math.sqrt(biggest);
  const stack = new Map<string, number>();
  const placed = [...dots]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      const size = Math.round(Math.max(7, Math.min(34, 5 + Math.sqrt(Math.abs(d.amount)) * k)));
      const up = d.amount > 0;
      // Clave por columna de ~1 % de ancho para apilar también fechas muy próximas.
      const key = `${Math.round(pos(d.date))}${up}`;
      const off = stack.get(key) ?? 0;
      stack.set(key, off + size + 2);
      return { ...d, size, top: up ? `calc(50% - ${4 + off + size}px)` : `calc(50% + ${4 + off}px)` };
    });

  // Marcas de mes (o de año si el periodo es largo).
  const ticks: Array<{ left: number; label: string }> = [];
  const months = (t1 - t0) / 30.4;
  const every = months > 40 ? 12 : months > 20 ? 3 : months > 10 ? 2 : 1;
  const start = new Date(t0 * 86_400_000);
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth() + 1; ; m++) {
    if (m > 11) {
      m = 0;
      y++;
    }
    const day = Date.UTC(y, m, 1) / 86_400_000;
    if (day > t1) break;
    if (m % every === 0) ticks.push({ left: ((day - t0) / (t1 - t0)) * 100, label: every >= 12 ? String(y) : m === 0 ? `${monthName(0)} ${String(y).slice(2)}` : monthName(m) });
  }

  return (
    <div className="relative mt-2 mr-4 ml-11" style={{ height }} onMouseLeave={() => onHover(null)}>
      <div className="absolute top-1/2 -right-4 -left-11 border-t border-line2" />
      <span className="absolute top-[calc(50%-20px)] -left-11 text-[11px] text-mute">entra</span>
      <span className="absolute top-[calc(50%+5px)] -left-11 text-[11px] text-mute">sale</span>
      {ticks.map((t, i) => (
        <div key={i} className="absolute inset-y-0 border-l border-dashed border-line" style={{ left: `${t.left}%` }}>
          <span className="absolute bottom-0 left-1.5 text-[11px] whitespace-nowrap text-mute">{t.label}</span>
        </div>
      ))}
      {placed.map((d) => (
        <div
          key={d.key}
          title={d.label}
          onMouseEnter={() => onHover(d.key)}
          className="absolute rounded-full transition-[transform,background] duration-150"
          style={{
            left: `${pos(d.date)}%`,
            top: d.top,
            width: d.size,
            height: d.size,
            marginLeft: -d.size / 2,
            border: `1.5px solid ${d.color}`,
            background: hot === d.key ? d.color : `color-mix(in oklab, ${d.color} 32%, transparent)`,
            transform: `scale(${hot === d.key ? 1.3 : 1})`,
            zIndex: hot === d.key ? 2 : 1,
          }}
        />
      ))}
    </div>
  );
}

// ── Lotes vendidos ─────────────────────────────────────────────────────────

export type LotBar = { key: string; name: string; from: string; to: string; detail: string; result: ReactNode; gain: number };

/** Una barra por lote, desde que se compró hasta que se vendió; el ejercicio va sombreado. */
export function LotsTimeline({ lots, year }: { lots: LotBar[]; year: number }) {
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
              title={`${l.name} · ${l.detail}`}
              className="absolute inset-y-[5px] flex items-center gap-2.5 overflow-hidden rounded-lg px-3 text-[12.5px] whitespace-nowrap transition-transform duration-150 hover:-translate-y-px"
              style={{
                left: `${a}%`,
                width: `${w}%`,
                background: `color-mix(in oklab, ${tone} 20%, var(--card))`,
                border: `1px solid color-mix(in oklab, ${tone} 55%, var(--card))`,
              }}
            >
              <span className="font-[550]">{l.name}</span>
              <span className="text-ink2">{l.detail}</span>
              <span className="ml-auto font-semibold" style={{ color: tone }}>
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
            <div className="mt-[3px] text-[20px] font-[550]" style={{ fontStretch: "106%" }}>
              {p.display}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
