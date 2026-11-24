import { useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Allocation, Plan, PlanBucket } from "../../shared/engine/plan.ts";
import type { Goal } from "../../shared/types.ts";
import { eur, num } from "../lib/format.ts";
import { barScale, deviationCurve, offAfter, scaleTicks } from "./plan-math.ts";

// Visualizaciones de la pantalla Plan: una barra por bloque sobre una escala
// común, la curva de cuánto corrige cada euro y el reparto de la aportación.
// HTML/CSS con medidas en porcentajes; las cifras llegan del motor (`shared/engine/plan.ts`).

const pp = (v: number, d = 1) => `${num(v, d, d)} %`;
/** Objetivo tal como se escribió: 35 %, 12,5 %. */
const target = (v: number) => `${num(v, 2)} %`;
const pos = (v: number) => `${Math.max(0, v)}%`;

export const NO_BLOCK = "__none";
export const bucketKey = (b: PlanBucket): string => b.goal?.id ?? NO_BLOCK;

/** Lo que está bajo el cursor: un bloque y, si viene de la tabla o de un tramo, un activo. */
export type PlanHot = { block: string; asset?: string } | null;

const COLS = "minmax(0,170px) minmax(0,1fr) 176px";
/**
 * Rayado diagonal de lo que sobra. Las rayas son el gris medio del tema
 * multiplicado sobre la barra: oscurecen el tramo igual en oscuro que en claro
 * sin escribir ningún color fijo.
 */
const hatch = (gap: number) => `repeating-linear-gradient(135deg, color-mix(in oklab, var(--mute) 80%, transparent) 0 2px, transparent 2px ${gap}px)`;

// ── Una barra por bloque ───────────────────────────────────────────────────

/**
 * Cada bloque es una barra de 38 px hasta su peso de hoy, hecha con sus activos
 * como tramos. La marca vertical es el objetivo: si el bloque se pasa, lo que
 * excede va rayado; si no llega, un hueco punteado hasta la marca. Lo que
 * añadiría la aportación se pinta en verde al final de la barra.
 */
export function PlanBars({
  plan,
  alloc,
  hot,
  onHover,
  onStep,
}: {
  plan: Plan;
  alloc: Allocation[];
  hot: PlanHot;
  onHover: (hot: PlanHot) => void;
  /** Sube o baja un punto el objetivo del bloque. */
  onStep: (goal: Goal, delta: number) => void;
}) {
  const scale = barScale(plan, alloc);
  const after = new Map(alloc.map((a) => [a.goal.id, a.weightAfterPct]));
  const x = (v: number) => pos((v / scale) * 100);
  const hotBucket = hot ? plan.buckets.find((b) => bucketKey(b) === hot.block) : undefined;
  const info = hotBucket
    ? [hotBucket.goal?.name ?? "Sin bloque", eur(hotBucket.valueEur, 0), hotBucket.positions.map((p) => `${p.asset.name} ${pp(plan.totalEur > 0 ? (p.valueEur / plan.totalEur) * 100 : 0)}`).join(" · ") || "sin posiciones"].join(" · ")
    : "Pasa el cursor por un bloque para ver qué lo compone";

  return (
    <>
      <div onMouseLeave={() => onHover(null)} className="mt-[26px]">
        <div className="-mx-2 grid items-center gap-4 px-2" style={{ gridTemplateColumns: COLS }}>
          <span />
          <div className="relative h-[18px]">
            {scaleTicks(scale).map((q) => (
              <span key={q} className="absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-mute" style={{ left: x(q) }}>
                {q} %
              </span>
            ))}
          </div>
          <span className="text-right text-[11px] text-mute">hoy · objetivo</span>
        </div>

        {plan.buckets.map((b) => {
          const key = bucketKey(b);
          const goal = b.goal;
          const near = Math.abs(b.driftPct) < 0.5;
          const over = !!goal && b.weightPct > b.targetPct + 0.05;
          const under = !!goal && b.weightPct < b.targetPct - 0.05;
          const to = goal ? (after.get(goal.id) ?? b.weightPct) : b.weightPct;
          const tint = goal ? "var(--acc)" : "var(--ink2)";
          return (
            <div
              key={key}
              onMouseEnter={() => onHover({ block: key })}
              className={`-mx-2 grid items-center gap-4 rounded-xl px-2 py-[9px] transition-colors duration-[120ms] ${hot?.block === key ? "bg-wash" : ""}`}
              style={{ gridTemplateColumns: COLS }}
            >
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold" style={{ fontStretch: "104%" }}>
                  {goal?.name ?? "Sin bloque"}
                </div>
                <div className={`truncate text-[12px] ${!goal || near ? "text-mute" : b.gapEur > 0 ? "text-acc" : "text-ink2"}`}>
                  {!goal ? `${eur(b.valueEur, 0)} sin asignar` : near ? "en su sitio" : b.gapEur > 0 ? `faltan ${eur(b.gapEur, 0)}` : `sobran ${eur(-b.gapEur, 0)}`}
                </div>
              </div>

              <div className="relative h-[38px] border-l border-line2">
                <div className="absolute inset-y-0 left-0 flex gap-[2px]" style={{ width: x(b.weightPct) }}>
                  {b.positions.map((p, n) => {
                    const share = plan.totalEur > 0 ? (p.valueEur / plan.totalEur) * 100 : 0;
                    const isHot = hot?.asset === p.asset.id;
                    const strength = Math.max(14, (goal ? 62 : 40) - n * (goal ? 14 : 9)) + (isHot ? 24 : 0);
                    return (
                      <div
                        key={p.asset.id}
                        title={`${p.asset.name} · ${eur(p.valueEur, 0)} · ${pp(share)}`}
                        onMouseEnter={() => onHover({ block: key, asset: p.asset.id })}
                        className="flex min-w-[2px] items-center overflow-hidden rounded-[5px] text-[12px] transition-[background] duration-150"
                        style={{ flex: `${Math.max(p.valueEur, 0)} 1 0`, background: `color-mix(in oklab, ${tint} ${strength}%, var(--card))` }}
                      >
                        {/* El rótulo solo cabe en los tramos que ocupan más del 15 % del ancho. */}
                        <span className="truncate px-[9px] font-[550]" style={{ opacity: share / scale > 0.15 ? 1 : 0 }}>
                          {p.asset.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {over && <div className="pointer-events-none absolute inset-y-0 rounded-r-[5px] mix-blend-multiply" style={{ left: x(b.targetPct), width: x(b.weightPct - b.targetPct), background: hatch(6) }} />}
                {under && <div className="pointer-events-none absolute inset-y-0 rounded-r-[5px] border border-l-0 border-dashed border-mute" style={{ left: x(b.weightPct), width: x(b.targetPct - b.weightPct) }} />}
                <div
                  className="pointer-events-none absolute inset-y-0 ml-[2px] rounded-[5px] bg-up transition-[width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
                  style={{ left: x(b.weightPct), width: x(to - b.weightPct) }}
                />
                {goal && <div className="pointer-events-none absolute -inset-y-[7px] -ml-px w-[2px] rounded-[1px] bg-ink" style={{ left: x(b.targetPct) }} />}
              </div>

              <div className="flex items-center justify-end gap-2.5">
                <span className="text-[15px] font-semibold whitespace-nowrap" style={{ fontStretch: "106%" }}>
                  {pp(b.weightPct)}
                </span>
                {goal ? (
                  <div className="flex items-center gap-[2px] rounded-full bg-wash p-[2px]">
                    <StepBtn label={`Bajar el objetivo de ${goal.name}`} disabled={goal.targetPct <= 0} onClick={() => onStep(goal, -1)}>
                      −
                    </StepBtn>
                    <span className="min-w-[38px] text-center text-[12.5px] font-semibold whitespace-nowrap">{target(goal.targetPct)}</span>
                    <StepBtn label={`Subir el objetivo de ${goal.name}`} disabled={goal.targetPct >= 100} onClick={() => onStep(goal, 1)}>
                      +
                    </StepBtn>
                  </div>
                ) : (
                  <span className="w-[90px] text-center text-[12px] text-mute">sin objetivo</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-[18px] text-[12px] text-mute">
        <Key swatch={<span className="h-[9px] w-3.5 rounded-[2px] bg-acc" />}>peso de hoy, por activo</Key>
        <Key swatch={<span className="h-[13px] w-[2px] rounded-[1px] bg-ink" />}>objetivo</Key>
        <Key swatch={<span className="h-[9px] w-3.5 rounded-[2px] bg-acc bg-blend-multiply" style={{ backgroundImage: hatch(5) }} />}>sobra</Key>
        <Key swatch={<span className="h-[9px] w-3.5 rounded-[2px] border border-dashed border-mute" />}>falta</Key>
        <Key swatch={<span className="h-[9px] w-3.5 rounded-[2px] bg-up" />}>con la aportación</Key>
        <span className="min-w-[200px] flex-1 truncate text-right text-ink2">{info}</span>
      </div>
    </>
  );
}

const Key = ({ swatch, children }: { swatch: ReactNode; children: ReactNode }) => (
  <span className="flex items-center gap-1.5">
    {swatch}
    {children}
  </span>
);

function StepBtn({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-[22px] place-items-center rounded-full leading-none text-ink2 transition-[background,color,transform] duration-150 hover:bg-raised hover:text-ink active:scale-90 disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

// ── Cuánto corrige cada euro ───────────────────────────────────────────────

/**
 * La desviación en función del importe aportado. Se pulsa o se arrastra para
 * elegir el importe (y con las flechas, si tiene el foco).
 */
export function PlanCurve({ plan, amount, max, onPick }: { plan: Plan; amount: number; max: number; onPick: (amountEur: number) => void }) {
  // Mientras se arrastra, la escala no cambia aunque el importe baje de un tramo «redondo».
  const [held, setHeld] = useState<number | null>(null);
  const span = held ?? max;
  const points = useMemo(() => deviationCurve(plan, span), [plan, span]);
  const off0 = plan.offPct;
  const off1 = useMemo(() => offAfter(plan, amount), [plan, amount]);
  // Con todo a un solo bloque la curva puede acabar por encima de donde empieza: el eje cubre su máximo.
  const top = Math.max(off0, off1, ...points.map((p) => p.offPct), 0.5) * 1.12;
  const line = points.map((p, i) => `${i ? "L" : "M"}${((p.amountEur / span) * 1000).toFixed(1)} ${(110 - (p.offPct / top) * 110).toFixed(1)}`).join("");
  const frac = span > 0 ? Math.min(1, Math.max(0, amount / span)) : 0;
  const step = span / 100;

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onPick((Math.round(f * 100) * span) / 100);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? amount + step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? amount - step : e.key === "Home" ? 0 : e.key === "End" ? span : null;
    if (next == null) return;
    e.preventDefault();
    onPick(Math.max(0, Math.min(span, Math.round(next / step) * step)));
  };

  return (
    <>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Importe de la aportación"
        aria-valuemin={0}
        aria-valuemax={span}
        aria-valuenow={Math.min(amount, span)}
        aria-valuetext={`${eur(amount, 0)}: la desviación quedaría en ${pp(off1)}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setHeld(span);
          pick(e);
        }}
        onPointerMove={(e) => held != null && pick(e)}
        onPointerUp={() => setHeld(null)}
        onPointerCancel={() => setHeld(null)}
        className="relative mt-1 h-[150px] cursor-ew-resize touch-none rounded-[4px] select-none"
      >
        <svg viewBox="0 0 1000 110" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <path d={`${line}L1000 110L0 110Z`} fill="var(--up)" opacity={0.13} />
          <path d={line} fill="none" stroke="var(--up)" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 border-t border-line2" />
        <span className="pointer-events-none absolute -top-1 right-0 text-[11px] text-mute">desviación de partida {pp(off0)}</span>
        <div className="pointer-events-none absolute inset-y-0 border-l border-ink2" style={{ left: pos(frac * 100) }}>
          <span className="absolute -left-1.5 -mt-1.5 size-[11px] rounded-full bg-up shadow-[0_0_0_3px_var(--card)]" style={{ top: pos((1 - off1 / top) * 100) }} />
          <span className={`absolute -mt-[26px] text-[12px] font-semibold whitespace-nowrap ${frac > 0.85 ? "right-2.5" : "left-2.5"}`} style={{ top: pos((1 - off1 / top) * 100) }}>
            {pp(off1)}
          </span>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-mute">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{eur(span * f, 0)}</span>
        ))}
      </div>
    </>
  );
}

// ── Dónde poner la aportación ──────────────────────────────────────────────

/** Barra de 40 px repartida entre los bloques que reciben y, por bloque, importe y peso antes → después. */
export function PlanSplit({ alloc, amount }: { alloc: Allocation[]; amount: number }) {
  const recv = alloc.filter((a) => a.amountEur > 0).sort((a, b) => b.amountEur - a.amountEur);
  // Céntimos solo si el reparto los tiene: con ellos, las partes suman exactamente la aportación.
  const digits = recv.some((a) => Math.abs(a.amountEur - Math.round(a.amountEur)) > 0.004) ? 2 : 0;
  return (
    <>
      <div className="flex h-10 gap-[3px]">
        {recv.map((a) => (
          <div
            key={a.goal.id}
            title={`${a.goal.name} · +${eur(a.amountEur, digits)}`}
            className="flex min-w-[3px] items-center overflow-hidden rounded-[7px] px-2.5 text-[12.5px] font-semibold whitespace-nowrap transition-[flex] duration-300"
            style={{ flex: `${a.amountEur} 1 0`, background: "color-mix(in oklab, var(--up) 62%, var(--card))" }}
          >
            <span style={{ opacity: a.amountEur / amount > 0.14 ? 1 : 0 }}>{a.goal.name}</span>
          </div>
        ))}
      </div>
      <div className="mt-3">
        {recv.map((a) => (
          <div key={a.goal.id} className="grid items-center gap-3 border-t border-line py-2 text-[12.5px]" style={{ gridTemplateColumns: "minmax(0,1fr) 96px 170px" }}>
            <span className="truncate font-[550]">{a.goal.name}</span>
            <span className="text-right font-semibold text-up">+{eur(a.amountEur, digits)}</span>
            <span className="text-right whitespace-nowrap text-ink2">
              {pp(a.weightBeforePct)} → <span className="font-semibold text-ink">{pp(a.weightAfterPct)}</span> <span className="text-mute">de {target(a.targetPct)}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
