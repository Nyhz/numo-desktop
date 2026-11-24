import { invoke } from "@tauri-apps/api/core";
import type { Account, AppState, Asset, Point, Tx } from "../../shared/types.ts";
import type { AppInfo, Backend, Loaded, Meta, Op } from "./backend.ts";

type Statement = { sql: string; params?: unknown[]; many?: unknown[][] };
type Cell = string | number | null;

// Correspondencia columna SQL → campo. El orden es el de los SELECT y los INSERT.
const ACCOUNT: Array<[string, keyof Account]> = [
  ["id", "id"],
  ["name", "name"],
  ["institution", "institution"],
  ["kind", "kind"],
  ["currency", "currency"],
  ["color", "color"],
  ["track_cash", "trackCash"],
  ["archived", "archived"],
  ["created_at", "createdAt"],
];
const ASSET: Array<[string, keyof Asset]> = [
  ["id", "id"],
  ["name", "name"],
  ["kind", "kind"],
  ["symbol", "symbol"],
  ["isin", "isin"],
  ["currency", "currency"],
  ["price_source", "priceSource"],
  ["created_at", "createdAt"],
];
const TX: Array<[string, keyof Tx]> = [
  ["id", "id"],
  ["date", "date"],
  ["type", "type"],
  ["account_id", "accountId"],
  ["asset_id", "assetId"],
  ["quantity", "quantity"],
  ["price", "price"],
  ["amount", "amount"],
  ["currency", "currency"],
  ["fx_rate", "fxRate"],
  ["fee", "fee"],
  ["fee_currency", "feeCurrency"],
  ["tax_source", "taxSource"],
  ["tax_home", "taxHome"],
  ["to_account_id", "toAccountId"],
  ["to_asset_id", "toAssetId"],
  ["to_quantity", "toQuantity"],
  ["note", "note"],
  ["created_at", "createdAt"],
];
const BOOLEANS = new Set(["trackCash", "archived"]);

function upsert<T>(table: string, cols: Array<[string, keyof T]>, row: T): Statement {
  const names = cols.map(([c]) => c);
  return {
    sql: `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map((_, i) => `?${i + 1}`).join(", ")})
          ON CONFLICT(id) DO UPDATE SET ${names
            .filter((c) => c !== "id" && c !== "created_at")
            .map((c) => `${c} = excluded.${c}`)
            .join(", ")}`,
    params: cols.map(([, f]) => row[f] ?? null),
  };
}

function toStatements(ops: Op[]): Statement[] {
  const out: Statement[] = [];
  for (const o of ops) {
    switch (o.op) {
      case "putAccount":
        out.push(upsert("accounts", ACCOUNT, o.row));
        break;
      case "delAccount":
        out.push({ sql: "DELETE FROM txs WHERE account_id = ?1 OR to_account_id = ?1", params: [o.id] });
        out.push({ sql: "DELETE FROM accounts WHERE id = ?1", params: [o.id] });
        break;
      case "putAsset":
        out.push(upsert("assets", ASSET, o.row));
        break;
      case "delAsset":
        out.push({ sql: "DELETE FROM assets WHERE id = ?1", params: [o.id] });
        break;
      case "putTx":
        out.push(upsert("txs", TX, o.row));
        break;
      case "delTx":
        out.push({ sql: "DELETE FROM txs WHERE id = ?1", params: [o.id] });
        break;
      case "prices":
        if (o.replace) out.push({ sql: "DELETE FROM prices WHERE asset_id = ?1", params: [o.assetId] });
        if (o.points.length) {
          out.push({
            sql: "INSERT INTO prices (asset_id, date, close) VALUES (?1, ?2, ?3) ON CONFLICT(asset_id, date) DO UPDATE SET close = excluded.close",
            many: o.points.map(([d, v]) => [o.assetId, d, v]),
          });
        }
        break;
      case "delPrice":
        out.push({ sql: "DELETE FROM prices WHERE asset_id = ?1 AND date = ?2", params: [o.assetId, o.date] });
        break;
      case "splits":
        out.push({ sql: "DELETE FROM splits WHERE asset_id = ?1", params: [o.assetId] });
        if (o.points.length) {
          out.push({
            sql: "INSERT INTO splits (asset_id, date, ratio) VALUES (?1, ?2, ?3)",
            many: o.points.map(([d, v]) => [o.assetId, d, v]),
          });
        }
        break;
      case "fx":
        if (o.points.length) {
          out.push({
            sql: "INSERT INTO fx (currency, date, rate) VALUES (?1, ?2, ?3) ON CONFLICT(currency, date) DO UPDATE SET rate = excluded.rate",
            many: o.points.map(([d, v]) => [o.currency, d, v]),
          });
        }
        break;
      case "meta":
        out.push({
          sql: "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          params: [o.key, o.value],
        });
        break;
    }
  }
  return out;
}

const query = (sql: string, params: unknown[] = []) => invoke<Cell[][]>("db_query", { sql, params });

async function selectAll<T>(table: string, cols: Array<[string, keyof T]>, order: string): Promise<T[]> {
  const rows = await query(`SELECT ${cols.map(([c]) => c).join(", ")} FROM ${table} ORDER BY ${order}`);
  return rows.map((r) => {
    const obj: Record<string, unknown> = {};
    cols.forEach(([, field], i) => {
      obj[field as string] = BOOLEANS.has(field as string) ? !!r[i] : r[i];
    });
    return obj as T;
  });
}

async function grouped(sql: string): Promise<Record<string, Point[]>> {
  const out: Record<string, Point[]> = {};
  for (const [k, d, v] of await query(sql)) (out[k as string] ??= []).push([d as string, v as number]);
  return out;
}

export const tauriBackend: Backend = {
  native: true,

  async load(): Promise<Loaded> {
    const [accounts, assets, txs, prices, fx, splits, metaRows] = await Promise.all([
      selectAll<Account>("accounts", ACCOUNT, "created_at, name"),
      selectAll<Asset>("assets", ASSET, "name"),
      selectAll<Tx>("txs", TX, "date, created_at"),
      grouped("SELECT asset_id, date, close FROM prices ORDER BY asset_id, date"),
      grouped("SELECT currency, date, rate FROM fx ORDER BY currency, date"),
      grouped("SELECT asset_id, date, ratio FROM splits ORDER BY asset_id, date"),
      query("SELECT key, value FROM meta"),
    ]);
    const meta: Meta = {};
    for (const [k, v] of metaRows) meta[k as string] = v as string;
    const state: AppState = { accounts, assets, txs, prices, fx, splits, lastSync: meta.lastSync ?? null };
    return { state, meta };
  },

  async apply(ops) {
    const statements = toStatements(ops);
    if (statements.length) await invoke("db_batch", { statements });
  },

  httpGet: (url) => invoke<string>("http_get", { url }),

  saveFile(name, data) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    return invoke<string | null>("save_file", { name, bytes: Array.from(bytes) });
  },

  exportBackup: (name) => invoke<string | null>("export_backup", { name }),
  info: () => invoke<AppInfo>("app_info"),
};
