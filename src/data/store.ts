import { useSyncExternalStore } from "react";
import { accountKey, assetKey, type ImportPlan } from "../../shared/csv.ts";
import { addMonths, todayIso } from "../../shared/dates.ts";
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
import type { Account, AppState, Asset, Goal, Mortgage, MortgageEvent, Point, Property, PropertyValuation, Tx } from "../../shared/types.ts";
import { EMPTY_STATE, reduce, type AppInfo, type Backend, type Loaded, type Op } from "./backend.ts";
import { browserBackend } from "./browser.ts";
import { makeDemo } from "./demo.ts";
import { fxOn, syncMarket, type SyncIssue } from "./market.ts";
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
  range: saved<RangeKey>("caudal.range", "1A"),
  syncing: false,
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
    set({ status: "ready", info, loaded });
    if (!info.smoke) void sync(false);
  } catch (e) {
    set({ status: "error", error: message(e) });
  }
}

export function setScope(scope: string[] | null): void {
  set({ scope: scope && scope.length ? scope : null });
}
export function setRange(range: RangeKey): void {
  localStorage.setItem("caudal.range", JSON.stringify(range));
  set({ range });
}

export function setDemo(on: boolean): void {
  set({ demo: on ? { state: makeDemo(todayIso()), meta: {} } : null, scope: null, issues: [] });
}

// ── Mercado ────────────────────────────────────────────────────────────────

export async function sync(force: boolean): Promise<void> {
  if (s.syncing || isExample()) return;
  set({ syncing: true });
  try {
    const { state, meta } = s.loaded;
    const { ops, issues } = await syncMarket(state, meta, backend.httpGet, force);
    await commit(ops);
    set({ issues });
  } catch (e) {
    set({ issues: [{ what: "Datos de mercado", message: message(e) }] });
  } finally {
    set({ syncing: false });
  }
}

/** Tipo de cambio del BCE para rellenar el formulario; lo guarda si hubo que descargarlo. */
export async function ecbRate(currency: string, date: string): Promise<{ rate: number; date: string } | null> {
  const hit = await fxOn(current().state, isExample() ? null : backend.httpGet, currency, date);
  if (!hit) return null;
  if (hit.ops.length) await commit(hit.ops).catch(() => {});
  return { rate: hit.rate, date: hit.date };
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
    priceSource: d.symbol ? d.priceSource : "manual",
    id: id ?? newId(),
    createdAt: before?.createdAt ?? new Date().toISOString(),
  };
  const ops: Op[] = [{ op: "putAsset", row }];
  // Si cambia de dónde sale el precio, las cotizaciones guardadas ya no valen.
  if (before && (before.symbol !== row.symbol || before.currency !== row.currency || before.priceSource !== row.priceSource)) {
    ops.push({ op: "prices", assetId: row.id, points: [], replace: true });
    ops.push({ op: "splits", assetId: row.id, points: [] });
    ops.push({ op: "meta", key: `fetched:asset:${row.id}`, value: "" });
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
    void sync(false);
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
  return attempt(async () => {
    await commit(ops);
    void sync(false);
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
    color: before?.color ?? [1, 2, 3, 4, 5, 6].find((c) => !used.has(c)) ?? (goals.length % 6) + 1,
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
    const color = [1, 2, 3, 4, 5, 6].find((c) => !used.has(c)) ?? ((state.goals.length + i) % 6) + 1;
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
