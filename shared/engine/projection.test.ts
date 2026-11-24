import { describe, expect, it } from "vitest";
import { monthsToReach, projectPortfolio, projectionDates } from "./projection.ts";

describe("proyección del patrimonio", () => {
  it("sin rentabilidad, solo suma las aportaciones", () => {
    expect(projectPortfolio(1000, 100, 0, 3)).toEqual([1000, 1100, 1200, 1300]);
  });

  it("la rentabilidad anual se reparte mes a mes y compone exactamente a un año", () => {
    const v = projectPortfolio(10000, 0, 6, 24);
    expect(v[12]).toBeCloseTo(10600, 6);
    expect(v[24]).toBeCloseTo(11236, 6);
    // Con aportaciones, cada una rinde desde el mes en que entra.
    const withFlows = projectPortfolio(0, 100, 12, 12);
    expect(withFlows[12]).toBeGreaterThan(1200);
    expect(withFlows[12]).toBeLessThan(1200 * 1.12);
  });

  it("dice en qué mes se alcanza un objetivo, o que no se alcanza", () => {
    const v = projectPortfolio(1000, 100, 0, 12);
    expect(monthsToReach(v, 1000)).toBe(0);
    expect(monthsToReach(v, 1450)).toBe(5);
    expect(monthsToReach(v, 1_000_000)).toBeNull();
    expect(projectionDates("2026-01-31", 2)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});
