import { describe, expect, it } from "vitest";
import { buildPlan, planContribution } from "../../shared/engine/plan.ts";
import type { Position } from "../../shared/engine/timeline.ts";
import type { Asset, Goal } from "../../shared/types.ts";
import { barScale, contributionSpan, deviationCurve, niceCeil, offAfter, scaleTicks } from "./plan-math.ts";

const goal = (id: string, targetPct: number, sortOrder = 0): Goal => ({ id, name: id, targetPct, color: 1, sortOrder, createdAt: "" });
const pos = (id: string, valueEur: number, goalId: string | null): Position => ({
  asset: { id, name: id, kind: "etf", symbol: null, isin: null, currency: "EUR", priceSource: "manual", goalId, planExcluded: false, createdAt: "" } as Asset,
  qty: 1,
  accounts: [],
  costEur: valueEur,
  price: valueEur,
  priceDate: null,
  valueEur,
  unrealizedEur: 0,
  unrealizedPct: 0,
  weight: 0,
  dayChangePct: null,
});

describe("cuentas de la pantalla Plan", () => {
  const goals = [goal("global", 60, 0), goal("emergentes", 30, 1), goal("oro", 10, 2)];
  const plan = buildPlan([pos("a", 7000, "global"), pos("b", 2000, "emergentes"), pos("c", 1000, "oro")], goals);

  it("sin aportación, la desviación es la del plan", () => {
    expect(offAfter(plan, 0)).toBe(plan.offPct);
    expect(offAfter(plan, -50)).toBe(plan.offPct);
  });

  it("la desviación tras aportar sale del reparto del motor", () => {
    // 500 € van enteros a emergentes: 7000 / 2500 / 1000 sobre 10.500.
    const expected = (Math.abs(7000 / 105 - 60) + Math.abs(2500 / 105 - 30) + Math.abs(1000 / 105 - 10)) / 2;
    expect(offAfter(plan, 500)).toBeCloseTo(expected, 9);
    expect(offAfter(plan, 500, planContribution(plan, 500))).toBeCloseTo(expected, 9);
    // Con 10.000 € se llega exactamente al plan.
    expect(offAfter(plan, 10000)).toBeCloseTo(0, 6);
  });

  it("la curva empieza en la desviación de hoy y no sube al aportar más", () => {
    const curve = deviationCurve(plan, 10000, 20);
    expect(curve).toHaveLength(21);
    expect(curve[0]).toEqual({ amountEur: 0, offPct: plan.offPct });
    expect(curve.at(-1)!.amountEur).toBe(10000);
    for (let i = 1; i < curve.length; i++) expect(curve[i]!.offPct).toBeLessThanOrEqual(curve[i - 1]!.offPct + 1e-9);
  });

  it("cuenta también los bloques con objetivo que no reciben nada", () => {
    const withZero = buildPlan([pos("a", 6000, "global"), pos("b", 3000, "emergentes"), pos("z", 1000, "viejo")], [goal("global", 70, 0), goal("emergentes", 30, 1), goal("viejo", 0, 2)]);
    const alloc = planContribution(withZero, 1000);
    expect(alloc.find((a) => a.goal.id === "viejo")).toBeUndefined();
    // 1.000 € a global: 7000 / 3000 / 1000 sobre 11.000.
    const expected = (Math.abs(7000 / 110 - 70) + Math.abs(3000 / 110 - 30) + Math.abs(1000 / 110 - 0)) / 2;
    expect(offAfter(withZero, 1000, alloc)).toBeCloseTo(expected, 9);
  });

  it("escalas", () => {
    expect(niceCeil(9341)).toBe(10000);
    expect(niceCeil(10000)).toBe(10000);
    expect(niceCeil(1200)).toBe(2000);
    expect(niceCeil(2100)).toBe(2500);
    expect(niceCeil(0)).toBe(0);
    expect(contributionSpan(plan, 0, 5000)).toBe(5000);
    expect(contributionSpan(plan, 12000, 5000)).toBe(20000);
    expect(barScale(plan, [])).toBeCloseTo(77, 9);
    expect(scaleTicks(45)).toEqual([0, 10, 20, 30, 40]);
  });
});
