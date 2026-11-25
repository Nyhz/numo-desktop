import { describe, expect, it } from "vitest";
import { grossFromNet, lossCarryover } from "./reports.ts";

describe("compensación de pérdidas entre ejercicios", () => {
  const of = (rows: Array<[year: number, netGainEur: number, incomeEur?: number]>) => lossCarryover(rows.map(([year, netGainEur, incomeEur = 0]) => ({ year, netGainEur, incomeEur })));

  it("una pérdida se arrastra y la absorben las ganancias de los años siguientes", () => {
    const [y21, y22, y23] = of([[2021, -1000], [2022, 300], [2023, 900]]);
    expect(y21).toMatchObject({ pendingInEur: 0, usedEur: 0, pendingOut: [{ year: 2021, lossEur: 1000, until: 2025 }] });
    expect(y22).toMatchObject({ pendingInEur: 1000, usedEur: 300, pendingOut: [{ year: 2021, lossEur: 700, until: 2025 }] });
    expect(y23).toMatchObject({ pendingInEur: 700, usedEur: 700, pendingOut: [] });
  });

  it("antes de arrastrarse, la pérdida se compensa con el 25 % de los dividendos e intereses del año", () => {
    const [y22, y23] = of([[2022, -1000, 2000], [2023, 0, 400]]);
    expect(y22).toMatchObject({ offsetByIncomeEur: 500, pendingOut: [{ year: 2022, lossEur: 500, until: 2026 }] });
    // Al año siguiente, sin ganancias, el 25 % de los rendimientos sigue absorbiendo lo pendiente.
    expect(y23).toMatchObject({ pendingInEur: 500, usedEur: 100, pendingOut: [{ year: 2022, lossEur: 400, until: 2026 }] });
  });

  it("se gasta primero la más antigua y lo que no se compensa en cuatro años caduca", () => {
    const years = of([[2018, -500], [2019, -200], [2020, 100], [2022, 0], [2023, 50]]);
    expect(years.map((y) => y.year)).toEqual([2018, 2019, 2020, 2021, 2022, 2023]);
    expect(years[2]!.pendingOut).toEqual([
      { year: 2018, lossEur: 400, until: 2022 },
      { year: 2019, lossEur: 200, until: 2023 },
    ]);
    // 2022 es el último año para la de 2018: lo que quede caduca.
    expect(years[4]).toMatchObject({ expiredEur: 400, pendingOut: [{ year: 2019, lossEur: 200, until: 2023 }] });
    expect(years[5]).toMatchObject({ usedEur: 50, expiredEur: 150, pendingOut: [] });
  });
});

describe("bruto a partir del neto ingresado", () => {
  it("encuentra el bruto que, retenido al 19 %, deja ese neto", () => {
    for (const net of [0.81, 1, 12.34, 74.86, 81, 123.45, 999.99]) {
      const { gross, tax } = grossFromNet(net);
      expect(tax).toBeCloseTo(Math.round(gross * 19) / 100, 10);
      expect(Math.round((gross - tax) * 100) / 100).toBe(net);
    }
  });

  it("sin retención el bruto es el neto", () => {
    expect(grossFromNet(50, 0)).toEqual({ gross: 50, tax: 0 });
  });
});
