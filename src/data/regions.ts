import type { AppState, Asset } from "../../shared/types.ts";
import type { Meta, Op } from "./backend.ts";

// Exposición geográfica: lo que hay «dentro» de cada ETF y fondo, de Morningstar.
// Un ETF mundial no es «Irlanda» (donde está domiciliado): es un 70 % Norteamérica,
// un 15 % Europa… Ese reparto interno cambia poco, así que se pide una vez al mes
// (la primera vez que se abre la app en el mes) y se guarda en `meta`: es dato de
// mercado, como el índice de referencia, y no viaja entre equipos.
//
// Son los servicios que usa la web de Morningstar, no una API documentada: pueden
// cambiar sin aviso. Si fallan, el activo queda «sin desglose» y no se rompe nada.
// A Morningstar solo viaja el ISIN (para encontrar su identificador) y ese identificador.

type Get = (url: string) => Promise<string>;

export const REGIONS = ["na", "eu", "jp", "apac", "em"] as const;
export type RegionKey = (typeof REGIONS)[number];
export const REGION_LABEL: Record<RegionKey, string> = {
  na: "Norteamérica",
  eu: "Europa",
  jp: "Japón",
  apac: "Asia-Pacífico desarrollada",
  em: "Emergentes",
};
export type Weights = Partial<Record<RegionKey, number>>;

/**
 * Países tal como los nombra Morningstar → su código ISO. Con ellos se agrupa por
 * regiones con el criterio habitual de los índices (MSCI): Morningstar, por su
 * cuenta, pone Taiwán y Corea en «Asia desarrollada», y un fondo de emergentes
 * saldría con la mitad fuera de «Emergentes».
 */
const MS_COUNTRY: Record<string, string> = {
  unitedStates: "US", canada: "CA", unitedKingdom: "GB", switzerland: "CH", france: "FR", germany: "DE", netherlands: "NL", spain: "ES", sweden: "SE", italy: "IT",
  denmark: "DK", belgium: "BE", finland: "FI", ireland: "IE", norway: "NO", austria: "AT", portugal: "PT", estonia: "EE", latvia: "LV", lithuania: "LT", slovakia: "SK",
  israel: "IL", japan: "JP", australia: "AU", newZealand: "NZ", hongKong: "HK", singapore: "SG", china: "CN", taiwan: "TW", southKorea: "KR", india: "IN",
  indonesia: "ID", malaysia: "MY", philippines: "PH", thailand: "TH", vietnam: "VN", pakistan: "PK", brazil: "BR", mexico: "MX", argentina: "AR", chile: "CL",
  colombia: "CO", peru: "PE", venezuela: "VE", czechRepublic: "CZ", greece: "GR", hungary: "HU", poland: "PL", russia: "RU", turkey: "TR", southAfrica: "ZA",
};

/** Regiones de Morningstar → las de la app (si la respuesta no trae países). */
const MS_REGION: Record<string, RegionKey> = {
  northAmerica: "na",
  europeDeveloped: "eu",
  unitedKingdom: "eu",
  japan: "jp",
  asiaDeveloped: "apac",
  australasia: "apac",
  asiaEmerging: "em",
  europeEmerging: "em",
  latinAmerica: "em",
  africaMiddleEast: "em",
};

/** Región de un país (para acciones sueltas), con la clasificación habitual de los índices. */
const COUNTRY_REGION: Record<string, RegionKey> = {};
const put = (r: RegionKey, codes: string) => codes.split(" ").forEach((c) => (COUNTRY_REGION[c] = r));
put("na", "US CA");
// Israel va con los desarrollados, como en los índices; los bálticos y Eslovaquia, con Europa.
put("eu", "AT BE CH DE DK ES FI FR GB IE IS IT LU NL NO PT SE LI MC JE GG IM IL EE LV LT SK");
put("jp", "JP");
put("apac", "AU NZ HK SG");
put("em", "CN TW KR IN BR MX ZA SA AE QA KW ID TH MY PH CL CO PE AR EG CZ GR HU PL TR VN PK VE RU");

export const REGIONS_MONTH = "regions:month";
export const regionsKey = (assetId: string) => `regions:asset:${assetId}`;

/** Lo guardado de cada activo. `weights` null: Morningstar no tiene su desglose (renta fija, materias primas…). */
export type StoredRegions = { secId: string | null; date: string | null; fetchedAt: string; weights: Weights | null };

export function parseRegions(raw: string | undefined): StoredRegions | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as StoredRegions;
    return d && typeof d.fetchedAt === "string" ? d : null;
  } catch {
    return null;
  }
}

/** El desglose por regiones de una respuesta de Morningstar, normalizado a 1; null si no trae nada. */
export function regionsFromMorningstar(text: string): { date: string | null; weights: Weights } | null {
  let fp: Record<string, unknown> | undefined;
  try {
    fp = (JSON.parse(text) as { fundPortfolio?: Record<string, unknown> }).fundPortfolio;
  } catch {
    return null;
  }
  if (!fp) return null;
  const date = typeof fp.portfolioDate === "string" ? fp.portfolioDate.slice(0, 10) : null;
  const sums: Weights = {};
  let total = 0;
  // Por países, si vienen: cada uno a su región; lo que no está en la lista
  // («other Countries»: Arabia Saudí, Emiratos, Catar…) son mercados emergentes.
  if (Array.isArray(fp.countries)) {
    for (const c of fp.countries as Array<{ name?: unknown; percent?: unknown }>) {
      const v = c?.percent;
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
      const region = COUNTRY_REGION[MS_COUNTRY[String(c.name)] ?? ""] ?? "em";
      sums[region] = (sums[region] ?? 0) + v;
      total += v;
    }
    if (total >= 1) {
      if (total < 100) sums.em = (sums.em ?? 0) + (100 - total);
      return { date, weights: normalize(sums) };
    }
  }
  for (const [k, region] of Object.entries(MS_REGION)) {
    const v = fp[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    sums[region] = (sums[region] ?? 0) + v;
    total += v;
  }
  // Los porcentajes son de la parte de renta variable: se reparte el total entre ellos.
  if (total < 1) return null;
  return { date, weights: normalize(sums) };
}

const normalize = (sums: Weights): Weights => {
  const total = REGIONS.reduce((s, r) => s + (sums[r] ?? 0), 0);
  const out: Weights = {};
  for (const r of REGIONS) if (sums[r]) out[r] = sums[r]! / total;
  return out;
};

const SEARCH = (isin: string) =>
  `https://lt.morningstar.com/api/rest.svc/dr6pz9spfi/security/screener?page=1&pageSize=20&outputType=json&version=1&languageId=en-GB&currencyId=EUR&universeIds=FOEUR%24%24ALL%7CETEUR%24%24ALL&securityDataPoints=SecId%7CIsin&term=${encodeURIComponent(isin)}`;
const BREAKDOWN = (secId: string) =>
  `https://api-global.morningstar.com/sal-service/v1/fund/portfolio/regionalSectorIncludeCountries/${encodeURIComponent(secId)}/data?languageId=en&locale=en&clientId=MDC&benchmarkId=category&version=4.65.0`;

/** Sin conexión no es «no hay desglose»: se deja para la próxima vez. */
const offline = (e: unknown) => /Sin conexión/i.test(e instanceof Error ? e.message : String(e));

/**
 * Busca el desglose de un ISIN. Un ETF tiene un identificador por cada bolsa en la
 * que cotiza y no todos responden: se prueban por orden (el último que funcionó, primero).
 */
export async function morningstarRegions(get: Get, isin: string, known: string | null): Promise<Omit<StoredRegions, "fetchedAt">> {
  const tryId = async (secId: string) => {
    try {
      return regionsFromMorningstar(await get(BREAKDOWN(secId)));
    } catch (e) {
      if (offline(e)) throw e;
      return null;
    }
  };
  if (known) {
    const got = await tryId(known);
    if (got) return { secId: known, ...got };
  }
  const found = JSON.parse(await get(SEARCH(isin))) as { rows?: Array<{ SecId?: string; Isin?: string }> };
  const ids = (found.rows ?? []).filter((r) => r.SecId && (!r.Isin || r.Isin.toUpperCase() === isin.toUpperCase())).map((r) => r.SecId!);
  for (const secId of ids.filter((id) => id !== known).slice(0, 6)) {
    const got = await tryId(secId);
    if (got) return { secId, ...got };
  }
  return { secId: null, date: null, weights: null };
}

/** Activos que tienen (o pueden tener) un reparto interno: ETF, fondos y demás con ISIN. */
const lookThrough = (a: Asset) => !!a.isin && a.kind !== "stock" && a.kind !== "crypto";

/** Qué hay que pedir: todo una vez al mes; entre medias, solo lo que aún no tiene nada guardado. */
export function regionsDue(state: AppState, meta: Meta, held: ReadonlySet<string>, today: string, force = false): Asset[] {
  const month = today.slice(0, 7);
  const all = force || meta[REGIONS_MONTH] !== month;
  return state.assets.filter((a) => held.has(a.id) && lookThrough(a) && (all || !parseRegions(meta[regionsKey(a.id)])));
}

/**
 * Pide a Morningstar lo que toque y devuelve lo que hay que guardar. Sin conexión
 * se para y no marca el mes, para volver a intentarlo en la siguiente actualización.
 */
export async function syncRegions(state: AppState, meta: Meta, get: Get, held: ReadonlySet<string>, today: string, force = false): Promise<Op[]> {
  const ops: Op[] = [];
  for (const a of regionsDue(state, meta, held, today, force)) {
    const before = parseRegions(meta[regionsKey(a.id)]);
    try {
      const got = await morningstarRegions(get, a.isin!, before?.secId ?? null);
      ops.push({ op: "meta", key: regionsKey(a.id), value: JSON.stringify({ ...got, fetchedAt: new Date().toISOString() } satisfies StoredRegions) });
    } catch (e) {
      if (offline(e)) return ops;
      // Cualquier otro fallo (la búsqueda cambió de formato…): el activo se queda como estaba.
    }
  }
  ops.push({ op: "meta", key: REGIONS_MONTH, value: today.slice(0, 7) });
  return ops;
}

/** Dónde está el dinero de un activo: por regiones, en cripto o sin desglose. */
export type Exposure = { kind: "regions"; weights: Weights } | { kind: "crypto" } | { kind: "none" };

export function exposureOf(a: Asset, stored: StoredRegions | null): Exposure {
  if (a.kind === "crypto") return { kind: "crypto" };
  if (stored?.weights) return { kind: "regions", weights: stored.weights };
  if (a.kind === "stock") {
    // El país del ISIN es el del domicilio de la empresa: casi siempre, también su mercado.
    const country = a.isin?.slice(0, 2).toUpperCase() || (a.priceSource === "nasdaq" ? "US" : a.priceSource === "bme" ? "ES" : "");
    const region = COUNTRY_REGION[country];
    if (region) return { kind: "regions", weights: { [region]: 1 } };
  }
  return { kind: "none" };
}

/** Repartos inventados para los fondos de la cartera de ejemplo (sus ISIN no existen). */
export const EXAMPLE_REGIONS: Record<string, Weights> = {
  "demo-world": { na: 0.74, eu: 0.15, jp: 0.06, apac: 0.04, em: 0.01 },
  "demo-fund-b": { na: 0.63, eu: 0.12, jp: 0.05, apac: 0.03, em: 0.17 },
};
