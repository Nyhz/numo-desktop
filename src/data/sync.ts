import { holdsCash, type AccountKind, type AppState, type Point } from "../../shared/types.ts";
import { ENTITIES, reduce, type Entity, type Op, type Stamp } from "./backend.ts";

// Sincronización entre equipos. Cada equipo deja en una carpeta compartida (la de
// un servicio de nube, por ejemplo) un archivo con sus registros, cuándo cambió
// cada uno y cuáles ha borrado. Al sincronizar se leen los archivos de los demás
// y, registro a registro, gana el cambio más reciente. La base de datos nunca se
// comparte: cada equipo tiene la suya y solo intercambia estos archivos.
//
// Este módulo es puro: decide qué cambios aplicar; no lee ni escribe nada.

export const SYNC_FORMAT = 1;
const EPOCH = "1970-01-01T00:00:00.000Z";

/** Campos de cada tipo de registro. Lo que no esté aquí no viaja. */
const FIELDS: Record<Entity, readonly string[]> = {
  accounts: ["id", "name", "institution", "kind", "currency", "color", "trackCash", "archived", "createdAt"],
  goals: ["id", "name", "targetPct", "color", "sortOrder", "createdAt"],
  assets: ["id", "name", "kind", "symbol", "isin", "currency", "priceSource", "goalId", "planExcluded", "createdAt"],
  properties: ["id", "name", "address", "purchaseDate", "purchasePrice", "purchaseCosts", "note", "createdAt"],
  mortgages: ["id", "propertyId", "lender", "principal", "rateType", "ratePct", "termMonths", "firstPaymentDate", "createdAt"],
  txs: ["id", "date", "type", "accountId", "assetId", "quantity", "price", "amount", "currency", "fxRate", "fee", "feeCurrency", "taxSource", "taxHome", "toAccountId", "toAssetId", "toQuantity", "note", "createdAt"],
  mortgageEvents: ["id", "mortgageId", "date", "type", "amount", "mode", "ratePct", "note", "createdAt"],
  valuations: ["id", "propertyId", "date", "value", "note"],
};
const PUT = { accounts: "putAccount", goals: "putGoal", assets: "putAsset", properties: "putProperty", mortgages: "putMortgage", txs: "putTx", mortgageEvents: "putMortgageEvent", valuations: "putValuation" } as const;
const DEL = { accounts: "delAccount", goals: "delGoal", assets: "delAsset", properties: "delProperty", mortgages: "delMortgage", txs: "delTx", mortgageEvents: "delMortgageEvent", valuations: "delValuation" } as const;

type Row = Record<string, unknown> & { id: string };
type Stamped = Row & { _at: string };
export type Snapshot = {
  format: number;
  device: { id: string; name: string };
  writtenAt: string;
  records: Record<Entity, Stamped[]>;
  tombstones: Array<{ entity: Entity; id: string; at: string }>;
  /** Históricos de precios y splits: algunas fuentes solo dan el último valor. */
  prices: Record<string, Point[]>;
  splits: Record<string, Point[]>;
};

const rowsOf = (state: AppState, entity: Entity): Row[] => state[entity] as unknown as Row[];

/** Lo que este equipo publica para los demás. */
export function buildSnapshot(state: AppState, stamps: Stamp[], device: { id: string; name: string }, now: string): Snapshot {
  const at = new Map(stamps.map((s) => [`${s.entity}:${s.id}`, s]));
  const records = {} as Record<Entity, Stamped[]>;
  for (const entity of ENTITIES) {
    records[entity] = rowsOf(state, entity).map((row) => {
      const out: Stamped = { id: row.id, _at: at.get(`${entity}:${row.id}`)?.at ?? (typeof row.createdAt === "string" && row.createdAt ? row.createdAt : EPOCH) };
      for (const f of FIELDS[entity]) out[f] = row[f];
      return out;
    });
  }
  const live = new Set(ENTITIES.flatMap((e) => rowsOf(state, e).map((r) => `${e}:${r.id}`)));
  const assetIds = new Set(state.assets.map((a) => a.id));
  const keep = (rec: Record<string, Point[]>) => Object.fromEntries(Object.entries(rec).filter(([id, pts]) => assetIds.has(id) && pts.length));
  return {
    format: SYNC_FORMAT,
    device,
    writtenAt: now,
    records,
    tombstones: stamps.filter((s) => s.deleted && !live.has(`${s.entity}:${s.id}`)).map(({ entity, id, at: when }) => ({ entity, id, at: when })),
    prices: keep(state.prices),
    splits: keep(state.splits),
  };
}

/** El mismo contenido sin la hora de escritura, para saber si hace falta volver a publicarlo. */
export const snapshotBody = (snap: Snapshot): string => JSON.stringify({ ...snap, writtenAt: "" });

const isPoint = (p: unknown): p is Point => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "number" && Number.isFinite(p[1]);
const series = (raw: unknown): Record<string, Point[]> => {
  const out: Record<string, Point[]> = {};
  if (raw && typeof raw === "object") for (const [id, pts] of Object.entries(raw)) if (Array.isArray(pts)) out[id] = pts.filter(isPoint);
  return out;
};

/**
 * Lee el archivo de otro equipo. Devuelve null si no es un archivo de Numo, y
 * lanza un error legible si lo escribió una versión más nueva que esta.
 */
export function parseSnapshot(text: string): Snapshot | null {
  let raw: Partial<Snapshot>;
  try {
    raw = JSON.parse(text) as Partial<Snapshot>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || typeof raw.format !== "number" || !raw.device?.id || !raw.records) return null;
  if (raw.format > SYNC_FORMAT) throw new Error(`«${raw.device.name || "Otro equipo"}» usa una versión más nueva de Numo. Actualiza la app en este equipo para sincronizar.`);
  const records = {} as Record<Entity, Stamped[]>;
  for (const entity of ENTITIES) {
    const list = Array.isArray(raw.records[entity]) ? raw.records[entity] : [];
    // Solo se aceptan registros completos: con todos sus campos y su marca de tiempo.
    records[entity] = list.filter((r): r is Stamped => !!r && typeof r.id === "string" && typeof r._at === "string" && FIELDS[entity].every((f) => r[f] !== undefined));
  }
  // Hasta la 0.4 había un tipo de cuenta «banco». Si otro equipo aún lo publica, se lee como
  // lo que hace la migración: fondo de emergencia si no tiene inversiones, bróker si las tiene.
  for (const account of records.accounts) {
    if (account.kind !== "bank") continue;
    const invests = records.txs.some((t) => (t.accountId === account.id || t.toAccountId === account.id) && (t.assetId != null || t.toAssetId != null));
    account.kind = invests ? "broker" : "emergency";
  }
  // Lo publique quien lo publique, solo el fondo de emergencia lleva efectivo.
  for (const account of records.accounts) account.trackCash = holdsCash(account.kind as AccountKind);
  const tombstones = (Array.isArray(raw.tombstones) ? raw.tombstones : []).filter((t) => t && (ENTITIES as readonly string[]).includes(t.entity) && typeof t.id === "string" && typeof t.at === "string");
  return { format: raw.format, device: { id: String(raw.device.id), name: String(raw.device.name ?? "") }, writtenAt: String(raw.writtenAt ?? ""), records, tombstones, prices: series(raw.prices), splits: series(raw.splits) };
}

/** De qué equipo es un archivo cifrado que aquí no se puede abrir: su nombre va fuera del cifrado. */
export function sealedDevice(text: string): string {
  try {
    const name = (JSON.parse(text) as { device?: { name?: unknown } } | null)?.device?.name;
    return typeof name === "string" && name ? name : "Otro equipo";
  } catch {
    return "Otro equipo";
  }
}

export type MergeResult = {
  ops: Op[];
  /** Registros creados o actualizados con lo de otros equipos. */
  pulled: number;
  /** Registros borrados porque se borraron en otro equipo. */
  deleted: number;
  /** Registros que no se han podido traer, con el motivo. */
  skipped: string[];
};

type Version = { at: string; row: Row | null };

/**
 * Compara lo de este equipo con lo publicado por los demás y devuelve los cambios
 * que hay que aplicar aquí. Registro a registro gana el cambio más reciente (un
 * borrado es un cambio más); en caso de empate se conserva lo local.
 */
export function mergeSnapshots(state: AppState, stamps: Stamp[], remotes: Snapshot[]): MergeResult {
  const stampOf = new Map(stamps.map((s) => [`${s.entity}:${s.id}`, s]));
  const skipped: string[] = [];

  // 1. La versión ganadora de cada registro que algún otro equipo conoce.
  const winners = new Map<Entity, Map<string, Version>>();
  const local = new Map<Entity, Map<string, Version>>();
  for (const entity of ENTITIES) {
    const mine = new Map<string, Version>();
    for (const row of rowsOf(state, entity)) mine.set(row.id, { at: stampOf.get(`${entity}:${row.id}`)?.at ?? (typeof row.createdAt === "string" && row.createdAt ? row.createdAt : EPOCH), row });
    for (const s of stamps) if (s.entity === entity && s.deleted && !mine.has(s.id)) mine.set(s.id, { at: s.at, row: null });
    local.set(entity, mine);

    const best = new Map<string, Version>();
    const offer = (id: string, v: Version) => {
      const cur = best.get(id);
      if (!cur || v.at > cur.at) best.set(id, v);
    };
    for (const snap of remotes) {
      for (const r of snap.records[entity]) {
        const { _at, ...row } = r;
        offer(r.id, { at: _at, row: row as Row });
      }
      for (const t of snap.tombstones) if (t.entity === entity) offer(t.id, { at: t.at, row: null });
    }
    // Solo interesan las que son más recientes que lo que hay aquí.
    for (const [id, v] of best) {
      const cur = mine.get(id);
      if (cur && cur.at >= v.at) best.delete(id);
      else if (!cur && !v.row) best.set(id, v); // borrado de algo que aquí nunca existió: se anota igualmente
    }
    winners.set(entity, best);
  }

  // 2. Cómo quedaría cada tipo de registro, para no traer nada que apunte a algo que no existe.
  const result = (entity: Entity): Set<string> => {
    const ids = new Set<string>();
    for (const [id, v] of local.get(entity)!) if (v.row) ids.add(id);
    for (const [id, v] of winners.get(entity)!) {
      if (v.row) ids.add(id);
      else ids.delete(id);
    }
    return ids;
  };
  const drop = (entity: Entity, id: string, why: string) => {
    winners.get(entity)!.delete(id);
    skipped.push(why);
  };
  const name = (row: Row | null, fallback: string) => (row && typeof row.name === "string" ? row.name : fallback);

  // Hipotecas: una por inmueble. Si dos equipos crearon una distinta, se queda la más reciente.
  const extraDels: Op[] = [];
  for (const [id, v] of [...winners.get("mortgages")!]) {
    if (!v.row) continue;
    const rival = [...local.get("mortgages")!].find(([otherId, o]) => otherId !== id && o.row && o.row.propertyId === v.row!.propertyId && winners.get("mortgages")!.get(otherId)?.row !== null);
    if (!rival) continue;
    if (rival[1].at >= v.at) drop("mortgages", id, "Una hipoteca de otro equipo se ha descartado: este inmueble ya tiene una más reciente aquí.");
    else {
      winners.get("mortgages")!.set(rival[0], { at: v.at, row: null });
      extraDels.push({ op: "delMortgage", id: rival[0], at: v.at });
    }
  }

  // Los activos apuntan a su bloque del plan: si el bloque no llega, el activo queda sin bloque.
  const goals = result("goals");
  for (const v of winners.get("assets")!.values()) if (v.row && v.row.goalId && !goals.has(v.row.goalId as string)) v.row = { ...v.row, goalId: null };

  const parents: Array<[Entity, Array<[field: string, parent: Entity]>, string]> = [
    ["mortgages", [["propertyId", "properties"]], "hipoteca"],
    ["txs", [["accountId", "accounts"], ["assetId", "assets"], ["toAccountId", "accounts"], ["toAssetId", "assets"]], "operación"],
    ["mortgageEvents", [["mortgageId", "mortgages"]], "evento de hipoteca"],
    ["valuations", [["propertyId", "properties"]], "valoración"],
  ];
  for (const [entity, refs, label] of parents) {
    for (const [id, v] of [...winners.get(entity)!]) {
      if (!v.row) continue;
      const missing = refs.find(([field, parent]) => v.row![field] != null && !result(parent).has(v.row![field] as string));
      if (missing) drop(entity, id, `Una ${label} de otro equipo no se ha traído: su ${missing[1] === "accounts" ? "cuenta" : missing[1] === "assets" ? "activo" : missing[1] === "properties" ? "inmueble" : "hipoteca"} ya no existe.`);
    }
  }
  // Un activo no se borra si aquí sigue habiendo operaciones que lo usan.
  const txAssets = new Set<string>();
  const txsAfter = result("txs");
  for (const [id, v] of local.get("txs")!) if (v.row && txsAfter.has(id) && !winners.get("txs")!.has(id)) for (const f of ["assetId", "toAssetId"]) if (v.row[f]) txAssets.add(v.row[f] as string);
  for (const v of winners.get("txs")!.values()) if (v.row) for (const f of ["assetId", "toAssetId"]) if (v.row[f]) txAssets.add(v.row[f] as string);
  for (const [id, v] of [...winners.get("assets")!]) if (!v.row && txAssets.has(id)) drop("assets", id, `«${name(local.get("assets")!.get(id)?.row ?? null, "Un activo")}» se borró en otro equipo, pero aquí tiene operaciones: se conserva.`);

  // 3. Los cambios: primero los borrados (de lo más dependiente a lo menos) y después las altas.
  const ops: Op[] = [...extraDels];
  let pulled = 0;
  let deleted = 0;
  for (const entity of [...ENTITIES].reverse()) {
    for (const [id, v] of winners.get(entity)!) {
      if (v.row || extraDels.some((o) => "id" in o && o.id === id)) continue;
      if (local.get(entity)!.get(id)?.row) deleted++;
      ops.push({ op: DEL[entity], id, at: v.at } as Op);
    }
  }
  deleted += extraDels.length;
  for (const entity of ENTITIES) {
    for (const v of winners.get(entity)!.values()) {
      if (!v.row) continue;
      pulled++;
      ops.push({ op: PUT[entity], row: v.row, at: v.at } as unknown as Op);
    }
  }

  // 4. Precios y splits: se suman los días que aquí faltan (los que ya hay no se tocan).
  const assets = result("assets");
  const morePrices = new Map<string, Map<string, number>>();
  const moreSplits = new Map<string, Map<string, number>>();
  for (const snap of remotes) {
    for (const [kind, source, target] of [["prices", snap.prices, morePrices], ["splits", snap.splits, moreSplits]] as const) {
      for (const [assetId, pts] of Object.entries(source)) {
        if (!assets.has(assetId)) continue;
        const have = new Set((state[kind][assetId] ?? []).map(([d]) => d));
        for (const [d, v] of pts) {
          if (have.has(d)) continue;
          if (!target.has(assetId)) target.set(assetId, new Map());
          target.get(assetId)!.set(d, v);
        }
      }
    }
  }
  for (const [assetId, pts] of morePrices) ops.push({ op: "prices", assetId, points: [...pts].sort((a, b) => a[0].localeCompare(b[0])) });
  // Los splits se guardan como lista completa por activo.
  for (const [assetId, pts] of moreSplits) ops.push({ op: "splits", assetId, points: [...(state.splits[assetId] ?? []), ...pts].sort((a, b) => a[0].localeCompare(b[0])) });

  return { ops, pulled, deleted, skipped };
}

/** Qué registro toca un cambio, y si lo deja vivo o borrado. Nulo si no es un registro del usuario. */
export function stampOf(o: Op, now: string): Stamp | null {
  for (const entity of ENTITIES) {
    if (o.op === PUT[entity] && "row" in o) return { entity, id: o.row.id, at: o.at ?? now, deleted: false };
    if (o.op === DEL[entity] && "id" in o) return { entity, id: o.id, at: ("at" in o ? o.at : undefined) ?? now, deleted: true };
  }
  return null;
}

/**
 * Borrar una cuenta, un inmueble o una hipoteca se lleva por delante lo que
 * cuelga de ellos. Esos registros también quedan anotados como borrados, para
 * que otro equipo que aún los tenga no los devuelva.
 */
export function cascadeOf(o: Op, state: AppState): Array<{ entity: Entity; id: string }> {
  if (o.op === "delAccount") return state.txs.filter((t) => t.accountId === o.id || t.toAccountId === o.id).map((t) => ({ entity: "txs", id: t.id }));
  if (o.op === "delMortgage") return state.mortgageEvents.filter((e) => e.mortgageId === o.id).map((e) => ({ entity: "mortgageEvents", id: e.id }));
  if (o.op === "delProperty") {
    const mortgages = state.mortgages.filter((m) => m.propertyId === o.id).map((m) => m.id);
    return [
      ...state.mortgageEvents.filter((e) => mortgages.includes(e.mortgageId)).map((e) => ({ entity: "mortgageEvents" as const, id: e.id })),
      ...mortgages.map((id) => ({ entity: "mortgages" as const, id })),
      ...state.valuations.filter((v) => v.propertyId === o.id).map((v) => ({ entity: "valuations" as const, id: v.id })),
    ];
  }
  return [];
}

/**
 * Lleva al día las marcas de tiempo tras aplicar unos cambios sobre `state` (el
 * estado de antes). El backend nativo hace lo mismo en SQL; esta versión en
 * memoria sirve para las pruebas.
 */
export function stampOps(stamps: Stamp[], ops: Op[], now: string, state: AppState): Stamp[] {
  const map = new Map(stamps.map((s) => [`${s.entity}:${s.id}`, s]));
  let loaded = { state, meta: {} };
  for (const o of ops) {
    const st = stampOf(o, now);
    if (st) {
      for (const child of cascadeOf(o, loaded.state)) map.set(`${child.entity}:${child.id}`, { ...child, at: st.at, deleted: true });
      map.set(`${st.entity}:${st.id}`, st);
    }
    loaded = reduce(loaded, [o]);
  }
  return [...map.values()];
}
