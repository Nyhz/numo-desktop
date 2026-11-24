import { describe, expect, it } from "vitest";
import type { Asset } from "../../shared/types.ts";
import { EMPTY_STATE, type Op } from "./backend.ts";
import {
  bestEodhdHit,
  binanceCurrency,
  mergeSplits,
  parseBinanceKlines,
  parseEcbCsv,
  parseEodhdEod,
  parseEodhdSearch,
  parseEodhdSplits,
  parseFtHistory,
  parseFtQuote,
  parseIndexaAccounts,
  parseIndexaPortfolio,
  parseYahooChart,
  parseYahooSearch,
  pickIndexa,
  probeSource,
  rescaleBefore,
  splitSuspect,
  syncMarket,
} from "./market.ts";

describe("Financial Times", () => {
  const sheet = `<h1 class="mod-tearsheet-overview__header__name mod-tearsheet-overview__header__name--large">Fondo de Prueba A EUR</h1>
    <div data-mod-config="{&quot;xid&quot;:&quot;55667788&quot;}"></div>
    <li><span class="mod-ui-data-list__label">Price (EUR)</span><span class="mod-ui-data-list__value">1,234.5678</span></li>
    <div class="mod-disclaimer">Data delayed at least 15 minutes, as of Nov 20 2026.</div>`;

  it("lee el valor liquidativo, la divisa, la fecha y el identificador", () => {
    expect(parseFtQuote(sheet)).toEqual({ price: 1234.5678, currency: "EUR", date: "2026-11-20", xid: "55667788", name: "Fondo de Prueba A EUR" });
  });
  it("falla si la ficha no trae precio", () => {
    expect(() => parseFtQuote("<html>Sin datos</html>")).toThrow();
  });
  it("lee el histórico y se queda con el cierre", () => {
    const body = JSON.stringify({
      html: `<tr><td><span>Friday, November 20, 2026</span></td><td>10.10</td><td>10.30</td><td>10.00</td><td>10.25</td><td>0</td></tr>
             <tr><td><span>Thursday, November 19, 2026</span></td><td>1,010.10</td><td>1,010.30</td><td>1,010.00</td><td>1,010.20</td></tr>
             <tr><td>cabecera sin cifras</td></tr>`,
    });
    expect(parseFtHistory(body)).toEqual([
      ["2026-11-19", 1010.2],
      ["2026-11-20", 10.25],
    ]);
  });
});

describe("Yahoo Finance", () => {
  it("convierte peniques a libras, usa la fecha local de la bolsa y salta los huecos", () => {
    const json = JSON.stringify({
      chart: {
        error: null,
        result: [
          {
            meta: { currency: "GBp", symbol: "SHEL.L", instrumentType: "EQUITY", longName: "Shell plc", fullExchangeName: "LSE", gmtoffset: 3600 },
            // 23:30 UTC del día 1 = 00:30 del día 2 en la bolsa.
            timestamp: [1717284600, 1717371000, 1717457400],
            events: { splits: { "1": { date: 1717371000, numerator: 2, denominator: 1 } } },
            indicators: { quote: [{ close: [2500, null, 2600] }] },
          },
        ],
      },
    });
    const q = parseYahooChart(json);
    expect(q).toMatchObject({ currency: "GBP", kind: "stock", name: "Shell plc" });
    expect(q.points).toEqual([
      ["2024-06-02", 25],
      ["2024-06-04", 26],
    ]);
    expect(q.splits).toEqual([["2024-06-03", 2]]);
  });
  it("usa el precio de la última sesión cuando su vela aún no tiene cierre", () => {
    const json = JSON.stringify({
      chart: {
        error: null,
        result: [
          {
            meta: { currency: "USD", symbol: "GOOG", instrumentType: "EQUITY", gmtoffset: -18000, regularMarketPrice: 279.53, regularMarketTime: 1795467600 },
            timestamp: [1795185000, 1795444200],
            indicators: { quote: [{ close: [264, null] }] },
          },
        ],
      },
    });
    expect(parseYahooChart(json).points).toEqual([
      ["2026-11-20", 264],
      ["2026-11-23", 279.53],
    ]);
  });
  it("no añade ese precio si la vela del día ya trae cierre", () => {
    const json = JSON.stringify({
      chart: { error: null, result: [{ meta: { currency: "USD", symbol: "X", gmtoffset: 0, regularMarketPrice: 11, regularMarketTime: 1795467600 }, timestamp: [1795444200], indicators: { quote: [{ close: [10] }] } }] },
    });
    expect(parseYahooChart(json).points).toEqual([["2026-11-23", 10]]);
  });
  it("da un error legible si el símbolo no existe", () => {
    expect(() => parseYahooChart(JSON.stringify({ chart: { result: null, error: { description: "No data found" } } }))).toThrow("No data found");
  });
  it("filtra los resultados de búsqueda a tipos conocidos", () => {
    const hits = parseYahooSearch(JSON.stringify({ quotes: [{ symbol: "VWCE.DE", longname: "Vanguard FTSE All-World", quoteType: "ETF", exchDisp: "XETRA" }, { symbol: "X", quoteType: "OPTION" }] }));
    expect(hits).toEqual([{ symbol: "VWCE.DE", name: "Vanguard FTSE All-World", kind: "etf", exchange: "XETRA" }]);
  });
});

describe("BCE y splits", () => {
  it("lee el CSV del BCE por nombre de columna", () => {
    const csv = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,TITLE\nA,D,USD,EUR,SP00,A,2024-01-02,1.0956,\"US dollar, daily\"\nA,D,USD,EUR,SP00,A,2024-01-03,,x\nA,D,GBP,EUR,SP00,A,2024-01-02,0.86645,x";
    const out = parseEcbCsv(csv);
    expect(out.get("USD")).toEqual([["2024-01-02", 1.0956]]);
    expect(out.get("GBP")).toEqual([["2024-01-02", 0.86645]]);
  });
  it("no aplica dos veces un split que Yahoo fecha unos días distinto", () => {
    expect(mergeSplits([["2026-07-20", 0.04]], [["2026-07-22", 0.04], ["2024-06-10", 10]])).toEqual([
      ["2024-06-10", 10],
      ["2026-07-20", 0.04],
    ]);
  });
});

describe("actualización", () => {
  const asset = (id: string, patch: Partial<Asset>): Asset => ({
    id,
    name: id,
    kind: "etf",
    symbol: null,
    isin: null,
    currency: "EUR",
    priceSource: "yahoo",
    goalId: null,
    planExcluded: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  });
  const metaOps = (ops: Op[]) => Object.fromEntries(ops.flatMap((o) => (o.op === "meta" ? [[o.key, o.value]] : [])));
  const chart = (symbol: string) =>
    JSON.stringify({
      chart: { error: null, result: [{ meta: { currency: "EUR", symbol, gmtoffset: 0 }, timestamp: [Date.UTC(2026, 10, 20) / 1000], indicators: { quote: [{ close: [50] }] } }] },
    });

  it("anota qué activos se quedan sin actualizar cuando Yahoo bloquea, y deja de insistir", async () => {
    const state = { ...EMPTY_STATE, assets: [asset("a", { symbol: "AAA" }), asset("b", { symbol: "BBB" }), asset("c", { symbol: "CCC" })] };
    const asked: string[] = [];
    const get = async (url: string) => {
      asked.push(url);
      if (url.includes("AAA")) return chart("AAA");
      throw new Error("HTTP 429");
    };
    const { ops, issues } = await syncMarket(state, {}, get, true);
    const meta = metaOps(ops);
    expect(meta["fetched:asset:a"]).toBeTruthy();
    expect(JSON.parse(meta["failed:asset:b"]!).message).toMatch(/limitando/);
    expect(JSON.parse(meta["failed:asset:c"]!).message).toMatch(/limitando/);
    expect(asked.filter((u) => u.includes("CCC"))).toHaveLength(0);
    expect(issues).toHaveLength(1);
    expect(meta.lastSync).toBeTruthy();
  });

  it("no cuenta como actualización una ronda en la que todo falla, y limpia el fallo al recuperarse", async () => {
    const state = { ...EMPTY_STATE, assets: [asset("a", { symbol: "AAA" })] };
    const down = await syncMarket(state, {}, async () => Promise.reject(new Error("sin conexión")), true);
    const meta = metaOps(down.ops);
    expect(JSON.parse(meta["failed:asset:a"]!).message).toBe("sin conexión");
    expect(meta.lastSync).toBeUndefined();
    const up = await syncMarket(state, meta, async () => chart("AAA"), true);
    expect(metaOps(up.ops)["failed:asset:a"]).toBe("");
  });

  it("comprueba una fuente antes de guardar el activo", async () => {
    const probe = await probeSource(async () => chart("AAA"), { priceSource: "yahoo", symbol: "AAA", isin: null, currency: "USD" });
    expect(probe).toMatchObject({ price: 50, date: "2026-11-20", currency: "EUR" });
    await expect(probeSource(async () => "<html></html>", { priceSource: "ft", symbol: null, isin: "ES0000000000", currency: "EUR" })).rejects.toThrow();
  });
});

describe("EODHD", () => {
  const eod = JSON.stringify([
    { date: "2026-11-20", open: 160, high: 161, low: 158, close: 159.34, adjusted_close: 159.34, volume: 10 },
    { date: "2026-11-23", open: 160, high: 166, low: 160, close: 165.04, adjusted_close: 165.04, volume: 12 },
    { date: "2026-11-24", close: 0 },
  ]);
  const search = JSON.stringify([
    { Code: "NGXA", Exchange: "F", Name: "WisdomTree Brent 3x", Type: "ETF", Currency: "EUR", ISIN: "IE00BMTM6D55", previousClose: 48.1, previousCloseDate: "2026-11-23" },
    { Code: "3BRL", Exchange: "LSE", Name: "WisdomTree Brent 3x", Type: "ETF", Currency: "USD", ISIN: "IE00BMTM6D55", previousClose: 52.8, previousCloseDate: "2026-11-23" },
    { Code: "NGXA", Exchange: "XETRA", Name: "WisdomTree Brent 3x", Type: "ETF", Currency: "EUR", ISIN: "IE00BMTM6D55", previousClose: 48.266, previousCloseDate: "2026-11-23" },
  ]);

  it("lee los cierres y descarta los que no valen", () => {
    expect(parseEodhdEod(eod)).toEqual([
      ["2026-11-20", 159.34],
      ["2026-11-23", 165.04],
    ]);
    expect(() => parseEodhdEod('{"error":"x"}')).toThrow();
  });

  it("de un ISIN con varias cotizaciones elige la divisa pedida en el mercado principal", () => {
    const hits = parseEodhdSearch(search);
    expect(hits).toHaveLength(3);
    expect(bestEodhdHit(hits, "EUR")).toMatchObject({ code: "NGXA.XETRA", kind: "etf", price: 48.266, date: "2026-11-23" });
    expect(bestEodhdHit(hits, "USD")?.code).toBe("3BRL.LSE");
  });

  it("resuelve el código a partir del ISIN al comprobar la fuente", async () => {
    const probe = await probeSource(async () => search, { priceSource: "eodhd", symbol: null, isin: "IE00BMTM6D55", currency: "EUR" });
    expect(probe).toMatchObject({ code: "NGXA.XETRA", price: 48.266, currency: "EUR" });
  });

  it("detecta un split por el salto de precio y reescala lo anterior", () => {
    const stored: Array<[string, number]> = [
      ["2026-06-01", 400],
      ["2026-06-02", 404],
    ];
    expect(splitSuspect(stored, [["2026-06-03", 101]])).toBe(true);
    expect(splitSuspect(stored, [["2026-06-03", 380]])).toBe(false);
    expect(parseEodhdSplits(JSON.stringify([{ date: "2026-06-03", split: "4.000000/1.000000" }]))).toEqual([["2026-06-03", 4]]);
    expect(rescaleBefore([...stored, ["2026-06-03", 101]], "2026-06-03", 4)).toEqual([
      ["2026-06-01", 100],
      ["2026-06-02", 101],
      ["2026-06-03", 101],
    ]);
  });

  it("al actualizar aplica el split y deja de insistir cuando se agota el cupo", async () => {
    const asset = (id: string, symbol: string): Asset => ({ id, name: id, kind: "stock", symbol, isin: null, currency: "EUR", priceSource: "eodhd", goalId: null, planExcluded: false, createdAt: "2026-01-01T00:00:00.000Z" });
    const state = { ...EMPTY_STATE, assets: [asset("a", "AAA.XETRA"), asset("b", "BBB.XETRA"), asset("c", "CCC.XETRA")], prices: { a: [["2026-06-01", 400], ["2026-06-02", 404]] as Array<[string, number]> } };
    const asked: string[] = [];
    const get = async (url: string) => {
      asked.push(url);
      if (url.includes("/splits/AAA.XETRA")) return JSON.stringify([{ date: "2026-06-03", split: "4.000000/1.000000" }]);
      if (url.includes("/eod/AAA.XETRA")) return JSON.stringify([{ date: "2026-06-02", close: 404 }, { date: "2026-06-03", close: 101 }]);
      throw new Error("HTTP 402");
    };
    const { ops, issues } = await syncMarket(state, {}, get, true);
    const prices = ops.find((o) => o.op === "prices" && o.assetId === "a");
    expect(prices).toMatchObject({ replace: true, points: [["2026-06-01", 100], ["2026-06-02", 101], ["2026-06-03", 101]] });
    expect(ops.find((o) => o.op === "splits" && o.assetId === "a")).toMatchObject({ points: [["2026-06-03", 4]] });
    expect(asked.filter((u) => u.includes("CCC"))).toHaveLength(0);
    expect(issues.map((i) => i.what)).toEqual(["EODHD"]);
    const failed = ops.filter((o) => o.op === "meta" && o.key.startsWith("failed:asset:") && o.value).map((o) => (o.op === "meta" ? o.key : ""));
    expect(failed).toEqual(["failed:asset:b", "failed:asset:c"]);
  });
});

describe("Binance e Indexa", () => {
  it("lee el cierre de las velas diarias con su fecha UTC", () => {
    const klines = JSON.stringify([
      [1795392000000, "0.00000308", "0.00000341", "0.00000302", "0.00000315", "1", 1795478399999],
      [1795478400000, "0.00000314", "0.00000329", "0.00000310", "0.00000319", "1", 1795564799999],
    ]);
    expect(parseBinanceKlines(klines)).toEqual([
      ["2026-11-23", 0.00000315],
      ["2026-11-24", 0.00000319],
    ]);
    expect(binanceCurrency("etheur")).toBe("EUR");
    expect(binanceCurrency("ETHUSDT")).toBe("USD");
  });

  const me = JSON.stringify({ email: "x", accounts: [{ account_number: "AAAA1111", status: "cancelled" }, { account_number: "BBBB2222", status: "active" }] });
  const portfolio = JSON.stringify({
    portfolio: { date: "2026-11-23", total_amount: 1 },
    instrument_accounts: [{ positions: [{ price: 22.05622, titles: 1, amount: 1, instrument: { identifier: "0192#0011", name: "Plan de prueba" } }] }],
  });

  it("de Indexa solo saca cuentas activas, y de la cartera el precio y la fecha", () => {
    expect(parseIndexaAccounts(me)).toEqual(["BBBB2222"]);
    const quotes = parseIndexaPortfolio(portfolio);
    expect(quotes).toEqual([{ identifier: "0192#0011", name: "Plan de prueba", price: 22.05622, date: "2026-11-23" }]);
    expect(pickIndexa(quotes, null).price).toBe(22.05622);
    expect(() => pickIndexa(quotes, "otro")).toThrow(/ninguna posición/);
  });

  it("actualiza el plan con una sola ronda de consultas y anota el fallo si la clave no vale", async () => {
    const plan: Asset = { id: "p", name: "Plan", kind: "fund", symbol: "0192#0011", isin: null, currency: "EUR", priceSource: "indexa", goalId: null, planExcluded: false, createdAt: "2026-01-01T00:00:00.000Z" };
    const state = { ...EMPTY_STATE, assets: [plan] };
    const good = await syncMarket(state, {}, async (url) => (url.endsWith("/users/me") ? me : portfolio), true);
    expect(good.ops.find((o) => o.op === "prices")).toMatchObject({ assetId: "p", points: [["2026-11-23", 22.05622]] });
    const bad = await syncMarket(state, {}, async () => Promise.reject(new Error("HTTP 401")), true);
    const failed = bad.ops.find((o) => o.op === "meta" && o.key === "failed:asset:p");
    expect(failed && failed.op === "meta" && JSON.parse(failed.value).message).toMatch(/rechaza la clave/);
  });
});
