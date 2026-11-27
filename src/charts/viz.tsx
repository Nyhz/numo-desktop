import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dayNum } from "../../shared/dates.ts";
import { eur, eurSigned, monthName, pct, pctSigned } from "../lib/format.ts";
import { growX, growY } from "../ui/motion.ts";
import { usePrivate } from "../ui/privacy.ts";

const toneOf = (v: number): string => (Math.abs(v) < 0.005 ? "var(--ink2)" : v > 0 ? "var(--up)" : "var(--down)");

// Visualizaciones secundarias del diseño (reparto por grupos, rentabilidad mes a
// mes y por posición, franja de concentración, flujo de efectivo, lotes vendidos…).
// Todas en HTML/CSS con medidas en porcentajes: se adaptan solas al ancho.

// ── Reparto ────────────────────────────────────────────────────────────────

export type TreeItem = { key: string; name: string; value: number; group: string };
export type TreeCell = { key: string; name: string; value: number; share: number };
export type TreeGroup = { name: string; total: number; share: number; cells: TreeCell[] };

/** Agrupa los elementos (por tipo, cuenta o divisa), de mayor a menor los grupos y lo de dentro. */
export function treeGroups(items: TreeItem[]): TreeGroup[] {
  const total = items.reduce((s, it) => s + Math.max(0, it.value), 0);
  const map = new Map<string, { name: string; total: number; items: TreeItem[] }>();
  for (const it of items) {
    if (!(it.value > 0)) continue;
    let g = map.get(it.group);
    if (!g) map.set(it.group, (g = { name: it.group, total: 0, items: [] }));
    g.items.push(it);
    g.total += it.value;
  }
  return [...map.values()]
    .sort((a, b) => b.total - a.total)
    .map((g) => ({
      name: g.name,
      total: g.total,
      share: total > 0 ? g.total / total : 0,
      cells: g.items.sort((a, b) => b.value - a.value).map((it) => ({ key: it.key, name: it.name, value: it.value, share: total > 0 ? it.value / total : 0 })),
    }));
}

/** Color de cada grupo, por orden de tamaño: el acento, cada vez más fundido con la tarjeta. */
const ringColor = (rank: number) => (rank ? `color-mix(in oklab, var(--acc) ${[100, 84, 70, 58, 48, 40][rank] ?? 40}%, var(--card))` : "var(--acc)");
/** Filas del desglose de un grupo: con más, las mayores y una última que suma el resto. */
const RING_ROWS = 6;

/**
 * Reparto en anillo: un arco por grupo y, al lado, lo que compone el grupo
 * activo. Se activa al pasar por un arco o por su píldora y se queda así al
 * retirar el cursor; al cambiar los grupos vuelve al mayor.
 */
export function RepartoRing({ groups }: { groups: TreeGroup[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const maskId = useId();
  // La geometría del anillo solo depende de los grupos, no de cuál está activo.
  const arcs = useMemo(() => {
    let angle = -Math.PI / 2;
    const at = (t: number) => `${(100 + 80 * Math.cos(t)).toFixed(2)} ${(100 + 80 * Math.sin(t)).toFixed(2)}`;
    return groups.map((g) => {
      const span = g.share * Math.PI * 2;
      const pad = Math.min(0.014, span / 4);
      const [a0, a1] = [angle + pad, angle + span - pad];
      angle += span;
      // Un grupo que lo es todo no se puede dibujar como un solo arco: su principio y su final coinciden.
      return span > Math.PI * 2 - 0.001 ? "M100 20A80 80 0 1 1 99.99 20" : `M${at(a0)}A80 80 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${at(a1)}`;
    });
  }, [groups]);
  if (!groups.length) return <div className="py-10 text-center text-mute">Sin posiciones que repartir.</div>;
  const active = groups.some((g) => g.name === picked) ? picked : groups[0]!.name;

  return (
    <>
      <div className="-mx-1 mb-3.5 flex flex-wrap gap-1">
        {groups.map((g, i) => (
          <div
            key={g.name}
            onMouseEnter={() => setPicked(g.name)}
            className={`flex cursor-default items-center gap-[7px] rounded-full px-2.5 py-1 text-[12.5px] transition-[background] duration-200 ${g.name === active ? "bg-wash2" : ""}`}
          >
            <span className="size-2 flex-none rounded-[3px]" style={{ background: ringColor(i) }} />
            <span className="text-ink2">{g.name}</span>
            <span className="font-semibold whitespace-nowrap">{pct(g.share)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-7 gap-y-5">
        <div className="relative mx-auto size-[184px] flex-none">
          <svg viewBox="0 0 200 200" className="block size-full overflow-visible" role="img" aria-label="Reparto de la cartera por grupos">
            {/* El anillo se dibuja de una pasada, desde arriba, al aparecer y al cambiar de reparto: una máscara que se va descubriendo. */}
            <mask id={maskId} maskUnits="userSpaceOnUse" x="-20" y="-20" width="240" height="240">
              <circle key={groups.map((g) => g.name).join("|")} className="ring-sweep" cx="100" cy="100" r="80" fill="none" stroke="white" strokeWidth="46" pathLength={1} strokeDasharray="1" transform="rotate(-90 100 100)" />
            </mask>
            <g mask={`url(#${maskId})`}>
            {groups.map((g, i) => (
              <path
                key={g.name}
                d={arcs[i]}
                fill="none"
                stroke={ringColor(i)}
                strokeWidth={g.name === active ? 30 : 22}
                opacity={g.name === active ? 1 : 0.5}
                onMouseEnter={() => setPicked(g.name)}
                className="cursor-pointer"
                style={{ transition: "opacity .25s, stroke-width .25s cubic-bezier(.2,.8,.2,1)" }}
              />
            ))}
            </g>
          </svg>
          {/* El centro de cada grupo, apilados: al cambiar se funden uno en otro. */}
          <div className="pointer-events-none absolute inset-0 grid">
            {groups.map((g) => (
              <div key={g.name} className="col-start-1 row-start-1 flex flex-col items-center justify-center px-[42px] text-center transition-opacity duration-300" style={{ opacity: g.name === active ? 1 : 0 }}>
                <span className="text-[12px] text-balance text-mute">{g.name}</span>
                <span className="text-[24px] leading-[1.15] font-medium tracking-[-0.01em]" style={{ fontStretch: "106%" }}>
                  {pct(g.share)}
                </span>
                <span className="priv text-[12px] text-ink2">{eur(g.total, 0)}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Los desgloses también se apilan en la misma celda: la tarjeta toma el alto del más largo y no salta. */}
        <div className="grid min-w-0 flex-[1_1_240px]">
          {groups.map((g, i) => {
            const on = g.name === active;
            const rest = g.cells.length > RING_ROWS ? g.cells.slice(RING_ROWS - 1) : [];
            const rows: Array<{ key: string; name: string; value: number; share: number; more?: boolean }> = rest.length
              ? [...g.cells.slice(0, RING_ROWS - 1), { key: "resto", name: `${rest.length} más`, value: rest.reduce((s, c) => s + c.value, 0), share: rest.reduce((s, c) => s + c.share, 0), more: true }]
              : g.cells;
            // Las barras van a escala de la fila mayor de las que se ven: «N más» puede sumar más que la primera.
            const top = Math.max(...rows.map((r) => r.value), 1e-9);
            return (
              <div
                key={g.name}
                aria-hidden={!on}
                className="col-start-1 row-start-1 flex flex-col gap-2 self-center"
                style={{ opacity: on ? 1 : 0, transform: on ? "none" : "translateY(6px)", pointerEvents: on ? "auto" : "none", transition: "opacity .3s, transform .3s cubic-bezier(.2,.8,.2,1)" }}
              >
                <span className="text-[12px] text-mute">{g.cells.length === 1 ? "1 posición" : `${g.cells.length} posiciones`}</span>
                {rows.map((c) => (
                  <div key={c.key}>
                    <div className="flex items-baseline gap-2.5 text-[12.5px]">
                      <span className={`min-w-0 flex-1 text-pretty ${c.more ? "text-mute" : ""}`}>{c.name}</span>
                      <span className="font-[550] whitespace-nowrap">{pct(c.share)}</span>
                      <span className="priv min-w-[58px] text-right text-[12px] whitespace-nowrap text-mute">{eur(c.value, 0)}</span>
                    </div>
                    <div className="mt-1 h-[3px] rounded-[2px] bg-raised">
                      <div ref={growX} className="origin-left h-[3px] rounded-[2px] transition-[width] duration-500" style={{ width: `${((c.value / top) * 100).toFixed(1)}%`, background: ringColor(i) }} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Rentabilidad mes a mes ─────────────────────────────────────────────────

const heatBg = (r: number): string => {
  if (Math.abs(r) < 0.0005) return "var(--wash)";
  // Intensidad del 10 al 65 % según la magnitud, saturando en ±6 %.
  const k = Math.min(1, Math.abs(r) / 0.06);
  return `color-mix(in oklab, var(${r > 0 ? "--up" : "--down"}) ${Math.round(10 + k * 55)}%, var(--card))`;
};
const heatText = (r: number) => (Math.abs(r) < 0.00005 ? "0,00" : (r > 0 ? "+" : "−") + (Math.abs(r) * 100).toFixed(2).replace(".", ","));

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
                    {up && <div ref={growY} className="origin-bottom absolute inset-x-px bottom-0 rounded-t-[3px] bg-up" style={{ height: height(r) }} />}
                    {down && <span className={`${text} bottom-[3px] text-down`}>{heatText(r)}</span>}
                  </div>
                  <div className="relative border-t border-line2">
                    {down && <div ref={growY} className="origin-top absolute inset-x-px top-0 rounded-b-[3px] bg-down" style={{ height: height(r) }} />}
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
/** Con muchas posiciones se ven las mejores y las peores; el resto, al pedirlo. */
const RETURN_TOP = 10;
const RETURN_BOTTOM = 5;

export function ReturnBars({ rows }: { rows: ReturnRow[] }) {
  const [all, setAll] = useState(false);
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
    // Separación suficiente para que «+100 %» y «+200 %» no se pisen en una tarjeta estrecha.
    if (left - last > 15) {
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
      {(() => {
        const sorted = [...rows].sort((a, b) => b.ret - a.ret);
        const cut = !all && sorted.length > RETURN_TOP + RETURN_BOTTOM + 2;
        // La escala sigue siendo la de todas: al desplegar, las barras no cambian de tamaño.
        const shown: Array<ReturnRow | null> = cut ? [...sorted.slice(0, RETURN_TOP), null, ...sorted.slice(-RETURN_BOTTOM)] : sorted;
        return shown.map((r) => {
          if (!r)
            return (
              <button key="gap" type="button" onClick={() => setAll(true)} className="my-1 w-full rounded-[6px] py-1 text-center text-[12px] text-mute transition-colors hover:bg-wash hover:text-ink">
                ··· {sorted.length - RETURN_TOP - RETURN_BOTTOM} posiciones más · ver todas
              </button>
            );
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
                  ref={growX}
                  className={`absolute top-1/2 min-w-[2px] rounded-[2px] transition-[left,width] duration-500 ${r.ret < 0 ? "origin-right" : "origin-left"}`}
                  style={{ left: `${Math.min(x(0), x(r.ret * 100))}%`, width: `${Math.abs(x(r.ret * 100) - x(0))}%`, height: h, marginTop: -h / 2, background: tone }}
                />
              </div>
              <span className="text-right whitespace-nowrap" style={{ color: tone }}>
                <span className="font-semibold">{pctSigned(r.ret)}</span> <span className="priv pl-1 text-[11.5px] opacity-75">{eurSigned(r.gain)}</span>
              </span>
            </div>
          );
        });
      })()}
      {all && rows.length > RETURN_TOP + RETURN_BOTTOM + 2 && (
        <button type="button" onClick={() => setAll(false)} className="mt-1 w-full rounded-[6px] py-1 text-center text-[12px] text-mute transition-colors hover:bg-wash hover:text-ink">
          Ver solo las {RETURN_TOP} mejores y las {RETURN_BOTTOM} peores
        </button>
      )}
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

/** `group`: el tipo de operación («Compra»…), para juntar los tramos cuando no caben uno a uno. */
export type FlowDot = { key: string; date: string; amount: number; color: string; label: string; group: string };

/** Alto de cada mitad de la columna (entra / sale). */
const FLOW_LANE = 112;
/** Lo que puede alargarse la pila más alta con los huecos entre tramos sin pisar su cifra. */
const FLOW_SLACK = 8;
const FLOW_MIN = 2;

/** En qué tramos se agrupa el flujo según lo largo que sea el periodo: meses, trimestres o años. */
function flowBuckets(from: string, to: string): Array<{ key: string; label: string }> {
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
/** Columnas del flujo, la escala y si los tramos van uno por tipo porque uno por operación no caben. */
export function flowLayout(dots: FlowDot[], from: string, to: string) {
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
  // Un tramo por operación mientras quepan con su alto mínimo; si no (años con cientos de
  // operaciones), uno por tipo con la suma: de otro modo la pila se saldría de la columna.
  // Se decide para todo el gráfico a la vez, para que todas las columnas se lean igual.
  // La pila más alta ocupa el 80 % del carril (ver `max`); cabe si los altos mínimos y los
  // huecos entre tramos no la alargan más que el margen que queda bajo su cifra.
  const fits = (list: FlowDot[]) => list.reduce((h, d) => h + Math.max((Math.abs(d.amount) / max) * FLOW_LANE, FLOW_MIN) + 1, 0) <= FLOW_LANE * 0.8 + FLOW_SLACK;
  const byType = cols.some((c) => !fits(c.ins) || !fits(c.outs));
  return { cols, max, byType };
}

export function FlowColumns({ dots, from, to, hot, onHover }: { dots: FlowDot[]; from: string; to: string; hot: string | null; onHover: (key: string | null) => void }) {
  const hidden = usePrivate();
  const { cols, max, byType } = flowLayout(dots, from, to);
  const whole = (n: number) => eur(n, 0);
  const grouped = (list: FlowDot[], col: string): Array<FlowDot & { count: number }> => {
    const by = new Map<string, FlowDot & { count: number }>();
    for (const d of list) {
      const g = by.get(d.group);
      if (g) {
        g.amount += d.amount;
        g.count++;
      } else by.set(d.group, { ...d, key: `${col}|${d.group}`, count: 1 });
    }
    return [...by.values()].map((g) => ({ ...g, label: `${g.group}: ${g.count} ${g.count === 1 ? "operación" : "operaciones"} · ${g.amount < 0 ? "−" : "+"}${whole(Math.abs(g.amount))}` }));
  };
  const stack = (list: FlowDot[], col: string) =>
    (byType ? grouped(list, col) : list.map((d) => ({ ...d, count: 1 })))
      .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))
      .map((dot) => (
        <div
          key={dot.key}
          // Un tramo que junta varias operaciones no señala ninguna fila de la tabla.
          onMouseEnter={() => onHover(dot.count === 1 ? dot.key : null)}
          // El rótulo lleva el importe de la operación (o de las que junta).
          title={hidden ? undefined : dot.label}
          className="w-full max-w-[72px] flex-none rounded-[3px] transition-opacity duration-150"
          style={{ height: `${(Math.abs(dot.amount) / max) * 100}%`, minHeight: FLOW_MIN, background: `color-mix(in oklab, ${dot.color} 78%, var(--card))`, opacity: hot && hot !== dot.key ? 0.35 : 1 }}
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
          // Contenedor: con columnas estrechas (ventana pequeña o un periodo largo) el pie se queda en la cifra.
          <div key={c.key} className="@container flex min-w-0 flex-1 flex-col items-center">
            <div className="flex h-[112px] w-full flex-col-reverse items-center gap-px pb-px">
              {stack(c.ins, c.key)}
              <span className="priv pb-[3px] text-[11.5px] font-[550] whitespace-nowrap">{c.inTotal > 0 ? `+${whole(c.inTotal)}` : ""}</span>
            </div>
            <div className="w-full border-t border-line2" />
            <div className="flex h-[112px] w-full flex-col items-center gap-px pt-px">
              {stack(c.outs, c.key)}
              <span className="priv pt-[3px] text-[11.5px] font-[550] whitespace-nowrap text-ink2">{c.outTotal > 0 ? `−${whole(c.outTotal)}` : ""}</span>
            </div>
            <div className="mt-1.5 w-full border-t border-line pt-1.5 text-center whitespace-nowrap">
              <div className="text-[12px] text-ink2">{c.label}</div>
              <div className="truncate text-[11.5px]" style={{ color: !any ? "var(--mute)" : net >= 0 ? "var(--up)" : "var(--ink2)" }}>
                {any ? (
                  <>
                    <span className="@max-[84px]:hidden">neto </span>
                    <span className="priv" title="Neto del mes: lo que entra menos lo que sale">{`${net < 0 ? "−" : "+"}${whole(Math.abs(net))}`}</span>
                  </>
                ) : (
                  <>
                    <span className="@max-[96px]:hidden">sin movimientos</span>
                    <span className="hidden @max-[96px]:inline">—</span>
                  </>
                )}
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
      {lots.map((l) => (
        <LotRow key={l.key} l={l} left={pos(dayNum(l.from))} right={pos(dayNum(l.to))} hidden={hidden} />
      ))}
    </div>
  );
}

/**
 * Una barra de «Lo vendido». Si su texto no cabe dentro (una compra de pocas
 * semanas antes de la venta), se mide y va fuera, a su izquierda, que es donde
 * queda sitio: las barras acaban todas en el ejercicio, a la derecha.
 */
function LotRow({ l, left, right, hidden }: { l: LotBar; left: number; right: number; hidden: boolean }) {
  const tone = l.gain >= 0 ? "var(--up)" : "var(--down)";
  const w = Math.max(right - left, 0.6);
  const bar = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [outside, setOutside] = useState(false);
  useLayoutEffect(() => {
    const check = () => {
      if (!bar.current || !text.current) return;
      // El texto se mide siempre en su sitio de dentro (invisible si va fuera): así no oscila.
      setOutside(text.current.scrollWidth > bar.current.clientWidth - 24);
    };
    check();
    const watch = new ResizeObserver(check);
    if (bar.current) watch.observe(bar.current);
    return () => watch.disconnect();
  }, [l.name, l.detail]);
  const label = (
    <>
      <span className="font-[550]">{l.name}</span>
      <span className="priv text-ink2">{l.detail}</span>
      <span className="priv font-semibold" style={{ color: tone }}>
        {l.result}
      </span>
    </>
  );
  return (
    <div className="relative h-10">
      <div
        ref={bar}
        title={hidden ? l.name : `${l.name} · ${l.detail}`}
        className="absolute inset-y-[5px] overflow-hidden rounded-lg px-3 text-[12.5px] whitespace-nowrap transition-transform duration-150 hover:-translate-y-px"
        style={{ left: `${left}%`, width: `${w}%`, background: `color-mix(in oklab, ${tone} 20%, var(--card))`, border: `1px solid color-mix(in oklab, ${tone} 55%, var(--card))` }}
      >
        <div ref={text} className={`flex h-full w-max min-w-full items-center gap-2.5 [&>:last-child]:ml-auto ${outside ? "invisible" : ""}`}>
          {label}
        </div>
      </div>
      {outside && (
        <div className="absolute inset-y-[5px] flex items-center gap-2.5 pr-2.5 text-[12.5px] whitespace-nowrap" style={{ right: `${100 - left}%` }}>
          {label}
        </div>
      )}
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
