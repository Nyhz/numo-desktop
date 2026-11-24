// Modelo de datos de Caudal. Solo se guarda lo que el usuario registra
// (cuentas, activos, operaciones) y los datos de mercado descargados.
// Posiciones, lotes, plusvalías y series se calculan siempre al vuelo.

export type AccountKind = "broker" | "bank" | "crypto" | "pension" | "other";
export type AssetKind = "stock" | "etf" | "fund" | "crypto" | "bond" | "other";
export type TxType =
  | "buy"
  | "sell"
  | "dividend"
  | "interest"
  | "deposit"
  | "withdrawal"
  | "fee"
  | "transfer";

export type Account = {
  id: string;
  name: string;
  institution: string;
  kind: AccountKind;
  /** Divisa en la que la cuenta guarda el efectivo. */
  currency: string;
  /** Hueco de color fijo (1-8); 0 = gris «otras». El color sigue a la cuenta, no a su posición. */
  color: number;
  /** Si es false la cuenta solo sigue inversiones: compras y ventas no mueven efectivo. */
  trackCash: boolean;
  archived: boolean;
  createdAt: string;
};

export type Asset = {
  id: string;
  name: string;
  kind: AssetKind;
  /** Símbolo de Yahoo Finance; null si el precio es manual. */
  symbol: string | null;
  isin: string | null;
  /** Divisa en la que cotiza. */
  currency: string;
  priceSource: "yahoo" | "manual";
  createdAt: string;
};

export type Tx = {
  id: string;
  /** Fecha de la operación, YYYY-MM-DD. */
  date: string;
  type: TxType;
  accountId: string;
  assetId: string | null;
  /** Unidades tal y como se ejecutaron (compra, venta, traspaso). */
  quantity: number | null;
  /** Precio unitario en `currency` (compra, venta). */
  price: number | null;
  /** Importe bruto en `currency` (dividendo, interés, ingreso, retirada, comisión). */
  amount: number | null;
  currency: string;
  /** Unidades de `currency` por 1 EUR (convención BCE). 1 si la operación es en EUR. */
  fxRate: number;
  fee: number;
  /** Divisa de la comisión: la de la operación o EUR. */
  feeCurrency: string;
  /** Retención en origen, en `currency`. */
  taxSource: number;
  /** Retención en España, en `currency`. */
  taxHome: number;
  /** Solo traspasos: cuenta, activo y unidades de destino. */
  toAccountId: string | null;
  toAssetId: string | null;
  toQuantity: number | null;
  note: string;
  createdAt: string;
};

/** [fecha, valor] */
export type Point = [date: string, value: number];

export type AppState = {
  accounts: Account[];
  assets: Asset[];
  txs: Tx[];
  /** Cierres diarios por activo, en la divisa del activo. */
  prices: Record<string, Point[]>;
  /** Tipo de referencia BCE por divisa: unidades de divisa por 1 EUR. */
  fx: Record<string, Point[]>;
  /** Splits por activo: [fecha, ratio] (10 = 10 acciones nuevas por cada antigua). */
  splits: Record<string, Point[]>;
  lastSync: string | null;
};

export const TX_TYPES: TxType[] = [
  "buy",
  "sell",
  "dividend",
  "interest",
  "deposit",
  "withdrawal",
  "fee",
  "transfer",
];
export const ASSET_KINDS: AssetKind[] = ["stock", "etf", "fund", "crypto", "bond", "other"];
export const ACCOUNT_KINDS: AccountKind[] = ["broker", "bank", "crypto", "pension", "other"];

export const TX_LABEL: Record<TxType, string> = {
  buy: "Compra",
  sell: "Venta",
  dividend: "Dividendo",
  interest: "Interés",
  deposit: "Ingreso",
  withdrawal: "Retirada",
  fee: "Comisión",
  transfer: "Traspaso",
};
export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  stock: "Acciones",
  etf: "ETF",
  fund: "Fondos",
  crypto: "Cripto",
  bond: "Renta fija",
  other: "Otros",
};
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  broker: "Bróker",
  bank: "Banco",
  crypto: "Exchange cripto",
  pension: "Plan de pensiones",
  other: "Otra",
};

/** Tipos que necesitan un activo. */
export const needsAsset = (t: TxType) =>
  t === "buy" || t === "sell" || t === "dividend" || t === "transfer";
/** Tipos que solo existen en cuentas que llevan efectivo. */
export const cashOnly = (t: TxType) => t === "deposit" || t === "withdrawal";
