import { addDays, dayNum, isIsoDate, isoOf, todayIso } from "../../shared/dates.ts";
import type { AppState, AssetKind, Point, PriceSource } from "../../shared/types.ts";
import type { Meta, Op } from "./backend.ts";

// Datos de mercado: cotizaciones (Yahoo Finance, EODHD, Binance, Financial Times),
// el valor del plan en Indexa Capital y los tipos de referencia del BCE.
// A los servicios de mercado solo viajan símbolos y divisas; nunca importes,
// posiciones ni nombres de cuenta. Indexa es la cuenta del propio usuario: de su
// respuesta solo se guarda el precio y la fecha de cada instrumento.

type Get = (url: string) => Promise<string>;

const FRESH_MS = 6 * 3600_000;
// EODHD da un cierre al día y la clave tiene un cupo diario: se consulta menos.
const FRESH_EODHD_MS = 12 * 3600_000;
const YAHOO_LIMIT = "Yahoo está limitando las peticiones";
const EODHD_LIMIT = "Se ha agotado el cupo diario de la clave de EODHD";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Algunas bolsas cotizan en céntimos de su divisa.
const MINOR: Record<string, [string, number]> = {
  GBp: ["GBP", 100],
  GBX: ["GBP", 100],
  ZAc: ["ZAR", 100],
  ILA: ["ILS", 100],
};

const KIND: Record<string, AssetKind> = {
  EQUITY: "stock",
  ETF: "etf",
  MUTUALFUND: "fund",
  CRYPTOCURRENCY: "crypto",
};

export type Quote = {
  symbol: string;
  name: string;
  kind: AssetKind;
  currency: string;
  exchange: string;
  points: Point[];
  splits: Point[];
};

type YahooChart = {
  chart: {
    error: { description?: string } | null;
    result: Array<{
      meta: {
        currency?: string;
        symbol: string;
        instrumentType?: string;
        longName?: string;
        shortName?: string;
        fullExchangeName?: string;
        gmtoffset?: number;
        regularMarketPrice?: number;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }> };
      indicators: { quote: Array<{ close?: Array<number | null> }> };
    }> | null;
  };
};

/** Interpreta la respuesta del gráfico de Yahoo. Separado de la red para poder probarlo. */
export function parseYahooChart(json: string): Quote {
  const data = JSON.parse(json) as YahooChart;
  const r = data.chart?.result?.[0];
  if (!r) throw new Error(data.chart?.error?.description ?? "Símbolo no encontrado");
  const [currency, divisor] = MINOR[r.meta.currency ?? ""] ?? [(r.meta.currency ?? "EUR").toUpperCase(), 1];
  const offset = r.meta.gmtoffset ?? 0;
  // La fecha de la sesión es la local de la bolsa, no la UTC.
  const dateOf = (ts: number) => new Date((ts + offset) * 1000).toISOString().slice(0, 10);
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  const byDate = new Map<string, number>();
  (r.timestamp ?? []).forEach((ts, i) => {
    const c = closes[i];
    // Yahoo deja huecos nulos en festivos y sesiones sin negociación: se saltan.
    if (typeof c === "number" && Number.isFinite(c) && c > 0) byDate.set(dateOf(ts), c / divisor);
  });
  // La vela de la última sesión llega con cierre nulo hasta que Yahoo la consolida
  // (horas después del cierre). Su precio sí viene en los metadatos: se usa ese.
  const { regularMarketPrice: last, regularMarketTime: lastAt } = r.meta;
  if (typeof last === "number" && last > 0 && typeof lastAt === "number") {
    const day = dateOf(lastAt);
    const newest = [...byDate.keys()].sort().pop();
    if (!byDate.has(day) && (!newest || day > newest)) byDate.set(day, last / divisor);
  }
  const splits: Point[] = Object.values(r.events?.splits ?? {})
    .filter((s) => s.numerator > 0 && s.denominator > 0)
    .map((s) => [dateOf(s.date), s.numerator / s.denominator] as Point)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return {
    symbol: r.meta.symbol,
    name: r.meta.longName ?? r.meta.shortName ?? r.meta.symbol,
    kind: KIND[r.meta.instrumentType ?? ""] ?? "other",
    currency,
    exchange: r.meta.fullExchangeName ?? "",
    points: [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    splits,
  };
}

/** Cierres diarios de un símbolo entre dos fechas (ambas incluidas). */
export async function yahooChart(get: Get, symbol: string, from: string, to: string): Promise<Quote> {
  const p1 = dayNum(from) * 86400;
  const p2 = (dayNum(to) + 1) * 86400;
  return parseYahooChart(
    await get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=split`,
    ),
  );
}

// ── Financial Times: valor liquidativo de fondos por ISIN ──────────────────

const FT = "https://markets.ft.com";
const FT_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ftNumber = (raw: string) => Number.parseFloat(raw.trim().replace(/,/g, ""));
const ftMonth = (name: string) => FT_MONTHS.indexOf(name.slice(0, 3).toLowerCase());
const iso = (y: string, m: number, d: string) => `${y}-${String(m + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;

/** Último valor liquidativo de la ficha de un fondo en FT. Falla si no hay un precio usable. */
export function parseFtQuote(html: string): { price: number; currency: string; date: string | null; xid: string | null; name: string | null } {
  const m = /Price \(([A-Za-z]{3})\)<\/span><span class="mod-ui-data-list__value">\s*([\d,]+\.\d+)/.exec(html);
  if (!m) throw new Error("FT no muestra precio para este ISIN");
  const price = ftNumber(m[2]!);
  if (!(price > 0)) throw new Error("FT devuelve un precio no válido");
  const asOf = /as of\s+([A-Za-z]{3,})\s+(\d{1,2})\s+(\d{4})/.exec(html);
  const month = asOf ? ftMonth(asOf[1]!) : -1;
  // El identificador interno de FT viene en un bloque de configuración, a veces con las comillas escapadas.
  const xid = /(?:&quot;|")xid(?:&quot;|"):(?:&quot;|")(\d+)/.exec(html)?.[1] ?? null;
  const name = /mod-tearsheet-overview__header__name[^>]*>([^<]+)</.exec(html)?.[1]?.trim().replace(/&amp;/g, "&") ?? null;
  return { price, currency: m[1]!.toUpperCase(), date: asOf && month >= 0 ? iso(asOf[3]!, month, asOf[2]!) : null, xid, name };
}

/** Histórico de FT: filas con fecha y cuatro cifras (apertura, máximo, mínimo, cierre). */
export function parseFtHistory(body: string): Point[] {
  let html = body;
  try {
    html = (JSON.parse(body) as { html?: string }).html ?? "";
  } catch {
    // Algunas respuestas llegan ya como HTML.
  }
  const out = new Map<string, number>();
  for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const d = /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(row[1]!);
    const month = d ? ftMonth(d[1]!) : -1;
    if (!d || month < 0) continue;
    const nums = [...row[1]!.matchAll(/<td>\s*([\d,]+\.\d+)\s*<\/td>/g)].map((x) => ftNumber(x[1]!));
    if (nums.length >= 4 && nums[3]! > 0) out.set(iso(d[3]!, month, d[2]!), nums[3]!);
  }
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** Precios de un fondo en FT: el último y, si hace falta rellenar un hueco, el histórico desde `from`. */
export async function ftPrices(get: Get, isin: string, currency: string, from: string | null, today: string): Promise<Point[]> {
  const quote = parseFtQuote(await get(`${FT}/data/funds/tearsheet/summary?s=${encodeURIComponent(`${isin}:${currency}`)}`));
  if (quote.currency !== currency) throw new Error(`FT lo cotiza en ${quote.currency}, no en ${currency}`);
  const points: Point[] = [[quote.date ?? today, quote.price]];
  if (from && quote.xid && from < (quote.date ?? today)) {
    const d = (x: string) => x.replace(/-/g, "/");
    try {
      points.unshift(...parseFtHistory(await get(`${FT}/data/equities/ajax/get-historical-prices?startDate=${d(from)}&endDate=${d(today)}&symbol=${quote.xid}`)));
    } catch {
      // Sin histórico se conserva al menos el último valor liquidativo.
    }
  }
  return points;
}

// ── EODHD: cierres diarios de acciones, ETF y fondos (con clave) ────────────
// La clave la añade el núcleo nativo a cada petición; aquí nunca se ve.

const EODHD = "https://eodhd.com/api";
const EODHD_KIND: Record<string, AssetKind> = { "Common Stock": "stock", "Preferred Stock": "stock", ETF: "etf", ETC: "etf", FUND: "fund", "Mutual Fund": "fund", Currency: "crypto", BOND: "bond" };
// A igualdad de divisa se prefiere el mercado principal a las bolsas regionales alemanas.
const EODHD_VENUES = ["XETRA", "MC", "US", "EUFUND", "PA", "AS", "MI", "SW", "LSE"];

/** Cierres sin ajustar por dividendos; los splits se tratan aparte. */
export function parseEodhdEod(json: string): Point[] {
  const data = JSON.parse(json) as unknown;
  if (!Array.isArray(data)) throw new Error("EODHD no devuelve precios para este código");
  return (data as Array<{ date?: string; close?: number }>)
    .filter((r) => typeof r.date === "string" && isIsoDate(r.date) && typeof r.close === "number" && r.close > 0)
    .map((r) => [r.date!, r.close!] as Point)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

export type EodhdHit = { code: string; name: string; kind: AssetKind; currency: string; isin: string | null; price: number | null; date: string | null };

export function parseEodhdSearch(json: string): EodhdHit[] {
  const data = JSON.parse(json) as unknown;
  if (!Array.isArray(data)) return [];
  return (data as Array<{ Code?: string; Exchange?: string; Name?: string; Type?: string; Currency?: string; ISIN?: string | null; previousClose?: number; previousCloseDate?: string }>)
    .filter((r) => r.Code && r.Exchange)
    .map((r) => ({
      code: `${r.Code}.${r.Exchange}`,
      name: r.Name ?? r.Code!,
      kind: EODHD_KIND[r.Type ?? ""] ?? "other",
      currency: (r.Currency ?? "").trim(),
      isin: r.ISIN || null,
      price: typeof r.previousClose === "number" && r.previousClose > 0 ? r.previousClose : null,
      date: r.previousCloseDate && isIsoDate(r.previousCloseDate) ? r.previousCloseDate : null,
    }));
}

/** «4.000000/1.000000» → 4 (acciones nuevas por cada antigua). */
export function parseEodhdSplits(json: string): Point[] {
  const data = JSON.parse(json) as unknown;
  if (!Array.isArray(data)) return [];
  return (data as Array<{ date?: string; split?: string }>)
    .map((r) => {
      const [n, d] = (r.split ?? "").split("/").map(Number);
      return [r.date ?? "", n! / d!] as Point;
    })
    .filter(([date, ratio]) => isIsoDate(date) && Number.isFinite(ratio) && ratio > 0 && ratio !== 1);
}

export const eodhdPrices = async (get: Get, code: string, from: string): Promise<Point[]> =>
  parseEodhdEod(await get(`${EODHD}/eod/${encodeURIComponent(code)}?from=${from}&fmt=json`));
export const eodhdSearch = async (get: Get, q: string): Promise<EodhdHit[]> =>
  parseEodhdSearch(await get(`${EODHD}/search/${encodeURIComponent(q)}?limit=15&fmt=json`));

/** De varias cotizaciones del mismo valor, la de la divisa pedida en el mercado principal. */
export function bestEodhdHit(hits: EodhdHit[], currency: string): EodhdHit | null {
  const rank = (h: EodhdHit) => {
    const venue = EODHD_VENUES.indexOf(h.code.slice(h.code.lastIndexOf(".") + 1));
    return (h.currency === currency ? 0 : 100) + (h.price == null ? 50 : 0) + (venue < 0 ? EODHD_VENUES.length : venue);
  };
  return [...hits].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Un salto así entre dos cierres seguidos no es mercado: hay que mirar si hubo split. */
export function splitSuspect(stored: Point[], incoming: Point[]): boolean {
  const first = incoming[0]?.[0];
  if (!first) return false;
  const before = [...stored].reverse().find(([d]) => d < first);
  const series = before ? [before, ...incoming] : incoming;
  return series.some(([, v], i) => i > 0 && (v / series[i - 1]![1] > 1.9 || v / series[i - 1]![1] < 0.52));
}

/** Pasa a unidades actuales los precios anteriores a un split. */
export const rescaleBefore = (points: Point[], date: string, ratio: number): Point[] => points.map(([d, v]) => (d < date ? [d, v / ratio] : [d, v]) as Point);

/** Estado de la clave: plan y consultas gastadas hoy (esta consulta no gasta). */
export async function eodhdStatus(get: Get): Promise<string> {
  const u = JSON.parse(await get(`${EODHD}/user?fmt=json`)) as { subscriptionType?: string; apiRequests?: number; dailyRateLimit?: number; apiRequestsDate?: string | null };
  const used = u.apiRequestsDate === new Date().toISOString().slice(0, 10) ? (u.apiRequests ?? 0) : 0;
  return `Plan ${u.subscriptionType === "free" ? "gratuito" : (u.subscriptionType ?? "desconocido")} · ${used} de ${u.dailyRateLimit ?? "?"} consultas usadas hoy`;
}

// ── Binance: criptomonedas, velas diarias públicas (sin clave) ──────────────

const BINANCE = "https://data-api.binance.vision/api/v3";

/** Cierre de cada vela diaria (UTC). La de hoy viene con el último precio. */
export function parseBinanceKlines(json: string): Point[] {
  const data = JSON.parse(json) as unknown;
  if (!Array.isArray(data)) throw new Error("Binance no devuelve precios para este par");
  return (data as Array<[number, string, string, string, string]>)
    .map((k) => [isoOf(Math.floor(k[0] / 86_400_000)), Number(k[4])] as Point)
    .filter(([, v]) => Number.isFinite(v) && v > 0);
}

export async function binancePrices(get: Get, pair: string, from: string, today: string): Promise<Point[]> {
  const out: Point[] = [];
  let start = dayNum(from);
  // Mil velas por petición: un histórico largo se pide por tramos.
  for (let page = 0; page < 8 && start <= dayNum(today); page++) {
    let chunk: Point[];
    try {
      chunk = parseBinanceKlines(await get(`${BINANCE}/klines?symbol=${encodeURIComponent(pair.toUpperCase())}&interval=1d&startTime=${start * 86_400_000}&limit=1000`));
    } catch (e) {
      throw new Error(message(e).includes("400") ? `Binance no tiene el par ${pair.toUpperCase()}` : message(e));
    }
    if (!chunk.length) break;
    out.push(...chunk);
    if (chunk.length < 1000) break;
    start = dayNum(chunk[chunk.length - 1]![0]) + 1;
  }
  return out;
}

/** Divisa en la que cotiza un par: ETHEUR → EUR. */
export const binanceCurrency = (pair: string): string => {
  const p = pair.toUpperCase();
  return p.endsWith("EUR") ? "EUR" : p.endsWith("GBP") ? "GBP" : p.endsWith("TRY") ? "TRY" : "USD";
};

// ── Indexa Capital: valor del plan o de los fondos de la cartera (con clave) ─

const INDEXA = "https://api.indexacapital.com";
export type IndexaQuote = { identifier: string; name: string; price: number; date: string };

export function parseIndexaAccounts(json: string): string[] {
  const data = JSON.parse(json) as { accounts?: Array<{ account_number?: string; status?: string }> };
  return (data.accounts ?? []).filter((a) => a.status === "active" && a.account_number).map((a) => a.account_number!);
}

/** De la cartera solo interesan el precio y la fecha de cada instrumento. */
export function parseIndexaPortfolio(json: string): IndexaQuote[] {
  const data = JSON.parse(json) as {
    portfolio?: { date?: string };
    instrument_accounts?: Array<{ positions?: Array<{ price?: number; date?: string; instrument?: { identifier?: string; isin_code?: string; name?: string } }> }>;
  };
  const out: IndexaQuote[] = [];
  for (const ia of data.instrument_accounts ?? []) {
    for (const p of ia.positions ?? []) {
      const date = (p.date ?? data.portfolio?.date ?? "").slice(0, 10);
      const identifier = p.instrument?.identifier || p.instrument?.isin_code || "";
      if (identifier && typeof p.price === "number" && p.price > 0 && isIsoDate(date)) out.push({ identifier, name: p.instrument?.name ?? identifier, price: p.price, date });
    }
  }
  return out;
}

export async function indexaQuotes(get: Get): Promise<IndexaQuote[]> {
  let accounts: string[];
  try {
    accounts = parseIndexaAccounts(await get(`${INDEXA}/users/me`));
  } catch (e) {
    throw new Error(/40[13]/.test(message(e)) ? "Indexa rechaza la clave: genera una nueva en su web y ponla en Ajustes → Conexiones" : message(e));
  }
  const out: IndexaQuote[] = [];
  for (const n of accounts) out.push(...parseIndexaPortfolio(await get(`${INDEXA}/accounts/${encodeURIComponent(n)}/portfolio`)));
  return out;
}

/** La posición que corresponde a un activo: por identificador o, si solo hay una, esa. */
export function pickIndexa(quotes: IndexaQuote[], identifier: string | null): IndexaQuote {
  const hit = identifier ? quotes.find((q) => q.identifier === identifier) : quotes.length === 1 ? quotes[0] : undefined;
  if (hit) return hit;
  throw new Error(
    identifier
      ? `Indexa no tiene ninguna posición con el identificador ${identifier}`
      : quotes.length
        ? `Indexa tiene varias posiciones: indica cuál (${quotes.map((q) => q.identifier).join(", ")})`
        : "Indexa no tiene posiciones en tus cuentas activas",
  );
}

export async function indexaStatus(get: Get): Promise<string> {
  const n = parseIndexaAccounts(await get(`${INDEXA}/users/me`)).length;
  return n === 1 ? "Conectado · 1 cuenta activa" : `Conectado · ${n} cuentas activas`;
}

export type Probe = { price: number; date: string; currency: string; name: string | null; kind: AssetKind | null; /** Código en la fuente, si se ha averiguado. */ code?: string };
export type ProbeInput = { priceSource: Exclude<PriceSource, "manual">; symbol: string | null; isin: string | null; currency: string };

/**
 * Pregunta a la fuente por un activo antes de guardarlo: confirma que existe,
 * en qué divisa cotiza y cuál es su último precio.
 */
export async function probeSource(get: Get, src: ProbeInput): Promise<Probe> {
  const today = todayIso();
  const lastOf = (pts: Point[], who: string): Point => {
    const last = pts[pts.length - 1];
    if (!last) throw new Error(`${who} no tiene precios recientes de este activo`);
    return last;
  };
  switch (src.priceSource) {
    case "yahoo": {
      if (!src.symbol) throw new Error("Falta el símbolo");
      const q = await yahooChart(get, src.symbol, addDays(today, -10), today);
      const last = lastOf(q.points, "Yahoo");
      return { price: last[1], date: last[0], currency: q.currency, name: q.name, kind: q.kind };
    }
    case "eodhd": {
      // Con ISIN basta una búsqueda: devuelve el código y el último cierre.
      if (!src.symbol) {
        if (!src.isin) throw new Error("Falta el código de EODHD o el ISIN");
        const hit = bestEodhdHit(await eodhdSearch(get, src.isin), src.currency);
        if (!hit || hit.price == null || !hit.date) throw new Error("EODHD no encuentra ese ISIN");
        if (MINOR[hit.currency]) throw new Error(`EODHD lo cotiza en ${hit.currency} (céntimos), que aún no se admite; usa otra bolsa u otra fuente`);
        return { price: hit.price, date: hit.date, currency: hit.currency || src.currency, name: hit.name, kind: hit.kind, code: hit.code };
      }
      const last = lastOf(await eodhdPrices(get, src.symbol, addDays(today, -15)), "EODHD");
      return { price: last[1], date: last[0], currency: src.currency, name: null, kind: null };
    }
    case "binance": {
      if (!src.symbol) throw new Error("Falta el par, por ejemplo ETHEUR");
      const last = lastOf(await binancePrices(get, src.symbol, addDays(today, -3), today), "Binance");
      return { price: last[1], date: last[0], currency: binanceCurrency(src.symbol), name: null, kind: "crypto", code: src.symbol.toUpperCase() };
    }
    case "indexa": {
      const q = pickIndexa(await indexaQuotes(get), src.symbol);
      return { price: q.price, date: q.date, currency: "EUR", name: q.name, kind: "fund", code: q.identifier };
    }
    case "ft": {
      if (!src.isin) throw new Error("Falta el ISIN");
      const q = parseFtQuote(await get(`${FT}/data/funds/tearsheet/summary?s=${encodeURIComponent(`${src.isin}:${src.currency}`)}`));
      return { price: q.price, date: q.date ?? today, currency: q.currency, name: q.name, kind: "fund" };
    }
  }
}

export type SearchHit = { symbol: string; name: string; kind: AssetKind; exchange: string };

export function parseYahooSearch(json: string): SearchHit[] {
  const data = JSON.parse(json) as {
    quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; quoteType?: string; exchDisp?: string }>;
  };
  return (data.quotes ?? [])
    .filter((x) => x.symbol && KIND[x.quoteType ?? ""])
    .map((x) => ({
      symbol: x.symbol!,
      name: x.longname ?? x.shortname ?? x.symbol!,
      kind: KIND[x.quoteType!]!,
      exchange: x.exchDisp ?? "",
    }));
}

/** Busca por nombre, símbolo o ISIN. */
export const searchMarket = async (get: Get, q: string): Promise<SearchHit[]> =>
  parseYahooSearch(
    await get(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`,
    ),
  );

/** Tipos de referencia del BCE (unidades de divisa por 1 EUR) a partir de su CSV. */
export function parseEcbCsv(csv: string): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  const lines = csv.split(/\r?\n/);
  const head = lines[0]?.split(",") ?? [];
  const iC = head.indexOf("CURRENCY");
  const iD = head.indexOf("TIME_PERIOD");
  const iV = head.indexOf("OBS_VALUE");
  if (iC < 0 || iD < 0 || iV < 0) return out;
  for (const line of lines.slice(1)) {
    // Las columnas que interesan van antes de cualquier campo entrecomillado.
    const c = line.split(",", Math.max(iC, iD, iV) + 1);
    const rate = Number(c[iV]);
    if (!c[iC] || !c[iD] || !(rate > 0)) continue;
    let arr = out.get(c[iC]!);
    if (!arr) out.set(c[iC]!, (arr = []));
    arr.push([c[iD]!, rate]);
  }
  return out;
}

export async function ecbRates(get: Get, currencies: string[], from: string): Promise<Map<string, Point[]>> {
  if (!currencies.length) return new Map();
  try {
    return parseEcbCsv(
      await get(
        `https://data-api.ecb.europa.eu/service/data/EXR/D.${currencies.join("+")}.EUR.SP00.A?startPeriod=${from}&format=csvdata`,
      ),
    );
  } catch (e) {
    // El BCE responde 404 cuando no publica ninguna de las divisas pedidas.
    if (message(e).includes("404")) return new Map();
    throw e;
  }
}

/**
 * Une los splits guardados con los de Yahoo. Los guardados mandan: uno de Yahoo
 * solo se añade si no hay ya otro a menos de 10 días (sería el mismo split con
 * la fecha desplazada, y aplicarlo dos veces multiplicaría las unidades).
 */
export function mergeSplits(saved: Point[], yahoo: Point[]): Point[] {
  const out = [...saved];
  for (const y of yahoo) {
    if (!out.some(([d]) => Math.abs(dayNum(d) - dayNum(y[0])) <= 10)) out.push(y);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

export type SyncIssue = { what: string; message: string };
export type SyncResult = { ops: Op[]; issues: SyncIssue[] };

const fresh = (meta: Meta, key: string, force: boolean, ms = FRESH_MS) =>
  !force && !!meta[key] && Date.now() - Date.parse(meta[key]!) < ms;

const span = (pts: Point[] | undefined) =>
  pts?.length ? { min: pts[0]![0], max: pts[pts.length - 1]![0] } : null;

/**
 * Calcula qué falta por descargar y lo descarga. No toca el estado: devuelve
 * los cambios para que el almacén los aplique y los guarde de una vez.
 */
export async function syncMarket(
  state: AppState,
  meta: Meta,
  get: Get,
  force = false,
): Promise<SyncResult> {
  const ops: Op[] = [];
  const issues: SyncIssue[] = [];
  const today = todayIso();
  const stamp = () => new Date().toISOString();
  let got = false;
  // Cada activo recuerda su último fallo para que se vea cuál no se está actualizando.
  const failed = (id: string, why: string) => ops.push({ op: "meta", key: `failed:asset:${id}`, value: JSON.stringify({ at: stamp(), message: why }) });
  const fetched = (id: string) => {
    got = true;
    ops.push({ op: "meta", key: `fetched:asset:${id}`, value: stamp() });
    if (meta[`failed:asset:${id}`]) ops.push({ op: "meta", key: `failed:asset:${id}`, value: "" });
  };
  const firstTx = state.txs.reduce((m, t) => (t.date < m ? t.date : m), today);
  const floor = addDays(today, -400);
  const globalStart = addDays(firstTx < floor ? firstTx : floor, -10);

  // ── Tipos de cambio (una sola petición por fecha de inicio) ──
  const currencies = new Set<string>();
  for (const a of state.accounts) currencies.add(a.currency);
  for (const a of state.assets) currencies.add(a.currency);
  for (const t of state.txs) currencies.add(t.currency);
  currencies.delete("EUR");
  const byStart = new Map<string, string[]>();
  for (const c of currencies) {
    const have = span(state.fx[c]);
    const covers = !!have && have.min <= addDays(globalStart, 7);
    if (covers && fresh(meta, `fetched:fx:${c}`, force)) continue;
    const from = covers ? addDays(have!.max, -7) : globalStart;
    byStart.set(from, [...(byStart.get(from) ?? []), c]);
  }
  for (const [from, list] of byStart) {
    try {
      const rates = await ecbRates(get, list, from);
      for (const c of list) {
        const pts = rates.get(c);
        if (pts?.length) ops.push({ op: "fx", currency: c, points: pts });
        else if (!state.fx[c]?.length) {
          issues.push({ what: c, message: "El BCE no publica esta divisa; se usa el cambio de tus operaciones." });
        }
        ops.push({ op: "meta", key: `fetched:fx:${c}`, value: stamp() });
        got = true;
      }
    } catch (e) {
      issues.push({ what: list.join(", "), message: `Tipos de cambio: ${message(e)}` });
    }
  }

  // ── Cotizaciones ──
  // En serie; el núcleo nativo deja un hueco entre peticiones porque Yahoo
  // bloquea las ráfagas. (Aquí no se usan temporizadores: la interfaz los
  // congela cuando la ventana no está a la vista.)
  const firstByAsset = new Map<string, string>();
  for (const t of state.txs) {
    for (const id of [t.assetId, t.toAssetId]) {
      if (id && (!firstByAsset.has(id) || t.date < firstByAsset.get(id)!)) firstByAsset.set(id, t.date);
    }
  }
  let limited = false;
  for (const a of state.assets) {
    if (a.priceSource !== "yahoo" || !a.symbol) continue;
    const first = firstByAsset.get(a.id) ?? today;
    const need = addDays(first < floor ? first : floor, -10);
    const have = span(state.prices[a.id]);
    const covers = !!have && have.min <= addDays(need, 10);
    if (covers && fresh(meta, `fetched:asset:${a.id}`, force)) continue;
    if (limited) {
      // Tras un bloqueo no se insiste, pero queda anotado qué se quedó sin actualizar.
      failed(a.id, YAHOO_LIMIT);
      continue;
    }
    try {
      let q = await yahooChart(get, a.symbol, covers ? addDays(have!.max, -7) : need, today);
      let full = !covers;
      if (covers && q.splits.length) {
        // Split nuevo: Yahoo reajusta todo el histórico, así que se baja entero otra vez.
        const known = state.splits[a.id] ?? [];
        if (mergeSplits(known, q.splits).length > known.length) {
          q = await yahooChart(get, a.symbol, need, today);
          full = true;
        }
      }
      if (full) ops.push({ op: "splits", assetId: a.id, points: mergeSplits(state.splits[a.id] ?? [], q.splits) });
      ops.push({ op: "prices", assetId: a.id, points: q.points, replace: full });
      fetched(a.id);
    } catch (e) {
      const msg = message(e);
      if (msg.includes("429")) {
        issues.push({ what: "Yahoo Finance", message: `${YAHOO_LIMIT}. Se conservan los últimos precios guardados; vuelve a intentarlo en unos minutos.` });
        failed(a.id, YAHOO_LIMIT);
        limited = true;
        continue;
      }
      issues.push({ what: a.name, message: msg });
      failed(a.id, msg);
    }
  }

  // ── Fondos por ISIN en Financial Times ──
  for (const a of state.assets) {
    if (a.priceSource !== "ft" || !a.isin) continue;
    if (fresh(meta, `fetched:asset:${a.id}`, force)) continue;
    const have = span(state.prices[a.id]);
    // Solo se pide histórico si falta más de una semana; lo normal es un valor liquidativo al día.
    const gapFrom = !have ? addDays(firstByAsset.get(a.id) ?? today, -10) : have.max < addDays(today, -7) ? have.max : null;
    try {
      ops.push({ op: "prices", assetId: a.id, points: await ftPrices(get, a.isin, a.currency, gapFrom, today) });
      fetched(a.id);
    } catch (e) {
      issues.push({ what: a.name, message: message(e) });
      failed(a.id, message(e));
    }
  }

  // ── EODHD: un cierre al día por código ──
  let spent = false;
  for (const a of state.assets) {
    if (a.priceSource !== "eodhd" || !a.symbol) continue;
    const stored = state.prices[a.id] ?? [];
    const have = span(stored);
    if (have && fresh(meta, `fetched:asset:${a.id}`, force, FRESH_EODHD_MS)) continue;
    if (spent) {
      failed(a.id, EODHD_LIMIT);
      continue;
    }
    const from = have ? addDays(have.max, -7) : addDays(firstByAsset.get(a.id) ?? floor, -10);
    try {
      const pts = await eodhdPrices(get, a.symbol, from);
      // EODHD da cierres tal como se negociaron: tras un split hay que reescalar lo anterior.
      const known = state.splits[a.id] ?? [];
      const found = a.kind !== "fund" && splitSuspect(stored, pts) ? parseEodhdSplits(await get(`${EODHD}/splits/${encodeURIComponent(a.symbol)}?from=${from}&fmt=json`)) : [];
      const added = mergeSplits(known, found).filter((sp) => !known.some((k) => k[0] === sp[0]));
      if (added.length) {
        let all = [...stored.filter(([d]) => !pts.some((p) => p[0] === d)), ...pts].sort((x, y) => x[0].localeCompare(y[0]));
        for (const [date, ratio] of added) all = rescaleBefore(all, date, ratio);
        ops.push({ op: "splits", assetId: a.id, points: mergeSplits(known, found) });
        ops.push({ op: "prices", assetId: a.id, points: all, replace: true });
      } else {
        ops.push({ op: "prices", assetId: a.id, points: pts });
      }
      fetched(a.id);
    } catch (e) {
      const msg = message(e);
      if (/HTTP 40[29]/.test(msg)) {
        issues.push({ what: "EODHD", message: `${EODHD_LIMIT}. Se conservan los últimos precios guardados; mañana se reanuda.` });
        failed(a.id, EODHD_LIMIT);
        spent = true;
        continue;
      }
      const why = msg.includes("404") ? `EODHD no conoce el código ${a.symbol}` : msg;
      issues.push({ what: a.name, message: why });
      failed(a.id, why);
    }
  }

  // ── Binance: criptomonedas ──
  for (const a of state.assets) {
    if (a.priceSource !== "binance" || !a.symbol) continue;
    const have = span(state.prices[a.id]);
    if (have && fresh(meta, `fetched:asset:${a.id}`, force)) continue;
    try {
      ops.push({ op: "prices", assetId: a.id, points: await binancePrices(get, a.symbol, have ? addDays(have.max, -3) : addDays(firstByAsset.get(a.id) ?? floor, -10), today) });
      fetched(a.id);
    } catch (e) {
      issues.push({ what: a.name, message: message(e) });
      failed(a.id, message(e));
    }
  }

  // ── Indexa Capital: una consulta sirve para todos sus activos ──
  const indexa = state.assets.filter((a) => a.priceSource === "indexa" && !(state.prices[a.id]?.length && fresh(meta, `fetched:asset:${a.id}`, force)));
  if (indexa.length) {
    try {
      const quotes = await indexaQuotes(get);
      for (const a of indexa) {
        try {
          const q = pickIndexa(quotes, a.symbol);
          ops.push({ op: "prices", assetId: a.id, points: [[q.date, q.price]] });
          fetched(a.id);
        } catch (e) {
          issues.push({ what: a.name, message: message(e) });
          failed(a.id, message(e));
        }
      }
    } catch (e) {
      issues.push({ what: "Indexa Capital", message: message(e) });
      for (const a of indexa) failed(a.id, message(e));
    }
  }

  // Solo cuenta como actualización si de verdad se descargó algo.
  if (got) ops.push({ op: "meta", key: "lastSync", value: stamp() });
  return { ops, issues };
}

/**
 * Tipo del BCE para una divisa en una fecha: el último publicado en o antes de
 * ese día. Si no está guardado lo descarga y devuelve también el cambio a aplicar.
 */
export async function fxOn(
  state: AppState,
  get: Get | null,
  currency: string,
  date: string,
): Promise<{ rate: number; date: string; ops: Op[] } | null> {
  if (currency === "EUR") return { rate: 1, date, ops: [] };
  const lookup = (pts: Point[] | undefined) => {
    let hit: Point | null = null;
    for (const p of pts ?? []) {
      if (p[0] > date) break;
      hit = p;
    }
    return hit;
  };
  const have = span(state.fx[currency]);
  const covered = !!have && have.min <= date && (have.max >= date || have.max >= addDays(todayIso(), -4));
  if (covered || !get) {
    const hit = lookup(state.fx[currency]);
    return hit ? { rate: hit[1], date: hit[0], ops: [] } : null;
  }
  try {
    const pts = (await ecbRates(get, [currency], addDays(have && have.min <= date ? have.max : date, -10))).get(currency) ?? [];
    const hit = lookup([...(state.fx[currency] ?? []), ...pts].sort((a, b) => a[0].localeCompare(b[0])));
    return hit ? { rate: hit[1], date: hit[0], ops: pts.length ? [{ op: "fx", currency, points: pts }] : [] } : null;
  } catch {
    const hit = lookup(state.fx[currency]);
    return hit ? { rate: hit[1], date: hit[0], ops: [] } : null;
  }
}
