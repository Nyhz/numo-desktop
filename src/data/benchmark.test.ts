import { describe, expect, it } from "vitest";
import { addDays, dayNum, isoOf } from "../../shared/dates.ts";
import type { Point } from "../../shared/types.ts";
import type { Meta, Op } from "./backend.ts";
import { BENCH_FETCHED, BENCH_KEY, BENCHMARK, benchmarkReturns, exampleBenchmark, parseBenchmark, syncBenchmark } from "./benchmark.ts";

const days = (from: string, n: number) => Array.from({ length: n }, (_, k) => addDays(from, k));

describe("benchmarkReturns", () => {
  // Semana del lunes 2 al viernes 6 de noviembre de 2026 y el lunes siguiente.
  const closes: Point[] = [
    ["2026-10-30", 100],
    ["2026-11-02", 110],
    ["2026-11-03", 121],
    ["2026-11-04", 99],
    ["2026-11-05", 104.5],
    ["2026-11-06", 132],
    ["2026-11-09", 137.5],
  ];

  it("toma como base el cierre de la primera fecha del gráfico", () => {
    const r = benchmarkReturns(closes, days("2026-11-02", 5))!;
    expect(r).toHaveLength(5);
    expect(r[0]).toBe(0);
    expect(r[1]).toBeCloseTo(10, 9);
    expect(r[2]).toBeCloseTo(-10, 9);
    expect(r[3]).toBeCloseTo(-5, 9);
    expect(r[4]).toBeCloseTo(20, 9);
  });

  it("si la primera fecha no tiene sesión, la base es el último cierre anterior", () => {
    // Domingo 1 de noviembre: vale el cierre del viernes 30 de octubre.
    const r = benchmarkReturns(closes, days("2026-11-01", 3))!;
    expect(r[0]).toBe(0);
    expect(r[1]).toBeCloseTo(10, 9);
    expect(r[2]).toBeCloseTo(21, 9);
  });

  it("los días sin sesión repiten el último cierre", () => {
    // Viernes, sábado, domingo y lunes.
    const r = benchmarkReturns(closes, days("2026-11-06", 4))!;
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(0);
    expect(r[2]).toBe(0);
    expect(r[3]).toBeCloseTo((137.5 / 132 - 1) * 100, 9);
  });

  it("devuelve un valor por fecha, alineado con ellas", () => {
    const dates = days("2026-10-30", 11);
    const r = benchmarkReturns(closes, dates)!;
    expect(r).toHaveLength(dates.length);
    expect(r[dates.indexOf("2026-11-09")]).toBeCloseTo(37.5, 9);
  });

  it("sin cierre en la primera fecha o antes no hay comparación", () => {
    expect(benchmarkReturns(closes, days("2026-10-29", 5))).toBeNull();
    expect(benchmarkReturns([], days("2026-11-02", 5))).toBeNull();
    expect(benchmarkReturns(closes, [])).toBeNull();
  });

  it("tampoco si el histórico se queda corto por un extremo", () => {
    // El gráfico empieza semanas después del último cierre, o sigue semanas más allá.
    expect(benchmarkReturns(closes, days("2026-12-01", 5))).toBeNull();
    expect(benchmarkReturns(closes, days("2026-11-02", 40))).toBeNull();
    // Un puente largo sí vale.
    expect(benchmarkReturns(closes, days("2026-11-09", 8))).toEqual(Array(8).fill(0));
  });
});

describe("syncBenchmark", () => {
  const today = "2026-11-24";
  const bar = (date: string) => dayNum(date) * 86_400 + 3600;
  /** Un cierre por día laborable, distinto cada día. */
  const closes = (from: string, to: string): Point[] =>
    days(from, dayNum(to) - dayNum(from) + 1)
      .filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))
      .map((d) => [d, 100 + (dayNum(d) % 97) / 4]);
  const metaOf = (ops: Op[]): Meta => Object.fromEntries(ops.flatMap((o) => (o.op === "meta" ? [[o.key, o.value]] : [])));
  const stored = (ops: Op[]) => parseBenchmark(metaOf(ops)[BENCH_KEY]);
  const isXetra = (url: string) => url.startsWith("https://api.boerse-frankfurt.de/") && url.includes(`XETR:${BENCHMARK.isin}`);
  const isYahoo = (url: string) => url.startsWith(`https://query1.finance.yahoo.com/v8/finance/chart/${BENCHMARK.symbol}?`);
  const yahoo = (rows: Point[], currency = "EUR") =>
    JSON.stringify({ chart: { error: null, result: [{ meta: { currency, symbol: BENCHMARK.symbol, gmtoffset: 3600 }, timestamp: rows.map(([d]) => bar(d) + 8 * 3600), indicators: { quote: [{ close: rows.map(([, v]) => v) }] } }] } });
  /**
   * Bolsa de mentira: devuelve las barras que caen en el tramo pedido. `lose` dice
   * a qué peticiones (por orden) responde «sin datos», como hace a veces la de verdad.
   */
  const exchange = (rows: Point[], urls: string[], lose: (n: number) => boolean = () => false, backup: string | null = null) => async (url: string) => {
    urls.push(url);
    if (isYahoo(url) && backup) return backup;
    if (!isXetra(url)) throw new Error("HTTP 404");
    if (lose(urls.filter(isXetra).length)) return '{"s":"no_data"}';
    const q = new URL(url).searchParams;
    const hit = rows.filter(([d]) => bar(d) >= +q.get("from")! && bar(d) <= +q.get("to")!);
    return JSON.stringify(hit.length ? { s: "ok", t: hit.map(([d]) => bar(d)), c: hit.map(([, v]) => v) } : { s: "no_data" });
  };
  // Primera operación el 5 de marzo de 2025: hace falta desde diez días antes (más de un tramo de la bolsa).
  const first = "2025-03-05";
  const history = closes("2025-02-23", today);

  it("la primera vez baja el histórico desde antes de la primera operación, por ISIN en Deutsche Börse", async () => {
    const urls: string[] = [];
    const ops = await syncBenchmark({}, exchange(closes("2024-01-01", today), urls), first, today);
    expect(urls.length).toBeGreaterThan(1);
    expect(urls.every(isXetra)).toBe(true);
    expect(stored(ops)).toEqual({ from: "2025-02-23", points: history });
    expect(metaOf(ops)[BENCH_FETCHED]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Solo toca `meta`: nada en la tabla de precios.
    expect(ops.every((o) => o.op === "meta")).toBe(true);
  });

  it("si ya se bajó hoy no pide nada", async () => {
    const urls: string[] = [];
    const meta = metaOf(await syncBenchmark({}, exchange(history, urls), first, today));
    urls.length = 0;
    expect(await syncBenchmark({ ...meta, [BENCH_FETCHED]: new Date(`${today}T08:00:00`).toISOString() }, exchange(history, urls), first, today)).toEqual([]);
    expect(urls).toEqual([]);
  });

  it("otro día repasa solo los últimos y conserva lo guardado", async () => {
    // Guardado hasta el lunes 23, cuya barra llegó a medias; hoy trae su cierre definitivo.
    const old = { [BENCH_KEY]: JSON.stringify({ from: "2025-02-23", points: [...history.slice(0, -2), ["2026-11-23", 90]] }), [BENCH_FETCHED]: "2026-11-23T09:00:00.000Z" };
    const urls: string[] = [];
    const ops = await syncBenchmark(old, exchange(history, urls), first, today);
    expect(urls).toHaveLength(1);
    expect(+new URL(urls[0]!).searchParams.get("from")!).toBe(dayNum("2026-11-16") * 86_400);
    expect(stored(ops)).toEqual({ from: "2025-02-23", points: history });
  });

  it("una operación anterior a lo guardado obliga a bajarlo entero", async () => {
    const old = { [BENCH_KEY]: JSON.stringify({ from: "2025-02-23", points: history }), [BENCH_FETCHED]: new Date(`${today}T08:00:00`).toISOString() };
    const ops = await syncBenchmark(old, exchange(closes("2024-01-01", today), []), "2024-06-11", today);
    expect(stored(ops)).toEqual({ from: "2024-06-01", points: closes("2024-06-01", today) });
  });

  it("no pide nada anterior al ETF", async () => {
    const urls: string[] = [];
    const ops = await syncBenchmark({}, exchange(closes(BENCHMARK.since, today), urls), "2001-05-01", today);
    expect(+new URL(urls[0]!).searchParams.get("from")!).toBe(dayNum(BENCHMARK.since) * 86_400);
    expect(stored(ops)).toEqual({ from: BENCHMARK.since, points: closes(BENCHMARK.since, today) });
  });

  it("un tramo que la bolsa da por vacío se vuelve a pedir", async () => {
    const urls: string[] = [];
    // Falla la segunda petición (el segundo tramo); la repetición ya responde bien.
    const ops = await syncBenchmark({}, exchange(history, urls, (n) => n === 2), first, today);
    expect(urls.every(isXetra)).toBe(true);
    // No repite la misma pregunta: la bolsa repetiría la misma respuesta.
    expect(new Set(urls).size).toBe(urls.length);
    expect(stored(ops)?.points).toEqual(history);
  });

  it("si el hueco sigue, usa Yahoo; y sin histórico entero no guarda nada", async () => {
    const urls: string[] = [];
    const ops = await syncBenchmark({}, exchange(history, urls, (n) => n !== 1, yahoo(history)), first, today);
    expect(urls.filter(isYahoo)).toHaveLength(1);
    expect(stored(ops)).toEqual({ from: "2025-02-23", points: history });
    // Ni la bolsa ni el respaldo lo dan entero (o el respaldo no lo da en euros).
    await expect(syncBenchmark({}, exchange(history, [], (n) => n !== 1), first, today)).rejects.toThrow();
    await expect(syncBenchmark({}, exchange(history, [], (n) => n !== 1, yahoo(history.slice(40))), first, today)).rejects.toThrow();
    await expect(syncBenchmark({}, exchange(history, [], (n) => n !== 1, yahoo(history, "USD")), first, today)).rejects.toThrow();
    await expect(syncBenchmark({}, async () => Promise.reject(new Error("Sin conexión")), first, today)).rejects.toThrow();
  });

  it("un repaso sin respuesta no cuenta como descargado", async () => {
    const old = { [BENCH_KEY]: JSON.stringify({ from: "2025-02-23", points: history.slice(0, -1) }), [BENCH_FETCHED]: "2026-11-23T09:00:00.000Z" };
    await expect(syncBenchmark(old, exchange(history, [], () => true), first, today)).rejects.toThrow();
    // Con el respaldo sí: lo guardado más los últimos días.
    expect(stored(await syncBenchmark(old, exchange(history, [], () => true, yahoo(history.slice(-6))), first, today))?.points).toEqual(history);
  });

  it("lo guardado con huecos no se da por bueno", async () => {
    const holed = [...history.slice(0, 100), ...history.slice(160)];
    const old = { [BENCH_KEY]: JSON.stringify({ from: "2025-02-23", points: holed }), [BENCH_FETCHED]: new Date(`${today}T08:00:00`).toISOString() };
    expect(stored(await syncBenchmark(old, exchange(history, []), first, today))?.points).toEqual(history);
  });
});

describe("parseBenchmark", () => {
  it("ignora lo que no se entiende y los cierres no válidos", () => {
    expect(parseBenchmark(undefined)).toBeNull();
    expect(parseBenchmark("no es json")).toBeNull();
    expect(parseBenchmark('{"points":[["2026-11-02",1]]}')).toBeNull();
    expect(parseBenchmark('{"from":"2026-11-01","points":[["2026-11-02",110],["mal",3],["2026-11-03",0],["2026-11-04",null]]}')).toEqual({ from: "2026-11-01", points: [["2026-11-02", 110]] });
  });
});

describe("exampleBenchmark", () => {
  it("es siempre el mismo, solo en días laborables y con cierre en la primera fecha o antes", () => {
    const a = exampleBenchmark("2025-11-22", "2026-11-24");
    expect(a).toEqual(exampleBenchmark("2025-11-22", "2026-11-24"));
    expect(a[0]![0] <= "2025-11-22").toBe(true);
    expect(a.at(-1)![0]).toBe("2026-11-24");
    expect(a.every(([d, v]) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) && v > 0)).toBe(true);
  });

  it("la rentabilidad entre dos fechas no depende de desde dónde se pida", () => {
    const dates = days("2026-06-01", 120);
    const short = benchmarkReturns(exampleBenchmark("2026-06-01", isoOf(dayNum("2026-06-01") + 119)), dates)!;
    const long = benchmarkReturns(exampleBenchmark("2023-01-01", "2026-11-24"), dates)!;
    short.forEach((v, i) => expect(v).toBeCloseTo(long[i]!, 3));
  });

  it("se mueve como un índice: ni plano ni disparatado", () => {
    const pts = exampleBenchmark("2016-11-24", "2026-11-24");
    const daily = pts.slice(1).map(([, v], i) => Math.log(v / pts[i]![1]));
    const mean = daily.reduce((s, x) => s + x, 0) / daily.length;
    const vol = Math.sqrt((daily.reduce((s, x) => s + (x - mean) ** 2, 0) / daily.length) * 252);
    expect(vol).toBeGreaterThan(0.08);
    expect(vol).toBeLessThan(0.16);
    expect(Math.max(...daily.map(Math.abs))).toBeLessThan(0.05);
    const yearly = (pts.at(-1)![1] / pts[0]![1]) ** (1 / 10) - 1;
    expect(yearly).toBeGreaterThan(0);
    expect(yearly).toBeLessThan(0.2);
  });
});
