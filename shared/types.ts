// Modelo de datos de Numo. Solo se guarda lo que el usuario registra
// (cuentas, activos, operaciones) y los datos de mercado descargados.
// Posiciones, lotes, plusvalías y series se calculan siempre al vuelo.

/**
 * `emergency` es el fondo de emergencia: efectivo que cuenta para el patrimonio
 * pero no es cartera (no se invierte ni entra en su rentabilidad). Es el único
 * dinero del banco que se registra: no hay un tipo de cuenta «banco».
 */
export type AccountKind = "broker" | "crypto" | "pension" | "emergency" | "other";
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

export type PriceSource = "xetra" | "bme" | "nasdaq" | "fundinfo" | "binance" | "indexa" | "yahoo" | "ft" | "manual";
export const PRICE_SOURCES: PriceSource[] = ["xetra", "bme", "nasdaq", "fundinfo", "binance", "indexa", "yahoo", "ft", "manual"];
export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  xetra: "Deutsche Börse · Xetra (ETF y acciones, por ISIN)",
  bme: "BME · Bolsa de Madrid (por ISIN)",
  nasdaq: "Nasdaq (acciones de EE. UU., por ticker)",
  fundinfo: "fundinfo (fondos, por ISIN)",
  binance: "Binance (criptomonedas en euros)",
  indexa: "Indexa Capital (tu plan o cartera; con token)",
  yahoo: "Yahoo Finance (por símbolo)",
  ft: "Financial Times (fondos, por ISIN)",
  manual: "Manual",
};
export const PRICE_SOURCE_SHORT: Record<PriceSource, string> = {
  xetra: "Deutsche Börse",
  bme: "BME",
  nasdaq: "Nasdaq",
  fundinfo: "fundinfo",
  binance: "Binance",
  indexa: "Indexa Capital",
  yahoo: "Yahoo Finance",
  ft: "Financial Times",
  manual: "Manual",
};
/** Fuentes que identifican el activo por su ISIN; las demás usan el campo de código. */
export const SOURCE_BY_ISIN: Record<PriceSource, boolean> = { xetra: true, bme: true, fundinfo: true, ft: true, nasdaq: false, binance: false, indexa: false, yahoo: false, manual: false };
/** Para qué sirve el campo de código en cada fuente, con un ejemplo. */
export const SOURCE_CODE: Record<PriceSource, { label: string; example: string; required: boolean; hint?: string } | null> = {
  xetra: { label: "Símbolo de Yahoo", example: "VWCE.DE", required: false, hint: "respaldo" },
  bme: { label: "Símbolo de Yahoo", example: "AMP.MC", required: false, hint: "respaldo" },
  nasdaq: { label: "Ticker", example: "GOOG", required: true },
  fundinfo: null,
  binance: { label: "Par de Binance", example: "ETHEUR", required: true },
  indexa: { label: "Identificador en Indexa", example: "se rellena solo", required: false, hint: "se rellena solo" },
  yahoo: { label: "Símbolo de Yahoo", example: "VWCE.DE", required: true },
  ft: null,
  manual: null,
};

export type Account = {
  id: string;
  name: string;
  institution: string;
  kind: AccountKind;
  /** Divisa en la que la cuenta guarda el efectivo. */
  currency: string;
  /** Hueco de color fijo (1-8); 0 = gris «otras». El color sigue a la cuenta, no a su posición. */
  color: number;
  /**
   * Si la cuenta lleva efectivo. Solo el fondo de emergencia lo lleva: el resto de
   * cuentas siguen inversiones y sus compras y ventas no mueven saldo. Se guarda por
   * compatibilidad, pero siempre vale `holdsCash(kind)`; lo que cuenta es el tipo.
   */
  trackCash: boolean;
  archived: boolean;
  createdAt: string;
};

export type Asset = {
  id: string;
  name: string;
  kind: AssetKind;
  /** Símbolo de Yahoo Finance; solo se usa si el precio viene de Yahoo. */
  symbol: string | null;
  isin: string | null;
  /** Divisa en la que cotiza. */
  currency: string;
  /** De dónde sale el precio: Yahoo (por símbolo), Financial Times (fondos, por ISIN) o a mano. */
  priceSource: PriceSource;
  /** Bloque del plan al que pertenece; null = sin asignar. */
  goalId: string | null;
  /** Fuera del plan: no cuenta en ningún bloque ni en el total repartido (p. ej. un plan de pensiones). */
  planExcluded: boolean;
  createdAt: string;
};

/** Bloque del plan de inversión: un peso objetivo sobre la cartera. */
export type Goal = {
  id: string;
  name: string;
  targetPct: number;
  /** Hueco de color fijo (1-6); acompaña al bloque. */
  color: number;
  sortOrder: number;
  createdAt: string;
};

export type Property = {
  id: string;
  name: string;
  address: string;
  /** Fecha de compra, YYYY-MM-DD. */
  purchaseDate: string;
  purchasePrice: number;
  /** Impuestos, notaría, registro… */
  purchaseCosts: number;
  note: string;
  createdAt: string;
};

export type RateType = "fixed" | "variable" | "mixed";

/** Hipoteca de amortización francesa; como mucho una por inmueble. */
export type Mortgage = {
  id: string;
  propertyId: string;
  lender: string;
  principal: number;
  rateType: RateType;
  /** TIN anual en %. */
  ratePct: number;
  termMonths: number;
  /** Fecha de la primera cuota, YYYY-MM-DD. */
  firstPaymentDate: string;
  createdAt: string;
};

export type MortgageEventType = "early_repayment" | "rate_change" | "payment_override";

/** Lo que cambia el cuadro: amortización anticipada, revisión del tipo o cuota real del recibo. */
export type MortgageEvent = {
  id: string;
  mortgageId: string;
  date: string;
  type: MortgageEventType;
  /** Importe amortizado, o nueva cuota mensual si es payment_override. */
  amount: number | null;
  /** Solo amortización anticipada: reducir plazo o reducir cuota. */
  mode: "reduce_term" | "reduce_installment" | null;
  /** Solo revisión del tipo: nuevo TIN en %. */
  ratePct: number | null;
  note: string;
  createdAt: string;
};

/** Valoración fechada del inmueble (tasación, reforma). */
export type PropertyValuation = {
  id: string;
  propertyId: string;
  date: string;
  value: number;
  note: string;
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
  goals: Goal[];
  properties: Property[];
  mortgages: Mortgage[];
  mortgageEvents: MortgageEvent[];
  valuations: PropertyValuation[];
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
export const ACCOUNT_KINDS: AccountKind[] = ["broker", "crypto", "pension", "emergency", "other"];

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
export const RATE_TYPE_LABEL: Record<RateType, string> = { fixed: "Fijo", variable: "Variable", mixed: "Mixto" };
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  broker: "Bróker",
  crypto: "Exchange cripto",
  pension: "Plan de pensiones",
  emergency: "Fondo de emergencia",
  other: "Otra",
};

/** Tipos que necesitan un activo. */
export const needsAsset = (t: TxType) =>
  t === "buy" || t === "sell" || t === "dividend" || t === "transfer";
/**
 * Operaciones que se registran en cada tipo de cuenta. Las comisiones van dentro
 * de cada compra o venta, así que no hay comisiones sueltas. El único efectivo
 * que se lleva es el del fondo de emergencia: ingresos, retiradas e intereses
 * solo se registran ahí, y en él no se compra nada.
 */
export const ACCOUNT_TX_TYPES: Record<AccountKind, TxType[]> = {
  broker: ["buy", "sell", "dividend", "transfer"],
  crypto: ["buy", "sell", "transfer"],
  pension: ["buy", "sell", "transfer"],
  emergency: ["deposit", "withdrawal", "interest"],
  other: ["buy", "sell", "dividend", "transfer"],
};
export const allowsTx = (kind: AccountKind, t: TxType) => ACCOUNT_TX_TYPES[kind].includes(t);
/** Solo el fondo de emergencia lleva efectivo. Bróker, cripto, pensiones y «otra», nunca. */
export const holdsCash = (kind: AccountKind) => kind === "emergency";
/** Tipos que solo existen en cuentas que llevan efectivo. */
export const cashOnly = (t: TxType) => t === "deposit" || t === "withdrawal";
