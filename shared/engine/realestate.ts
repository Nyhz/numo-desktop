import { addMonths } from "../dates.ts";
import type { AppState, Mortgage, MortgageEvent, Property, PropertyValuation } from "../types.ts";
import { r2 } from "./ledger.ts";

// Hipoteca de amortización francesa. El cuadro nunca se guarda: se deriva de
// las condiciones y de los eventos (amortizaciones, revisiones del tipo y
// cuotas reales) para cualquier fecha, pasada o futura.

export type ScheduleRow = {
  date: string;
  kind: "payment" | "early_repayment";
  payment: number;
  interest: number;
  principal: number;
  /** Capital pendiente después de esta fila. */
  remaining: number;
  ratePct: number;
};

/** Cuota mensual constante que amortiza `principal` en `months` meses. */
export function annuity(principal: number, ratePct: number, months: number): number {
  if (months <= 0) return r2(principal);
  const r = ratePct / 100 / 12;
  return r === 0 ? r2(principal / months) : r2((principal * r) / (1 - (1 + r) ** -months));
}

const MAX_ROWS = 1200; // 100 años: tope contra bucles si la cuota no cubre intereses

type Terms = Pick<Mortgage, "principal" | "ratePct" | "termMonths" | "firstPaymentDate">;
type Ev = Pick<MortgageEvent, "date" | "type" | "amount" | "mode" | "ratePct">;

/**
 * Cuadro de amortización completo.
 *
 * Reglas de los eventos:
 * - Un evento fechado antes de una cuota se aplica antes de ella; el mismo día
 *   se aplica después, salvo la «cuota real», que es precisamente esa cuota.
 * - Amortizar reduciendo plazo mantiene la cuota; reduciendo cuota la recalcula.
 * - Una revisión del tipo recalcula la cuota, salvo que haya una cuota real
 *   vigente: entonces solo cambia el reparto entre intereses y capital.
 */
export function buildSchedule(terms: Terms, events: Ev[] = []): ScheduleRow[] {
  const pending = [...events].sort(
    (a, b) => a.date.localeCompare(b.date) || Number(b.type === "payment_override") - Number(a.type === "payment_override"),
  );
  const rows: ScheduleRow[] = [];
  let remaining = r2(terms.principal);
  let ratePct = terms.ratePct;
  let monthsLeft = terms.termMonths;
  let payment = annuity(remaining, ratePct, monthsLeft);
  let forced = false;
  let ev = 0;

  for (let n = 0; remaining > 0 && rows.length < MAX_ROWS; n++) {
    const date = addMonths(terms.firstPaymentDate, n);

    while (ev < pending.length && pending[ev]!.date < date) {
      const e = pending[ev++]!;
      if (e.type === "payment_override") {
        payment = r2(e.amount ?? payment);
        forced = true;
      } else if (e.type === "rate_change") {
        ratePct = e.ratePct ?? ratePct;
        if (!forced) payment = annuity(remaining, ratePct, monthsLeft);
      } else {
        const amount = r2(Math.min(e.amount ?? 0, remaining));
        if (amount <= 0) continue;
        remaining = r2(remaining - amount);
        rows.push({ date: e.date, kind: "early_repayment", payment: amount, interest: 0, principal: amount, remaining, ratePct });
        if (remaining === 0) return rows;
        if (e.mode === "reduce_installment") {
          payment = annuity(remaining, ratePct, monthsLeft);
          forced = false;
        }
      }
    }
    while (ev < pending.length && pending[ev]!.date === date && pending[ev]!.type === "payment_override") {
      payment = r2(pending[ev++]!.amount ?? payment);
      forced = true;
    }

    const interest = r2(remaining * (ratePct / 100 / 12));
    let principal = r2(payment - interest);
    if (monthsLeft <= 1 || principal >= remaining) principal = remaining;
    // Cuota que no cubre intereses: se detiene el cuadro en vez de generar deuda creciente.
    if (principal <= 0) break;
    remaining = r2(remaining - principal);
    rows.push({ date, kind: "payment", payment: r2(interest + principal), interest, principal, remaining, ratePct });
    monthsLeft -= 1;
  }
  return rows;
}

export type MortgageView = {
  mortgage: Mortgage;
  events: MortgageEvent[];
  schedule: ScheduleRow[];
  /** Capital pendiente hoy. */
  outstanding: number;
  /** Capital ya devuelto (cuotas y amortizaciones). */
  principalPaid: number;
  interestPaid: number;
  interestRemaining: number;
  totalInterest: number;
  /** Cuotas y amortizaciones pagadas hasta hoy. */
  paidToDate: number;
  paymentsMade: number;
  paymentsLeft: number;
  /** Cuota vigente: la próxima, o la última si ya se ha terminado. */
  payment: number;
  nextPayment: ScheduleRow | null;
  endDate: string | null;
  /** Fracción del préstamo ya devuelta, 0..1. */
  progress: number;
};

export type PropertyView = {
  property: Property;
  valuations: PropertyValuation[];
  /** Valor vigente: la última valoración, o el precio de compra si no hay ninguna. */
  value: number;
  valueAsOf: string | null;
  loan: MortgageView | null;
  /** Valor menos hipoteca pendiente. */
  equity: number;
  /** Parte del inmueble que ya es tuya, 0..1. */
  ownedShare: number;
  /** Entrada: lo que no cubrió la hipoteca. */
  downPayment: number;
  /** Todo lo desembolsado hasta hoy: entrada, gastos y cuotas. */
  totalPaid: number;
  /** Revalorización frente al precio de compra. */
  appreciation: number;
};

export const valueAt = (property: Property, valuations: PropertyValuation[], date: string) => {
  let best: PropertyValuation | null = null;
  for (const v of valuations) if (v.date <= date && (!best || v.date > best.date)) best = v;
  return best ? { value: best.value, asOf: best.date } : { value: property.purchasePrice, asOf: null as string | null };
};

export const outstandingAt = (principal: number, rows: ScheduleRow[], date: string): number => {
  let out = r2(principal);
  for (const row of rows) {
    if (row.date > date) break;
    out = row.remaining;
  }
  return out;
};

export function viewMortgage(mortgage: Mortgage, events: MortgageEvent[], today: string): MortgageView {
  const schedule = buildSchedule(mortgage, events);
  const past = schedule.filter((r) => r.date <= today);
  const future = schedule.filter((r) => r.date > today);
  const sum = (rows: ScheduleRow[], f: (r: ScheduleRow) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
  const outstanding = outstandingAt(mortgage.principal, schedule, today);
  const next = future.find((r) => r.kind === "payment") ?? null;
  const lastPayment = [...schedule].reverse().find((r) => r.kind === "payment");
  return {
    mortgage,
    events: [...events].sort((a, b) => a.date.localeCompare(b.date)),
    schedule,
    outstanding,
    principalPaid: r2(mortgage.principal - outstanding),
    interestPaid: sum(past, (r) => r.interest),
    interestRemaining: sum(future, (r) => r.interest),
    totalInterest: sum(schedule, (r) => r.interest),
    paidToDate: sum(past, (r) => r.payment),
    paymentsMade: past.filter((r) => r.kind === "payment").length,
    paymentsLeft: future.filter((r) => r.kind === "payment").length,
    payment: next?.payment ?? lastPayment?.payment ?? 0,
    nextPayment: next,
    endDate: schedule.length ? schedule[schedule.length - 1]!.date : null,
    progress: mortgage.principal > 0 ? (mortgage.principal - outstanding) / mortgage.principal : 0,
  };
}

export function viewProperty(state: AppState, property: Property, today: string): PropertyView {
  const valuations = state.valuations.filter((v) => v.propertyId === property.id).sort((a, b) => a.date.localeCompare(b.date));
  const mortgage = state.mortgages.find((m) => m.propertyId === property.id) ?? null;
  const loan = mortgage ? viewMortgage(mortgage, state.mortgageEvents.filter((e) => e.mortgageId === mortgage.id), today) : null;
  const { value, asOf } = valueAt(property, valuations, today);
  const outstanding = loan?.outstanding ?? 0;
  const downPayment = r2(Math.max(0, property.purchasePrice - (mortgage?.principal ?? 0)));
  return {
    property,
    valuations,
    value,
    valueAsOf: asOf,
    loan,
    equity: r2(value - outstanding),
    ownedShare: value > 0 ? Math.max(0, (value - outstanding) / value) : 0,
    downPayment,
    totalPaid: r2(downPayment + property.purchaseCosts + (loan?.paidToDate ?? 0)),
    appreciation: r2(value - property.purchasePrice),
  };
}

export const viewProperties = (state: AppState, today: string): PropertyView[] =>
  [...state.properties].sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate)).map((p) => viewProperty(state, p, today));

/**
 * Lo que ya es tuyo de todos los inmuebles (valor menos hipoteca pendiente) en
 * cada fecha; nada antes de la compra. `dates` va en orden creciente.
 */
export function equitySeries(views: PropertyView[], dates: string[]): Float64Array {
  const out = new Float64Array(dates.length);
  for (const v of views) {
    const rows = v.loan?.schedule ?? [];
    let value = v.property.purchasePrice;
    let debt = v.loan?.mortgage.principal ?? 0;
    let nextValuation = 0;
    let nextRow = 0;
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]!;
      if (date < v.property.purchaseDate) continue;
      while (nextValuation < v.valuations.length && v.valuations[nextValuation]!.date <= date) value = v.valuations[nextValuation++]!.value;
      while (nextRow < rows.length && rows[nextRow]!.date <= date) debt = rows[nextRow++]!.remaining;
      out[i] = out[i]! + value - debt;
    }
  }
  return out;
}

/** Un año del cuadro, para leerlo de un vistazo. */
export type ScheduleYear = { year: number; payments: number; paid: number; interest: number; principal: number; remaining: number };

export function scheduleByYear(rows: ScheduleRow[]): ScheduleYear[] {
  const out: ScheduleYear[] = [];
  for (const r of rows) {
    const year = +r.date.slice(0, 4);
    let y = out[out.length - 1];
    if (!y || y.year !== year) out.push((y = { year, payments: 0, paid: 0, interest: 0, principal: 0, remaining: r.remaining }));
    if (r.kind === "payment") y.payments++;
    y.paid = r2(y.paid + r.payment);
    y.interest = r2(y.interest + r.interest);
    y.principal = r2(y.principal + r.principal);
    y.remaining = r.remaining;
  }
  return out;
}

export type WhatIf = {
  interestSaved: number;
  monthsSaved: number;
  newEndDate: string | null;
  newPayment: number;
  paymentBefore: number;
};

