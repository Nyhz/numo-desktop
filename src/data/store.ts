import { useMemo, useSyncExternalStore } from "react";
import { accountKey, assetKey, type ImportPlan } from "../../shared/csv.ts";
import { addMonths, todayIso } from "../../shared/dates.ts";
import { fxHealth, needsAttention, parseFailure, priceHealth, type PriceHealth } from "../../shared/engine/health.ts";
import { buildLedger, type Ledger } from "../../shared/engine/ledger.ts";
import {
  buildPositions,
  buildTimeline,
  dailyReturns,
  indexOfDate,
  type Position,
  type Scope,
  type Timeline,
} from "../../shared/engine/timeline.ts";
import { extrasSchema, type Extras } from "../../shared/extras.ts";
import {
  accountInput,
  assetInput,
  firstIssue,
  goalInput,
  mortgageEventInput,
  mortgageInput,
  propertyInput,
  txInput,
  valuationInput,
} from "../../shared/schema.ts";
import { SOURCE_BY_ISIN } from "../../shared/types.ts";
import type { Account, AppState, Asset, Goal, Mortgage, MortgageEvent, Point, Property, PropertyValuation, Tx } from "../../shared/types.ts";
import { EMPTY_STATE, reduce, type AppInfo, type Backend, type Loaded, type Op } from "./backend.ts";
import { BENCH_KEY, exampleBenchmark, parseBenchmark, syncBenchmark } from "./benchmark.ts";
import { browserBackend } from "./browser.ts";
import { makeDemo } from "./demo.ts";
import { dueAssets, fxOn, indexaStatus, syncMarket, type SyncIssue, type SyncProgress } from "./market.ts";
import { buildSnapshot, mergeSnapshots, parseSnapshot, sealedDevice, snapshotBody, stampOf, type Snapshot } from "./sync.ts";
import { tauriBackend } from "./tauri.ts";

export const backend: Backend = "__TAURI_INTERNALS__" in window ? tauriBackend : browserBackend;

export type RangeKey = "1M" | "3M" | "6M" | "YTD" | "1A" | "3A" | "ALL";
export const RANGES: Array<[RangeKey, string]> = [
  ["1M", "1 M"],
  ["3M", "3 M"],
  ["6M", "6 M"],
  ["YTD", "Año"],
  ["1A", "1 A"],
  ["3A", "3 A"],
  ["ALL", "Todo"],
];

export type UpdateState = {
  /** idle: sin comprobar · current: comprobado, no hay nada · available: hay una · installing: descargándola. */
  status: "idle" | "checking" | "current" | "available" | "installing" | "error";
  version: string | null;
  notes: string;
  /** Porcentaje descargado mientras se instala. */
  progress: number;
  error: string | null;
  checkedAt: string | null;
  /** El aviso de esta versión se ha cerrado (sigue en Ajustes). */
  hidden: boolean;
};

type S = {
  status: "loading" | "ready" | "error";
  error: string | null;
  loaded: Loaded;
  /** Cartera de ejemplo en memoria; mientras está activa no se guarda nada. */
  demo: Loaded | null;
  /** Cuentas elegidas; null = todas. */
  scope: string[] | null;
  range: RangeKey;
  syncing: boolean;
  /** Qué activo se está actualizando y cuántos van, mientras dura la descarga. */
  progress: SyncProgress | null;
  /** Sincronización con otros equipos a través de una carpeta compartida. */
  devices: { busy: boolean; error: string | null; peers: Array<{ name: string; writtenAt: string }>; notes: string[] };
  /** Versión nueva de la app: si la hay, y cómo va su descarga. */
  update: UpdateState;
  /** Animación de arranque: completa si hay precios que actualizar, corta si están al día. */
  splash: { mode: "full" | "short"; phase: SplashPhase; from: number | null } | null;
  issues: SyncIssue[];
  info: AppInfo | null;
};

const saved = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

let s: S = {
  status: "loading",
  error: null,
  loaded: { state: EMPTY_STATE, meta: {} },
  demo: null,
  scope: null,
  range: saved<RangeKey>("numo.range", "1A"),
  syncing: false,
  progress: null,
  devices: { busy: false, error: null, peers: [], notes: [] },
  update: { status: "idle", version: null, notes: "", progress: 0, error: null, checkedAt: null, hidden: false },
  splash: null,
  issues: [],
  info: null,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<S>) => {
  s = { ...s, ...patch };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const getApp = () => s;
/** Sustituye lo cargado por lo que hay en disco (solo para la prueba de humo). */
export const setLoaded = (loaded: Loaded): void => set({ loaded });
export function useApp<T>(select: (state: S) => T): T {
  return useSyncExternalStore(subscribe, () => select(s));
}

const current = () => s.demo ?? s.loaded;
/** true cuando lo que se ve es la cartera de ejemplo. */
export const isExample = (state: S = s) => state.demo != null || !backend.native;

/**
 * Identificador aleatorio (UUID v4). No se usa crypto.randomUUID porque solo
 * existe en contextos seguros y la app empaquetada se sirve desde tauri://.
 */
function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

/** load: cargando · enter: la app entra · data: se descubren los datos · done: terminada. */
export type SplashPhase = "load" | "enter" | "data" | "done";
export function setSplashPhase(phase: SplashPhase): void {
  if (s.splash && s.splash.phase !== phase) set({ splash: { ...s.splash, phase } });
}

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Guarda los cambios y, solo si se han guardado, actualiza lo que se ve. */
async function commit(ops: Op[]): Promise<void> {
  if (!ops.length) return;
  if (s.demo) return set({ demo: reduce(s.demo, ops) });
  await backend.apply(ops);
  set({ loaded: reduce(s.loaded, ops) });
  // Lo que cambia el usuario se publica para sus otros equipos (lo que llega de ellos, no).
  if (!applyingRemote && ops.some((o) => stampOf(o, "") != null || o.op === "delPrice")) publishSoon();
}

async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(`No se pudo guardar: ${message(e)}`);
  }
}

// ── Arranque ───────────────────────────────────────────────────────────────

export async function boot(): Promise<void> {
  try {
    const [info, loaded] = await Promise.all([backend.info(), backend.load()]);
    // Con precios por actualizar, la carga se enseña entera; si la app se abrió hace poco, en corto.
    const visible = !info.smoke && !info.import;
    const stale = backend.native && dueAssets(loaded.state, loaded.meta).length > 0;
    const tl = derive(loaded.state, null).timeline;
    set({ status: "ready", info, loaded, splash: visible ? { mode: stale ? "full" : "short", phase: "load", from: tl.n ? tl.total[tl.n - 1]! : null } : null });
    // Primero lo de los otros equipos (puede traer activos nuevos) y después los precios.
    if (!info.smoke && !info.import) {
      void syncDevices().finally(() => sync(false));
      void checkUpdate();
    }
  } catch (e) {
    set({ status: "error", error: message(e) });
  }
}

export function setScope(scope: string[] | null): void {
  set({ scope: scope && scope.length ? scope : null });
}
export function setRange(range: RangeKey): void {
  localStorage.setItem("numo.range", JSON.stringify(range));
  set({ range });
}

export function setDemo(on: boolean): void {
  set({ demo: on ? { state: makeDemo(todayIso()), meta: {} } : null, scope: null, issues: [] });
}

// ── Mercado ────────────────────────────────────────────────────────────────

let running: Promise<void> | null = null;

/**
 * Actualiza precios y tipos de cambio. Nunca hay dos actualizaciones a la vez:
 * si ya hay una en marcha se espera a que termine (y, si se pidió forzada, se
 * lanza otra después para no quedarse con datos a medias).
 */
export function sync(force: boolean): Promise<void> {
  if (isExample()) return Promise.resolve();
  if (running) return force ? running.then(() => sync(true)) : running;
  running = doSync(force).finally(() => {
    running = null;
  });
  return running;
}

async function doSync(force: boolean): Promise<void> {
  set({ syncing: true });
  try {
    const { state, meta } = s.loaded;
    const { ops, issues } = await syncMarket(state, meta, backend.httpGet, force, (progress) => set({ progress }));
    await commit(ops);
    set({ issues });
  } catch (e) {
    set({ issues: [{ what: "Datos de mercado", message: message(e) }] });
  } finally {
    set({ syncing: false, progress: null });
  }
}

/** Actualización en segundo plano tras un cambio; no se lanza en los modos sin interfaz. */
export const syncSoon = () => {
  if (!s.info?.smoke && !s.info?.import) void sync(false);
};

/** Tipo de cambio del BCE para rellenar el formulario; lo guarda si hubo que descargarlo. */
export async function ecbRate(currency: string, date: string): Promise<{ rate: number; date: string } | null> {
  const hit = await fxOn(current().state, isExample() ? null : backend.httpGet, currency, date);
  if (!hit) return null;
  if (hit.ops.length) await commit(hit.ops).catch(() => {});
  return { rate: hit.rate, date: hit.date };
}

// ── Índice de referencia ───────────────────────────────────────────────────
// Sus cierres van en `meta` (no son precios de un activo ni se sincronizan) y se
// bajan en segundo plano cuando el gráfico los pide, como mucho una vez al día.

let benching = false;
let benchFailedAt = 0;

/** Descarga el índice si falta o es de otro día. No avisa de nada: si falla, el gráfico sale sin él. */
export function ensureBenchmark(): void {
  const { state, meta } = s.loaded;
  // Tras un fallo (sin red, la bolsa caída) no se insiste hasta pasados diez minutos.
  if (isExample() || benching || s.info?.smoke || s.info?.import || !state.txs.length || Date.now() - benchFailedAt < 600_000) return;
  const today = todayIso();
  const first = state.txs.reduce((m, t) => (t.date < m ? t.date : m), today);
  benching = true;
  syncBenchmark(meta, backend.httpGet, first, today)
    .then(commit)
    .catch(() => {
      benchFailedAt = Date.now();
    })
    .finally(() => {
      benching = false;
    });
}

/**
 * Cierres del índice para un gráfico que empieza en `from`, o null si (todavía) no
 * los hay. En la cartera de ejemplo son inventados y no se guardan en ningún sitio.
 */
export function useBenchmark(from: string | null): Point[] | null {
  const example = useApp((x) => isExample(x));
  const raw = useApp((x) => x.loaded.meta[BENCH_KEY]);
  return useMemo(() => (!from ? null : example ? exampleBenchmark(from, todayIso()) : (parseBenchmark(raw)?.points ?? null)), [example, raw, from]);
}

// ── Sincronización entre equipos ───────────────────────────────────────────
// Cada equipo deja en una carpeta compartida un archivo con sus registros; al
// sincronizar se leen los de los demás y gana el cambio más reciente de cada
// registro (ver sync.ts). La carpeta y el nombre del equipo son de cada equipo.

let applyingRemote = false;
let syncingDevices: Promise<Result<{ pulled: number; deleted: number } | null>> | null = null;
let publishTimer: ReturnType<typeof setTimeout> | undefined;
let lastFocusSync = 0;

export const syncFolder = (state: S = s): string | null => state.loaded.meta["sync:dir"] || null;
export function deviceOf(state: S = s): { id: string; name: string } | null {
  try {
    const d = JSON.parse(state.loaded.meta["sync:device"] ?? "null") as { id?: string; name?: string } | null;
    return d?.id ? { id: d.id, name: d.name ?? "" } : null;
  } catch {
    return null;
  }
}

/** Publica los cambios poco después de hacerlos, juntando los que van seguidos. */
function publishSoon(): void {
  if (!syncFolder()) return;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => void syncDevices(), 1500);
}
/** Al volver a la ventana se mira si otro equipo ha dejado algo (como mucho una vez por minuto). */
export function syncOnFocus(): void {
  if (!syncFolder() || Date.now() - lastFocusSync < 60_000) return;
  lastFocusSync = Date.now();
  void syncDevices();
}

/** Trae lo de los demás equipos y publica lo de este. Nunca hay dos a la vez. */
export function syncDevices(): Promise<Result<{ pulled: number; deleted: number } | null>> {
  if (syncingDevices) return syncingDevices;
  syncingDevices = doSyncDevices().finally(() => {
    syncingDevices = null;
  });
  return syncingDevices;
}

async function doSyncDevices(): Promise<Result<{ pulled: number; deleted: number } | null>> {
  const dir = syncFolder();
  const device = deviceOf();
  if (!backend.native || s.demo || !dir || !device) return ok(null);
  set({ devices: { ...s.devices, busy: true } });
  try {
    const files = await backend.syncRead(dir);
    const own = `${device.id}.json`;
    // Archivos de otros equipos que están cifrados y aquí no se pueden abrir.
    const sealed = syncSealed();
    const locked = files.filter((f) => f.locked && f.name !== own).map((f) => `«${sealedDevice(f.text)}»`);
    // Sin contraseña aquí no se publica nada: sería dejar en claro lo que el otro equipo cifra.
    if (locked.length && !sealed) throw new Error(`${locked.join(", ")} cifra sus archivos. Pon aquí la misma contraseña para sincronizar (Ajustes → Sincronización entre equipos → Cifrado).`);
    const remotes: Snapshot[] = [];
    for (const f of files) {
      if (f.name === own || f.locked) continue;
      const snap = parseSnapshot(f.text);
      if (snap) remotes.push(snap);
    }
    let stamps = await backend.stamps();
    const merge = mergeSnapshots(s.loaded.state, stamps, remotes);
    if (merge.ops.length) {
      // Antes de aplicar borrados o muchos cambios de golpe se guarda una copia.
      if (merge.deleted > 0 || merge.pulled > 25) await backend.backupNow("antes-de-sincronizar");
      applyingRemote = true;
      try {
        await commit(merge.ops);
      } finally {
        applyingRemote = false;
      }
      stamps = await backend.stamps();
    }
    // Solo se reescribe el archivo propio si su contenido ha cambiado, o si hay que cifrarlo o descifrarlo.
    const now = new Date().toISOString();
    const snapshot = buildSnapshot(s.loaded.state, stamps, device, now);
    const previous = files.find((f) => f.name === own);
    let same = false;
    try {
      same = !!previous && !previous.locked && !!previous.sealed === sealed && snapshotBody(JSON.parse(previous.text) as Snapshot) === snapshotBody(snapshot);
    } catch {
      same = false;
    }
    if (!same) await backend.syncWrite(dir, own, JSON.stringify(snapshot));
    await commit([{ op: "meta", key: "sync:last", value: now }]);
    set({ devices: { busy: false, error: null, peers: remotes.map((r) => ({ name: r.device.name || "Otro equipo", writtenAt: r.writtenAt })), notes: merge.skipped } });
    // Si han llegado activos nuevos, sus precios.
    if (merge.pulled) syncSoon();
    if (locked.length) throw new Error(`La contraseña de este equipo no abre los archivos de ${locked.join(", ")}: tiene que ser la misma en todos.`);
    return ok({ pulled: merge.pulled, deleted: merge.deleted });
  } catch (e) {
    set({ devices: { ...s.devices, busy: false, error: message(e) } });
    return fail(message(e));
  }
}

/** Elige la carpeta compartida y sincroniza por primera vez. Devuelve null si se cancela. */
export async function chooseSyncFolder(): Promise<Result<{ dir: string; pulled: number } | null>> {
  if (isExample()) return fail("La cartera de ejemplo no se sincroniza");
  try {
    const dir = await backend.syncPick();
    if (!dir) return ok(null);
    const device = deviceOf() ?? { id: newId(), name: /Mac/i.test(navigator.platform) ? "Mac" : /Win/i.test(navigator.platform) ? "PC con Windows" : "Equipo" };
    await commit([
      { op: "meta", key: "sync:dir", value: dir },
      { op: "meta", key: "sync:device", value: JSON.stringify(device) },
    ]);
    const res = await syncDevices();
    if (!res.ok) return fail(res.error);
    return ok({ dir, pulled: res.value?.pulled ?? 0 });
  } catch (e) {
    return fail(message(e));
  }
}

/** true si este equipo cifra lo que deja en la carpeta compartida. */
export const syncSealed = (state: S = s): boolean => !!state.loaded.meta["connected:sync"];

/**
 * Pone, cambia o quita (con cadena vacía) la contraseña que cifra los archivos de
 * la carpeta compartida, y vuelve a publicar el de este equipo. Como las demás
 * claves, no se queda en la interfaz: la usa el núcleo nativo al leer y escribir.
 */
export async function setSyncPassword(password: string): Promise<Result<{ pulled: number; deleted: number } | null>> {
  if (isExample()) return fail("La cartera de ejemplo no se sincroniza");
  if (password && password.length < 8) return fail("La contraseña debe tener al menos 8 caracteres");
  try {
    await backend.apply([{ op: "meta", key: "secret:sync", value: password }]);
    set({ loaded: { ...s.loaded, meta: { ...s.loaded.meta, "connected:sync": password ? "1" : "" } } });
  } catch (e) {
    return fail(`No se pudo guardar: ${message(e)}`);
  }
  return syncDevices();
}

/** Deja de sincronizar este equipo. No borra nada: ni aquí ni en la carpeta. */
export const stopSync = (): Promise<Result> =>
  attempt(async () => {
    await commit([{ op: "meta", key: "sync:dir", value: "" }]);
    set({ devices: { busy: false, error: null, peers: [], notes: [] } });
  });

export function renameDevice(name: string): Promise<Result> {
  const device = deviceOf();
  if (!device || !name.trim()) return Promise.resolve(fail("Pon un nombre al equipo"));
  return attempt(async () => {
    await commit([{ op: "meta", key: "sync:device", value: JSON.stringify({ ...device, name: name.trim() }) }]);
    void syncDevices();
  });
}

// ── Actualización de la app ────────────────────────────────────────────────
// La app pregunta a GitHub si hay una versión más nueva: al abrir, al volver a la
// ventana (como mucho cada seis horas) y cuando se pide en Ajustes. Instalarla es
// siempre decisión del usuario: se descarga, se comprueba su firma y la app se reinicia.

const UPDATE_EVERY_MS = 6 * 3600_000;

/** Busca una versión nueva. Con `manual`, un fallo se enseña; si no, se calla (puede no haber red). */
export async function checkUpdate(manual = false): Promise<void> {
  if (s.update.status === "checking" || s.update.status === "installing") return;
  const before = s.update;
  set({ update: { ...before, status: "checking", error: null } });
  const checkedAt = new Date().toISOString();
  try {
    const found = await backend.checkUpdate();
    if (found) set({ update: { ...before, status: "available", version: found.version, notes: found.notes, error: null, checkedAt, hidden: before.hidden && before.version === found.version } });
    else set({ update: { ...before, status: "current", version: null, notes: "", error: null, checkedAt } });
  } catch (e) {
    set({ update: manual ? { ...before, status: "error", error: message(e), checkedAt } : { ...before, status: before.status === "checking" ? "idle" : before.status } });
  }
}

/** Al volver a la ventana se vuelve a mirar, si la última vez fue hace rato. */
export function updateOnFocus(): void {
  const last = s.update.checkedAt ? Date.parse(s.update.checkedAt) : 0;
  if (!s.info?.smoke && !s.info?.import && Date.now() - last > UPDATE_EVERY_MS) void checkUpdate();
}

/** Descarga e instala la versión nueva. Si todo va bien la app se reinicia y esto no vuelve. */
export async function installUpdate(): Promise<void> {
  if (s.update.status !== "available" && s.update.status !== "error") return;
  const target = s.update;
  set({ update: { ...target, status: "installing", progress: 0, error: null, hidden: false } });
  try {
    await backend.installUpdate((progress) => set({ update: { ...s.update, progress } }));
  } catch (e) {
    set({ update: { ...target, status: "error", error: message(e), hidden: false } });
  }
}

export const hideUpdate = (): void => set({ update: { ...s.update, hidden: true } });

// ── Conexiones (claves de servicios) ───────────────────────────────────────

export type Service = "indexa";
const serviceStatus = (_name: Service) => indexaStatus(backend.httpGet);

/** Estado de una conexión ya guardada, preguntando al servicio. */
export const connectionStatus = (name: Service): Promise<Result<string>> =>
  serviceStatus(name).then(ok, (e) => fail(/40[13]/.test(message(e)) ? "El servicio rechaza la clave" : message(e)));

/**
 * Guarda (o quita, con cadena vacía) la clave de un servicio. Se comprueba al
 * guardar y, si no vale, no se conserva. La clave no se queda en la interfaz:
 * el núcleo nativo la añade a cada petición.
 */
export async function saveSecret(name: Service, value: string): Promise<Result<string>> {
  if (isExample()) return fail("La cartera de ejemplo no guarda claves");
  const put = async (v: string) => {
    await backend.apply([{ op: "meta", key: `secret:${name}`, value: v }]);
    set({ loaded: { ...s.loaded, meta: { ...s.loaded.meta, [`connected:${name}`]: v ? "1" : "" } } });
  };
  try {
    await put(value.trim());
    if (!value.trim()) return ok("");
    const status = await serviceStatus(name);
    syncSoon();
    return ok(status);
  } catch (e) {
    await put("").catch(() => {});
    return fail(/40[13]/.test(message(e)) ? "El servicio rechaza esa clave; no se ha guardado" : `No se pudo comprobar la clave: ${message(e)}`);
  }
}

// ── Cuentas ────────────────────────────────────────────────────────────────

export function saveAccount(input: unknown, id?: string): Promise<Result<Account>> {
  const parsed = accountInput.safeParse(input);
  if (!parsed.success) return Promise.resolve(fail(firstIssue(parsed.error)));
  const { accounts } = current().state;
  const before = id ? accounts.find((a) => a.id === id) : undefined;
  if (id && !before) return Promise.resolve(fail("La cuenta ya no existe"));
  if (accounts.some((a) => a.id !== id && accountKey(a.name) === accountKey(parsed.data.name)))
    return Promise.resolve(fail("Ya hay una cuenta con ese nombre"));
  // El color se asigna una vez y acompaña a la cuenta para siempre.
  const used = new Set(accounts.map((a) => a.color));
  const color = before?.color ?? [1, 2, 3, 4, 5, 6, 7, 8].find((c) => !used.has(c)) ?? 0;
  const row: Account = {
    ...parsed.data,
    id: id ?? newId(),
    color,
    createdAt: before?.createdAt ?? new Date().toISOString(),
  };
  return attempt(async () => {
    await commit([{ op: "putAccount", row }]);
    return row;
  });
}

export function removeAccount(id: string): Promise<Result> {
  return attempt(async () => {
    await commit([{ op: "delAccount", id }]);
    if (s.scope?.includes(id)) setScope(s.scope.filter((x) => x !== id));
  });
}

// ── Activos ────────────────────────────────────────────────────────────────

export function saveAsset(input: unknown, id?: string): Promise<Result<Asset>> {
  const parsed = assetInput.safeParse(input);
  if (!parsed.success) return Promise.resolve(fail(firstIssue(parsed.error)));
  const before = id ? current().state.assets.find((a) => a.id === id) : undefined;
  if (id && !before) return Promise.resolve(fail("El activo ya no existe"));
  const d = parsed.data;
  const raw = (input ?? {}) as Record<string, unknown>;
  const row: Asset = {
    ...d,
    // El formulario de activo no toca el plan: se conserva lo que hubiera.
    goalId: "goalId" in raw ? d.goalId : (before?.goalId ?? null),
    planExcluded: "planExcluded" in raw ? d.planExcluded : (before?.planExcluded ?? false),
    symbol: d.symbol || null,
    isin: d.isin || null,
    // Cada fuente necesita su dato: unas el ISIN, otras su código. Sin él, manual.
    priceSource: d.priceSource === "manual" || d.priceSource === "indexa" ? d.priceSource : (SOURCE_BY_ISIN[d.priceSource] ? d.isin : d.symbol) ? d.priceSource : "manual",
    id: id ?? newId(),
    createdAt: before?.createdAt ?? new Date().toISOString(),
  };
  const ops: Op[] = [{ op: "putAsset", row }];
  if (before && row.priceSource !== "manual") {
    const code = (a: Asset) => (SOURCE_BY_ISIN[a.priceSource] ? a.isin : a.symbol) ?? "";
    const moved = before.priceSource !== row.priceSource;
    // Corregir el código dentro de la misma fuente, o cambiar la divisa, invalida lo guardado.
    // Cambiar de fuente no: el histórico sigue valiendo y la nueva lo continúa.
    if (before.currency !== row.currency || (!moved && code(before) !== code(row))) {
      ops.push({ op: "prices", assetId: row.id, points: [], replace: true });
      ops.push({ op: "splits", assetId: row.id, points: [] });
    }
    if (moved || before.currency !== row.currency || code(before) !== code(row)) {
      ops.push({ op: "meta", key: `fetched:asset:${row.id}`, value: "" });
      ops.push({ op: "meta", key: `failed:asset:${row.id}`, value: "" });
    }
  }
  return attempt(async () => {
    await commit(ops);
    return row;
  });
}

export function removeAsset(id: string): Promise<Result> {
  const n = current().state.txs.filter((t) => t.assetId === id || t.toAssetId === id).length;
  if (n) return Promise.resolve(fail(`El activo aparece en ${n} operaciones. Bórralas antes.`));
  return attempt(() => commit([{ op: "delAsset", id }]));
}

export function setPrice(assetId: string, date: string, close: number | null): Promise<Result> {
  return attempt(() =>
    commit([
      close == null
        ? { op: "delPrice", assetId, date }
        : { op: "prices", assetId, points: [[date, close]] },
    ]),
  );
}

// ── Operaciones ────────────────────────────────────────────────────────────

function checkTx(t: ReturnType<typeof txInput.parse>, state: AppState): string | null {
  const account = state.accounts.find((a) => a.id === t.accountId);
  if (!account) return "La cuenta no existe";
  if (t.assetId && !state.assets.some((a) => a.id === t.assetId)) return "El activo no existe";
  if (t.toAccountId && !state.accounts.some((a) => a.id === t.toAccountId)) return "La cuenta de destino no existe";
  if (t.toAssetId && !state.assets.some((a) => a.id === t.toAssetId)) return "El activo de destino no existe";
  if ((t.type === "deposit" || t.type === "withdrawal") && !account.trackCash)
    return `«${account.name}» no lleva efectivo. Actívalo en la cuenta para registrar ingresos y retiradas.`;
  if (t.type === "transfer" && (t.toAccountId ?? t.accountId) === t.accountId && (t.toAssetId ?? t.assetId) === t.assetId)
    return "El traspaso tiene el mismo origen y destino";
  return null;
}

export function saveTx(input: unknown, id?: string): Promise<Result<Tx>> {
  const parsed = txInput.safeParse(input);
  if (!parsed.success) return Promise.resolve(fail(firstIssue(parsed.error)));
  const state = current().state;
  const problem = checkTx(parsed.data, state);
  if (problem) return Promise.resolve(fail(problem));
  const before = id ? state.txs.find((t) => t.id === id) : undefined;
  if (id && !before) return Promise.resolve(fail("La operación ya no existe"));
  const row: Tx = {
    ...parsed.data,
    id: id ?? newId(),
    createdAt: before?.createdAt ?? new Date().toISOString(),
  };
  return attempt(async () => {
    await commit([{ op: "putTx", row }]);
    syncSoon();
    return row;
  });
}

/** Borra y devuelve la operación para poder deshacerlo. */
export function removeTx(id: string): Promise<Result<Tx | null>> {
  const tx = current().state.txs.find((t) => t.id === id) ?? null;
  return attempt(async () => {
    await commit([{ op: "delTx", id }]);
    return tx;
  });
}

export const restoreTx = (tx: Tx): Promise<Result> => attempt(() => commit([{ op: "putTx", row: tx }]));

/** Importa un CSV ya analizado. Todo o nada: un error en una línea no guarda ninguna. */
export async function importPlan(plan: ImportPlan): Promise<Result<number>> {
  const state = current().state;
  const ops: Op[] = [];
  const now = Date.now();

  const accounts = new Map(state.accounts.map((a) => [accountKey(a.name), a]));
  const used = new Set(state.accounts.map((a) => a.color));
  for (const a of plan.newAccounts) {
    const color = [1, 2, 3, 4, 5, 6, 7, 8].find((c) => !used.has(c)) ?? 0;
    used.add(color);
    const row: Account = { ...a, id: newId(), color, createdAt: new Date(now).toISOString() };
    accounts.set(accountKey(a.name), row);
    ops.push({ op: "putAccount", row });
  }

  const assets = new Map<string, string>();
  const index = (a: Asset) => {
    if (a.isin) assets.set(`isin:${a.isin.toUpperCase()}`, a.id);
    if (a.symbol) assets.set(`sym:${a.symbol.toUpperCase()}`, a.id);
    assets.set(assetKey({ name: a.name }), a.id);
  };
  state.assets.forEach(index);
  for (const { key, ...a } of plan.newAssets) {
    const row: Asset = { ...a, id: newId(), createdAt: new Date(now).toISOString() };
    index(row);
    assets.set(key, row.id);
    ops.push({ op: "putAsset", row });
  }
  const assetId = (ref: { isin: string; symbol: string; name: string } | null) =>
    ref ? (assets.get(assetKey(ref)) ?? assets.get(assetKey({ name: ref.name })) ?? null) : null;

  const draft = reduce({ state, meta: {} }, ops).state;
  const rates = new Map<string, number>();
  let n = 0;
  for (const r of plan.rows) {
    let fxRate = r.currency === "EUR" ? 1 : r.fxRate;
    if (fxRate == null) {
      const k = `${r.currency}|${r.date}`;
      if (!rates.has(k)) {
        const hit = await fxOn(draft, isExample() ? null : backend.httpGet, r.currency, r.date);
        if (!hit) return fail(`Línea ${r.line}: falta el cambio de ${r.currency} y el BCE no lo publica`);
        rates.set(k, hit.rate);
        ops.push(...hit.ops);
      }
      fxRate = rates.get(k)!;
    }
    const parsed = txInput.safeParse({
      date: r.date,
      type: r.type,
      accountId: accounts.get(accountKey(r.account))?.id ?? "",
      assetId: assetId(r.asset),
      quantity: r.quantity,
      price: r.price,
      amount: r.amount,
      currency: r.currency,
      fxRate,
      fee: r.fee,
      feeCurrency: r.feeCurrency,
      taxSource: r.taxSource,
      taxHome: r.taxHome,
      toAccountId: r.toAccount ? (accounts.get(accountKey(r.toAccount))?.id ?? null) : null,
      toAssetId: assetId(r.toAsset),
      toQuantity: r.toQuantity,
      note: r.note,
    });
    if (!parsed.success) return fail(`Línea ${r.line}: ${firstIssue(parsed.error)}`);
    const problem = checkTx(parsed.data, draft);
    if (problem) return fail(`Línea ${r.line}: ${problem}`);
    // createdAt creciente: conserva el orden del archivo dentro de un mismo día.
    ops.push({
      op: "putTx",
      row: { ...parsed.data, id: newId(), createdAt: new Date(now + n++).toISOString() },
    });
  }
  // Quien importa decide cuándo actualizar precios (normalmente al terminar todos los archivos).
  return attempt(async () => {
    await commit(ops);
    return n;
  });
}

/** Importa precios históricos o splits ya emparejados con sus activos. */
export function importSeries(kind: "prices" | "splits", byAsset: Map<string, Point[]>): Promise<Result<number>> {
  const { splits } = current().state;
  const ops: Op[] = [];
  let n = 0;
  for (const [assetId, points] of byAsset) {
    n += points.length;
    if (kind === "prices") ops.push({ op: "prices", assetId, points });
    else {
      const merged = new Map([...(splits[assetId] ?? []), ...points]);
      ops.push({ op: "splits", assetId, points: [...merged.entries()].sort((a, b) => a[0].localeCompare(b[0])) });
    }
  }
  return attempt(async () => {
    await commit(ops);
    return n;
  });
}

// ── Plan ───────────────────────────────────────────────────────────────────

export function saveGoal(input: unknown, id?: string): Promise<Result<Goal>> {
  const parsed = goalInput.safeParse(input);
  if (!parsed.success) return Promise.resolve(fail(firstIssue(parsed.error)));
  const { goals } = current().state;
  const before = id ? goals.find((g) => g.id === id) : undefined;
  if (id && !before) return Promise.resolve(fail("El bloque ya no existe"));
  if (goals.some((g) => g.id !== id && g.name.trim().toLowerCase() === parsed.data.name.toLowerCase()))
    return Promise.resolve(fail("Ya hay un bloque con ese nombre"));
  const used = new Set(goals.map((g) => g.color));
  const row: Goal = {
    ...parsed.data,
    id: id ?? newId(),
    color: before?.color ?? [1, 2, 3, 4, 5, 6, 7, 8].find((c) => !used.has(c)) ?? 0,
    sortOrder: before?.sortOrder ?? goals.reduce((m, g) => Math.max(m, g.sortOrder), -1) + 1,
    createdAt: before?.createdAt ?? new Date().toISOString(),
  };
  return attempt(async () => {
    await commit([{ op: "putGoal", row }]);
    return row;
  });
}

export const removeGoal = (id: string): Promise<Result> => attempt(() => commit([{ op: "delGoal", id }]));

/** Asigna un activo a un bloque, lo deja sin asignar (null) o lo saca del plan. */
export function assignAsset(assetId: string, goalId: string | null, planExcluded: boolean): Promise<Result> {
  const asset = current().state.assets.find((a) => a.id === assetId);
  if (!asset) return Promise.resolve(fail("El activo ya no existe"));
  return attempt(() => commit([{ op: "putAsset", row: { ...asset, goalId: planExcluded ? null : goalId, planExcluded } }]));
}

// ── Inmuebles ──────────────────────────────────────────────────────────────

/**
 * Guarda el inmueble y su hipoteca en un solo paso. `mortgage: null` significa
 * sin hipoteca (y borra la que hubiera, con sus eventos).
 */
export function saveProperty(input: unknown, mortgage: unknown | null, id?: string): Promise<Result<Property>> {
  const parsed = propertyInput.safeParse(input);
  if (!parsed.success) return Promise.resolve(fail(firstIssue(parsed.error)));
  const state = current().state;
  const before = id ? state.properties.find((p) => p.id === id) : undefined;
  if (id && !before) return Promise.resolve(fail("El inmueble ya no existe"));
  const row: Property = { ...parsed.data, id: id ?? newId(), createdAt: before?.createdAt ?? new Date().toISOString() };
  const ops: Op[] = [{ op: "putProperty", row }];
  const existing = state.mortgages.find((m) => m.propertyId === row.id);
  if (mortgage == null) {
    if (existing) ops.push({ op: "delMortgage", id: existing.id });
  } else {
    const m = mortgageInput.safeParse(mortgage);
    if (!m.success) return Promise.resolve(fail(firstIssue(m.error)));
    if (m.data.principal > row.purchasePrice * 1.5) return Promise.resolve(fail("El capital de la hipoteca es mucho mayor que el precio de compra: revisa las cifras"));
    const mrow: Mortgage = { ...m.data, id: existing?.id ?? newId(), propertyId: row.id, createdAt: existing?.createdAt ?? new Date().toISOString() };
    ops.push({ op: "putMortgage", row: mrow });
  }
  return attempt(async () => {
    await commit(ops);
    return row;
  });
}

export const removeProperty = (id: string): Promise<Result> => attempt(() => commit([{ op: "delProperty", id }]));

export function saveMortgageEvent(mortgageId: string, input: unknown, id?: string): Promise<Result<MortgageEvent>> {
  const parsed = mortgageEventInput.safeParse(input);
  if (!parsed.success) return Promise.resolve(fail(firstIssue(parsed.error)));
  const state = current().state;
  const mortgage = state.mortgages.find((m) => m.id === mortgageId);
  if (!mortgage) return Promise.resolve(fail("La hipoteca ya no existe"));
  if (parsed.data.date < mortgage.firstPaymentDate && parsed.data.type !== "rate_change")
    return Promise.resolve(fail("La fecha es anterior a la primera cuota"));
  const before = id ? state.mortgageEvents.find((e) => e.id === id) : undefined;
  const row: MortgageEvent = { ...parsed.data, id: id ?? newId(), mortgageId, createdAt: before?.createdAt ?? new Date().toISOString() };
  return attempt(async () => {
    await commit([{ op: "putMortgageEvent", row }]);
    return row;
  });
}
export const removeMortgageEvent = (id: string): Promise<Result> => attempt(() => commit([{ op: "delMortgageEvent", id }]));

export function saveValuation(propertyId: string, input: unknown, id?: string): Promise<Result<PropertyValuation>> {
  const parsed = valuationInput.safeParse(input);
  if (!parsed.success) return Promise.resolve(fail(firstIssue(parsed.error)));
  const state = current().state;
  if (!state.properties.some((p) => p.id === propertyId)) return Promise.resolve(fail("El inmueble ya no existe"));
  // Una valoración por fecha: guardar otra el mismo día la sustituye.
  const same = state.valuations.find((v) => v.propertyId === propertyId && v.date === parsed.data.date);
  const row: PropertyValuation = { ...parsed.data, id: id ?? same?.id ?? newId(), propertyId };
  return attempt(async () => {
    await commit([{ op: "putValuation", row }]);
    return row;
  });
}
export const removeValuation = (id: string): Promise<Result> => attempt(() => commit([{ op: "delValuation", id }]));

/** Importa el plan y los inmuebles desde un JSON de extras. No duplica lo que ya exista por nombre. */
export function importExtras(json: unknown): Promise<Result<{ goals: number; assigned: number; properties: number; unmatched: string[] }>> {
  const parsed = extrasSchema.safeParse(json);
  if (!parsed.success) return Promise.resolve(fail(`El archivo de extras no es válido: ${firstIssue(parsed.error)}`));
  const x: Extras = parsed.data;
  const state = current().state;
  const ops: Op[] = [];
  const now = new Date().toISOString();
  const fold = (t: string) => t.trim().toLowerCase();

  const goalIds = new Map(state.goals.map((g) => [fold(g.name), g.id]));
  const used = new Set(state.goals.map((g) => g.color));
  let goals = 0;
  x.objetivos.forEach((o, i) => {
    if (goalIds.has(fold(o.nombre))) return;
    const color = [1, 2, 3, 4, 5, 6, 7, 8].find((c) => !used.has(c)) ?? 0;
    used.add(color);
    const row: Goal = { id: newId(), name: o.nombre.trim(), targetPct: o.objetivoPct, color, sortOrder: o.orden ?? state.goals.length + i, createdAt: now };
    goalIds.set(fold(o.nombre), row.id);
    ops.push({ op: "putGoal", row });
    goals++;
  });

  const byKey = new Map<string, Asset>();
  for (const a of state.assets) {
    if (a.isin) byKey.set(`isin:${a.isin.toUpperCase()}`, a);
    if (a.symbol) byKey.set(`sym:${a.symbol.toUpperCase()}`, a);
    byKey.set(`name:${accountKey(a.name)}`, a);
  }
  const unmatched: string[] = [];
  let assigned = 0;
  for (const a of x.asignaciones) {
    const asset =
      (a.isin && byKey.get(`isin:${a.isin.toUpperCase()}`)) || (a.simbolo && byKey.get(`sym:${a.simbolo.toUpperCase()}`)) || (a.activo && byKey.get(`name:${accountKey(a.activo)}`)) || null;
    if (!asset) {
      unmatched.push(a.activo || a.isin || a.simbolo);
      continue;
    }
    const goalId = a.objetivo ? (goalIds.get(fold(a.objetivo)) ?? null) : null;
    ops.push({ op: "putAsset", row: { ...asset, goalId: a.excluido ? null : goalId, planExcluded: a.excluido } });
    assigned++;
  }

  let properties = 0;
  for (const p of x.inmuebles) {
    if (state.properties.some((q) => fold(q.name) === fold(p.nombre))) continue;
    const prop: Property = { id: newId(), name: p.nombre.trim(), address: p.direccion, purchaseDate: p.fechaCompra, purchasePrice: p.precio, purchaseCosts: p.gastos, note: p.nota, createdAt: now };
    ops.push({ op: "putProperty", row: prop });
    properties++;
    if (p.hipoteca) {
      const h = p.hipoteca;
      const m: Mortgage = { id: newId(), propertyId: prop.id, lender: h.entidad, principal: h.principal, rateType: h.tipo, ratePct: h.tin, termMonths: h.plazoMeses, firstPaymentDate: h.primeraCuota, createdAt: now };
      ops.push({ op: "putMortgage", row: m });
      for (const e of h.eventos) {
        ops.push({ op: "putMortgageEvent", row: { id: newId(), mortgageId: m.id, date: e.fecha, type: e.tipo, amount: e.importe, mode: e.modo, ratePct: e.tin, note: e.nota, createdAt: now } });
      }
    }
    for (const v of p.valoraciones) ops.push({ op: "putValuation", row: { id: newId(), propertyId: prop.id, date: v.fecha, value: v.valor, note: v.nota } });
  }

  return attempt(async () => {
    await commit(ops);
    return { goals, assigned, properties, unmatched };
  });
}

// ── Datos derivados ────────────────────────────────────────────────────────

export type Derived = {
  state: AppState;
  today: string;
  scope: Scope;
  ledger: Ledger;
  timeline: Timeline;
  returns: Float64Array;
  positions: Position[];
  accounts: Map<string, Account>;
  assets: Map<string, Asset>;
};

let ledgerCache: { state: AppState; ledger: Ledger } | null = null;
let derivedCache: { key: string; ledger: Ledger; value: Derived } | null = null;

/** Todo lo que se calcula a partir de los datos, recalculado solo cuando cambian. */
export function derive(state: AppState, scopeIds: string[] | null): Derived {
  const today = todayIso();
  if (ledgerCache?.state !== state) ledgerCache = { state, ledger: buildLedger(state) };
  const { ledger } = ledgerCache;
  const key = `${today}|${scopeIds ? [...scopeIds].sort().join(",") : "*"}`;
  if (derivedCache?.ledger === ledger && derivedCache.key === key) return derivedCache.value;
  const scope: Scope = scopeIds ? new Set(scopeIds) : null;
  const timeline = buildTimeline(ledger, state, scope, today);
  const value: Derived = {
    state,
    today,
    scope,
    ledger,
    timeline,
    returns: dailyReturns(timeline),
    positions: buildPositions(ledger, state, scope, today),
    accounts: new Map(state.accounts.map((a) => [a.id, a])),
    assets: new Map(state.assets.map((a) => [a.id, a])),
  };
  derivedCache = { key, ledger, value };
  return value;
}

/** Estado del precio de cada activo (de qué día es y si se está actualizando) y de las divisas. */
export function useHealth(): { byAsset: Map<string, PriceHealth>; attention: number; fxLate: number } {
  const loaded = useApp((x) => x.demo ?? x.loaded);
  return useMemo(() => {
    const today = todayIso();
    const { state, meta } = loaded;
    const byAsset = new Map<string, PriceHealth>();
    let attention = 0;
    for (const a of state.assets) {
      const h = priceHealth(a, state.prices[a.id], meta[`fetched:asset:${a.id}`] || null, parseFailure(meta[`failed:asset:${a.id}`]), today);
      byAsset.set(a.id, h);
      if (needsAttention(h)) attention++;
    }
    const currencies = new Set([...state.assets, ...state.accounts].map((x) => x.currency));
    currencies.delete("EUR");
    const fxLate = [...currencies].filter((c) => fxHealth(state.fx[c], today).late).length;
    return { byAsset, attention, fxLate };
  }, [loaded]);
}

export function useDerived(): Derived {
  const state = useApp((x) => (x.demo ?? x.loaded).state);
  const scope = useApp((x) => x.scope);
  return derive(state, scope);
}

/** Índice del día base del rango en la serie (-1 = desde el principio) y fecha de inicio. */
export function rangeBase(range: RangeKey, tl: Timeline, today: string): { from: number; fromDate: string | null } {
  let date: string | null;
  switch (range) {
    case "1M":
      date = addMonths(today, -1);
      break;
    case "3M":
      date = addMonths(today, -3);
      break;
    case "6M":
      date = addMonths(today, -6);
      break;
    case "YTD":
      date = `${+today.slice(0, 4) - 1}-12-31`;
      break;
    case "1A":
      date = addMonths(today, -12);
      break;
    case "3A":
      date = addMonths(today, -36);
      break;
    default:
      date = null;
  }
  if (!date || tl.n === 0) return { from: -1, fromDate: null };
  const from = indexOfDate(tl, date);
  return { from, fromDate: from < 0 ? null : date };
}
