import { describe, expect, it } from "vitest";
import { parseNumber, parseTxCsv, planImport, txsToCsv } from "../csv.ts";
import { addMonths, dayNum } from "../dates.ts";
import { txInput } from "../schema.ts";
import type { Account, AppState, Asset, Point, Tx } from "../types.ts";
import { buildLedger } from "./ledger.ts";
import { buildYearReport } from "./reports.ts";
import {
  cashReturn,
  drawdown,
  buildPositions,
  buildTimeline,
  dailyReturns,
  indexOfDate,
  monthlyReturns,
  periodStats,
  totalsIn,
  twr,
  xirr,
} from "./timeline.ts";

let seq = 0;
const acct = (id: string, over: Partial<Account> = {}): Account => ({
  id,
  name: id,
  institution: "",
  kind: "broker",
  currency: "EUR",
  color: 1,
  trackCash: false,
  archived: false,
  createdAt: "2020-01-01T00:00:00Z",
  ...over,
});
const asset = (id: string, over: Partial<Asset> = {}): Asset => ({
  id,
  name: id,
  kind: "stock",
  symbol: id,
  isin: null,
  currency: "EUR",
  priceSource: "yahoo",
  goalId: null,
  planExcluded: false,
  archived: false,
  createdAt: "2020-01-01T00:00:00Z",
  ...over,
});
const tx = (over: Partial<Tx> & Pick<Tx, "date" | "type" | "accountId">): Tx => ({
  id: `t${++seq}`,
  assetId: null,
  quantity: null,
  price: null,
  amount: null,
  currency: "EUR",
  fxRate: 1,
  fee: 0,
  feeCurrency: over.currency ?? "EUR",
  taxSource: 0,
  taxHome: 0,
  toAccountId: null,
  toAssetId: null,
  toQuantity: null,
  note: "",
  createdAt: `2020-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
  ...over,
});
const state = (over: Partial<AppState>): AppState => ({
  accounts: [acct("A")],
  assets: [asset("X")],
  txs: [],
  prices: {},
  fx: {},
  splits: {},
  goals: [],
  properties: [],
  mortgages: [],
  mortgageEvents: [],
  valuations: [],
  lastSync: null,
  ...over,
});

describe("lotes FIFO", () => {
  it("empareja ventas con las compras más antiguas y reparte comisiones", () => {
    const s = state({
      txs: [
        tx({ date: "2023-01-10", type: "buy", accountId: "A", assetId: "X", quantity: 10, price: 100, fee: 5 }),
        tx({ date: "2023-03-10", type: "buy", accountId: "A", assetId: "X", quantity: 10, price: 120, fee: 5 }),
        tx({ date: "2024-02-01", type: "sell", accountId: "A", assetId: "X", quantity: 15, price: 150, fee: 6 }),
      ],
    });
    const led = buildLedger(s);
    expect(led.matches).toHaveLength(2);
    const [m1, m2] = led.matches;
    expect(m1).toMatchObject({ acqDate: "2023-01-10", qty: 10, costEur: 1005 });
    expect(m2).toMatchObject({ acqDate: "2023-03-10", qty: 5, costEur: 602.5 });
    // El importe de venta neto (2250 − 6) se reparte sin perder céntimos.
    expect(m1!.proceedsEur + m2!.proceedsEur).toBeCloseTo(2244, 10);
    expect(m1!.gainEur + m2!.gainEur).toBeCloseTo(2244 - 1607.5, 10);
    const open = led.lots.get("X")!;
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ qty: 5, costEur: 602.5 });
    expect(led.issues).toHaveLength(0);
  });

  it("convierte a EUR con el cambio de cada operación", () => {
    const s = state({
      assets: [asset("U", { currency: "USD" })],
      txs: [
        tx({ date: "2023-01-10", type: "buy", accountId: "A", assetId: "U", quantity: 10, price: 110, currency: "USD", fxRate: 1.1, fee: 2, feeCurrency: "EUR" }),
        tx({ date: "2023-06-10", type: "sell", accountId: "A", assetId: "U", quantity: 10, price: 120, currency: "USD", fxRate: 1.2, fee: 2.4, feeCurrency: "USD" }),
      ],
    });
    const [m] = buildLedger(s).matches;
    expect(m!.costEur).toBe(1002); // 1100 USD / 1,10 + 2 EUR
    expect(m!.proceedsEur).toBe(998); // 1200 USD / 1,20 − 2,40 USD / 1,20
    expect(m!.gainEur).toBe(-4);
  });

  it("es global por activo aunque las compras estén en cuentas distintas", () => {
    const s = state({
      accounts: [acct("A"), acct("B")],
      txs: [
        tx({ date: "2023-01-10", type: "buy", accountId: "A", assetId: "X", quantity: 10, price: 10 }),
        tx({ date: "2023-02-10", type: "buy", accountId: "B", assetId: "X", quantity: 10, price: 20 }),
        tx({ date: "2023-03-10", type: "sell", accountId: "B", assetId: "X", quantity: 10, price: 30 }),
      ],
      prices: { X: [["2023-03-10", 30]] },
    });
    const led = buildLedger(s);
    expect(led.matches[0]).toMatchObject({ acqDate: "2023-01-10", costEur: 100, gainEur: 200 });
    // Las unidades físicas siguen en A; el coste pendiente es el del lote de febrero.
    const [pos] = buildPositions(led, s, null, "2023-03-10");
    expect(pos!.accounts).toEqual([{ accountId: "A", qty: 10 }]);
    expect(pos!.costEur).toBe(200);
  });

  it("un traspaso entre fondos hereda fecha y coste sin generar plusvalía", () => {
    const s = state({
      assets: [asset("F1", { kind: "fund" }), asset("F2", { kind: "fund" })],
      txs: [
        tx({ date: "2021-01-10", type: "buy", accountId: "A", assetId: "F1", quantity: 100, price: 10 }),
        tx({ date: "2022-01-10", type: "buy", accountId: "A", assetId: "F1", quantity: 100, price: 12 }),
        tx({ date: "2023-01-10", type: "transfer", accountId: "A", assetId: "F1", quantity: 150, toAssetId: "F2", toQuantity: 30 }),
        tx({ date: "2024-01-10", type: "sell", accountId: "A", assetId: "F2", quantity: 30, price: 80 }),
      ],
    });
    const led = buildLedger(s);
    expect(led.lots.get("F1")).toEqual([expect.objectContaining({ qty: 50, costEur: 600 })]);
    expect(led.matches).toHaveLength(2);
    expect(led.matches[0]).toMatchObject({ acqDate: "2021-01-10", qty: 20, costEur: 1000 });
    expect(led.matches[1]).toMatchObject({ acqDate: "2022-01-10", qty: 10, costEur: 600 });
    expect(led.matches.reduce((s2, m) => s2 + m.gainEur, 0)).toBeCloseTo(2400 - 1600, 10);
  });

  it("ajusta las unidades anteriores a un split", () => {
    const s = state({
      txs: [
        tx({ date: "2024-01-10", type: "buy", accountId: "A", assetId: "X", quantity: 2, price: 1000 }),
        tx({ date: "2024-07-01", type: "sell", accountId: "A", assetId: "X", quantity: 5, price: 120 }),
      ],
      splits: { X: [["2024-06-10", 10]] },
      prices: { X: [["2024-01-10", 100], ["2024-07-01", 120]] },
    });
    const led = buildLedger(s);
    expect(led.matches[0]).toMatchObject({ qty: 5, costEur: 500, proceedsEur: 600 });
    const [pos] = buildPositions(led, s, null, "2024-07-01");
    expect(pos!.qty).toBe(15);
    expect(pos!.valueEur).toBe(1800);
    // Antes del split la valoración usa unidades actuales × precio ajustado.
    const tl = buildTimeline(led, s, null, "2024-07-01");
    expect(tl.total[0]).toBe(2000);
  });

  it("avisa cuando se vende más de lo que hay", () => {
    const s = state({
      txs: [
        tx({ date: "2024-01-10", type: "buy", accountId: "A", assetId: "X", quantity: 5, price: 10 }),
        tx({ date: "2024-02-10", type: "sell", accountId: "A", assetId: "X", quantity: 8, price: 10 }),
      ],
    });
    const led = buildLedger(s);
    expect(led.issues).toEqual([expect.objectContaining({ kind: "oversell", missingQty: 3 })]);
    expect(led.matches.reduce((a, m) => a + m.proceedsEur, 0)).toBe(80);
  });
});

describe("serie diaria y rentabilidad", () => {
  const prices: Point[] = [
    ["2024-01-01", 10],
    ["2024-01-02", 11],
    ["2024-01-03", 12],
    ["2024-01-04", 12],
  ];

  it("cuenta sin efectivo: comprar y venderlo todo no rompe el TWR", () => {
    const s = state({
      txs: [
        tx({ date: "2024-01-01", type: "buy", accountId: "A", assetId: "X", quantity: 100, price: 10 }),
        tx({ date: "2024-01-03", type: "sell", accountId: "A", assetId: "X", quantity: 100, price: 12.6 }),
      ],
      prices: { X: prices },
    });
    const led = buildLedger(s);
    const tl = buildTimeline(led, s, null, "2024-01-04");
    expect([...tl.total]).toEqual([1000, 1100, 0, 0]);
    const r = dailyReturns(tl);
    expect(twr(r, -1, 3)).toBeCloseTo(0.26, 10); // 10 → 12,60
    const st = periodStats(tl, -1, 3);
    expect(st.gain).toBe(260);
    expect(st.netFlow).toBe(-260);
  });

  it("cuenta con efectivo: los dividendos son rentabilidad, los ingresos no", () => {
    const s = state({
      accounts: [acct("A", { trackCash: true })],
      txs: [
        tx({ date: "2024-01-01", type: "deposit", accountId: "A", amount: 2000 }),
        tx({ date: "2024-01-01", type: "buy", accountId: "A", assetId: "X", quantity: 100, price: 10 }),
        tx({ date: "2024-01-03", type: "dividend", accountId: "A", assetId: "X", amount: 50, taxHome: 9.5 }),
        tx({ date: "2024-01-04", type: "deposit", accountId: "A", amount: 1000 }),
      ],
      prices: { X: prices },
    });
    const led = buildLedger(s);
    const tl = buildTimeline(led, s, null, "2024-01-04");
    expect([...tl.total]).toEqual([2000, 2100, 2240.5, 3240.5]);
    expect(tl.byKind.get("cash")![3]).toBe(2040.5);
    const st = periodStats(tl, -1, 3);
    expect(st.gain).toBe(240.5);
    expect(st.twr).toBeCloseTo(240.5 / 2000, 10);
    expect(totalsIn(led, null, "2024-01-01", "2024-12-31").dividendsEur).toBe(40.5);
  });

  it("valora en EUR con el tipo de cambio de cada día", () => {
    const s = state({
      assets: [asset("U", { currency: "USD" })],
      txs: [tx({ date: "2024-01-01", type: "buy", accountId: "A", assetId: "U", quantity: 10, price: 100, currency: "USD", fxRate: 1.0 })],
      prices: { U: [["2024-01-01", 100]] },
      fx: { USD: [["2024-01-01", 1.0], ["2024-01-02", 1.25]] },
    });
    const tl = buildTimeline(buildLedger(s), s, null, "2024-01-02");
    expect([...tl.total]).toEqual([1000, 800]);
  });

  it("un traspaso entre cuentas no es flujo si ambas están en el filtro", () => {
    const s = state({
      accounts: [acct("A"), acct("B")],
      txs: [
        tx({ date: "2024-01-01", type: "buy", accountId: "A", assetId: "X", quantity: 100, price: 10 }),
        tx({ date: "2024-01-02", type: "transfer", accountId: "A", assetId: "X", quantity: 100, toAccountId: "B" }),
      ],
      prices: { X: prices },
    });
    const led = buildLedger(s);
    const all = buildTimeline(led, s, null, "2024-01-03");
    expect([...all.total]).toEqual([1000, 1100, 1200]);
    expect(all.outflow[1]).toBe(0);
    const onlyB = buildTimeline(led, s, new Set(["B"]), "2024-01-03");
    expect([...onlyB.total]).toEqual([1100, 1200]);
    expect(onlyB.inflow[0]).toBe(1100);
    expect(twr(dailyReturns(onlyB), -1, 1)).toBeCloseTo(1200 / 1100 - 1, 10);
  });

  it("agrupa la rentabilidad por meses", () => {
    const s = state({
      txs: [tx({ date: "2024-01-31", type: "buy", accountId: "A", assetId: "X", quantity: 1, price: 100 })],
      prices: { X: [["2024-01-31", 100], ["2024-02-29", 110]] },
    });
    const tl = buildTimeline(buildLedger(s), s, null, "2024-03-01");
    const months = monthlyReturns(tl);
    expect(months.map((m) => m.month)).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(months[1]!.ret).toBeCloseTo(0.1, 10);
    expect(indexOfDate(tl, "2024-02-29")).toBe(dayNum("2024-02-29") - dayNum("2024-01-31"));
  });

  it("calcula la TIR anualizada", () => {
    expect(xirr([{ day: 0, amount: -1000 }, { day: 365, amount: 1100 }])).toBeCloseTo(0.1, 6);
    expect(xirr([{ day: 0, amount: -1000 }, { day: 365, amount: -1000 }, { day: 730, amount: 2200 }])).toBeCloseTo(0.0654, 3);
    expect(xirr([{ day: 0, amount: 100 }])).toBeNull();
  });
});

describe("informe anual", () => {
  it("separa plusvalías, rendimientos y posiciones a cierre", () => {
    const s = state({
      accounts: [acct("A", { trackCash: true })],
      assets: [asset("X", { isin: "US0378331005", currency: "USD" })],
      txs: [
        tx({ date: "2023-10-01", type: "deposit", accountId: "A", amount: 5000 }),
        tx({ date: "2023-11-01", type: "buy", accountId: "A", assetId: "X", quantity: 20, price: 110, currency: "USD", fxRate: 1.1 }),
        tx({ date: "2023-12-01", type: "dividend", accountId: "A", assetId: "X", amount: 22, currency: "USD", fxRate: 1.1, taxSource: 3.3, taxHome: 3.55 }),
        tx({ date: "2023-12-15", type: "sell", accountId: "A", assetId: "X", quantity: 5, price: 99, currency: "USD", fxRate: 1.1 }),
        tx({ date: "2024-01-10", type: "buy", accountId: "A", assetId: "X", quantity: 5, price: 100, currency: "USD", fxRate: 1.1 }),
      ],
      prices: { X: [["2023-12-29", 121]] },
      fx: { USD: [["2023-10-01", 1.1]] },
    });
    const led = buildLedger(s);
    const tl = buildTimeline(led, s, null, "2024-06-01");
    const rep = buildYearReport(led, s, tl, null, 2023, "2024-06-01");
    expect(rep.asOf).toBe("2023-12-31");
    expect(rep.gains).toHaveLength(1);
    expect(rep.gains[0]).toMatchObject({ qty: 5, acqValueEur: 500, saleValueEur: 450, gainEur: -50, review: true });
    expect(rep.income[0]).toMatchObject({ country: "US", grossEur: 20, taxSourceEur: 3, taxHomeEur: 3.23, netEur: 13.77 });
    expect(rep.holdings[0]).toMatchObject({ qty: 15, valueEur: 1650 });
    expect(rep.cash[0]!.balanceEur).toBe(5000 - 2000 + 13.77 + 450);
    expect(rep.totals.netGainEur).toBe(-50);
    expect(rep.totals.lossesEur).toBe(-50);
    // Saldo medio del 4T: 5000 durante 31 días, 3000 durante 30, etc.
    expect(rep.cash[0]!.avgQ4Eur).toBeGreaterThan(3000);
    expect(rep.cash[0]!.avgQ4Eur).toBeLessThan(5000);
  });

  it("no marca la pérdida si no hay recompra en la ventana", () => {
    const s = state({
      txs: [
        tx({ date: "2023-01-10", type: "buy", accountId: "A", assetId: "X", quantity: 10, price: 100 }),
        tx({ date: "2023-06-10", type: "sell", accountId: "A", assetId: "X", quantity: 10, price: 90 }),
        tx({ date: addMonths("2023-06-10", 3), type: "buy", accountId: "A", assetId: "X", quantity: 10, price: 80 }),
      ],
    });
    const led = buildLedger(s);
    const rep = buildYearReport(led, s, buildTimeline(led, s, null, "2024-01-01"), null, 2023, "2024-01-01");
    expect(rep.gains[0]!.review).toBe(false);
  });
});

describe("CSV de operaciones", () => {
  it("lo que se exporta se vuelve a importar igual", () => {
    const s = state({
      assets: [asset("X", { name: "Acme Corp", isin: "US0378331005", symbol: "ACME", currency: "USD" })],
      txs: [
        tx({ date: "2024-01-10", type: "buy", accountId: "A", assetId: "X", quantity: 1.5, price: 100.25, currency: "USD", fxRate: 1.0875, fee: 1, feeCurrency: "EUR", note: 'con ; y "comillas"' }),
        tx({ date: "2024-02-10", type: "dividend", accountId: "A", assetId: "X", amount: 12.5, currency: "USD", fxRate: 1.08, taxSource: 1.88 }),
      ],
    });
    const parsed = parseTxCsv(txsToCsv(s));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      date: "2024-01-10",
      type: "buy",
      account: "A",
      quantity: 1.5,
      price: 100.25,
      currency: "USD",
      fxRate: 1.0875,
      fee: 1,
      feeCurrency: "EUR",
      note: 'con ; y "comillas"',
    });
    expect(parsed.rows[0]!.asset).toMatchObject({ isin: "US0378331005", symbol: "ACME" });
    const plan = planImport(parsed.rows, s);
    expect(plan.newAccounts).toEqual([]);
    expect(plan.newAssets).toEqual([]);
    const fresh = planImport(parsed.rows, state({ accounts: [], assets: [] }));
    expect(fresh.newAccounts.map((a) => a.name)).toEqual(["A"]);
    expect(fresh.newAssets.map((a) => a.isin)).toEqual(["US0378331005"]);
  });

  it("entiende números y fechas en formato español e inglés", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("0,5")).toBe(0.5);
    expect(parseNumber("")).toBeNull();
    const { rows, errors } = parseTxCsv("Fecha,Tipo,Cuenta,Importe\n15/03/2024,Ingreso,Mi banco,\"1.000,50\"\n2024-13-01,Ingreso,Mi banco,5\n");
    expect(rows[0]).toMatchObject({ date: "2024-03-15", type: "deposit", amount: 1000.5 });
    expect(errors).toHaveLength(1);
  });
});

describe("validación de operaciones", () => {
  it("limpia los campos que no aplican al tipo", () => {
    const t = txInput.parse({ date: "2024-01-10", type: "deposit", accountId: "A", amount: 100, currency: "eur", assetId: "X", fee: 3, fxRate: 2 });
    expect(t).toMatchObject({ assetId: null, fee: 0, fxRate: 1, currency: "EUR", feeCurrency: "EUR" });
  });
  it("rechaza una compra sin precio", () => {
    const r = txInput.safeParse({ date: "2024-01-10", type: "buy", accountId: "A", assetId: "X", quantity: 1, currency: "EUR" });
    expect(r.success).toBe(false);
  });
});

describe("fondo de emergencia", () => {
  it("lo que renta el efectivo: intereses entre saldo medio, anualizado", () => {
    const s = state({
      accounts: [acct("E", { kind: "emergency", trackCash: true })],
      assets: [],
      txs: [
        tx({ date: "2024-01-01", type: "deposit", accountId: "E", amount: 10000 }),
        ...[2, 3, 4, 5, 6, 7].map((m) => tx({ date: `2024-0${m}-01`, type: "interest", accountId: "E", amount: 25, taxHome: 4.75 })),
      ],
    });
    const led = buildLedger(s);
    const tl = buildTimeline(led, s, new Set(["E"]), "2024-07-01");
    const r = cashReturn(tl, led, "E");
    expect(r.interest).toBe(150);
    expect(r.interestNet).toBe(121.5);
    expect(r.days).toBe(183);
    // El saldo medio es algo más de 10.000 (los intereses netos se van sumando).
    expect(r.avgBalance).toBeGreaterThan(10000);
    expect(r.avgBalance).toBeLessThan(10121.5);
    // 150 € en medio año sobre unos 10.000 €: alrededor del 3 % anual.
    expect(r.rate!).toBeCloseTo((150 / r.avgBalance) * (365 / 183), 6);
    expect(r.rate!).toBeGreaterThan(0.029);
    expect(r.rate!).toBeLessThan(0.03);
    // Con menos de un mes de historia, o para una cuenta que no lleva efectivo, no hay cifra.
    expect(cashReturn(buildTimeline(led, s, new Set(["E"]), "2024-01-20"), led, "E").rate).toBeNull();
    expect(cashReturn(tl, led, "otra").rate).toBeNull();
  });
});

describe("el fondo de emergencia y las compras", () => {
  it("una compra en otra cuenta no le resta nada, lleve o no efectivo esa cuenta", () => {
    const s = state({
      accounts: [acct("E", { kind: "emergency", trackCash: true }), acct("SinEfectivo"), acct("ConEfectivo", { trackCash: true })],
      assets: [asset("X")],
      txs: [
        tx({ date: "2024-01-01", type: "deposit", accountId: "E", amount: 10000 }),
        tx({ date: "2024-01-01", type: "deposit", accountId: "ConEfectivo", amount: 3000 }),
        tx({ date: "2024-02-01", type: "buy", accountId: "SinEfectivo", assetId: "X", quantity: 10, price: 100 }),
        tx({ date: "2024-02-02", type: "buy", accountId: "ConEfectivo", assetId: "X", quantity: 5, price: 100, fee: 2 }),
      ],
      prices: { X: [["2024-01-01", 100], ["2024-03-01", 100]] },
    });
    const led = buildLedger(s);
    const all = buildTimeline(led, s, null, "2024-03-01");
    const last = all.n - 1;
    // El fondo sigue entero; la única cuenta que baja es la que compró con su propio efectivo.
    expect(all.cash.get("E")![last]).toBe(10000);
    expect(all.cash.get("ConEfectivo")![last]).toBe(3000 - 502);
    expect(all.cash.has("SinEfectivo")).toBe(false);
    // Visto solo, el fondo vale lo mismo antes y después de las compras.
    const fund = buildTimeline(led, s, new Set(["E"]), "2024-03-01");
    expect(fund.total[0]).toBe(10000);
    expect(fund.total[fund.n - 1]).toBe(10000);
  });
});

describe("caída desde máximos", () => {
  it("mide cada día contra el máximo anterior y recuerda el peor momento", () => {
    // +10 %, −20 %, +5 %, +30 % (nuevo máximo), −10 %.
    const dd = drawdown(Float64Array.from([0.1, -0.2, 0.05, 0.3, -0.1]));
    expect(dd.series[0]).toBe(0);
    expect(dd.series[1]).toBeCloseTo(-0.2, 12);
    expect(dd.series[2]).toBeCloseTo(0.8 * 1.05 - 1, 12);
    expect(dd.series[3]).toBe(0);
    expect(dd.now).toBeCloseTo(-0.1, 12);
    expect(dd.worstAt).toBe(1);
    expect(dd.worst).toBeCloseTo(-0.2, 12);
    expect(dd.worstDay).toBe(-0.2);
    // Con menos de un mes no hay volatilidad que anualizar.
    expect(dd.volatility).toBeNull();
  });

  it("anualiza la volatilidad diaria y no cae si la cartera solo sube", () => {
    const flat = drawdown(new Float64Array(60).fill(0.001));
    expect(flat.worst).toBe(0);
    expect(flat.volatility).toBeCloseTo(0, 9);
    // Un día +1 % y otro −1 %: desviación diaria del 1 %, por la raíz de 365.
    const zigzag = drawdown(Float64Array.from({ length: 60 }, (_, i) => (i % 2 ? -0.01 : 0.01)));
    expect(zigzag.volatility!).toBeCloseTo(0.01 * Math.sqrt(365), 9);
    expect(drawdown(new Float64Array(0))).toMatchObject({ worst: 0, now: 0, volatility: null, worstDay: 0 });
  });
});
