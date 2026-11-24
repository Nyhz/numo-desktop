import { addDays, dayNum, isIsoDate, isoOf } from "../../shared/dates.ts";
import type { Point } from "../../shared/types.ts";
import type { Meta, Op } from "./backend.ts";
import { xetraPrices, yahooChart } from "./market.ts";

// Índice de referencia con el que comparar la rentabilidad de la cartera. El índice
// en sí no tiene cotización pública: se usa un ETF de acumulación en euros que lo
// replica (dividendos dentro, como en la rentabilidad de la cartera).
// A la bolsa solo viaja el ISIN del ETF; nada de la cartera.

type Get = (url: string) => Promise<string>;

/** iShares Core MSCI World UCITS ETF (Acc). `since`: su primer cierre en Xetra. */
export const BENCHMARK = { id: "msci-world", label: "MSCI World", isin: "IE00B4L5Y983", symbol: "EUNL.DE", currency: "EUR", since: "2009-10-14" } as const;

// Va en `meta` y no en `prices`: no es un activo del usuario ni se sincroniza entre equipos.
export const BENCH_KEY = `bench:${BENCHMARK.id}`;
export const BENCH_FETCHED = `fetched:bench:${BENCHMARK.id}`;

/** Lo guardado: los cierres y desde qué fecha se pidieron (el ETF puede no tener sesión ese día). */
export type StoredBenchmark = { from: string; points: Point[] };

export function parseBenchmark(raw: string | undefined): StoredBenchmark | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { from?: unknown; points?: unknown };
    if (typeof d.from !== "string" || !isIsoDate(d.from) || !Array.isArray(d.points)) return null;
    const points = merge([], d.points as Point[]);
    return points.length ? { from: d.from, points } : null;
  } catch {
    return null;
  }
}

/** Une dos series (manda la segunda), sin cierres no válidos y en orden. */
const merge = (a: Point[], b: Point[]): Point[] =>
  [...new Map([...a, ...b.filter((p) => Array.isArray(p) && typeof p[0] === "string" && isIsoDate(p[0]) && typeof p[1] === "number" && Number.isFinite(p[1]) && p[1] > 0)]).entries()].sort((x, y) => x[0].localeCompare(y[0]));

// Más de estos días sin cierres es un hueco en el histórico, no un puente
// (los festivos encadenados con un fin de semana no pasan de seis).
const MAX_GAP = 10;

/** Tramos de más de MAX_GAP días sin ningún cierre entre `start` y `end`. */
function holes(points: Point[], start: string, end: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let prev = start;
  for (const d of [...points.map((p) => p[0]), end]) {
    if (dayNum(d) - dayNum(prev) > MAX_GAP) out.push([prev, d]);
    prev = d;
  }
  return out;
}

/** Día local de una marca de tiempo guardada ("" si no es válida). */
function localDay(stamp: string | undefined): string {
  const d = new Date(stamp ?? "");
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Descarga lo que falte del índice para cubrir desde `first` (la primera operación)
 * hasta hoy y devuelve los cambios a guardar. Como mucho una vez al día: si ya se
 * bajó hoy, no pide nada. Falla si no consigue el histórico entero, y entonces no
 * hay nada que guardar: quien llama decide qué hacer.
 */
export async function syncBenchmark(meta: Meta, get: Get, first: string, today: string): Promise<Op[]> {
  // Diez días de margen: la base de la comparación es el último cierre en esa fecha o antes.
  const need = addDays(first, -MAX_GAP);
  const start = need < BENCHMARK.since ? BENCHMARK.since : need;
  const have = parseBenchmark(meta[BENCH_KEY]);
  const keep = have && have.from <= start && !holes(have.points, have.from, have.points[have.points.length - 1]![0]).length ? have : null;
  if (keep && localDay(meta[BENCH_FETCHED]) >= today) return [];
  const base = keep?.points ?? [];
  const lo = keep?.from ?? start;
  // Con histórico guardado solo se repasan los últimos días (el de hoy llega a medias).
  const from = keep ? addDays(base[base.length - 1]![0], -7) : start;
  let points: Point[];
  try {
    const got = await xetraPrices(get, BENCHMARK.isin, from, today);
    if (!got.length) throw new Error("no devuelve precios");
    points = merge(base, got);
    // La bolsa responde a veces «sin datos», o con solo el final, a un tramo que sí los tiene, y
    // a la misma pregunta repite la misma respuesta: cada hueco se pide otra vez, él solo y
    // desde unos días antes para que la petición no coincida con la que falló. Tres intentos.
    for (const back of [3, 5, 8]) {
      for (const [a, b] of holes(points, lo, today)) points = merge(points, await xetraPrices(get, BENCHMARK.isin, addDays(a, -back), b));
    }
    if (holes(points, lo, today).length) throw new Error("histórico incompleto");
  } catch {
    // Mismo respaldo que los activos: Yahoo, con el símbolo del ETF en Xetra.
    const q = await yahooChart(get, BENCHMARK.symbol, from, today);
    points = q.currency === BENCHMARK.currency ? merge(base, q.points) : [];
    // Antes nada que un histórico con huecos: el gráfico los dibujaría como tramos planos.
    if (!q.points.length || holes(points, lo, today).length) throw new Error("El índice de referencia no se ha podido descargar entero");
  }
  return [
    { op: "meta", key: BENCH_KEY, value: JSON.stringify({ from: lo, points } satisfies StoredBenchmark) },
    { op: "meta", key: BENCH_FETCHED, value: new Date().toISOString() },
  ];
}

/**
 * Rentabilidad acumulada del índice, en %, en las fechas del gráfico (0 en la
 * primera). Los días sin sesión repiten el último cierre. null si no hay cierre
 * en la primera fecha o antes, o si el histórico se queda corto por algún extremo:
 * mejor no comparar que dibujar una línea plana.
 */
export function benchmarkReturns(points: Point[], dates: string[]): number[] | null {
  const out: number[] = [];
  let j = 0;
  let last: Point | null = null;
  let base = 0;
  for (const date of dates) {
    while (j < points.length && points[j]![0] <= date) last = points[j++]!;
    if (!last) return null;
    if (!out.length) {
      if (dayNum(date) - dayNum(last[0]) > MAX_GAP) return null;
      base = last[1];
    }
    out.push((last[1] / base - 1) * 100);
  }
  if (!last || dayNum(dates[dates.length - 1]!) - dayNum(last[0]) > MAX_GAP) return null;
  return out;
}

// ── Cartera de ejemplo ─────────────────────────────────────────────────────
// Allí no hay red: el índice es inventado, como todo lo demás, y no se guarda.

/** Número entre 0 y 1 que solo depende de `n`. */
function unit(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Índice inventado en días laborables. La variación de cada día sale de su fecha,
 * no del día anterior: la curva es la misma se pida desde donde se pida.
 */
export function exampleBenchmark(from: string, to: string): Point[] {
  const [drift, vol] = [0.085, 0.12];
  const out: Point[] = [];
  let p = 100;
  // Unos días antes, para que haya cierre aunque `from` caiga en fin de semana.
  for (let d = dayNum(from) - 4; d <= dayNum(to); d++) {
    const dow = new Date(d * 86_400_000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    // El desplazamiento está elegido para que el tramo de estos años parezca un índice corriente.
    const n = 2 * (d + 224_000);
    const gauss = Math.sqrt(-2 * Math.log(unit(n) + 1e-12)) * Math.cos(2 * Math.PI * unit(n + 1));
    p *= Math.exp((drift - (vol * vol) / 2) / 252 + (vol / Math.sqrt(252)) * gauss);
    out.push([isoOf(d), Math.round(p * 10000) / 10000]);
  }
  return out;
}
