import { addDays, dayNum, todayIso } from "../../shared/dates.ts";
import type { AppState, AssetKind, Point } from "../../shared/types.ts";
import type { Meta, Op } from "./backend.ts";

// Datos de mercado: cotizaciones de Yahoo Finance y tipos de referencia del BCE.
// Solo viajan símbolos y divisas; nunca importes, posiciones ni nombres de cuenta.

type Get = (url: string) => Promise<string>;

const FRESH_MS = 6 * 3600_000;
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

const fresh = (meta: Meta, key: string, force: boolean) =>
  !force && !!meta[key] && Date.now() - Date.parse(meta[key]!) < FRESH_MS;

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
  for (const a of state.assets) {
    if (a.priceSource !== "yahoo" || !a.symbol) continue;
    const first = firstByAsset.get(a.id) ?? today;
    const need = addDays(first < floor ? first : floor, -10);
    const have = span(state.prices[a.id]);
    const covers = !!have && have.min <= addDays(need, 10);
    if (covers && fresh(meta, `fetched:asset:${a.id}`, force)) continue;
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
      ops.push({ op: "meta", key: `fetched:asset:${a.id}`, value: stamp() });
    } catch (e) {
      const msg = message(e);
      if (msg.includes("429")) {
        issues.push({
          what: "Yahoo Finance",
          message: "Yahoo está limitando las peticiones. Se conservan los últimos precios guardados; vuelve a intentarlo en unos minutos.",
        });
        break;
      }
      issues.push({ what: a.name, message: msg });
    }
  }

  // Solo cuenta como actualización si de verdad se descargó algo.
  if (ops.length) ops.push({ op: "meta", key: "lastSync", value: stamp() });
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
