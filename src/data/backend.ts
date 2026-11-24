import type { Account, AppState, Asset, Point, Tx } from "../../shared/types.ts";

/**
 * Un cambio sobre los datos guardados. La interfaz nunca escribe SQL: describe
 * cambios, el mismo reductor los aplica al estado en memoria y el backend nativo
 * los traduce a una única transacción de SQLite.
 */
export type Op =
  | { op: "putAccount"; row: Account }
  /** Borra la cuenta y todas sus operaciones. */
  | { op: "delAccount"; id: string }
  | { op: "putAsset"; row: Asset }
  | { op: "delAsset"; id: string }
  | { op: "putTx"; row: Tx }
  | { op: "delTx"; id: string }
  /** Con `replace` se sustituye el histórico entero del activo. */
  | { op: "prices"; assetId: string; points: Point[]; replace?: boolean }
  | { op: "delPrice"; assetId: string; date: string }
  | { op: "splits"; assetId: string; points: Point[] }
  | { op: "fx"; currency: string; points: Point[] }
  | { op: "meta"; key: string; value: string };

export type Meta = Record<string, string>;
export type Loaded = { state: AppState; meta: Meta };
export type AppInfo = { version: string; dbPath: string; smoke: boolean };

export interface Backend {
  /** true dentro de la app de escritorio; false en la vista previa del navegador. */
  readonly native: boolean;
  load(): Promise<Loaded>;
  apply(ops: Op[]): Promise<void>;
  httpGet(url: string): Promise<string>;
  /** Devuelve dónde se guardó, o null si el usuario canceló. */
  saveFile(name: string, data: string | Uint8Array): Promise<string | null>;
  exportBackup(name: string): Promise<string | null>;
  info(): Promise<AppInfo>;
}

const mergePoints = (cur: Point[] | undefined, add: Point[]): Point[] => {
  if (!cur?.length) return [...add].sort((a, b) => a[0].localeCompare(b[0]));
  const m = new Map(cur);
  for (const [d, v] of add) m.set(d, v);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};

const upsert = <T extends { id: string }>(list: T[], row: T): T[] =>
  list.some((x) => x.id === row.id) ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row];

const without = <T>(rec: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _drop, ...rest } = rec;
  return rest;
};

/** Aplica los cambios al estado en memoria. Puro: devuelve objetos nuevos. */
export function reduce(loaded: Loaded, ops: Op[]): Loaded {
  let { state, meta } = loaded;
  for (const o of ops) {
    switch (o.op) {
      case "putAccount":
        state = { ...state, accounts: upsert(state.accounts, o.row) };
        break;
      case "delAccount":
        state = {
          ...state,
          accounts: state.accounts.filter((a) => a.id !== o.id),
          txs: state.txs.filter((t) => t.accountId !== o.id && t.toAccountId !== o.id),
        };
        break;
      case "putAsset":
        state = { ...state, assets: upsert(state.assets, o.row) };
        break;
      case "delAsset":
        state = {
          ...state,
          assets: state.assets.filter((a) => a.id !== o.id),
          prices: without(state.prices, o.id),
          splits: without(state.splits, o.id),
        };
        break;
      case "putTx":
        state = { ...state, txs: upsert(state.txs, o.row) };
        break;
      case "delTx":
        state = { ...state, txs: state.txs.filter((t) => t.id !== o.id) };
        break;
      case "prices":
        state = {
          ...state,
          prices: {
            ...state.prices,
            [o.assetId]: mergePoints(o.replace ? [] : state.prices[o.assetId], o.points),
          },
        };
        break;
      case "delPrice":
        state = {
          ...state,
          prices: {
            ...state.prices,
            [o.assetId]: (state.prices[o.assetId] ?? []).filter(([d]) => d !== o.date),
          },
        };
        break;
      case "splits":
        state = { ...state, splits: { ...state.splits, [o.assetId]: o.points } };
        break;
      case "fx":
        state = { ...state, fx: { ...state.fx, [o.currency]: mergePoints(state.fx[o.currency], o.points) } };
        break;
      case "meta":
        meta = { ...meta, [o.key]: o.value };
        if (o.key === "lastSync") state = { ...state, lastSync: o.value };
        break;
    }
  }
  return { state, meta };
}

export const EMPTY_STATE: AppState = {
  accounts: [],
  assets: [],
  txs: [],
  prices: {},
  fx: {},
  splits: {},
  lastSync: null,
};
