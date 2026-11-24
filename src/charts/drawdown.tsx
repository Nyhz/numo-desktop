import { useMemo, useState } from "react";
import { isoOf } from "../../shared/dates.ts";
import { drawdown } from "../../shared/engine/timeline.ts";
import { dateShort, monthName } from "../lib/format.ts";

// «Caída desde máximos»: cuánto ha llegado a bajar la cartera desde su punto más
// alto anterior. Las cifras salen del motor (`drawdown`); aquí solo se dibuja:
// curva y área en HTML/SVG, con la escala fuera, a la derecha, y el dato del
// cursor en la cabecera, sin ficha flotante.

/** −10,08 %: signo menos de verdad y coma decimal. */
const fall = (ratio: number, digits = 2) => `${ratio < -0.00005 ? "−" : ""}${Math.abs(ratio * 100).toFixed(digits).replace(".", ",")} %`;

/** Cada cuántos puntos va una marca del eje, para que queden tres o cuatro. */
const tickStep = (worstPct: number) => (worstPct <= 16 ? 4 : worstPct <= 40 ? 10 : 20);

export function DrawdownCard({ returns, start }: { returns: Float64Array; /** Número de día del primer dato. */ start: number }) {
  const [hover, setHover] = useState(-1);

  // La serie y su geometría solo cambian con los datos, no con el cursor.
  const view = useMemo(() => {
    const dd = drawdown(returns);
    const n = dd.series.length;
    const step = tickStep(-dd.worst * 100);
    // El eje llega al múltiplo del paso que queda por debajo de la caída máxima.
    const low = -Math.max(step, Math.ceil((-dd.worst * 100) / step - 1e-9) * step) / 100;
    const ticks: number[] = [];
    for (let q = 0; q >= low * 100 - 1e-9; q -= step) ticks.push(q);
    const y = (v: number) => (v / low) * 100;
    // Con miles de días basta un punto cada dos píxeles; el de la caída máxima no se pierde.
    const every = Math.max(1, Math.ceil(n / 500));
    let line = "";
    for (let i = 0; i < n; i++) {
      if (i % every && i !== n - 1 && i !== dd.worstAt) continue;
      line += `${line ? "L" : "M"}${((i / Math.max(1, n - 1)) * 1000).toFixed(1)} ${y(dd.series[i]!).toFixed(2)}`;
    }
    // Una etiqueta de mes cada tres; con historias largas, cada seis o cada año.
    const months: Array<{ left: number; m: number; year: number }> = [];
    for (let i = 1; i < n; i++) {
      const [a, b] = [isoOf(start + i - 1), isoOf(start + i)];
      if (a.slice(0, 7) !== b.slice(0, 7)) months.push({ left: (i / (n - 1)) * 100, m: +b.slice(5, 7) - 1, year: +b.slice(0, 4) });
    }
    const gap = [3, 6, 12, 24].find((g) => months.length / g <= 7) ?? 60;
    const labels = months.filter((mo) => (gap >= 12 ? mo.m === 0 && mo.year % (gap / 12) === 0 : mo.m % gap === 0)).map((mo) => ({ left: mo.left, text: gap >= 12 ? String(mo.year) : `${monthName(mo.m)} ${String(mo.year).slice(2)}` }));
    return { dd, n, low, ticks, y, line, labels };
  }, [returns, start]);

  const { dd, n, low, ticks, y, line, labels } = view;
  if (n < 2) return null;
  const at = hover >= 0 ? Math.round(hover * (n - 1)) : -1;
  const pos = (i: number) => `${((i / (n - 1)) * 100).toFixed(2)}%`;
  // La fecha de la caída máxima va a la derecha del punto, salvo que no quepa.
  const labelLeft = dd.worstAt / (n - 1) > 0.6;
  const figure = "mt-0.5 text-[20px] font-[550]";

  return (
    <section className="card flex min-w-0 flex-col px-5 py-[18px]">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="wide font-semibold">Caída desde máximos</span>
        <span className="flex-1 text-right text-[12.5px] whitespace-nowrap text-mute">{at >= 0 ? `${dateShort(isoOf(start + at))} · ${fall(dd.series[at]!)}` : `desde el ${dateShort(isoOf(start))}`}</span>
      </div>
      <div className="mt-3.5 grid gap-x-5 gap-y-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))" }}>
        <div>
          <div className="text-[12px] text-mute">Caída máxima</div>
          <div className={`${figure} text-down`} style={{ fontStretch: "106%" }}>
            {fall(dd.worst)}
          </div>
        </div>
        <div>
          <div className="text-[12px] text-mute">Ahora</div>
          <div className={figure} style={{ fontStretch: "106%" }}>
            {fall(dd.now)}
          </div>
        </div>
        <div>
          <div className="text-[12px] text-mute">Volatilidad anual</div>
          <div className={figure} style={{ fontStretch: "106%" }}>
            {dd.volatility == null ? "—" : `${(dd.volatility * 100).toFixed(2).replace(".", ",")} %`}
          </div>
        </div>
        <div>
          <div className="text-[12px] text-mute">Peor día</div>
          <div className={figure} style={{ fontStretch: "106%" }}>
            {fall(dd.worstDay)}
          </div>
        </div>
      </div>

      <div
        className="relative mt-5 mr-[46px] min-h-[150px] flex-1 cursor-crosshair"
        role="img"
        aria-label={`Caída desde máximos: máxima de ${fall(dd.worst)} el ${dateShort(isoOf(start + dd.worstAt))}`}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)));
        }}
        onMouseLeave={() => setHover(-1)}
      >
        {ticks.map((q) => (
          <div key={q} className={`absolute inset-x-0 border-t ${q ? "border-line" : "border-line2"}`} style={{ top: `${y(q / 100)}%` }}>
            <span className="absolute -top-2 left-full pl-2.5 text-[11px] whitespace-nowrap text-mute">{q ? `−${-q} %` : "0 %"}</span>
          </div>
        ))}
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <path d={`${line}L1000 0L0 0Z`} fill="var(--down)" opacity={0.16} />
          <path d={line} fill="none" stroke="var(--down)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        {dd.worst < -0.0005 && (
          <div className="pointer-events-none absolute" style={{ left: pos(dd.worstAt), top: `${y(dd.worst)}%` }}>
            <span className="absolute -m-[4.5px] size-[9px] rounded-full border-2 border-down bg-card" />
            <span className="absolute -top-2 text-[11.5px] whitespace-nowrap text-ink2" style={labelLeft ? { right: 12 } : { left: 12 }}>
              {dateShort(isoOf(start + dd.worstAt))}
            </span>
          </div>
        )}
        {at >= 0 && (
          <div className="pointer-events-none absolute inset-y-0 border-l border-line2" style={{ left: pos(at) }}>
            <span className="absolute left-0 -m-[4.5px] size-[9px] rounded-full bg-down" style={{ top: `${y(dd.series[at]!)}%`, boxShadow: "0 0 0 3px var(--card)" }} />
          </div>
        )}
      </div>
      <div className="relative mt-2 mr-[46px] h-[18px]">
        {labels.map((l) => (
          <span key={l.left} className="absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-mute" style={{ left: `${l.left}%` }}>
            {l.text}
          </span>
        ))}
      </div>
    </section>
  );
}
