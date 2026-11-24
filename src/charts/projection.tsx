import { useMemo, useState } from "react";
import { parseNumber } from "../../shared/csv.ts";
import { monthsToReach, projectPortfolio, projectionDates } from "../../shared/engine/projection.ts";
import { equitySeries, type PropertyView } from "../../shared/engine/realestate.ts";
import { eur, eurAxis, monthLong, num } from "../lib/format.ts";
import { Card, Pills, Priv } from "../ui/kit.tsx";
import { HeroChart, stackModel } from "./hero.tsx";

// Proyección del patrimonio (pantalla Plan): cuánto habría dentro de N años con
// una aportación mensual y una rentabilidad anual dadas. Las cuentas están en
// `shared/engine/projection.ts`; lo de los inmuebles sale del cuadro de la hipoteca.

const KEY = "numo.proyeccion";
type Inputs = { monthly: string; annual: string; years: "10" | "20" | "30"; goal: string };

const yearsText = (months: number) => {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} ${y === 1 ? "año" : "años"}` : "", m ? `${m} ${m === 1 ? "mes" : "meses"}` : ""].filter(Boolean).join(" y ") || "ya";
};

export function Projection({
  portfolio,
  reserve,
  homes,
  today,
  suggestedMonthly,
}: {
  portfolio: number;
  /** Fondo de emergencia: cuenta para el patrimonio y se deja tal cual. */
  reserve: number;
  homes: PropertyView[];
  today: string;
  /** Aportación media mensual del último año, como punto de partida. */
  suggestedMonthly: number;
}) {
  const [inputs, setInputs] = useState<Inputs>(() => {
    const base: Inputs = { monthly: num(suggestedMonthly, 0), annual: "5", years: "20", goal: "" };
    try {
      return { ...base, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Inputs>) };
    } catch {
      return base;
    }
  });
  const set = (patch: Partial<Inputs>) => {
    const next = { ...inputs, ...patch };
    setInputs(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const monthly = Math.max(0, parseNumber(inputs.monthly.replace(/\./g, "")) || 0);
  const annual = Math.min(30, Math.max(-20, parseNumber(inputs.annual) || 0));
  const goal = Math.max(0, parseNumber(inputs.goal.replace(/\./g, "")) || 0);
  const months = +inputs.years * 12;

  const view = useMemo(() => {
    const dates = projectionDates(today, months);
    const cartera = projectPortfolio(portfolio, monthly, annual, months);
    const inmuebles = equitySeries(homes, dates);
    const total = cartera.map((v, i) => v + inmuebles[i]! + reserve);
    return { dates, cartera, inmuebles, total };
  }, [today, months, portfolio, reserve, monthly, annual, homes]);

  const model = useMemo(
    () =>
      stackModel({
        dates: view.dates,
        axis: eurAxis,
        format: (v) => eur(v, 0),
        priv: true,
        series: [
          ...(homes.length ? [{ label: "Inmuebles · lo que ya será tuyo", color: "var(--s8)", values: view.inmuebles }] : []),
          ...(reserve > 0 ? [{ label: "Fondo de emergencia", color: "var(--s2)", values: view.dates.map(() => reserve) }] : []),
          { label: "Cartera", color: "var(--acc)", values: view.cartera },
        ],
      }),
    [view, homes.length, reserve],
  );

  const end = months;
  const contributed = monthly * months;
  const grown = view.cartera[end]! - portfolio - contributed;
  const reach = goal > 0 ? monthsToReach(view.total, goal) : null;
  const field = "field h-8 text-right";

  return (
    <Card title="Proyección del patrimonio" note="una cuenta, no una predicción: los mercados no suben en línea recta">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-ink2">Aportación al mes</span>
          <span className="relative block w-[130px]">
            <input className={`${field} pr-7`} inputMode="decimal" value={inputs.monthly} onChange={(e) => set({ monthly: e.target.value })} />
            <span className="pointer-events-none absolute top-1.5 right-2.5 text-mute">€</span>
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-ink2">Rentabilidad anual</span>
          <span className="relative block w-[96px]">
            <input className={`${field} pr-7`} inputMode="decimal" value={inputs.annual} onChange={(e) => set({ annual: e.target.value })} />
            <span className="pointer-events-none absolute top-1.5 right-2.5 text-mute">%</span>
          </span>
        </label>
        <div>
          <span className="mb-1.5 block text-[12px] text-ink2">Horizonte</span>
          {/* A la altura de los campos de al lado, que son algo más altos que las píldoras. */}
          <div className="flex h-8 items-center">
            <Pills label="Horizonte de la proyección" size="sm" value={inputs.years} onChange={(years) => set({ years })} options={[["10", "10 años"], ["20", "20 años"], ["30", "30 años"]]} />
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-ink2">Objetivo (opcional)</span>
          <span className="relative block w-[150px]">
            <input className={`${field} pr-7`} inputMode="decimal" placeholder="p. ej. 500.000" value={inputs.goal} onChange={(e) => set({ goal: e.target.value })} />
            <span className="pointer-events-none absolute top-1.5 right-2.5 text-mute">€</span>
          </span>
        </label>
        <div className="ml-auto text-right">
          <div className="text-[12px] text-mute">En {inputs.years} años · {monthLong(view.dates[end]!.slice(0, 7))}</div>
          <div className="priv text-[30px] leading-[1.1] font-medium tracking-[-0.01em]" style={{ fontStretch: "108%" }}>
            {eur(view.total[end]!, 0)}
          </div>
        </div>
      </div>

      <HeroChart model={model} height={220} />

      <div className="mt-3 flex flex-wrap gap-x-7 gap-y-1.5 text-[12.5px] text-ink2">
        <span>
          Cartera <Priv>{eur(view.cartera[end]!, 0)}</Priv>: hoy <Priv>{eur(portfolio, 0)}</Priv>, más <Priv>{eur(contributed, 0)}</Priv> aportados y <Priv>{eur(grown, 0)}</Priv> de rentabilidad
        </span>
        {reserve > 0 && (
          <span>
            Fondo de emergencia <Priv>{eur(reserve, 0)}</Priv>, tal cual está
          </span>
        )}
        {homes.length > 0 && (
          <span>
            Inmuebles <Priv>{eur(view.inmuebles[end]!, 0)}</Priv>, por la hipoteca que se va pagando (sin revalorización)
          </span>
        )}
        {goal > 0 && (
          <span className="font-medium text-ink">
            {reach == null ? (
              <>
                Con estas cifras no llegas a <Priv>{eur(goal, 0)}</Priv> en {inputs.years} años.
              </>
            ) : reach === 0 ? (
              <>
                Ya has alcanzado <Priv>{eur(goal, 0)}</Priv>.
              </>
            ) : (
              <>
                Llegarías a <Priv>{eur(goal, 0)}</Priv> en {yearsText(reach)}, en {monthLong(view.dates[reach]!.slice(0, 7))}.
              </>
            )}
          </span>
        )}
      </div>
      <p className="mt-2.5 text-[12px] text-pretty text-mute">
        Pon la rentabilidad descontando la inflación (un 4–5 % es habitual para una cartera de bolsa global) y las cifras estarán en euros de hoy. La aportación sugerida es tu media mensual del último año.
      </p>
    </Card>
  );
}
