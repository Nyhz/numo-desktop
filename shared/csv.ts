import { isIsoDate } from "./dates.ts";
import type { AssetInput, AccountInput } from "./schema.ts";
import {
  PRICE_SOURCES,
  SOURCE_BY_ISIN,
  ACCOUNT_KINDS,
  ASSET_KINDS,
  TX_LABEL,
  TX_TYPES,
  type AccountKind,
  type AppState,
  type AssetKind,
  type Point,
  type PriceSource,
  type TxType,
} from "./types.ts";

export type Cell = string | number | null | undefined;

/** CSV con `;` y coma decimal: lo que Excel en español abre sin preguntar. */
export function csvEncode(rows: Cell[][], sep = ";"): string {
  const esc = (c: Cell): string => {
    if (c == null) return "";
    if (typeof c === "number") return Number.isFinite(c) ? String(c).replace(".", ",") : "";
    return /[";\n\r,]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;
  };
  return rows.map((r) => r.map(esc).join(sep)).join("\r\n") + "\r\n";
}

export function csvParse(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const head = src.slice(0, src.search(/\r?\n/) < 0 ? src.length : src.search(/\r?\n/));
  const count = (ch: string) => head.split(ch).length - 1;
  const sep = count(";") >= count(",") && count(";") >= count("\t") ? ";" : count("\t") > count(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Acepta 1234.56, 1234,56, 1.234,56 y 1,234.56. Vacío = null. */
export function parseNumber(raw: string | undefined): number | null {
  const s = (raw ?? "").replace(/[\s€$£]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let norm = s;
  if (lastComma >= 0 && lastDot >= 0) {
    norm = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) norm = s.replace(",", ".");
  const n = Number(norm);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Acepta AAAA-MM-DD, DD/MM/AAAA y DD-MM-AAAA. */
export function parseDate(raw: string | undefined): string | null {
  const s = (raw ?? "").trim().slice(0, 10);
  if (isIsoDate(s)) return s;
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

const fold = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const TYPE_BY_NAME = new Map<string, TxType>();
for (const t of TX_TYPES) {
  TYPE_BY_NAME.set(t, t);
  TYPE_BY_NAME.set(fold(TX_LABEL[t]), t);
}

export const TX_CSV_HEADER = [
  "fecha",
  "tipo",
  "cuenta",
  "activo",
  "isin",
  "simbolo",
  "divisa_activo",
  "cantidad",
  "precio",
  "importe",
  "divisa",
  "cambio",
  "comision",
  "divisa_comision",
  "retencion_origen",
  "retencion_espana",
  "cuenta_destino",
  "activo_destino",
  "isin_destino",
  "cantidad_destino",
  "nota",
  "tipo_activo",
  "tipo_cuenta",
  "fuente_precio",
] as const;
type Col = (typeof TX_CSV_HEADER)[number];

/** Todas las operaciones en el formato que el propio importador entiende. */
export function txsToCsv(state: AppState, txIds?: Set<string>): string {
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const assets = new Map(state.assets.map((a) => [a.id, a]));
  const rows: Cell[][] = [[...TX_CSV_HEADER]];
  const txs = [...state.txs]
    .filter((t) => !txIds || txIds.has(t.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  for (const t of txs) {
    const asset = t.assetId ? assets.get(t.assetId) : undefined;
    const toAsset = t.toAssetId ? assets.get(t.toAssetId) : undefined;
    rows.push([
      t.date,
      TX_LABEL[t.type],
      accounts.get(t.accountId)?.name ?? "",
      asset?.name ?? "",
      asset?.isin ?? "",
      asset?.symbol ?? "",
      asset?.currency ?? "",
      t.quantity,
      t.price,
      t.amount,
      t.currency,
      t.currency === "EUR" ? null : t.fxRate,
      t.fee || null,
      t.fee ? t.feeCurrency : "",
      t.taxSource || null,
      t.taxHome || null,
      t.toAccountId ? (accounts.get(t.toAccountId)?.name ?? "") : "",
      toAsset?.name ?? "",
      toAsset?.isin ?? "",
      t.toQuantity,
      t.note,
      asset?.kind ?? "",
      accounts.get(t.accountId)?.kind ?? "",
      asset?.priceSource ?? "",
    ]);
  }
  return csvEncode(rows);
}

export type AssetRef = { name: string; isin: string; symbol: string; currency: string };

export type ImportRow = {
  line: number;
  date: string;
  type: TxType;
  account: string;
  asset: AssetRef | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  currency: string;
  /** null = rellenar con el tipo de referencia del BCE de ese día. */
  fxRate: number | null;
  fee: number;
  feeCurrency: string;
  taxSource: number;
  taxHome: number;
  toAccount: string;
  toAsset: AssetRef | null;
  toQuantity: number | null;
  note: string;
  /** Opcionales: solo se usan al crear un activo o una cuenta que no existía. */
  assetKind: AssetKind | null;
  accountKind: AccountKind | null;
  priceSource: PriceSource | null;
};

export type ParsedCsv = { rows: ImportRow[]; errors: Array<{ line: number; message: string }> };

export function parseTxCsv(text: string): ParsedCsv {
  const table = csvParse(text);
  const errors: ParsedCsv["errors"] = [];
  if (table.length < 2) return { rows: [], errors: [{ line: 1, message: "El archivo está vacío" }] };
  const header = table[0]!.map(fold);
  const idx = (c: Col) => header.indexOf(c);
  for (const required of ["fecha", "tipo", "cuenta"] as const) {
    if (idx(required) < 0) {
      return {
        rows: [],
        errors: [{ line: 1, message: `Falta la columna «${required}» en la cabecera` }],
      };
    }
  }

  const rows: ImportRow[] = [];
  table.slice(1).forEach((cells, k) => {
    const line = k + 2;
    const get = (c: Col) => (idx(c) < 0 ? "" : (cells[idx(c)] ?? "").trim());
    const num = (c: Col) => parseNumber(get(c));
    const fail = (message: string) => errors.push({ line, message });

    const date = parseDate(get("fecha"));
    const type = TYPE_BY_NAME.get(fold(get("tipo")));
    const account = get("cuenta");
    if (!date) return fail(`Fecha no reconocida: «${get("fecha")}»`);
    if (!type) return fail(`Tipo no reconocido: «${get("tipo")}»`);
    if (!account) return fail("Falta la cuenta");

    const numbers = {
      quantity: num("cantidad"),
      price: num("precio"),
      amount: num("importe"),
      fxRate: num("cambio"),
      fee: num("comision"),
      taxSource: num("retencion_origen"),
      taxHome: num("retencion_espana"),
      toQuantity: num("cantidad_destino"),
    };
    for (const [name, v] of Object.entries(numbers)) {
      if (v != null && Number.isNaN(v)) return fail(`Número no válido en «${name}»`);
    }

    const assetName = get("activo");
    const isin = get("isin").toUpperCase();
    const symbol = get("simbolo");
    const hasAsset = !!(assetName || isin || symbol);
    const assetCcy = (get("divisa_activo") || get("divisa") || "EUR").toUpperCase();
    const currency = (get("divisa") || (hasAsset ? assetCcy : "EUR")).toUpperCase();
    const toName = get("activo_destino");
    const toIsin = get("isin_destino").toUpperCase();

    rows.push({
      line,
      date,
      type,
      account,
      asset: hasAsset
        ? { name: assetName || symbol || isin, isin, symbol, currency: assetCcy }
        : null,
      quantity: numbers.quantity,
      price: numbers.price,
      amount: numbers.amount,
      currency,
      fxRate: currency === "EUR" ? 1 : numbers.fxRate,
      fee: numbers.fee ?? 0,
      feeCurrency: (get("divisa_comision") || currency).toUpperCase(),
      taxSource: numbers.taxSource ?? 0,
      taxHome: numbers.taxHome ?? 0,
      toAccount: get("cuenta_destino"),
      toAsset: toName || toIsin ? { name: toName || toIsin, isin: toIsin, symbol: "", currency: assetCcy } : null,
      toQuantity: numbers.toQuantity,
      note: get("nota"),
      assetKind: (ASSET_KINDS as string[]).includes(get("tipo_activo")) ? (get("tipo_activo") as AssetKind) : null,
      accountKind: (ACCOUNT_KINDS as string[]).includes(get("tipo_cuenta")) ? (get("tipo_cuenta") as AccountKind) : null,
      priceSource: (PRICE_SOURCES as string[]).includes(get("fuente_precio")) ? (get("fuente_precio") as PriceSource) : null,
    });
  });
  return { rows, errors };
}

/** Clave estable para reconocer un activo: ISIN, si no símbolo, si no nombre. */
export const assetKey = (a: { isin?: string | null; symbol?: string | null; name: string }) =>
  a.isin ? `isin:${a.isin.toUpperCase()}` : a.symbol ? `sym:${a.symbol.toUpperCase()}` : `name:${fold(a.name)}`;

export const accountKey = (name: string) => fold(name);

export type ImportPlan = {
  newAccounts: AccountInput[];
  newAssets: Array<AssetInput & { key: string }>;
  rows: ImportRow[];
};

const guessKind = (ref: AssetRef): AssetKind =>
  /-(EUR|USD|USDT|GBP)$/i.test(ref.symbol) ? "crypto" : "other";

/** Qué cuentas y activos habría que crear para importar estas filas. */
/** Fuente de un activo importado: la indicada si trae el dato que necesita; si no, Yahoo con símbolo o manual. */
function resolveSource(source: PriceSource | null, ref: { symbol: string; isin: string }): PriceSource {
  const isin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(ref.isin);
  if (source === "manual" || source === "indexa") return source;
  if (source && SOURCE_BY_ISIN[source]) return isin ? source : ref.symbol ? "yahoo" : "manual";
  if (source && ref.symbol) return source;
  return ref.symbol ? "yahoo" : "manual";
}

export function planImport(rows: ImportRow[], state: AppState): ImportPlan {
  const haveAccounts = new Set(state.accounts.map((a) => accountKey(a.name)));
  const haveAssets = new Set<string>();
  for (const a of state.assets) {
    if (a.isin) haveAssets.add(`isin:${a.isin.toUpperCase()}`);
    if (a.symbol) haveAssets.add(`sym:${a.symbol.toUpperCase()}`);
    haveAssets.add(`name:${fold(a.name)}`);
  }
  const newAccounts = new Map<string, AccountInput>();
  const newAssets = new Map<string, AssetInput & { key: string }>();
  // Una cuenta nueva lleva efectivo si el archivo trae ingresos o retiradas para ella.
  const withCash = new Set(
    rows.filter((r) => r.type === "deposit" || r.type === "withdrawal").map((r) => accountKey(r.account)),
  );

  const needAccount = (name: string, kind: AccountKind | null = null) => {
    const k = accountKey(name);
    if (!name || haveAccounts.has(k) || newAccounts.has(k)) return;
    newAccounts.set(k, {
      name,
      institution: "",
      kind: kind ?? "broker",
      currency: "EUR",
      trackCash: withCash.has(k),
      archived: false,
    });
  };
  const needAsset = (ref: AssetRef | null, kind: AssetKind | null = null, source: PriceSource | null = null) => {
    if (!ref) return;
    const k = assetKey(ref);
    if (haveAssets.has(k) || haveAssets.has(`name:${fold(ref.name)}`) || newAssets.has(k)) return;
    newAssets.set(k, {
      key: k,
      name: ref.name,
      kind: kind ?? guessKind(ref),
      symbol: ref.symbol || null,
      isin: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(ref.isin) ? ref.isin : null,
      currency: ref.currency,
            priceSource: resolveSource(source, ref),
      goalId: null,
      planExcluded: false,
      archived: false,
    });
  };
  for (const r of rows) {
    needAccount(r.account, r.accountKind);
    needAccount(r.toAccount);
    needAsset(r.asset, r.assetKind, r.priceSource);
    needAsset(r.toAsset, r.assetKind);
  }
  return { newAccounts: [...newAccounts.values()], newAssets: [...newAssets.values()], rows };
}

/** true si el archivo tiene la cabecera del CSV de operaciones (el que la propia app exporta). */
export function isTxCsv(text: string): boolean {
  const header = (csvParse(text.slice(0, 2000))[0] ?? []).map(fold);
  return ["fecha", "tipo", "cuenta"].every((c) => header.includes(c));
}
