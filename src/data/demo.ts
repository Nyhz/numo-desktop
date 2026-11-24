import { addDays, addMonths, dayNum, isoOf } from "../../shared/dates.ts";
import { txInput } from "../../shared/schema.ts";
import type { Account, AppState, Asset, AssetKind, Goal, MortgageEvent, Point, Tx } from "../../shared/types.ts";

// Cartera de ejemplo: entidades, empresas y precios inventados. Sirve para
// enseñar la app sin datos reales; nada de esto se guarda en la base de datos.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Paseo aleatorio geométrico en días laborables. */
function walk(seed: number, from: string, to: string, p0: number, drift: number, vol: number): Point[] {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const out: Point[] = [];
  let p = p0;
  for (let d = dayNum(from); d <= dayNum(to); d++) {
    const dow = new Date(d * 86_400_000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    p *= Math.exp((drift - (vol * vol) / 2) / 252 + (vol / Math.sqrt(252)) * gauss());
    out.push([isoOf(d), Math.round(p * 10000) / 10000]);
  }
  return out;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function makeDemo(today: string): AppState {
  const start = addMonths(today, -40);
  const from = addDays(start, -12);
  const at = "2020-01-01T00:00:00.000Z";

  const account = (i: number, name: string, institution: string, kind: Account["kind"], currency: string, trackCash: boolean): Account => ({
    id: `demo-acct-${i}`,
    name,
    institution,
    kind,
    currency,
    color: i,
    trackCash,
    archived: false,
    createdAt: at,
  });
  const broker = account(1, "Bróker Atlas", "Atlas Valores", "broker", "EUR", true);
  const funds = account(2, "Fondos Norte", "Banco Norte", "broker", "EUR", false);
  const usd = account(3, "Bróker Meridian", "Meridian Securities", "broker", "USD", true);
  const crypto = account(4, "Cripto", "Exchange Boreal", "crypto", "EUR", false);
  const cushion = account(5, "Fondo de emergencia", "Banco Litoral", "emergency", "EUR", true);

  const assets: Asset[] = [];
  const prices: Record<string, Point[]> = {};
  const asset = (
    key: string,
    name: string,
    kind: AssetKind,
    currency: string,
    isin: string | null,
    seed: number,
    p0: number,
    drift: number,
    vol: number,
  ) => {
    // Fuentes de mentira (no se consultan): sirven para enseñar cómo se ve cada una.
    const source = kind === "fund" ? "ft" : "yahoo";
    const a: Asset = { id: `demo-${key}`, name, kind, symbol: source === "yahoo" ? `${key.toUpperCase()}.DEMO` : null, isin, currency, priceSource: source, goalId: null, planExcluded: false, createdAt: at };
    assets.push(a);
    prices[a.id] = walk(seed, from, today, p0, drift, vol);
    return a;
  };
  const world = asset("world", "Atlas Mundo UCITS ETF", "etf", "EUR", "IE00DEMO0018", 11, 92, 0.11, 0.13);
  const helios = asset("helios", "Helios Systems", "stock", "USD", "US00DEMO0026", 23, 148, 0.16, 0.26);
  const meridian = asset("meridian", "Meridian Software", "stock", "USD", "US00DEMO0034", 31, 265, 0.14, 0.22);
  const vertice = asset("vertice", "Vértice Semiconductores", "stock", "USD", "US00DEMO0042", 47, 38, 0.34, 0.42);
  const textil = asset("textil", "Textil Ibérica", "stock", "EUR", "ES00DEMO0059", 53, 31, 0.12, 0.2);
  const banco = asset("banco", "Banco Cantábrico", "stock", "EUR", "ES00DEMO0067", 61, 3.4, 0.15, 0.27);
  const north = asset("north", "Northsea Energy", "stock", "GBP", "GB00DEMO0075", 71, 23, -0.09, 0.24);
  const btc = asset("btc", "Bitcoin", "crypto", "EUR", null, 83, 24000, 0.45, 0.55);
  const eth = asset("eth", "Ethereum", "crypto", "EUR", null, 97, 1650, -0.12, 0.6);
  const fundA = asset("fund-a", "Renta Fija Corto Plazo FI", "fund", "EUR", "ES00DEMO0083", 101, 10.02, 0.028, 0.008);
  const fundB = asset("fund-b", "Bolsa Global Indexado FI", "fund", "EUR", "ES00DEMO0091", 113, 101.5, 0.1, 0.12);
  // Dos activos que solo se siguen, sin posición: la pantalla Activos los enseña aparte.
  asset("aurora", "Aurora Renovables", "stock", "EUR", "ES00DEMO0109", 127, 14.2, 0.07, 0.3);
  asset("pacifico", "Pacífico Emergentes UCITS ETF", "etf", "EUR", "IE00DEMO0117", 131, 28.4, 0.06, 0.16);

  const fx: Record<string, Point[]> = {
    USD: walk(131, from, today, 1.085, 0.005, 0.07),
    GBP: walk(137, from, today, 0.862, -0.003, 0.05),
  };
  const on = (pts: Point[], date: string) => {
    let v = pts[0]![1];
    for (const [d, p] of pts) {
      if (d > date) break;
      v = p;
    }
    return v;
  };
  const close = (a: Asset, date: string) => on(prices[a.id]!, date);
  const rate = (ccy: string, date: string) => (ccy === "EUR" ? 1 : round(on(fx[ccy]!, date), 4));

  const txs: Tx[] = [];
  const add = (raw: Record<string, unknown>) => {
    const n = txs.length;
    txs.push({
      ...txInput.parse(raw),
      id: `demo-tx-${n}`,
      createdAt: new Date(Date.UTC(2020, 0, 1) + n * 1000).toISOString(),
    });
  };
  const trade = (type: "buy" | "sell", acct: Account, a: Asset, date: string, quantity: number, fee: number, feeCurrency = "EUR") => {
    if (date > today) return;
    add({ date, type, accountId: acct.id, assetId: a.id, quantity, price: round(close(a, date), 4), currency: a.currency, fxRate: rate(a.currency, date), fee, feeCurrency });
  };
  const r = rng(7);

  // Fondo de emergencia: un ingreso inicial que se queda quieto y cobra intereses cada mes.
  add({ date: start, type: "deposit", accountId: cushion.id, amount: 9000, currency: "EUR" });
  for (let m = 1; m < 41 && addMonths(start, m) <= today; m++) {
    const gross = round((9000 * 0.0245) / 12 + m * 0.04);
    add({ date: addMonths(start, m), type: "interest", accountId: cushion.id, amount: gross, currency: "EUR", taxHome: round(gross * 0.19) });
  }

  // Bróker en EUR: aportación mensual, compras periódicas, dividendos e intereses.
  add({ date: start, type: "deposit", accountId: broker.id, amount: 12000, currency: "EUR" });
  for (let m = 0; m < 41; m++) {
    const date = addDays(addMonths(start, m), 2 + Math.floor(r() * 5));
    if (date > today) break;
    if (m > 0) add({ date: addMonths(start, m), type: "deposit", accountId: broker.id, amount: 900, currency: "EUR" });
    trade("buy", broker, world, date, 5 + Math.floor(r() * 4), 1);
    if (m % 6 === 1) trade("buy", broker, textil, date, 20, 3);
    if (m % 7 === 2) trade("buy", broker, banco, date, 300, 3);
    if (m % 9 === 3) trade("buy", broker, north, date, 40, 4);
    if (m % 6 === 5) {
      const d1 = round(18 + m * 1.6);
      const d2 = round(22 + m * 2.1);
      add({ date, type: "dividend", accountId: broker.id, assetId: textil.id, amount: d1, currency: "EUR", taxHome: round(d1 * 0.19) });
      if (addDays(date, 9) <= today) add({ date: addDays(date, 9), type: "dividend", accountId: broker.id, assetId: banco.id, amount: d2, currency: "EUR", taxHome: round(d2 * 0.19) });
    }
    if (m % 12 === 11) add({ date, type: "fee", accountId: broker.id, amount: 12, currency: "EUR", note: "Custodia anual" });
    if (m % 4 === 0 && addDays(date, 12) <= today) add({ date: addDays(date, 12), type: "interest", accountId: broker.id, amount: round(3 + r() * 6), currency: "EUR", taxHome: 0.9 });
  }
  trade("sell", broker, banco, addMonths(start, 22), 400, 3);
  trade("sell", broker, north, addMonths(start, 30), 40, 4);

  // Bróker en USD.
  add({ date: addMonths(start, 2), type: "deposit", accountId: usd.id, amount: 15000, currency: "USD", fxRate: rate("USD", addMonths(start, 2)) });
  trade("buy", usd, helios, addMonths(start, 2), 25, 1, "USD");
  trade("buy", usd, meridian, addMonths(start, 3), 12, 1, "USD");
  trade("buy", usd, vertice, addMonths(start, 4), 60, 1, "USD");
  trade("buy", usd, helios, addMonths(start, 14), 10, 1, "USD");
  trade("sell", usd, vertice, addMonths(start, 26), 20, 1, "USD");
  trade("sell", usd, helios, addMonths(start, 33), 12, 1, "USD");
  for (let q = 1; q <= 12; q++) {
    const date = addMonths(start, 2 + q * 3);
    if (date > today) break;
    const f = rate("USD", date);
    const d1 = round(6 + q * 0.4);
    const d2 = round(9 + q * 0.5);
    add({ date, type: "dividend", accountId: usd.id, assetId: helios.id, amount: d1, currency: "USD", fxRate: f, taxSource: round(d1 * 0.15) });
    if (addDays(date, 20) <= today) add({ date: addDays(date, 20), type: "dividend", accountId: usd.id, assetId: meridian.id, amount: d2, currency: "USD", fxRate: f, taxSource: round(d2 * 0.15) });
  }

  // Fondos, con un traspaso entre fondos a mitad de camino (sin efecto fiscal).
  for (let m = 0; m < 41; m += 2) {
    const date = addDays(addMonths(start, m), 5);
    if (date > today) break;
    const f = m < 18 ? fundA : fundB;
    const nav = round(close(f, date), 4);
    add({ date, type: "buy", accountId: funds.id, assetId: f.id, quantity: round(600 / nav, 4), price: nav, currency: "EUR" });
  }
  const tDate = addDays(addMonths(start, 19), 5);
  if (tDate <= today) {
    add({ date: tDate, type: "transfer", accountId: funds.id, assetId: fundA.id, quantity: 350, toAssetId: fundB.id, toQuantity: round((350 * close(fundA, tDate)) / close(fundB, tDate), 4), currency: "EUR", note: "Traspaso a renta variable" });
  }

  // Cripto.
  for (let m = 6; m < 41; m += 5) {
    const date = addDays(addMonths(start, m), 10);
    if (date > today) break;
    trade("buy", crypto, btc, date, round(700 / close(btc, date), 6), 2.5);
    if (m % 2 === 0) trade("buy", crypto, eth, date, round(400 / close(eth, date), 5), 1.5);
  }
  trade("sell", crypto, btc, addMonths(start, 31), 0.012, 2.5);

  // Plan de ejemplo: cinco bloques con su peso objetivo.
  const goal = (i: number, name: string, targetPct: number): Goal => ({ id: `demo-goal-${i}`, name, targetPct, color: i, sortOrder: i, createdAt: at });
  const goals = [goal(1, "Global", 35), goal(2, "Tecnología", 30), goal(3, "España y Europa", 15), goal(4, "Cripto", 10), goal(5, "Renta fija", 10)];
  const assign: Record<string, number> = { world: 1, "fund-b": 1, helios: 2, meridian: 2, vertice: 2, textil: 3, banco: 3, north: 3, btc: 4, eth: 4, "fund-a": 5 };
  for (const a of assets) a.goalId = `demo-goal-${assign[a.id.replace("demo-", "")] ?? 1}`;

  // Un inmueble con hipoteca fija y una tasación.
  const bought = addMonths(today, -26);
  const property = { id: "demo-prop-1", name: "Piso de la calle Mayor", address: "Calle Mayor 12, 3.º B", purchaseDate: bought, purchasePrice: 248000, purchaseCosts: 21300, note: "", createdAt: at };
  const mortgage = { id: "demo-mort-1", propertyId: property.id, lender: "Banco Norte", principal: 198400, rateType: "fixed" as const, ratePct: 2.65, termMonths: 300, firstPaymentDate: addMonths(bought, 1), createdAt: at };
  const mortgageEvents: MortgageEvent[] = [];
  const valuations = [{ id: "demo-val-1", propertyId: property.id, date: addMonths(bought, 20), value: 262000, note: "Tasación" }];

  return { accounts: [broker, funds, usd, crypto, cushion], assets, txs, prices, fx, splits: {}, goals, properties: [property], mortgages: [mortgage], mortgageEvents, valuations, lastSync: null };
}
