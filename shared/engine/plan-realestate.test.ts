import { describe, expect, it } from "vitest";
import type { Asset, Goal, Mortgage } from "../types.ts";
import { buildPlan, planContribution } from "./plan.ts";
import { annuity, buildSchedule, scheduleByYear, simulateRepayment, viewMortgage } from "./realestate.ts";
import type { Position } from "./timeline.ts";

const goal = (id: string, targetPct: number, sortOrder = 0): Goal => ({ id, name: id, targetPct, color: 1, sortOrder, createdAt: "" });
const pos = (id: string, valueEur: number, goalId: string | null, planExcluded = false): Position => ({
  asset: { id, name: id, kind: "etf", symbol: null, isin: null, currency: "EUR", priceSource: "manual", goalId, planExcluded, createdAt: "" } as Asset,
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

describe("plan de inversión", () => {
  const goals = [goal("global", 60, 0), goal("emergentes", 30, 1), goal("oro", 10, 2)];
  const positions = [pos("a", 7000, "global"), pos("b", 2000, "emergentes"), pos("c", 1000, "oro"), pos("pension", 5000, null, true)];

  it("compara el peso real con el objetivo e ignora lo excluido", () => {
    const plan = buildPlan(positions, goals);
    expect(plan.totalEur).toBe(10000);
    expect(plan.excludedEur).toBe(5000);
    expect(plan.targetSum).toBe(100);
    const [g, e, o] = plan.buckets;
    expect(g).toMatchObject({ weightPct: 70, driftPct: 10, gapEur: -1000 });
    expect(e).toMatchObject({ weightPct: 20, driftPct: -10, gapEur: 1000 });
    expect(o!.driftPct).toBeCloseTo(0, 10);
    expect(plan.offPct).toBe(10);
  });

  it("pone aparte lo que no tiene bloque", () => {
    const plan = buildPlan([...positions, pos("suelto", 1000, null)], goals);
    expect(plan.buckets.at(-1)).toMatchObject({ goal: null, valueEur: 1000, targetPct: 0 });
  });

  it("una aportación va primero a lo más retrasado y reparte hasta el último céntimo", () => {
    const plan = buildPlan(positions, goals);
    const small = planContribution(plan, 500);
    expect(small.find((a) => a.goal.id === "emergentes")!.amountEur).toBe(500);
    expect(small.find((a) => a.goal.id === "global")!.amountEur).toBe(0);

    const big = planContribution(plan, 10000);
    expect(big.reduce((s, a) => s + a.amountEur, 0)).toBeCloseTo(10000, 6);
    // Con 10.000 € más se puede llegar exactamente al plan: 12.000 / 6.000 / 2.000.
    expect(big.map((a) => a.amountEur)).toEqual([5000, 4000, 1000]);
    for (const a of big) expect(a.weightAfterPct).toBeCloseTo(a.targetPct, 6);
  });

  it("nunca propone vender: los bloques pasados de peso no reciben nada", () => {
    const plan = buildPlan(positions, goals);
    for (const amount of [1, 137.33, 2500]) {
      const out = planContribution(plan, amount);
      expect(out.every((a) => a.amountEur >= 0)).toBe(true);
      expect(out.reduce((s, a) => s + a.amountEur, 0)).toBeCloseTo(amount, 6);
    }
  });
});

describe("hipoteca", () => {
  const m: Mortgage = { id: "m", propertyId: "p", lender: "", principal: 200000, rateType: "fixed", ratePct: 3, termMonths: 360, firstPaymentDate: "2024-02-05", createdAt: "" };

  it("calcula la cuota francesa y termina a cero", () => {
    expect(annuity(200000, 3, 360)).toBe(843.21);
    expect(annuity(120000, 0, 120)).toBe(1000);
    const rows = buildSchedule(m);
    expect(rows).toHaveLength(360);
    expect(rows[0]).toMatchObject({ date: "2024-02-05", payment: 843.21, interest: 500, principal: 343.21, remaining: 199656.79 });
    expect(rows.at(-1)!.remaining).toBe(0);
    expect(rows.at(-1)!.date).toBe("2054-01-05");
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBeCloseTo(200000, 6);
  });

  it("amortizar reduciendo plazo acorta; reduciendo cuota la baja", () => {
    const base = buildSchedule(m);
    const ev = { date: "2025-01-20", type: "early_repayment" as const, amount: 20000, ratePct: null };
    const shorter = buildSchedule(m, [{ ...ev, mode: "reduce_term" }]);
    const lower = buildSchedule(m, [{ ...ev, mode: "reduce_installment" }]);
    const payments = (rows: typeof base) => rows.filter((r) => r.kind === "payment");
    expect(payments(shorter).length).toBeLessThan(360);
    expect(payments(shorter)[20]!.payment).toBe(843.21);
    expect(payments(lower)).toHaveLength(360);
    expect(payments(lower)[20]!.payment).toBeLessThan(843.21);
    expect(shorter.at(-1)!.remaining).toBe(0);
    expect(lower.at(-1)!.remaining).toBe(0);
    const interest = (rows: typeof base) => rows.reduce((s, r) => s + r.interest, 0);
    expect(interest(shorter)).toBeLessThan(interest(lower));
    expect(interest(lower)).toBeLessThan(interest(base));
  });

  it("una revisión del tipo recalcula la cuota y la cuota real manda sobre la calculada", () => {
    const up = buildSchedule(m, [{ date: "2025-01-20", type: "rate_change", amount: null, mode: null, ratePct: 4 }]);
    expect(up[11]!.payment).toBe(843.21);
    expect(up[12]!.payment).toBeGreaterThan(843.21);
    expect(up[12]!.ratePct).toBe(4);
    const real = buildSchedule(m, [{ date: "2024-03-05", type: "payment_override", amount: 850, mode: null, ratePct: null }]);
    expect(real[0]!.payment).toBe(843.21);
    expect(real[1]!.payment).toBe(850);
    expect(real[5]!.payment).toBe(850);
  });

  it("resume el estado a una fecha y simula una amortización", () => {
    const v = viewMortgage(m, [], "2026-02-05");
    expect(v.paymentsMade).toBe(25);
    expect(v.paymentsLeft).toBe(335);
    expect(v.outstanding).toBe(v.schedule[24]!.remaining);
    expect(v.principalPaid + v.outstanding).toBeCloseTo(200000, 6);
    expect(v.interestPaid + v.interestRemaining).toBeCloseTo(v.totalInterest, 6);
    expect(v.nextPayment!.date).toBe("2026-03-05");
    const sim = simulateRepayment(v, 10000, "reduce_term", "2026-02-10")!;
    expect(sim.monthsSaved).toBeGreaterThan(20);
    expect(sim.interestSaved).toBeGreaterThan(5000);
    expect(sim.newPayment).toBe(843.21);
    const years = scheduleByYear(v.schedule);
    expect(years[0]).toMatchObject({ year: 2024, payments: 11 });
    expect(years.reduce((s, y) => s + y.principal, 0)).toBeCloseTo(200000, 6);
  });
});
