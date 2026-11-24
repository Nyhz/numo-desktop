import { Channel, invoke } from "@tauri-apps/api/core";
import type { Account, AppState, Asset, Goal, Mortgage, MortgageEvent, Point, Property, PropertyValuation, Tx } from "../../shared/types.ts";
import type { AppInfo, Backend, Entity, Loaded, Meta, Op } from "./backend.ts";
import { stampOf } from "./sync.ts";

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
  ["goal_id", "goalId"],
  ["plan_excluded", "planExcluded"],
  ["archived", "archived"],
  ["created_at", "createdAt"],
];
const GOAL: Array<[string, keyof Goal]> = [
  ["id", "id"],
  ["name", "name"],
  ["target_pct", "targetPct"],
  ["color", "color"],
  ["sort_order", "sortOrder"],
  ["created_at", "createdAt"],
];
const PROPERTY: Array<[string, keyof Property]> = [
  ["id", "id"],
  ["name", "name"],
  ["address", "address"],
  ["purchase_date", "purchaseDate"],
  ["purchase_price", "purchasePrice"],
  ["purchase_costs", "purchaseCosts"],
  ["note", "note"],
  ["created_at", "createdAt"],
];
const MORTGAGE: Array<[string, keyof Mortgage]> = [
  ["id", "id"],
  ["property_id", "propertyId"],
  ["lender", "lender"],
  ["principal", "principal"],
  ["rate_type", "rateType"],
  ["rate_pct", "ratePct"],
  ["term_months", "termMonths"],
  ["first_payment_date", "firstPaymentDate"],
  ["created_at", "createdAt"],
];
const MORTGAGE_EVENT: Array<[string, keyof MortgageEvent]> = [
  ["id", "id"],
  ["mortgage_id", "mortgageId"],
  ["date", "date"],
  ["type", "type"],
  ["amount", "amount"],
  ["mode", "mode"],
  ["rate_pct", "ratePct"],
  ["note", "note"],
  ["created_at", "createdAt"],
];
const VALUATION: Array<[string, keyof PropertyValuation]> = [
  ["id", "id"],
  ["property_id", "propertyId"],
  ["date", "date"],
  ["value", "value"],
  ["note", "note"],
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
const BOOLEANS = new Set(["trackCash", "archived", "planExcluded"]);

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

// Las claves foráneas (ON DELETE CASCADE / SET NULL) limpian lo que cuelga de la fila.
const del = (table: string, id: string): Statement => ({ sql: `DELETE FROM ${table} WHERE id = ?1`, params: [id] });

/** Qué registros arrastra cada borrado: [tipo, tabla, condición sobre ?1 = id borrado]. Debe coincidir con `cascadeOf` (sync.ts). */
const CASCADE: Partial<Record<Op["op"], Array<[Entity, string, string]>>> = {
  delAccount: [["txs", "txs", "account_id = ?1 OR to_account_id = ?1"]],
  delMortgage: [["mortgageEvents", "mortgage_events", "mortgage_id = ?1"]],
  delProperty: [
    ["mortgageEvents", "mortgage_events", "mortgage_id IN (SELECT id FROM mortgages WHERE property_id = ?1)"],
    ["mortgages", "mortgages", "property_id = ?1"],
    ["valuations", "property_valuations", "property_id = ?1"],
  ],
};

function toStatements(ops: Op[]): Statement[] {
  const out: Statement[] = [];
  const now = new Date().toISOString();
  for (const o of ops) {
    // Cada cambio sobre un registro del usuario deja su marca de tiempo (para sincronizar equipos).
    const stamp = stampOf(o, now);
    if (stamp) {
      // Lo que se borra en cascada también queda anotado como borrado (antes de que desaparezca).
      for (const [entity, table, where] of CASCADE[o.op] ?? []) {
        out.push({
          sql: `INSERT INTO sync_stamps (entity, id, at, deleted) SELECT '${entity}', id, ?2, 1 FROM ${table} WHERE ${where} ON CONFLICT(entity, id) DO UPDATE SET at = excluded.at, deleted = 1`,
          params: [stamp.id, stamp.at],
        });
      }
      out.push({
        sql: "INSERT INTO sync_stamps (entity, id, at, deleted) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(entity, id) DO UPDATE SET at = excluded.at, deleted = excluded.deleted",
        params: [stamp.entity, stamp.id, stamp.at, stamp.deleted ? 1 : 0],
      });
    }
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
      case "putGoal":
        out.push(upsert("goals", GOAL, o.row));
        break;
      case "delGoal":
        out.push(del("goals", o.id));
        break;
      case "putProperty":
        out.push(upsert("properties", PROPERTY, o.row));
        break;
      case "delProperty":
        out.push(del("properties", o.id));
        break;
      case "putMortgage":
        out.push(upsert("mortgages", MORTGAGE, o.row));
        break;
      case "delMortgage":
        out.push(del("mortgages", o.id));
        break;
      case "putMortgageEvent":
        out.push(upsert("mortgage_events", MORTGAGE_EVENT, o.row));
        break;
      case "delMortgageEvent":
        out.push(del("mortgage_events", o.id));
        break;
      case "putValuation":
        out.push(upsert("property_valuations", VALUATION, o.row));
        break;
      case "delValuation":
        out.push(del("property_valuations", o.id));
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
    const [accounts, assets, txs, prices, fx, splits, metaRows, goals, properties, mortgages, mortgageEvents, valuations] = await Promise.all([
      selectAll<Account>("accounts", ACCOUNT, "created_at, name"),
      selectAll<Asset>("assets", ASSET, "name"),
      selectAll<Tx>("txs", TX, "date, created_at"),
      grouped("SELECT asset_id, date, close FROM prices ORDER BY asset_id, date"),
      grouped("SELECT currency, date, rate FROM fx ORDER BY currency, date"),
      grouped("SELECT asset_id, date, ratio FROM splits ORDER BY asset_id, date"),
      // Las claves de servicios no se cargan: basta saber cuáles hay.
      query("SELECT key, CASE WHEN key LIKE 'secret:%' THEN '' ELSE value END FROM meta WHERE value <> ''"),
      selectAll<Goal>("goals", GOAL, "sort_order, name"),
      selectAll<Property>("properties", PROPERTY, "purchase_date"),
      selectAll<Mortgage>("mortgages", MORTGAGE, "created_at"),
      selectAll<MortgageEvent>("mortgage_events", MORTGAGE_EVENT, "date"),
      selectAll<PropertyValuation>("property_valuations", VALUATION, "date"),
    ]);
    const meta: Meta = {};
    for (const [k, v] of metaRows) {
      const key = k as string;
      if (key.startsWith("secret:")) meta[`connected:${key.slice(7)}`] = "1";
      else meta[key] = v as string;
    }
    const state: AppState = { accounts, assets, txs, prices, fx, splits, goals, properties, mortgages, mortgageEvents, valuations, lastSync: meta.lastSync ?? null };
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
  async stamps() {
    const rows = await query("SELECT entity, id, at, deleted FROM sync_stamps");
    return rows.map(([entity, id, at, deleted]) => ({ entity: entity as Entity, id: id as string, at: at as string, deleted: !!deleted }));
  },
  syncPick: () => invoke<string | null>("sync_pick_dir"),
  syncRead: (dir) => invoke<Array<{ name: string; text: string; sealed: boolean; locked: boolean }>>("sync_read", { dir }),
  syncWrite: (dir, name, text) => invoke<void>("sync_write", { dir, name, text }),
  backupNow: (label) => invoke<void>("backup_now", { label }),
  openReleases: () => invoke<void>("open_releases"),
  checkUpdate: () => invoke<{ version: string; notes: string } | null>("check_update"),
  installUpdate(onProgress) {
    const channel = new Channel<number>();
    channel.onmessage = onProgress;
    return invoke<void>("install_update", { onProgress: channel });
  },
};
