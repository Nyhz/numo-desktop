import { describe, expect, it } from "vitest";
import { mergeSplits, parseEcbCsv, parseFtHistory, parseFtQuote, parseYahooChart, parseYahooSearch } from "./market.ts";

describe("Financial Times", () => {
  const sheet = `<div data-mod-config="{&quot;xid&quot;:&quot;55667788&quot;}"></div>
    <li><span class="mod-ui-data-list__label">Price (EUR)</span><span class="mod-ui-data-list__value">1,234.5678</span></li>
    <div class="mod-disclaimer">Data delayed at least 15 minutes, as of Nov 20 2026.</div>`;

  it("lee el valor liquidativo, la divisa, la fecha y el identificador", () => {
    expect(parseFtQuote(sheet)).toEqual({ price: 1234.5678, currency: "EUR", date: "2026-11-20", xid: "55667788" });
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
