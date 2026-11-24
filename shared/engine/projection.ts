import { addMonths } from "../dates.ts";

// Proyección del patrimonio: una cuenta sencilla y transparente, no una
// predicción. La cartera crece cada mes al ritmo anual que se le diga y recibe
// la aportación a final de mes; lo de los inmuebles lo pone el cuadro de la
// hipoteca (ver `equitySeries`), que ya se conoce mes a mes.

/** Valor de la cartera a final de cada mes, de hoy (índice 0) a dentro de `months`. */
export function projectPortfolio(start: number, monthly: number, annualPct: number, months: number): number[] {
  const rate = (1 + annualPct / 100) ** (1 / 12) - 1;
  const out = [start];
  for (let m = 1; m <= months; m++) out.push(out[m - 1]! * (1 + rate) + monthly);
  return out;
}

/** Fechas de la proyección: hoy y el mismo día de cada mes siguiente. */
export const projectionDates = (today: string, months: number): string[] => Array.from({ length: months + 1 }, (_, m) => addMonths(today, m));

/** Primer mes en que la serie alcanza el objetivo; null si no llega en el horizonte. */
export function monthsToReach(values: ArrayLike<number>, goal: number): number | null {
  for (let m = 0; m < values.length; m++) if (values[m]! >= goal) return m;
  return null;
}
