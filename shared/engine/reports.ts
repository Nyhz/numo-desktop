import { addMonths, dayNum, isoOf } from "../dates.ts";
import type { Account, AppState, Asset, TxType } from "../types.ts";
import { holdingsAt, r2, rebuyWindowMonths, type Ledger } from "./ledger.ts";
import type { Scope, Timeline } from "./timeline.ts";

/** País según el prefijo del ISIN (XS y similares no identifican un país). */
export const countryOfIsin = (isin: string | null | undefined): string => {
  if (!isin || isin.length < 2) return "";
  const cc = isin.slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(cc) && cc !== "XS" ? cc : "";
};

/** Una venta emparejada con el lote de compra que consume. */
export type GainRow = {
  sellTxId: string;
  asset: Asset;
  account: Account;
  qty: number;
  acqDate: string | null;
  acqValueEur: number;
  sellDate: string;
  saleValueEur: number;
  gainEur: number;
  /** Pérdida con recompra cercana: conviene revisar si es compensable. */
  review: boolean;
};

export type IncomeRow = {
  txId: string;
  date: string;
  type: Extract<TxType, "dividend" | "interest">;
  account: Account;
  asset: Asset | null;
  country: string;
  currency: string;
  grossNative: number;
  fxRate: number;
  grossEur: number;
  taxSourceEur: number;
  taxHomeEur: number;
  feeEur: number;
  netEur: number;
};

export type HoldingRow = {
  account: Account;
  asset: Asset;
  country: string;
  qty: number;
  price: number | null;
  currency: string;
  fxRate: number;
  valueEur: number;
};

export type CashRow = {
  account: Account;
  balance: number;
  balanceEur: number;
  /** Saldo medio del cuarto trimestre, en EUR. */
  avgQ4Eur: number;
};

export type YearReport = {
  year: number;
  /** Fecha de la foto de posiciones: 31 de diciembre, u hoy si el año no ha terminado. */
  asOf: string;
  gains: GainRow[];
  income: IncomeRow[];
  holdings: HoldingRow[];
  cash: CashRow[];
  totals: {
    gainsEur: number;
    lossesEur: number;
    netGainEur: number;
    saleValueEur: number;
    acqValueEur: number;
    dividendsGrossEur: number;
    interestGrossEur: number;
    taxSourceEur: number;
    taxHomeEur: number;
    incomeNetEur: number;
    feesEur: number;
    holdingsEur: number;
    cashEur: number;
  };
};

/** Años con alguna operación, del más reciente al más antiguo. */
export function yearsWithActivity(state: AppState, today: string): number[] {
  const ys = new Set<number>([+today.slice(0, 4)]);
  for (const t of state.txs) ys.add(+t.date.slice(0, 4));
  return [...ys].sort((a, b) => b - a);
}

export function buildYearReport(
  ledger: Ledger,
  state: AppState,
  timeline: Timeline,
  scope: Scope,
  year: number,
  today: string,
): YearReport {
  const ok = (id: string) => !scope || scope.has(id);
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const assets = new Map(state.assets.map((a) => [a.id, a]));
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const asOf = to < today ? to : today;
  const asOfDay = dayNum(asOf);
  const { market } = ledger;

  // Compras por activo, para detectar recompras posteriores a una venta con pérdidas.
  const buysByAsset = new Map<string, number[]>();
  for (const t of ledger.ntxs) {
    if (t.tx.type === "buy" && t.tx.assetId) {
      const arr = buysByAsset.get(t.tx.assetId) ?? [];
      arr.push(t.day);
      buysByAsset.set(t.tx.assetId, arr);
    }
  }

  const gains: GainRow[] = [];
  for (const m of ledger.matches) {
    if (!ok(m.accountId) || m.sellDate < from || m.sellDate > to) continue;
    const asset = assets.get(m.assetId);
    const account = accounts.get(m.accountId);
    if (!asset || !account) continue;
    let review = false;
    if (m.gainEur < 0) {
      const months = rebuyWindowMonths(asset.kind);
      if (months) {
        const sellDay = dayNum(m.sellDate);
        const until = dayNum(addMonths(m.sellDate, months));
        const boughtAfter = (buysByAsset.get(m.assetId) ?? []).some(
          (d) => d > sellDay && d <= until,
        );
        review = m.heldRecent || boughtAfter;
      }
    }
    gains.push({
      sellTxId: m.sellTxId,
      asset,
      account,
      qty: m.qty,
      acqDate: m.acqDate,
      acqValueEur: m.costEur,
      sellDate: m.sellDate,
      saleValueEur: m.proceedsEur,
      gainEur: m.gainEur,
      review,
    });
  }
  gains.sort(
    (a, b) =>
      a.sellDate.localeCompare(b.sellDate) ||
      a.asset.name.localeCompare(b.asset.name) ||
      (a.acqDate ?? "").localeCompare(b.acqDate ?? ""),
  );

  const income: IncomeRow[] = [];
  let feesEur = 0;
  for (const t of ledger.ntxs) {
    const { tx } = t;
    if (!ok(tx.accountId) || tx.date < from || tx.date > to) continue;
    feesEur += tx.type === "fee" ? t.grossEur : t.feeEur;
    if (tx.type !== "dividend" && tx.type !== "interest") continue;
    income.push({
      txId: tx.id,
      date: tx.date,
      type: tx.type,
      account: t.account,
      asset: t.asset,
      country: countryOfIsin(t.asset?.isin),
      currency: tx.currency,
      grossNative: tx.amount ?? 0,
      fxRate: tx.currency === "EUR" ? 1 : tx.fxRate,
      grossEur: t.grossEur,
      taxSourceEur: t.taxSourceEur,
      taxHomeEur: t.taxHomeEur,
      feeEur: t.feeEur,
      netEur: t.cashEur,
    });
  }

  const holdings: HoldingRow[] = [];
  for (const [key, qty] of holdingsAt(ledger, asOfDay)) {
    const [accountId, assetId] = key.split("|") as [string, string];
    if (!ok(accountId)) continue;
    const account = accounts.get(accountId);
    const asset = assets.get(assetId);
    if (!account || !asset) continue;
    const price = market.price(assetId, asOfDay);
    const fxRate = market.fx(asset.currency, asOfDay);
    holdings.push({
      account,
      asset,
      country: countryOfIsin(asset.isin),
      qty,
      price,
      currency: asset.currency,
      fxRate,
      valueEur: r2((qty * (price ?? 0)) / fxRate),
    });
  }
  holdings.sort(
    (a, b) => a.account.name.localeCompare(b.account.name) || b.valueEur - a.valueEur,
  );

  const cash: CashRow[] = [];
  const iAsOf = asOfDay - timeline.start;
  const iQ4 = dayNum(`${year}-10-01`) - timeline.start;
  for (const [accountId, series] of timeline.cash) {
    const account = accounts.get(accountId);
    if (!account || !ok(accountId) || iAsOf < 0 || iAsOf >= timeline.n) continue;
    const balance = series[iAsOf]!;
    const fxAt = (i: number) => market.fx(account.currency, timeline.start + i);
    let sum = 0;
    let days = 0;
    for (let i = Math.max(iQ4, 0); i <= iAsOf; i++) {
      sum += series[i]! / fxAt(i);
      days++;
    }
    // Días del trimestre anteriores a la apertura de la cuenta cuentan como saldo cero.
    const q4Days = Math.max(asOfDay - dayNum(`${year}-10-01`) + 1, days, 1);
    if (Math.abs(balance) < 0.005 && sum === 0) continue;
    cash.push({
      account,
      balance: r2(balance),
      balanceEur: r2(balance / fxAt(iAsOf)),
      avgQ4Eur: iAsOf >= iQ4 ? r2(sum / q4Days) : 0,
    });
  }
  cash.sort((a, b) => a.account.name.localeCompare(b.account.name));

  const sum = <T>(rows: T[], f: (r: T) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
  const div = income.filter((r) => r.type === "dividend");
  const int = income.filter((r) => r.type === "interest");
  return {
    year,
    asOf: isoOf(asOfDay),
    gains,
    income,
    holdings,
    cash,
    totals: {
      gainsEur: sum(gains, (g) => Math.max(g.gainEur, 0)),
      lossesEur: sum(gains, (g) => Math.min(g.gainEur, 0)),
      netGainEur: sum(gains, (g) => g.gainEur),
      saleValueEur: sum(gains, (g) => g.saleValueEur),
      acqValueEur: sum(gains, (g) => g.acqValueEur),
      dividendsGrossEur: sum(div, (r) => r.grossEur),
      interestGrossEur: sum(int, (r) => r.grossEur),
      taxSourceEur: sum(income, (r) => r.taxSourceEur),
      taxHomeEur: sum(income, (r) => r.taxHomeEur),
      incomeNetEur: sum(income, (r) => r.netEur),
      feesEur: r2(feesEur),
      holdingsEur: sum(holdings, (h) => h.valueEur),
      cashEur: sum(cash, (c) => c.balanceEur),
    },
  };
}
