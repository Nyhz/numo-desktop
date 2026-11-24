import { describe, expect, it } from "vitest";
import { scheduleByYear, simulateRepayment, viewProperty } from "../../shared/engine/realestate.ts";
import type { AppState, Mortgage, Property } from "../../shared/types.ts";
import { homeModel, simulatedSchedule } from "./inmuebles-model.ts";

const property: Property = { id: "p", name: "Piso", address: "", purchaseDate: "2024-01-10", purchasePrice: 250000, purchaseCosts: 20000, note: "", createdAt: "" };
const mortgage: Mortgage = { id: "m", propertyId: "p", lender: "", principal: 200000, rateType: "fixed", ratePct: 3, termMonths: 360, firstPaymentDate: "2024-02-05", createdAt: "" };
const state = (withLoan: boolean): AppState =>
  ({
    accounts: [],
    assets: [],
    txs: [],
    prices: {},
    fx: {},
    splits: {},
    goals: [],
    properties: [property],
    mortgages: withLoan ? [mortgage] : [],
    mortgageEvents: [],
    valuations: [{ id: "v", propertyId: "p", date: "2025-06-01", value: 270000, note: "" }],
    lastSync: null,
  }) as AppState;
const today = "2026-02-10";
const pcNum = (s: string) => parseFloat(s);

describe("gráfico de Inmuebles", () => {
  const view = viewProperty(state(true), property, today);

  it("da una columna por año, de la compra a la última cuota, con las cifras del cuadro", () => {
    const m = homeModel(view, today, 0, "reduce_term");
    expect(m.years[0]!.year).toBe(2024);
    expect(m.years.at(-1)!.year).toBe(2054);
    expect(m.years.filter((y) => y.isNow).map((y) => y.year)).toEqual([2026]);
    expect(m.years.find((y) => y.year === 2027)!.future).toBe(true);
    const byYear = scheduleByYear(view.loan!.schedule);
    for (const y of byYear) {
      const col = m.years.find((c) => c.year === y.year)!;
      expect(col).toMatchObject({ paid: y.paid, principal: y.principal, interest: y.interest, remaining: y.remaining });
      // Tuyo + del banco = valor del inmueble a final de ese año.
      expect(col.own + col.gain + col.bank).toBeCloseTo(col.value, 6);
      expect(col.gain).toBe(0);
    }
    expect(m.years[0]!.value).toBe(250000);
    expect(m.years.at(-1)!).toMatchObject({ value: 270000, own: 270000, bank: 0 });
    expect(m.simulated).toBe(0);
    // El año que más se paga llena la zona de pagos; ninguna columna se sale de la suya.
    expect(Math.max(...m.years.map((y) => pcNum(y.hPrincipal) + pcNum(y.hInterest)))).toBeCloseTo(100, 2);
    for (const y of m.years) expect(pcNum(y.hOwn) + pcNum(y.hGain) + pcNum(y.hBank)).toBeLessThanOrEqual(100);
    expect(m.ticks.map((t) => t.value)).toEqual([100000, 200000]);
  });

  it("la simulación solo cambia de hoy en adelante y coincide con la del motor", () => {
    const base = homeModel(view, today, 0, "reduce_term");
    for (const mode of ["reduce_term", "reduce_installment"] as const) {
      const m = homeModel(view, today, 30000, mode);
      expect(m.simulated).toBe(30000);
      const sim = simulatedSchedule(view, 30000, mode, today)!;
      const ends = new Map(scheduleByYear(sim).map((y) => [y.year, y.remaining]));
      m.years.forEach((y, i) => {
        const b = base.years[i]!;
        // Lo tuyo según el cuadro vigente y lo pagado cada año no se tocan.
        expect(y).toMatchObject({ own: b.own, paid: b.paid, remaining: b.remaining });
        if (y.year < 2026) expect(y.gain).toBe(0);
        else expect(y.bank).toBeCloseTo(ends.get(y.year) ?? 0, 6);
        expect(y.own + y.gain + y.bank).toBeCloseTo(y.value, 6);
      });
      // Reduciendo plazo la cuota sigue igual y la ventaja crece; reduciendo cuota se amortiza más despacio y mengua.
      const gain = m.years.find((y) => y.year === 2026)!.gain;
      if (mode === "reduce_term") expect(gain).toBeGreaterThanOrEqual(30000);
      else expect(gain).toBeGreaterThan(29000);
      expect(gain).toBeLessThan(31000);
      // El mismo cuadro que usa el motor para sus cifras de ahorro.
      const w = simulateRepayment(view.loan!, 30000, mode, today)!;
      expect(sim.at(-1)!.date).toBe(w.newEndDate);
      expect(view.loan!.totalInterest - sim.reduce((s, r) => s + r.interest, 0)).toBeCloseTo(w.interestSaved, 2);
    }
  });

  it("no simula más que el capital pendiente", () => {
    const m = homeModel(view, today, 1e9, "reduce_term");
    expect(m.simulated).toBe(view.loan!.outstanding);
    for (const y of m.years.filter((c) => c.year >= 2026)) expect(y.bank).toBe(0);
  });

  it("sin hipoteca, el inmueble entero es tuyo de la compra a hoy", () => {
    const m = homeModel(viewProperty(state(false), property, today), today, 10000, "reduce_term");
    expect(m.hasLoan).toBe(false);
    expect(m.years.map((y) => y.year)).toEqual([2024, 2025, 2026]);
    expect(m.years.map((y) => y.own)).toEqual([250000, 270000, 270000]);
    expect(m.years.every((y) => y.bank === 0 && y.gain === 0 && y.paid === 0)).toBe(true);
    expect(m.simulated).toBe(0);
  });
});
