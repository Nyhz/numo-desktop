import type { ReactNode } from "react";
import { eurAxis, pct } from "../lib/format.ts";
import type { HomeModel } from "./inmuebles-model.ts";

// Visualizaciones de la pantalla Inmuebles, en HTML/CSS con alturas en
// porcentajes. La geometría viene calculada de `inmuebles-model.ts`.

export const HOME_COLOR = {
  own: "var(--acc)",
  forecast: "color-mix(in oklab, var(--acc) 45%, var(--card))",
  sim: "var(--up)",
  bank: "var(--line)",
  principal: "color-mix(in oklab, var(--acc) 55%, var(--card))",
  interest: "color-mix(in oklab, var(--down) 70%, var(--card))",
  costs: "color-mix(in oklab, var(--ink2) 45%, var(--card))",
} as const;

const Key = ({ color, ring = false, children }: { color: string; ring?: boolean; children: ReactNode }) => (
  <span className="flex items-center gap-1.5">
    <span className="size-2 rounded-[2px]" style={{ background: color, boxShadow: ring ? "0 0 0 1px var(--line2)" : undefined }} />
    {children}
  </span>
);

// Con pocos años (inmueble recién comprado o sin hipoteca) las columnas no se estiran a todo el ancho.
const COL = "min-w-0 max-w-[120px] flex-1";

/**
 * Dos series de columnas por año sobre el mismo eje: arriba (240 px), de quién
 * es el inmueble a final de cada año; abajo (84 px, hacia abajo), lo que se
 * paga ese año. Al pasar por un año se atenúan los demás.
 */
export function HomeChart({ model, hot, onHover }: { model: HomeModel; hot: number | null; onHover: (year: number | null) => void }) {
  const { years, ticks, hasLoan } = model;
  const dim = (year: number) => (hot == null || hot === year ? 1 : 0.35);
  return (
    <div className="mt-[22px] mr-14" onMouseLeave={() => onHover(null)}>
      <div className="mb-2 text-[11px] text-mute">{hasLoan ? "De quién es el inmueble a final de cada año" : "Valor del inmueble a final de cada año"}</div>
      <div className="relative h-[240px]" role="img" aria-label={hasLoan ? "Columnas por año: parte del inmueble que es tuya y parte que es del banco. Las cifras están en el cuadro por años." : "Columnas por año con el valor del inmueble."}>
        {ticks.map((t) => (
          <div key={t.value} className="absolute inset-x-0 border-t border-line" style={{ top: t.top }}>
            <span className="absolute -top-2 left-full pl-2 text-[11px] whitespace-nowrap text-mute">{eurAxis(t.value)}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex gap-1">
          {years.map((y) => (
            <div key={y.year} onMouseEnter={() => onHover(y.year)} className={`${COL} flex h-full flex-col justify-end gap-px transition-opacity duration-150`} style={{ opacity: dim(y.year) }}>
              <div className="rounded-t-[4px] transition-[height] duration-300" style={{ height: y.hBank, background: HOME_COLOR.bank }} />
              <div className="transition-[height] duration-300" style={{ height: y.hGain, background: HOME_COLOR.sim }} />
              <div className={hasLoan ? "rounded-b-[1px]" : "rounded-t-[4px] rounded-b-[1px]"} style={{ height: y.hOwn, background: y.future ? HOME_COLOR.forecast : HOME_COLOR.own }} />
            </div>
          ))}
        </div>
      </div>

      <div className={`flex gap-1 border-line2 py-[5px] ${hasLoan ? "border-y" : "border-t"}`}>
        {years.map((y) => (
          <div key={y.year} className={`${COL} flex h-4 items-center justify-center gap-1 text-[11px] whitespace-nowrap ${y.isNow ? "text-ink" : "text-mute"}`}>
            {y.isNow && <span className="size-[5px] flex-none rounded-full bg-ink" />}
            {y.tick}
          </div>
        ))}
      </div>

      {hasLoan && (
        <div className="flex h-[84px] gap-1" role="img" aria-label="Columnas por año: capital e intereses pagados. Las cifras están en el cuadro por años.">
          {years.map((y) => (
            <div key={y.year} onMouseEnter={() => onHover(y.year)} className={`${COL} flex h-full flex-col gap-px transition-opacity duration-150`} style={{ opacity: dim(y.year) }}>
              <div className="rounded-t-[1px]" style={{ height: y.hPrincipal, background: HOME_COLOR.principal }} />
              <div className="rounded-b-[4px]" style={{ height: y.hInterest, background: HOME_COLOR.interest }} />
            </div>
          ))}
        </div>
      )}

      {hasLoan && (
        <div className="mt-2 flex flex-wrap gap-x-[18px] gap-y-1 text-[11px] text-mute">
          <span>Lo que pagas cada año:</span>
          <Key color={HOME_COLOR.principal}>capital</Key>
          <Key color={HOME_COLOR.interest}>intereses</Key>
          <span className="flex-1" />
          <Key color={HOME_COLOR.own}>tuyo</Key>
          <Key color={HOME_COLOR.forecast}>tuyo, previsto</Key>
          <Key color={HOME_COLOR.sim}>si amortizas</Key>
          <Key color={HOME_COLOR.bank} ring>
            del banco
          </Key>
        </div>
      )}
    </div>
  );
}

export type PaidPart = { key: string; label: string; value: number; color: string; display: ReactNode };

/** Un total repartido en partes: barra de 40 px y, debajo, cada cifra con su porcentaje. */
export function PaidSplit({ parts }: { parts: PaidPart[] }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  if (!(total > 0)) return <div className="text-mute">Sin datos.</div>;
  return (
    <>
      <div className="flex h-10 gap-[3px]">
        {shown.map((p) => (
          <div key={p.key} title={p.label} className="rounded-[6px]" style={{ flex: `${p.value} 1 0`, background: p.color }} />
        ))}
      </div>
      <div className="mt-3.5 flex flex-wrap gap-6">
        {shown.map((p) => (
          <div key={p.key}>
            <div className="flex items-center gap-[7px] text-[12px] text-mute">
              <span className="size-2 rounded-[2px]" style={{ background: p.color }} />
              {p.label} · {pct(p.value / total)}
            </div>
            <div className="mt-[3px] text-[17px] font-[550]" style={{ fontStretch: "106%" }}>
              {p.display}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Mini barra capital / intereses de una fila del cuadro. */
export const PaidMiniBar = ({ principal, interest }: { principal: number; interest: number }) => (
  <div className="flex h-1.5 gap-[2px]" title={`${pct(principal / Math.max(1, principal + interest))} capital · ${pct(interest / Math.max(1, principal + interest))} intereses`}>
    <div className="rounded-[2px]" style={{ flex: `${principal} 1 0`, background: HOME_COLOR.principal }} />
    <div className="rounded-[2px]" style={{ flex: `${interest} 1 0`, background: HOME_COLOR.interest }} />
  </div>
);
