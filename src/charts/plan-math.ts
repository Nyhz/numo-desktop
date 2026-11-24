import { planContribution, type Allocation, type Plan } from "../../shared/engine/plan.ts";

// Cuentas de la pantalla Plan que el motor no da hechas: la desviación que
// quedaría tras una aportación y las escalas de sus gráficos. Todo sale de
// `planContribution`; aquí no se decide ningún reparto.

/**
 * Desviación (en puntos) que quedaría tras aportar `amountEur` repartido como
 * dice el motor. Misma medida que `plan.offPct`: la mitad de la suma de las
 * diferencias absolutas de los bloques con objetivo.
 */
export function offAfter(plan: Plan, amountEur: number, alloc: Allocation[] = planContribution(plan, amountEur)): number {
  if (!(amountEur > 0) || !alloc.length) return plan.offPct;
  const total = plan.totalEur + amountEur;
  const add = new Map(alloc.map((a) => [a.goal.id, a.amountEur]));
  let sum = 0;
  for (const b of plan.buckets) {
    if (!b.goal) continue;
    sum += Math.abs(((b.valueEur + (add.get(b.goal.id) ?? 0)) / total) * 100 - b.targetPct);
  }
  return sum / 2;
}

export type CurvePoint = { amountEur: number; offPct: number };

/** La desviación en función del importe aportado, de 0 a `maxEur`. */
export function deviationCurve(plan: Plan, maxEur: number, steps = 50): CurvePoint[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const amountEur = (maxEur * i) / steps;
    return { amountEur, offPct: offAfter(plan, amountEur) };
  });
}

/** Redondea hacia arriba a un número «de eje»: 1, 2, 2,5 o 5 por una potencia de diez. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 0;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5]) if (v <= m * pow * (1 + 1e-9)) return m * pow;
  return 10 * pow;
}

/**
 * Hasta qué importe llega la curva: en torno a una décima parte de lo que hay
 * en el plan, sin quedarse por debajo del atajo más alto ni del importe elegido.
 */
export const contributionSpan = (plan: Plan, amountEur: number, floorEur: number): number => niceCeil(Math.max(plan.totalEur * 0.1, floorEur, amountEur));

/** Tope de la escala común de las barras, en %: cabe el mayor peso, objetivo o peso tras aportar, con un 10 % de aire. */
export function barScale(plan: Plan, alloc: Allocation[]): number {
  return Math.max(1, ...plan.buckets.map((b) => Math.max(b.weightPct, b.targetPct)), ...alloc.map((a) => a.weightAfterPct)) * 1.1;
}

/** Marcas del eje de las barras: de 0 hasta donde llegue la escala. */
export function scaleTicks(scale: number): number[] {
  const step = scale > 60 ? 20 : scale > 25 ? 10 : scale > 12 ? 5 : scale > 5 ? 2 : 1;
  const out: number[] = [];
  for (let q = 0; q < scale; q += step) out.push(q);
  return out;
}
