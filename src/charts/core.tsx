import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { dayNum } from "../../shared/dates.ts";
import { monthName } from "../lib/format.ts";

/** Anchura del contenedor, actualizada al redimensionar la ventana. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export const scale = (d0: number, d1: number, r0: number, r1: number) => {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
};

/** Marcas «redondas» (1, 2, 5 × 10ⁿ) que cubren [min, max]. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export type TimeTick = { i: number; label: string };

/** Marcas del eje temporal: días en rangos cortos, meses en medios, años en largos. */
export function timeTicks(dates: string[], width: number): TimeTick[] {
  const n = dates.length;
  if (n < 2) return [];
  const max = Math.max(2, Math.floor(width / 84));
  const span = dayNum(dates[n - 1]!) - dayNum(dates[0]!);
  if (span <= 70) {
    const out: TimeTick[] = [];
    const count = Math.min(max, 6);
    for (let k = 0; k < count; k++) {
      const i = Math.round(((k + 0.5) * (n - 1)) / count);
      const d = dates[i]!;
      out.push({ i, label: `${+d.slice(8, 10)} ${monthName(+d.slice(5, 7) - 1)}` });
    }
    return out;
  }
  // Primer punto de cada mes.
  const starts: Array<{ i: number; y: number; m: number }> = [];
  for (let i = 1; i < n; i++) {
    if (dates[i]!.slice(0, 7) !== dates[i - 1]!.slice(0, 7)) {
      starts.push({ i, y: +dates[i]!.slice(0, 4), m: +dates[i]!.slice(5, 7) - 1 });
    }
  }
  const step = [1, 2, 3, 6, 12, 24, 60].find((s) => starts.length / s <= max) ?? 120;
  return starts
    .filter((s) => (step >= 12 ? s.m === 0 && s.y % (step / 12) === 0 : s.m % step === 0))
    .map((s) => ({
      i: s.i,
      label: step >= 12 ? String(s.y) : s.m === 0 ? `${monthName(0)} ${String(s.y).slice(2)}` : monthName(s.m),
    }));
}

export type TipRow = { color?: string; label: string; value: string; strong?: boolean };

/** Cuadro flotante junto al cursor. El valor manda; la etiqueta acompaña. */
export function Tip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: string; rows: TipRow[] }) {
  const flip = x > width * 0.6;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-36 rounded-lg bg-raised px-3 py-2 text-[12px]"
      style={{
        left: flip ? undefined : x + 14,
        right: flip ? width - x + 14 : undefined,
        top: Math.max(0, y),
        boxShadow: "var(--shadow)",
      }}
    >
      <div className="mb-1 text-muted">{title}</div>
      {rows.map((r, i) => (
        <div key={i} className={`flex items-center gap-2 py-px ${r.strong ? "font-semibold" : ""}`}>
          {r.color ? <span className="h-[2px] w-3 shrink-0 rounded-full" style={{ background: r.color }} /> : <span className="w-3 shrink-0" />}
          <span className="num text-ink">{r.value}</span>
          <span className="ml-auto pl-3 text-ink-2">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export type LegendItem = { key: string; label: string; color: string; line?: boolean };

export function Legend({ items, children }: { items: LegendItem[]; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5">
          <span
            className={it.line ? "h-[2px] w-3.5 rounded-full" : "size-2.5 rounded-[3px]"}
            style={{ background: it.color }}
          />
          {it.label}
        </span>
      ))}
      {children}
    </div>
  );
}
