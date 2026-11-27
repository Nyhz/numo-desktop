import { describe, expect, it } from "vitest";
import type { Account, Asset, ForeignFiling } from "../types.ts";
import { filingFrom, foreignStatus, pendingFilings } from "./foreign.ts";
import type { YearReport } from "./reports.ts";

const account = (id: string, country: string, kind: Account["kind"] = "broker"): Account => ({ id, name: id, institution: "", kind, currency: "EUR", color: 1, trackCash: kind === "emergency", country, archived: false, createdAt: "" });
const asset = (id: string, kind: Asset["kind"] = "etf"): Asset => ({ id, name: id, kind, symbol: null, isin: null, currency: "EUR", priceSource: "manual", goalId: null, planExcluded: false, createdAt: "" });

const degiro = account("degiro", "NL");
const myinvestor = account("myinvestor", "ES");
const exchange = account("exchange", "MT", "crypto");
const wallet = account("wallet", "", "crypto");
const neobank = account("neobank", "DE", "emergency");

/** Una foto de fin de año con lo justo para los modelos. */
function report(year: number, holdings: Array<[Account, Asset, number]>, cash: Array<[Account, number, number?]> = []): YearReport {
  return {
    year,
    asOf: `${year}-12-31`,
    gains: [],
    income: [],
    holdings: holdings.map(([acc, a, valueEur]) => ({ account: acc, asset: a, country: "", qty: 1, price: valueEur, currency: "EUR", fxRate: 1, valueEur })),
    cash: cash.map(([acc, balanceEur, avgQ4Eur]) => ({ account: acc, balance: balanceEur, balanceEur, avgQ4Eur: avgQ4Eur ?? balanceEur })),
    totals: {} as YearReport["totals"],
  };
}
const filing = (model: "720" | "721", year: number, blocks: ForeignFiling["blocks"], items: string[] = []): ForeignFiling => ({ id: `${model}-${year}`, model, year, blocks, items, createdAt: "" });
const m720 = (s: ReturnType<typeof foreignStatus>) => s.find((m) => m.model === "720")!;
const m721 = (s: ReturnType<typeof foreignStatus>) => s.find((m) => m.model === "721")!;

const vwce = asset("vwce");
const btc = asset("btc", "crypto");

describe("modelos 720 y 721", () => {
  it("solo cuenta lo que está en entidades de fuera de España", () => {
    const s = foreignStatus(2026, "2027-01-15", report(2026, [[degiro, vwce, 30_000], [myinvestor, vwce, 40_000], [wallet, btc, 80_000]]), null, []);
    expect(m720(s).blocks.find((b) => b.block === "securities")!.valueEur).toBe(30_000);
    expect(m720(s).due).toBe(false);
    // Un monedero propio no tiene entidad: no va al 721.
    expect(m721(s).due).toBe(false);
  });

  it("la primera vez obliga al pasar de 50.000 € en un bloque; cada bloque va por separado", () => {
    const s = foreignStatus(2026, "2027-01-15", report(2026, [[degiro, vwce, 50_001], [exchange, btc, 49_000]]), null, []);
    expect(m720(s).due).toBe(true);
    expect(m721(s).due).toBe(false);
    expect(m720(s).phase).toBe("window");
    expect(pendingFilings(s).map((m) => m.model)).toEqual(["720"]);
  });

  it("una criptomoneda va al 721 aunque esté en un bróker", () => {
    const s = foreignStatus(2026, "2027-01-15", report(2026, [[degiro, btc, 60_000]]), null, []);
    expect(m721(s).due).toBe(true);
    expect(m720(s).due).toBe(false);
  });

  it("en las cuentas también obliga el saldo medio del cuarto trimestre", () => {
    const s = foreignStatus(2026, "2027-01-15", report(2026, [], [[neobank, 45_000, 52_000]]), null, []);
    expect(m720(s).blocks.find((b) => b.block === "accounts")!.due).toBe(true);
  });

  it("después, solo si sube más de 20.000 € desde la última declaración", () => {
    const filed = [filing("720", 2025, { securities: 60_000 }, ["securities:degiro|vwce"])];
    const prev = report(2025, [[degiro, vwce, 60_000]]);
    expect(m720(foreignStatus(2026, "2027-01-15", report(2026, [[degiro, vwce, 79_000]]), prev, filed)).due).toBe(false);
    const up = foreignStatus(2026, "2027-01-15", report(2026, [[degiro, vwce, 80_500]]), prev, filed);
    expect(m720(up).due).toBe(true);
    expect(m720(up).blocks.find((b) => b.block === "securities")!.rule).toEqual({ kind: "change", rise: 20_500, over: true });
  });

  it("y siempre que se deja de tener algo declarado", () => {
    const filed = [filing("720", 2025, { securities: 60_000 }, ["securities:degiro|vwce"])];
    const prev = report(2025, [[degiro, vwce, 60_000]]);
    const sold = foreignStatus(2026, "2027-01-15", report(2026, []), prev, filed);
    expect(m720(sold).due).toBe(true);
    expect(m720(sold).blocks.find((b) => b.block === "securities")!.ended).toEqual(["degiro|vwce"]);
    // Al año siguiente ya no: se declaró al venderlo.
    const next = foreignStatus(2027, "2028-01-15", report(2027, []), report(2026, []), [...filed, filing("720", 2026, { securities: 0 }, [])]);
    expect(m720(next).due).toBe(false);
  });

  it("confirmar guarda solo los bloques presentados, que pasan a ser la referencia", () => {
    const s = foreignStatus(2026, "2027-02-01", report(2026, [[degiro, vwce, 70_000]], [[neobank, 10_000]]), null, []);
    const f = filingFrom(m720(s), 2026);
    expect(f.blocks).toEqual({ securities: 70_000 });
    expect(f.items).toEqual(["securities:degiro|vwce"]);
    const done = foreignStatus(2026, "2027-02-01", report(2026, [[degiro, vwce, 70_000]]), null, [{ ...f, id: "x", createdAt: "" }]);
    expect(m720(done).filing).not.toBeNull();
    expect(pendingFilings(done)).toEqual([]);
  });

  it("el plazo: ejercicio abierto, del 1 de enero al 31 de marzo, y fuera de plazo", () => {
    const r = report(2026, [[degiro, vwce, 70_000]]);
    expect(m720(foreignStatus(2026, "2026-11-27", r, null, [])).phase).toBe("open");
    expect(m720(foreignStatus(2026, "2027-03-31", r, null, [])).phase).toBe("window");
    expect(m720(foreignStatus(2026, "2027-04-01", r, null, [])).phase).toBe("late");
    expect(pendingFilings(foreignStatus(2026, "2027-04-01", r, null, []))).toEqual([]);
  });
});
