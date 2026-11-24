import { describe, expect, it } from "vitest";
import { scheduleByYear, viewProperty } from "../../shared/engine/realestate.ts";
import type { AppState, Mortgage, Property } from "../../shared/types.ts";
import { homeModel } from "./inmuebles-model.ts";

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
    const m = homeModel(view, today);
    expect(m.years[0]!.year).toBe(2024);
    expect(m.years.at(-1)!.year).toBe(2054);
    expect(m.years.filter((y) => y.isNow).map((y) => y.year)).toEqual([2026]);
    expect(m.years.find((y) => y.year === 2027)!.future).toBe(true);
    const byYear = scheduleByYear(view.loan!.schedule);
    for (const y of byYear) {
      const col = m.years.find((c) => c.year === y.year)!;
      expect(col).toMatchObject({ paid: y.paid, principal: y.principal, interest: y.interest, remaining: y.remaining });
      // Tuyo + del banco = valor del inmueble a final de ese año.
      expect(col.own + col.bank).toBeCloseTo(col.value, 6);
    }
    expect(m.years[0]!.value).toBe(250000);
    expect(m.years.at(-1)!).toMatchObject({ value: 270000, own: 270000, bank: 0 });
    // El año que más se paga llena la zona de pagos; ninguna columna se sale de la suya.
    expect(Math.max(...m.years.map((y) => pcNum(y.hPrincipal) + pcNum(y.hInterest)))).toBeCloseTo(100, 2);
    for (const y of m.years) expect(pcNum(y.hOwn) + pcNum(y.hBank)).toBeLessThanOrEqual(100);
    expect(m.ticks.map((t) => t.value)).toEqual([100000, 200000]);
  });

  it("sin hipoteca, el inmueble entero es tuyo de la compra a hoy", () => {
    const m = homeModel(viewProperty(state(false), property, today), today);
    expect(m.hasLoan).toBe(false);
    expect(m.years.map((y) => y.year)).toEqual([2024, 2025, 2026]);
    expect(m.years.map((y) => y.own)).toEqual([250000, 270000, 270000]);
    expect(m.years.every((y) => y.bank === 0 && y.paid === 0)).toBe(true);
  });
});
