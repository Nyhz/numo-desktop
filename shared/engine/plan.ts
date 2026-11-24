import type { Asset, Goal } from "../types.ts";
import { r2 } from "./ledger.ts";
import type { Position } from "./timeline.ts";

/** Un bloque del plan con lo que pesa de verdad frente a lo que debería pesar. */
export type PlanBucket = {
  /** null = posiciones sin bloque asignado. */
  goal: Goal | null;
  positions: Position[];
  valueEur: number;
  /** Peso real sobre lo repartido, en %. */
  weightPct: number;
  targetPct: number;
  /** Puntos de diferencia: positivo = sobra, negativo = falta. */
  driftPct: number;
  /** Euros que habría que comprar (positivo) o que sobran (negativo) para estar en el objetivo. */
  gapEur: number;
};

export type Plan = {
  buckets: PlanBucket[];
  /** Valor de lo que entra en el plan (sin lo excluido). */
  totalEur: number;
  excluded: Position[];
  excludedEur: number;
  /** Suma de los objetivos; el plan está completo cuando es 100. */
  targetSum: number;
  /** Media de las desviaciones absolutas, en puntos: cuánto se aleja la cartera del plan. */
  offPct: number;
};

/**
 * Compara la cartera con el plan. Solo cuentan posiciones (el efectivo queda
 * fuera) y se ignoran las marcadas como excluidas.
 */
export function buildPlan(positions: Position[], goals: Goal[]): Plan {
  const excluded = positions.filter((p) => p.asset.planExcluded);
  const inPlan = positions.filter((p) => !p.asset.planExcluded);
  const totalEur = r2(inPlan.reduce((s, p) => s + p.valueEur, 0));
  const ordered = [...goals].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const known = new Set(ordered.map((g) => g.id));

  const make = (goal: Goal | null, list: Position[]): PlanBucket => {
    const valueEur = r2(list.reduce((s, p) => s + p.valueEur, 0));
    const weightPct = totalEur > 0 ? (valueEur / totalEur) * 100 : 0;
    const targetPct = goal?.targetPct ?? 0;
    return {
      goal,
      positions: [...list].sort((a, b) => b.valueEur - a.valueEur),
      valueEur,
      weightPct,
      targetPct,
      driftPct: weightPct - targetPct,
      gapEur: r2((targetPct / 100) * totalEur - valueEur),
    };
  };

  const buckets = ordered.map((g) => make(g, inPlan.filter((p) => p.asset.goalId === g.id)));
  const loose = inPlan.filter((p) => !p.asset.goalId || !known.has(p.asset.goalId));
  if (loose.length) buckets.push(make(null, loose));

  const withGoal = buckets.filter((b) => b.goal);
  return {
    buckets,
    totalEur,
    excluded,
    excludedEur: r2(excluded.reduce((s, p) => s + p.valueEur, 0)),
    targetSum: r2(ordered.reduce((s, g) => s + g.targetPct, 0)),
    offPct: withGoal.length ? withGoal.reduce((s, b) => s + Math.abs(b.driftPct), 0) / 2 : 0,
  };
}

export type Allocation = {
  goal: Goal;
  /** Cuánto de la aportación va a este bloque. */
  amountEur: number;
  weightBeforePct: number;
  weightAfterPct: number;
  targetPct: number;
};

/**
 * A dónde va una aportación: entera al bloque más retrasado, el que hoy está
 * más euros por debajo de su objetivo. Una sola operación al mes ahorra
 * comisiones, aunque ese bloque quede algo por encima de su peso; al mes
 * siguiente le tocará a otro. Nunca se propone vender.
 */
export function planContribution(plan: Plan, amountEur: number): Allocation[] {
  const buckets = plan.buckets.filter((b): b is PlanBucket & { goal: Goal } => !!b.goal && b.targetPct > 0);
  if (!buckets.length || !(amountEur > 0)) return [];
  // Lo que no tiene bloque también forma parte del total, pero no recibe dinero.
  const total = plan.totalEur + amountEur;
  // El hueco es el que se ve hoy en pantalla («faltan N €»). Si ninguno está por debajo, va al menos pasado.
  const chosen = buckets.reduce((best, b) => (b.gapEur > best.gapEur ? b : best));
  const rounded = buckets.map((b) => (b === chosen ? r2(amountEur) : 0));

  return buckets
    .map((b, i) => ({
      goal: b.goal,
      amountEur: r2(rounded[i]!),
      weightBeforePct: b.weightPct,
      weightAfterPct: total > 0 ? ((b.valueEur + rounded[i]!) / total) * 100 : 0,
      targetPct: b.targetPct,
    }))
    .filter((a) => a.amountEur > 0 || a.targetPct > 0);
}

/** Activos que se pueden asignar a un bloque: todos los que tienen o han tenido posición primero. */
export const sortForAssignment = (assets: Asset[], held: Set<string>): Asset[] =>
  [...assets].sort((a, b) => Number(held.has(b.id)) - Number(held.has(a.id)) || a.name.localeCompare(b.name));
