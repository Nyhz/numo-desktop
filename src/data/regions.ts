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
  // Australia, Nueva Zelanda, Hong Kong y Singapur: Japón y la Asia emergente van aparte.
  apac: "Asia-Pacífico",
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

// ── Sectores ──
// Los once de Morningstar (los de GICS, con otro nombre). En un ETF o fondo, el
// reparto de su parte de renta variable; en una acción, el sector de la empresa.

export const SECTORS = ["tech", "fin", "health", "ind", "cyc", "comm", "def", "energy", "mat", "re", "util"] as const;
export type SectorKey = (typeof SECTORS)[number];
export const SECTOR_LABEL: Record<SectorKey, string> = {
  tech: "Tecnología",
  fin: "Finanzas",
  health: "Salud",
  ind: "Industria",
  cyc: "Consumo cíclico",
  comm: "Comunicaciones",
  def: "Consumo defensivo",
  energy: "Energía",
  mat: "Materiales",
  re: "Inmobiliario",
  util: "Servicios públicos",
};
export type SectorWeights = Partial<Record<SectorKey, number>>;

/** Claves del reparto de un fondo en Morningstar → las de la app. */
const MS_SECTOR: Record<string, SectorKey> = {
  technology: "tech",
  financialServices: "fin",
  healthcare: "health",
  industrials: "ind",
  consumerCyclical: "cyc",
  communicationServices: "comm",
  consumerDefensive: "def",
  energy: "energy",
  basicMaterials: "mat",
  realEstate: "re",
  utilities: "util",
};
/** Nombre del sector de una acción en el buscador de Morningstar → el de la app. */
const STOCK_SECTOR: Record<string, SectorKey> = {
  Technology: "tech",
  "Financial Services": "fin",
  Healthcare: "health",
  Industrials: "ind",
  "Consumer Cyclical": "cyc",
  "Communication Services": "comm",
  "Consumer Defensive": "def",
  Energy: "energy",
  "Basic Materials": "mat",
  "Real Estate": "re",
  Utilities: "util",
};

/** El reparto por sectores de la renta variable de un fondo, normalizado a 1; null si no tiene (renta fija, monetarios…). */
export function sectorsFromMorningstar(text: string): SectorWeights | null {
  let fp: Record<string, unknown> | undefined;
  try {
    fp = (JSON.parse(text) as { EQUITY?: { fundPortfolio?: Record<string, unknown> } }).EQUITY?.fundPortfolio;
  } catch {
    return null;
  }
  if (!fp) return null;
  const sums: SectorWeights = {};
  let total = 0;
  for (const [k, sector] of Object.entries(MS_SECTOR)) {
    const v = fp[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    sums[sector] = (sums[sector] ?? 0) + v;
    total += v;
  }
  if (total < 1) return null;
  const out: SectorWeights = {};
  for (const k of SECTORS) if (sums[k]) out[k] = sums[k]! / total;
  return out;
}

export const REGIONS_MONTH = "regions:month";
export const regionsKey = (assetId: string) => `regions:asset:${assetId}`;

/**
 * Lo guardado de cada activo (en `meta`, con la clave de siempre aunque ya lleve
 * también sectores). `weights` null: Morningstar no tiene su reparto por regiones
 * (renta fija, materias primas, una acción: va por su país). `sectors` null: no
 * tiene sector; sin la clave, se guardó antes de que hubiera sectores y se vuelve a pedir.
 */
export type StoredRegions = { secId: string | null; date: string | null; fetchedAt: string; weights: Weights | null; sectors?: SectorWeights | null };

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
const STOCK_SEARCH = (isin: string) =>
  `https://lt.morningstar.com/api/rest.svc/dr6pz9spfi/security/screener?page=1&pageSize=10&outputType=json&version=1&languageId=en-GB&currencyId=EUR&universeIds=E0WWE%24%24ALL&securityDataPoints=SecId%7CIsin%7CSectorName&term=${encodeURIComponent(isin)}`;
const SECTOR_BREAKDOWN = (secId: string) =>
  `https://api-global.morningstar.com/sal-service/v1/fund/portfolio/v2/sector/${encodeURIComponent(secId)}/data?languageId=en&locale=en&clientId=MDC&benchmarkId=category&version=4.65.0`;
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
  // Con el identificador que responde, también su reparto por sectores.
  const withSectors = async (secId: string, got: { date: string | null; weights: Weights }) => {
    let sectors: SectorWeights | null = null;
    try {
      sectors = sectorsFromMorningstar(await get(SECTOR_BREAKDOWN(secId)));
    } catch (e) {
      if (offline(e)) throw e;
    }
    return { secId, ...got, sectors };
  };
  if (known) {
    const got = await tryId(known);
    if (got) return withSectors(known, got);
  }
  const found = JSON.parse(await get(SEARCH(isin))) as { rows?: Array<{ SecId?: string; Isin?: string }> };
  const ids = (found.rows ?? []).filter((r) => r.SecId && (!r.Isin || r.Isin.toUpperCase() === isin.toUpperCase())).map((r) => r.SecId!);
  for (const secId of ids.filter((id) => id !== known).slice(0, 6)) {
    const got = await tryId(secId);
    if (got) return withSectors(secId, got);
  }
  return { secId: null, date: null, weights: null, sectors: null };
}

/** El sector de una acción, del buscador de Morningstar por su ISIN. Su región va por el país del ISIN. */
export async function morningstarStock(get: Get, isin: string): Promise<Omit<StoredRegions, "fetchedAt">> {
  const found = JSON.parse(await get(STOCK_SEARCH(isin))) as { rows?: Array<{ SecId?: string; Isin?: string; SectorName?: string }> };
  const row = (found.rows ?? []).find((r) => r.Isin?.toUpperCase() === isin.toUpperCase() && r.SectorName && STOCK_SECTOR[r.SectorName]);
  return { secId: row?.SecId ?? null, date: null, weights: null, sectors: row ? { [STOCK_SECTOR[row.SectorName!]!]: 1 } : null };
}

/** Activos que se le piden a Morningstar: ETF, fondos y demás con ISIN (su reparto) y acciones con ISIN (su sector). */
const lookThrough = (a: Asset) => !!a.isin && a.kind !== "crypto";

/** Qué hay que pedir: todo una vez al mes; entre medias, solo lo que aún no tiene nada guardado (o se guardó sin sectores). */
export function regionsDue(state: AppState, meta: Meta, held: ReadonlySet<string>, today: string, force = false): Asset[] {
  const month = today.slice(0, 7);
  const all = force || meta[REGIONS_MONTH] !== month;
  return state.assets.filter((a) => {
    if (!held.has(a.id) || !lookThrough(a)) return false;
    const stored = parseRegions(meta[regionsKey(a.id)]);
    return all || !stored || stored.sectors === undefined;
  });
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
      const got = a.kind === "stock" ? await morningstarStock(get, a.isin!) : await morningstarRegions(get, a.isin!, before?.secId ?? null);
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

/** A qué sectores va el dinero de un activo: por sectores, en cripto o sin desglose. */
export type SectorExposure = { kind: "sectors"; weights: SectorWeights } | { kind: "crypto" } | { kind: "none" };

export function sectorExposureOf(a: Asset, stored: StoredRegions | null): SectorExposure {
  if (a.kind === "crypto") return { kind: "crypto" };
  if (stored?.sectors) return { kind: "sectors", weights: stored.sectors };
  return { kind: "none" };
}

/** Sectores inventados para la cartera de ejemplo (sus ISIN no existen). */
export const EXAMPLE_SECTORS: Record<string, SectorWeights> = {
  "demo-world": { tech: 0.27, fin: 0.16, health: 0.11, ind: 0.11, cyc: 0.1, comm: 0.08, def: 0.06, energy: 0.04, mat: 0.03, re: 0.02, util: 0.02 },
  "demo-fund-b": { tech: 0.24, fin: 0.18, health: 0.1, ind: 0.1, cyc: 0.11, comm: 0.08, def: 0.07, energy: 0.05, mat: 0.04, re: 0.02, util: 0.01 },
  "demo-helios": { health: 1 },
  "demo-meridian": { tech: 1 },
  "demo-vertice": { tech: 1 },
  "demo-textil": { cyc: 1 },
  "demo-banco": { fin: 1 },
  "demo-north": { energy: 1 },
};

/** Repartos inventados para los fondos de la cartera de ejemplo (sus ISIN no existen). */
export const EXAMPLE_REGIONS: Record<string, Weights> = {
  "demo-world": { na: 0.74, eu: 0.15, jp: 0.06, apac: 0.04, em: 0.01 },
  "demo-fund-b": { na: 0.63, eu: 0.12, jp: 0.05, apac: 0.03, em: 0.17 },
};
