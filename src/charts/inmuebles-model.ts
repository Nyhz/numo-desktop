import { yearOf } from "../../shared/dates.ts";
import { buildSchedule, scheduleByYear, valueAt, type PropertyView, type ScheduleRow } from "../../shared/engine/realestate.ts";

// Geometría del gráfico de Inmuebles: dos series de columnas por año con el eje
// de años común. Arriba, de quién es el inmueble a final de cada año; abajo, lo
// que se paga ese año. Todas las cifras salen del cuadro del motor: aquí solo
// se agrupan por año y se convierten en alturas.

export type SimMode = "reduce_term" | "reduce_installment";

export type HomeYear = {
  year: number;
  isNow: boolean;
  /** Año posterior al actual: lo tuyo es una previsión. */
  future: boolean;
  /** Rótulo en la franja de años («» si no toca). */
  tick: string;
  /** Valor del inmueble a final de año. */
  value: number;
  /** Tuyo según el cuadro vigente: valor menos capital pendiente. */
  own: number;
  /** Lo que además sería tuyo con la amortización simulada. */
  gain: number;
  /** Del banco (con la simulación aplicada, si la hay). */
  bank: number;
  /** Pagado ese año según el cuadro vigente. */
  paid: number;
  principal: number;
  interest: number;
  payments: number;
  /** Capital pendiente a final de año, sin simulación. */
  remaining: number;
  // Alturas en % de su zona.
  hOwn: string;
  hGain: string;
  hBank: string;
  hPrincipal: string;
  hInterest: string;
};

export type HomeModel = {
  years: HomeYear[];
  ticks: Array<{ top: string; value: number }>;
  hasLoan: boolean;
  /** Importe realmente simulado (acotado al capital pendiente). */
  simulated: number;
};

const pc = (x: number) => `${(Math.max(0, x) * 100).toFixed(3)}%`;

/** El paso «redondo» (1, 2 o 5 × 10ⁿ) más fino que deja como mucho tres líneas de eje bajo `top`. */
const axisStep = (top: number): number => {
  const pow = 10 ** Math.floor(Math.log10(top / 4));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => Math.floor(top / s) <= 3) ?? 10 * pow;
};

/** Capital pendiente a final de cada año de `from` a `to`, arrastrando el último conocido. */
function remainingByYear(principal: number, rows: ScheduleRow[], from: number, to: number): Map<number, number> {
  const ends = new Map(scheduleByYear(rows).map((y) => [y.year, y.remaining]));
  const out = new Map<number, number>();
  let rem = principal;
  for (let year = from; year <= to; year++) {
    rem = ends.get(year) ?? rem;
    out.set(year, rem);
  }
  return out;
}

/** El cuadro que resultaría de amortizar `amount` hoy: el mismo cálculo que `simulateRepayment`. */
export function simulatedSchedule(view: PropertyView, amount: number, mode: SimMode, today: string): ScheduleRow[] | null {
  const loan = view.loan;
  if (!loan || !(amount > 0) || loan.outstanding <= 0) return null;
  return buildSchedule(loan.mortgage, [...loan.events, { date: today, type: "early_repayment", amount: Math.min(amount, loan.outstanding), mode, ratePct: null }]);
}

export function homeModel(view: PropertyView, today: string, amount: number, mode: SimMode): HomeModel {
  const { property, valuations, loan } = view;
  const thisYear = yearOf(today);
  const base = loan?.schedule ?? [];
  const sim = simulatedSchedule(view, amount, mode, today);
  const simulated = sim && loan ? Math.min(amount, loan.outstanding) : 0;

  const first = Math.min(yearOf(property.purchaseDate), base.length ? yearOf(base[0]!.date) : Infinity, thisYear);
  const last = Math.max(thisYear, base.length ? yearOf(base[base.length - 1]!.date) : thisYear);
  const principal = loan?.mortgage.principal ?? 0;
  const baseRem = remainingByYear(principal, base, first, last);
  const simRem = sim ? remainingByYear(principal, sim, first, last) : baseRem;
  const paidBy = new Map(scheduleByYear(base).map((y) => [y.year, y]));

  const n = last - first + 1;
  // Con muchos años solo se rotulan los múltiplos de 5 (o de 2); con pocos, todos.
  const every = n > 14 ? 5 : n > 7 ? 2 : 1;

  const raw = [];
  for (let year = first; year <= last; year++) {
    const value = Math.max(0, valueAt(property, valuations, `${year}-12-31`).value);
    const remaining = baseRem.get(year) ?? 0;
    // Si la deuda supera al valor, el inmueble entero es del banco: nada se dibuja por encima del valor.
    const bankBase = Math.min(remaining, value);
    const bankSim = year >= thisYear ? Math.min(simRem.get(year) ?? 0, bankBase) : bankBase;
    const y = paidBy.get(year);
    raw.push({ year, value, remaining, own: value - bankBase, gain: bankBase - bankSim, bank: bankSim, paid: y?.paid ?? 0, principal: y?.principal ?? 0, interest: y?.interest ?? 0, payments: y?.payments ?? 0 });
  }

  // El eje deja un 7 % de aire sobre el valor más alto.
  const maxValue = Math.max(...raw.map((y) => y.value), 0);
  const top = maxValue * 1.07 || 1;
  const maxPaid = Math.max(...raw.map((y) => y.paid), 0) || 1;
  const ticks = [];
  if (maxValue > 0) for (let step = axisStep(top), q = step; q < top * 0.97; q += step) ticks.push({ top: pc(1 - q / top), value: q });

  return {
    years: raw.map((y) => ({
      ...y,
      isNow: y.year === thisYear,
      future: y.year > thisYear,
      tick: y.year % every === 0 ? String(y.year) : "",
      hOwn: pc(y.own / top),
      hGain: pc(y.gain / top),
      hBank: pc(y.bank / top),
      hPrincipal: pc(y.principal / maxPaid),
      hInterest: pc(y.interest / maxPaid),
    })),
    ticks,
    hasLoan: loan != null,
    simulated,
  };
}
