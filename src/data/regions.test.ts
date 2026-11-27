import { describe, expect, it } from "vitest";
import type { AppState, Asset } from "../../shared/types.ts";
import { EMPTY_STATE } from "./backend.ts";
import { exposureOf, morningstarRegions, morningstarStock, regionsDue, regionsFromMorningstar, regionsKey, REGIONS_MONTH, sectorExposureOf, sectorsFromMorningstar, syncRegions } from "./regions.ts";

const asset = (id: string, kind: Asset["kind"], isin: string | null, priceSource: Asset["priceSource"] = "xetra"): Asset => ({ id, name: id, kind, symbol: null, isin, currency: "EUR", priceSource, goalId: null, planExcluded: false, createdAt: "" });

// Extracto real de la respuesta de Morningstar para un ETF del MSCI World.
const WORLD = JSON.stringify({
  fundPortfolio: { portfolioDate: "2026-11-25T06:00:00.000", masterPortfolioId: "461942", northAmerica: 76.202, unitedKingdom: 3.43859, europeDeveloped: 11.868, europeEmerging: 0.0, africaMiddleEast: 0.235, japan: 5.613, australasia: 1.575, asiaDeveloped: 0.836, asiaEmerging: 0.121, latinAmerica: 0.113 },
});
const SEARCH = JSON.stringify({ total: 2, rows: [{ SecId: "LSE", Isin: "IE00B4L5Y983" }, { SecId: "XETRA", Isin: "IE00B4L5Y983" }] });

// Extracto real del reparto por sectores de un ETF del MSCI World (lo que no es renta variable va aparte).
const SECTORS = JSON.stringify({
  FIXEDINCOME: { fundPortfolio: { cashAndEquivalents: 100 } },
  EQUITY: { fundPortfolio: { portfolioDate: "2026-11-24T06:00:00.000", basicMaterials: 2.9645, consumerCyclical: 9.21825, financialServices: 16.43482, realEstate: 1.7011, communicationServices: 7.62782, energy: 4.16079, industrials: 10.43023, technology: 28.55879, consumerDefensive: 5.63688, healthcare: 10.69766, utilities: 2.56917 } },
});
const STOCKS = JSON.stringify({ total: 2, rows: [{ SecId: "0P0000B5FM", Isin: "US0378331005", SectorName: "Technology" }, { SecId: "0P0000BMP3", Isin: "US0378331005", SectorName: "Technology" }] });

/** Un Morningstar de mentira: la cotización de Londres falla, como pasa de verdad. */
function fakeGet(calls: string[]) {
  return async (url: string) => {
    calls.push(url);
    if (url.includes("E0WWE")) return STOCKS;
    if (url.includes("/sector/")) return SECTORS;
    if (url.includes("lt.morningstar.com")) return SEARCH;
    if (url.includes("/LSE/")) throw new Error("HTTP 404");
    if (url.includes("/XETRA/")) return WORLD;
    throw new Error("HTTP 404");
  };
}

describe("reparto por regiones", () => {
  it("agrupa los países con el criterio de los índices: Taiwán y Corea son emergentes; lo que no tiene nombre, también", () => {
    const em = JSON.stringify({ fundPortfolio: { portfolioDate: "2026-11-25T06:00:00.000", countries: [{ name: "taiwan", percent: 26.1 }, { name: "china", percent: 18.2 }, { name: "southKorea", percent: 16.7 }, { name: "india", percent: 16 }, { name: "unitedStates", percent: 1 }, { name: "japan", percent: null }], regions: [] } });
    const got = regionsFromMorningstar(em)!;
    expect(got.weights.em).toBeCloseTo(0.99, 9);
    expect(got.weights.na).toBeCloseTo(0.01, 9);
  });

  it("sin países, usa las regiones de Morningstar y las agrupa en las de la app, sumando 1", () => {
    const got = regionsFromMorningstar(WORLD)!;
    expect(got.date).toBe("2026-11-25");
    expect(got.weights.na).toBeCloseTo(0.762, 3);
    expect(got.weights.eu).toBeCloseTo(0.153, 3);
    expect(Object.values(got.weights).reduce((s, v) => s + v!, 0)).toBeCloseTo(1, 9);
    // Renta fija: todo a null.
    expect(regionsFromMorningstar(JSON.stringify({ fundPortfolio: { northAmerica: null, japan: null } }))).toBeNull();
  });

  it("prueba las cotizaciones hasta dar con una que responde, y la recuerda", async () => {
    const calls: string[] = [];
    const got = await morningstarRegions(fakeGet(calls), "IE00B4L5Y983", null);
    expect(got.secId).toBe("XETRA");
    // El mes siguiente va directa a la que funcionó: sin búsqueda (regiones y sectores, nada más).
    const again: string[] = [];
    await morningstarRegions(fakeGet(again), "IE00B4L5Y983", "XETRA");
    expect(again.some((u) => u.includes("lt.morningstar.com"))).toBe(false);
    expect(again).toHaveLength(2);
  });

  it("una vez al mes todo; entre medias, solo lo nuevo", () => {
    const etf = asset("etf", "etf", "IE00B4L5Y983");
    const nuevo = asset("nuevo", "fund", "ES0114638036");
    const accion = asset("accion", "stock", "US0378331005");
    const state: AppState = { ...EMPTY_STATE, assets: [etf, nuevo, accion] };
    const held = new Set(["etf", "nuevo", "accion"]);
    const stored = JSON.stringify({ secId: "X", date: null, fetchedAt: "2026-11-02T10:00:00Z", weights: { na: 1 }, sectors: { tech: 1 } });
    // Las acciones también: de ellas se pide su sector.
    expect(regionsDue(state, { [REGIONS_MONTH]: "2026-10", [regionsKey("etf")]: stored }, held, "2026-11-27").map((a) => a.id)).toEqual(["etf", "nuevo", "accion"]);
    expect(regionsDue(state, { [REGIONS_MONTH]: "2026-11", [regionsKey("etf")]: stored }, held, "2026-11-27").map((a) => a.id)).toEqual(["nuevo", "accion"]);
  });

  it("sin conexión no marca el mes, para volver a intentarlo", async () => {
    const state: AppState = { ...EMPTY_STATE, assets: [asset("etf", "etf", "IE00B4L5Y983")] };
    const ops = await syncRegions(state, {}, async () => Promise.reject(new Error("Sin conexión: timeout")), new Set(["etf"]), "2026-11-27");
    expect(ops).toEqual([]);
    const ok = await syncRegions(state, {}, fakeGet([]), new Set(["etf"]), "2026-11-27");
    expect(ok.map((o) => (o.op === "meta" ? o.key : ""))).toEqual([regionsKey("etf"), REGIONS_MONTH]);
  });

  it("acciones por el país de su ISIN; cripto y lo que no tiene desglose, aparte", () => {
    expect(exposureOf(asset("a", "stock", "ES0109260291", "bme"), null)).toEqual({ kind: "regions", weights: { eu: 1 } });
    expect(exposureOf(asset("g", "stock", null, "nasdaq"), null)).toEqual({ kind: "regions", weights: { na: 1 } });
    expect(exposureOf(asset("b", "crypto", null), null)).toEqual({ kind: "crypto" });
    expect(exposureOf(asset("oro", "etf", "IE00B4ND3602"), { secId: null, date: null, fetchedAt: "", weights: null })).toEqual({ kind: "none" });
  });

  it("sectores: el reparto de la renta variable de un fondo, y el de cada acción por su ISIN", async () => {
    const w = sectorsFromMorningstar(SECTORS)!;
    expect(w.tech).toBeCloseTo(0.2856, 3);
    expect(Object.values(w).reduce((s, v) => s + v!, 0)).toBeCloseTo(1, 9);
    expect(sectorsFromMorningstar(JSON.stringify({ EQUITY: { fundPortfolio: { technology: null } } }))).toBeNull();
    // Un fondo trae a la vez regiones y sectores, con el mismo identificador.
    const fund = await morningstarRegions(fakeGet([]), "IE00B4L5Y983", null);
    expect(fund.sectors?.tech).toBeCloseTo(0.2856, 3);
    // Una acción: su sector entero, y la región sigue yendo por el país de su ISIN.
    const apple = await morningstarStock(fakeGet([]), "US0378331005");
    expect(apple.sectors).toEqual({ tech: 1 });
    expect(sectorExposureOf(asset("a", "stock", "US0378331005"), { ...apple, fetchedAt: "" })).toEqual({ kind: "sectors", weights: { tech: 1 } });
    expect(exposureOf(asset("a", "stock", "US0378331005"), { ...apple, fetchedAt: "" })).toEqual({ kind: "regions", weights: { na: 1 } });
    expect(sectorExposureOf(asset("b", "crypto", null), null)).toEqual({ kind: "crypto" });
  });

  it("lo guardado antes de que hubiera sectores se vuelve a pedir, sin esperar al mes siguiente", () => {
    const etf = asset("etf", "etf", "IE00B4L5Y983");
    const state: AppState = { ...EMPTY_STATE, assets: [etf] };
    const old = JSON.stringify({ secId: "X", date: null, fetchedAt: "2026-11-02T10:00:00Z", weights: { na: 1 } });
    expect(regionsDue(state, { [REGIONS_MONTH]: "2026-11", [regionsKey("etf")]: old }, new Set(["etf"]), "2026-11-27").map((a) => a.id)).toEqual(["etf"]);
  });
});
