import type { Account, Asset, ForeignBlock, ForeignFiling, ForeignModel } from "../types.ts";
import type { YearReport } from "./reports.ts";

// Modelos 720 y 721: bienes y derechos en el extranjero.
//
// Se declara por bloques, cada uno por separado: las cuentas en entidades de fuera
// de España y los valores y fondos depositados fuera (modelo 720), y las
// criptomonedas custodiadas por entidades de fuera (modelo 721). Un bloque obliga
// a presentar la declaración del ejercicio cuando:
//  · nunca se ha declarado y supera 50.000 € a 31 de diciembre (en las cuentas,
//    también cuenta el saldo medio del cuarto trimestre);
//  · ya se declaró y ha subido más de 20.000 € desde la última declaración; o
//  · se ha dejado de tener algo que estaba declarado.
// Se presenta entre el 1 de enero y el 31 de marzo del año siguiente.
//
// Lo que decide si algo está «fuera» es el país de la entidad (el de la cuenta),
// no el del ISIN: un fondo irlandés comprado en un banco español no se declara.
// Los inmuebles en el extranjero no se tienen en cuenta.

export const FOREIGN_THRESHOLD = 50_000;
export const FOREIGN_STEP = 20_000;

export const BLOCK_MODEL: Record<ForeignBlock, ForeignModel> = { accounts: "720", securities: "720", crypto: "721" };
export const BLOCK_LABEL: Record<ForeignBlock, string> = { accounts: "Cuentas", securities: "Valores y fondos", crypto: "Criptomonedas" };
export const MODEL_LABEL: Record<ForeignModel, string> = {
  "720": "Modelo 720 · bienes y derechos en el extranjero",
  "721": "Modelo 721 · criptomonedas en el extranjero",
};
const BLOCKS: ForeignBlock[] = ["accounts", "securities", "crypto"];

/** Una cuenta está fuera de España si su entidad tiene un país que no es España. Sin país: monedero propio. */
export const isForeign = (a: Pick<Account, "country">): boolean => !!a.country && a.country !== "ES";

export type ForeignItem = {
  /** «cuenta» o «cuenta|activo»: lo que se guarda al confirmar para saber después si se deja de tener. */
  key: string;
  block: ForeignBlock;
  account: Account;
  asset: Asset | null;
  valueEur: number;
  /** Solo cuentas: saldo medio del cuarto trimestre, en EUR. */
  avgQ4Eur: number | null;
  /** Sin precio a esa fecha: el valor está incompleto. */
  noPrice: boolean;
};

export type BlockStatus = {
  block: ForeignBlock;
  items: ForeignItem[];
  /** Valor a 31 de diciembre (u hoy, si el año no ha terminado). */
  valueEur: number;
  avgQ4Eur: number | null;
  /** Lo que se compara con los umbrales: el valor, o el mayor de valor y saldo medio en las cuentas. */
  measureEur: number;
  /** La última declaración que incluyó este bloque, de un ejercicio anterior. */
  last: { year: number; valueEur: number } | null;
  /** Lo declarado que se dejó de tener durante el ejercicio. */
  ended: string[];
  due: boolean;
  /**
   * Por qué hay que presentarlo, o por qué no: se dejó de tener algo declarado,
   * primera vez por encima o por debajo del umbral, nada fuera, o cuánto ha
   * subido (o bajado, si es negativo) desde la última declaración.
   */
  rule: { kind: "ended" } | { kind: "first"; over: boolean } | { kind: "empty" } | { kind: "change"; rise: number; over: boolean };
};

/** open: el ejercicio no ha acabado · window: se puede presentar · late: el plazo ya pasó. */
export type FilingPhase = "open" | "window" | "late";

export type ModelStatus = {
  model: ForeignModel;
  blocks: BlockStatus[];
  due: boolean;
  /** La declaración de este ejercicio que el usuario confirmó, si la hay. */
  filing: ForeignFiling | null;
  deadline: string;
  phase: FilingPhase;
};

const keyOf = (accountId: string, assetId?: string) => (assetId ? `${accountId}|${assetId}` : accountId);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Lo que hay fuera de España en una foto de fin de año (o de hoy), por bloques. */
export function foreignItems(report: YearReport): ForeignItem[] {
  const out: ForeignItem[] = [];
  for (const c of report.cash) {
    if (!isForeign(c.account) || c.balanceEur <= 0.005) continue;
    out.push({ key: keyOf(c.account.id), block: "accounts", account: c.account, asset: null, valueEur: c.balanceEur, avgQ4Eur: c.avgQ4Eur, noPrice: false });
  }
  for (const h of report.holdings) {
    if (!isForeign(h.account) || h.qty <= 0) continue;
    // Una criptomoneda va al 721 esté en la cuenta que esté; lo demás (acciones, ETF, fondos…) al 720.
    out.push({ key: keyOf(h.account.id, h.asset.id), block: h.asset.kind === "crypto" ? "crypto" : "securities", account: h.account, asset: h.asset, valueEur: h.valueEur, avgQ4Eur: null, noPrice: h.price == null });
  }
  return out.sort((a, b) => b.valueEur - a.valueEur);
}

/**
 * Si hay que presentar los modelos 720 y 721 de un ejercicio, y por qué.
 * `report` es la foto del ejercicio (todas las cuentas) y `previous` la del
 * anterior, para saber qué se tenía al empezarlo.
 */
export function foreignStatus(year: number, today: string, report: YearReport, previous: YearReport | null, filings: ForeignFiling[]): ModelStatus[] {
  const items = foreignItems(report);
  const before = new Set(previous ? foreignItems(previous).map((i) => i.key) : []);
  const deadline = `${year + 1}-03-31`;
  const phase: FilingPhase = today <= `${year}-12-31` ? "open" : today <= deadline ? "window" : "late";

  const blocks = BLOCKS.map((block): BlockStatus => {
    const mine = items.filter((i) => i.block === block);
    const valueEur = r2(mine.reduce((s, i) => s + i.valueEur, 0));
    const avgQ4Eur = block === "accounts" ? r2(mine.reduce((s, i) => s + (i.avgQ4Eur ?? 0), 0)) : null;
    const measureEur = Math.max(valueEur, avgQ4Eur ?? 0);
    const prior = filings
      .filter((f) => f.model === BLOCK_MODEL[block] && f.year < year && f.blocks?.[block] != null)
      .sort((a, b) => b.year - a.year)[0];
    const last = prior ? { year: prior.year, valueEur: prior.blocks[block]! } : null;
    // Lo declarado que se tenía al empezar el ejercicio y ya no se tiene al acabarlo.
    const held = new Set(mine.map((i) => i.key));
    const declared = (prior?.items ?? []).filter((k) => k.startsWith(`${block}:`)).map((k) => k.slice(block.length + 1));
    const ended = declared.filter((k) => before.has(k) && !held.has(k));

    let rule: BlockStatus["rule"];
    if (ended.length) rule = { kind: "ended" };
    else if (last) {
      const rise = r2(measureEur - last.valueEur);
      rule = { kind: "change", rise, over: rise > FOREIGN_STEP };
    } else if (mine.length) rule = { kind: "first", over: measureEur > FOREIGN_THRESHOLD };
    else rule = { kind: "empty" };
    const due = rule.kind === "ended" || ((rule.kind === "first" || rule.kind === "change") && rule.over);
    return { block, items: mine, valueEur, avgQ4Eur, measureEur, last, ended, due, rule };
  });

  return (["720", "721"] as const).map((model) => {
    const own = blocks.filter((b) => BLOCK_MODEL[b.block] === model);
    return {
      model,
      blocks: own,
      due: own.some((b) => b.due),
      filing: filings.find((f) => f.model === model && f.year === year) ?? null,
      deadline,
      phase,
    };
  });
}

/** La declaración que se guarda al confirmar: el valor de cada bloque presentado y lo que se tenía en él. */
export function filingFrom(status: ModelStatus, year: number): Omit<ForeignFiling, "id" | "createdAt"> {
  const filed = status.blocks.filter((b) => b.due);
  return {
    model: status.model,
    year,
    blocks: Object.fromEntries(filed.map((b) => [b.block, b.measureEur])),
    items: filed.flatMap((b) => b.items.map((i) => `${b.block}:${i.key}`)),
  };
}

/** Ejercicios con una declaración pendiente que todavía se puede presentar a tiempo. */
export const pendingFilings = (statuses: ModelStatus[]): ModelStatus[] => statuses.filter((m) => m.due && !m.filing && m.phase === "window");
