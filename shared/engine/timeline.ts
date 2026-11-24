import { dayNum, isoOf } from "../dates.ts";
import type { AppState, Asset } from "../types.ts";
import { holdingsAt, r2, type Ledger } from "./ledger.ts";

/** Cuentas incluidas; null = todas. */
export type Scope = Set<string> | null;

/** Valor diario de la cartera y flujos externos, todo en EUR. */
export type Timeline = {
  /** Primer día (número de día) y número de días hasta hoy. */
  start: number;
  n: number;
  total: Float64Array;
  byAccount: Map<string, Float64Array>;
  /** Por tipo de activo, más "cash". */
  byKind: Map<string, Float64Array>;
  /** Dinero que entra (inicio del día) y sale (fin del día) de la cartera. */
  inflow: Float64Array;
  outflow: Float64Array;
  /** Efectivo por cuenta en su divisa, solo cuentas que lo llevan. */
  cash: Map<string, Float64Array>;
};

const EMPTY: Timeline = {
  start: 0,
  n: 0,
  total: new Float64Array(0),
  byAccount: new Map(),
  byKind: new Map(),
  inflow: new Float64Array(0),
  outflow: new Float64Array(0),
  cash: new Map(),
};

export function buildTimeline(
  ledger: Ledger,
  state: AppState,
  scope: Scope,
  today: string,
): Timeline {
  const inScope = (id: string | null) => !!id && (!scope || scope.has(id));
  const txs = ledger.ntxs;
  const first = txs.find(
    (t) => inScope(t.tx.accountId) || (t.tx.type === "transfer" && inScope(t.tx.toAccountId)),
  );
  if (!first) return EMPTY;

  const start = first.day;
  const end = Math.max(dayNum(today), start);
  const n = end - start + 1;
  const { market } = ledger;
  const assets = new Map<string, Asset>(state.assets.map((a) => [a.id, a]));
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));

  const vec = () => new Float64Array(n);
  const total = vec();
  const inflow = vec();
  const outflow = vec();
  const byAccount = new Map<string, Float64Array>();
  const byKind = new Map<string, Float64Array>();
  const cash = new Map<string, Float64Array>();
  const get = (m: Map<string, Float64Array>, k: string) => {
    let v = m.get(k);
    if (!v) m.set(k, (v = vec()));
    return v;
  };

  const pxCache = new Map<string, Float64Array>();
  const px = (assetId: string) => {
    let v = pxCache.get(assetId);
    if (!v) pxCache.set(assetId, (v = market.priceEurDaily(assetId, start, n)));
    return v;
  };
  const fxCache = new Map<string, Float64Array>();
  const fxOf = (ccy: string) => {
    let v = fxCache.get(ccy);
    if (!v) fxCache.set(ccy, (v = market.fxDaily(ccy, start, n)));
    return v;
  };

  type Pos = { acct: string; asset: string; qty: number };
  const pos = new Map<string, Pos>();
  const addPos = (acct: string, asset: string, q: number) => {
    const k = `${acct}|${asset}`;
    const p = pos.get(k);
    if (p) {
      p.qty += q;
      if (Math.abs(p.qty) < 1e-9) pos.delete(k);
    } else if (Math.abs(q) >= 1e-9) pos.set(k, { acct, asset, qty: q });
  };
  const cashBal = new Map<string, number>();
  const addCash = (acct: string, v: number) => cashBal.set(acct, (cashBal.get(acct) ?? 0) + v);

  let p = 0;
  while (p < txs.length && txs[p]!.day < start) p++;

  for (let i = 0; i < n; i++) {
    const day = start + i;
    while (p < txs.length && txs[p]!.day <= day) {
      const t = txs[p++]!;
      const { tx } = t;
      const A = tx.accountId;
      const inA = inScope(A);
      const tracks = t.account.trackCash;
      // En cuentas sin efectivo el dinero entra y sale de la cartera con cada operación.
      const settle = () => {
        if (tracks) addCash(A, t.cashAcct);
        else if (t.cashEur >= 0) outflow[i]! += t.cashEur;
        else inflow[i]! += -t.cashEur;
      };
      switch (tx.type) {
        case "buy":
          if (inA && tx.assetId) {
            addPos(A, tx.assetId, t.qty);
            settle();
          }
          break;
        case "sell":
          if (inA && tx.assetId) {
            addPos(A, tx.assetId, -t.qty);
            settle();
          }
          break;
        case "dividend":
        case "interest":
        case "fee":
          if (inA) settle();
          break;
        case "deposit":
          if (inA && tracks) {
            addCash(A, t.cashAcct);
            inflow[i]! += t.grossEur;
          }
          break;
        case "withdrawal":
          if (inA && tracks) {
            addCash(A, t.cashAcct);
            outflow[i]! += t.grossEur;
          }
          break;
        case "transfer": {
          if (!tx.assetId) break;
          const B = tx.toAccountId ?? A;
          const inB = inScope(B);
          const value = t.qty * px(tx.assetId)[i]!;
          if (inA) addPos(A, tx.assetId, -t.qty);
          if (inB) addPos(B, tx.toAssetId ?? tx.assetId, t.toQty);
          // Un traspaso solo es flujo externo si cruza el límite de las cuentas elegidas.
          if (inA && !inB) outflow[i]! += value;
          if (inB && !inA) inflow[i]! += value;
          if (inA && t.cashEur !== 0) settle();
          break;
        }
      }
    }

    let sum = 0;
    for (const { acct, asset, qty } of pos.values()) {
      const v = qty * px(asset)[i]!;
      if (v === 0) continue;
      get(byAccount, acct)[i]! += v;
      get(byKind, assets.get(asset)?.kind ?? "other")[i]! += v;
      sum += v;
    }
    for (const [acct, bal] of cashBal) {
      get(cash, acct)[i] = bal;
      const ccy = accounts.get(acct)?.currency ?? "EUR";
      const v = ccy === "EUR" ? bal : bal / fxOf(ccy)[i]!;
      get(byAccount, acct)[i]! += v;
      get(byKind, "cash")[i]! += v;
      sum += v;
    }
    total[i] = sum;
  }

  return { start, n, total, byAccount, byKind, inflow, outflow, cash };
}

/** Índice del día dentro de la serie, acotado a [-1, n-1]. -1 = antes del inicio. */
export const indexOfDate = (tl: Timeline, iso: string): number =>
  Math.max(-1, Math.min(tl.n - 1, dayNum(iso) - tl.start));

export const dateAt = (tl: Timeline, i: number): string => isoOf(tl.start + i);

/**
 * Rentabilidad diaria ponderada por tiempo. Las entradas cuentan desde el
 * inicio del día y las salidas al final:
 *   r = (V_hoy + salidas) / (V_ayer + entradas) − 1
 * Así comprar con la cartera vacía o venderlo todo no rompe el cálculo.
 */
export function dailyReturns(tl: Timeline): Float64Array {
  const r = new Float64Array(tl.n);
  for (let i = 0; i < tl.n; i++) {
    const base = (i > 0 ? tl.total[i - 1]! : 0) + tl.inflow[i]!;
    r[i] = base > 0.005 ? (tl.total[i]! + tl.outflow[i]!) / base - 1 : 0;
  }
  return r;
}

/** Rentabilidad acumulada (TWR) en los días (from, to]. from = -1 incluye el primer día. */
export function twr(r: Float64Array, from: number, to: number): number {
  let acc = 1;
  for (let i = from + 1; i <= to; i++) acc *= 1 + r[i]!;
  return acc - 1;
}

/** Índice de rentabilidad acumulada en % sobre el día `from` (0 en el origen). */
export function returnIndex(r: Float64Array, from: number, to: number): Float64Array {
  const out = new Float64Array(Math.max(0, to - from + (from < 0 ? 0 : 1)));
  let acc = 1;
  let k = 0;
  if (from >= 0) out[k++] = 0;
  for (let i = from + 1; i <= to; i++) {
    acc *= 1 + r[i]!;
    out[k++] = (acc - 1) * 100;
  }
  return out;
}

export type Flow = { day: number; amount: number };

/** TIR anualizada de una lista de flujos (negativo = aportación). null si no tiene solución. */
export function xirr(flows: Flow[]): number | null {
  const fl = flows.filter((f) => Math.abs(f.amount) > 0.005);
  if (fl.length < 2) return null;
  const t0 = Math.min(...fl.map((f) => f.day));
  if (!fl.some((f) => f.amount > 0) || !fl.some((f) => f.amount < 0)) return null;
  const npv = (rate: number) =>
    fl.reduce((s, f) => s + f.amount / (1 + rate) ** ((f.day - t0) / 365), 0);
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  let fhi = npv(hi);
  if (flo * fhi > 0) {
    hi = 1000;
    fhi = npv(hi);
    if (flo * fhi > 0) return null;
  }
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-10) return mid;
    if (flo * fm < 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

export type PeriodStats = {
  startValue: number;
  endValue: number;
  /** Aportaciones menos retiradas en el periodo. */
  netFlow: number;
  /** Lo que ha ganado la cartera: variación de valor descontando aportaciones. */
  gain: number;
  twr: number;
  /** TIR anualizada (ponderada por dinero); null si el periodo es corto o no converge. */
  xirr: number | null;
  days: number;
};

export function periodStats(tl: Timeline, from: number, to: number): PeriodStats {
  if (tl.n === 0 || to < 0) {
    return { startValue: 0, endValue: 0, netFlow: 0, gain: 0, twr: 0, xirr: null, days: 0 };
  }
  const r = dailyReturns(tl);
  const startValue = from < 0 ? 0 : tl.total[from]!;
  const endValue = tl.total[to]!;
  const flows: Flow[] = [];
  if (from >= 0) flows.push({ day: from, amount: -startValue });
  let netFlow = 0;
  for (let i = from + 1; i <= to; i++) {
    netFlow += tl.inflow[i]! - tl.outflow[i]!;
    if (tl.inflow[i]) flows.push({ day: i, amount: -tl.inflow[i]! });
    if (tl.outflow[i]) flows.push({ day: i, amount: tl.outflow[i]! });
  }
  flows.push({ day: to, amount: endValue });
  const days = to - Math.max(from, 0);
  return {
    startValue,
    endValue,
    netFlow: r2(netFlow),
    gain: r2(endValue - startValue - netFlow),
    twr: twr(r, from, to),
    xirr: days >= 90 ? xirr(flows) : null,
    days,
  };
}

/**
 * Cuánto ha movido el precio lo que hay en cartera en la última sesión de cada
 * activo (la misma variación «Día» de cada posición, sumada en euros).
 */
export function sessionChange(positions: Position[]): { gainEur: number; pct: number } {
  let gain = 0;
  let before = 0;
  for (const p of positions) {
    const prev = p.dayChangePct == null ? p.valueEur : p.valueEur / (1 + p.dayChangePct);
    gain += p.valueEur - prev;
    before += prev;
  }
  return { gainEur: r2(gain), pct: before > 0 ? gain / before : 0 };
}

export type CashReturn = {
  /** Intereses del periodo, brutos y ya sin retenciones, en la divisa de la cuenta. */
  interest: number;
  interestNet: number;
  /** Saldo medio del periodo. */
  avgBalance: number;
  /** Intereses brutos entre saldo medio, anualizado. null con menos de un mes o sin saldo. */
  rate: number | null;
  days: number;
};

/**
 * Lo que renta el efectivo de una cuenta: los intereses del último año entre el
 * saldo medio que ha tenido en ese tiempo, anualizado. Es la cifra que se puede
 * comparar con la TAE que anuncia el banco. La serie debe incluir esa cuenta.
 */
export function cashReturn(tl: Timeline, ledger: Ledger, accountId: string, days = 365): CashReturn {
  const series = tl.cash.get(accountId);
  const end = tl.n - 1;
  if (!series || end < 0) return { interest: 0, interestNet: 0, avgBalance: 0, rate: null, days: 0 };
  // Desde que la cuenta tiene saldo, como mucho un año atrás.
  let first = 0;
  while (first <= end && Math.abs(series[first]!) < 0.005) first++;
  const from = Math.max(first, end - days + 1);
  const span = end - from + 1;
  let sum = 0;
  for (let i = from; i <= end; i++) sum += series[i]!;
  const avg = span > 0 ? sum / span : 0;
  let interest = 0;
  let net = 0;
  for (const n of ledger.ntxs) {
    if (n.tx.accountId !== accountId || n.tx.type !== "interest" || n.day < tl.start + from || n.day > tl.start + end) continue;
    interest += n.tx.amount ?? 0;
    net += n.cashAcct;
  }
  return { interest: r2(interest), interestNet: r2(net), avgBalance: r2(avg), rate: span >= 30 && avg > 0 ? (interest / avg) * (365 / span) : null, days: Math.max(0, span) };
}

/** Aportación neta acumulada día a día (entradas − salidas). */
export function netInvested(tl: Timeline): Float64Array {
  const out = new Float64Array(tl.n);
  let acc = 0;
  for (let i = 0; i < tl.n; i++) {
    acc += tl.inflow[i]! - tl.outflow[i]!;
    out[i] = acc;
  }
  return out;
}

/** Rentabilidad TWR de cada mes natural. */
export function monthlyReturns(tl: Timeline): Array<{ month: string; ret: number }> {
  const r = dailyReturns(tl);
  const out: Array<{ month: string; ret: number }> = [];
  let cur = "";
  let acc = 1;
  for (let i = 0; i < tl.n; i++) {
    const m = isoOf(tl.start + i).slice(0, 7);
    if (m !== cur) {
      if (cur) out.push({ month: cur, ret: acc - 1 });
      cur = m;
      acc = 1;
    }
    acc *= 1 + r[i]!;
  }
  if (cur) out.push({ month: cur, ret: acc - 1 });
  return out;
}

export type Position = {
  asset: Asset;
  /** Unidades en las cuentas elegidas. */
  qty: number;
  accounts: Array<{ accountId: string; qty: number }>;
  /** Coste de adquisición (FIFO) de las unidades que quedan. */
  costEur: number;
  /** Último precio en la divisa del activo y su fecha. */
  price: number | null;
  priceDate: string | null;
  valueEur: number;
  unrealizedEur: number;
  unrealizedPct: number | null;
  /** Peso sobre el total de posiciones. */
  weight: number;
  /** Variación del último cierre frente al anterior, en la divisa del activo. */
  dayChangePct: number | null;
};

export function buildPositions(
  ledger: Ledger,
  state: AppState,
  scope: Scope,
  today: string,
): Position[] {
  const day = dayNum(today);
  const { market } = ledger;
  const holdings = holdingsAt(ledger, day);
  const assets = new Map(state.assets.map((a) => [a.id, a]));
  const totalQty = new Map<string, number>();
  const scoped = new Map<string, Array<{ accountId: string; qty: number }>>();
  for (const [key, qty] of holdings) {
    const [accountId, assetId] = key.split("|") as [string, string];
    totalQty.set(assetId, (totalQty.get(assetId) ?? 0) + qty);
    if (scope && !scope.has(accountId)) continue;
    const arr = scoped.get(assetId) ?? [];
    arr.push({ accountId, qty });
    scoped.set(assetId, arr);
  }

  const out: Position[] = [];
  for (const [assetId, accts] of scoped) {
    const asset = assets.get(assetId);
    if (!asset) continue;
    const qty = accts.reduce((s, a) => s + a.qty, 0);
    if (Math.abs(qty) < 1e-9) continue;
    const lots = ledger.lots.get(assetId) ?? [];
    const lotCost = lots.reduce((s, l) => s + l.costEur, 0);
    const all = totalQty.get(assetId) ?? 0;
    // El FIFO es global: el coste se reparte entre cuentas en proporción a las unidades.
    const costEur = all > 1e-9 ? r2((lotCost * qty) / all) : 0;
    const price = market.price(assetId, day);
    const pDay = market.priceDay(assetId, day);
    const priceEur = market.priceEur(assetId, day) ?? 0;
    const valueEur = r2(qty * priceEur);
    const prev = pDay != null ? market.price(assetId, pDay - 1) : null;
    out.push({
      asset,
      qty,
      accounts: accts,
      costEur,
      price,
      priceDate: pDay != null ? isoOf(pDay) : null,
      valueEur,
      unrealizedEur: r2(valueEur - costEur),
      unrealizedPct: costEur > 0 ? (valueEur - costEur) / costEur : null,
      weight: 0,
      dayChangePct: price != null && prev ? price / prev - 1 : null,
    });
  }
  const sum = out.reduce((s, p) => s + p.valueEur, 0);
  for (const p of out) p.weight = sum > 0 ? p.valueEur / sum : 0;
  return out.sort((a, b) => b.valueEur - a.valueEur);
}

export type Totals = {
  /** Plusvalía realizada (ventas emparejadas FIFO). */
  realizedEur: number;
  /** Dividendos netos de retenciones. */
  dividendsEur: number;
  interestEur: number;
  /** Comisiones de compraventa más comisiones sueltas. */
  feesEur: number;
};

/** Resultados cobrados entre dos fechas (ambas incluidas) en las cuentas elegidas. */
export function totalsIn(ledger: Ledger, scope: Scope, from: string, to: string): Totals {
  const ok = (id: string) => !scope || scope.has(id);
  let realizedEur = 0;
  for (const m of ledger.matches) {
    if (ok(m.accountId) && m.sellDate >= from && m.sellDate <= to) realizedEur += m.gainEur;
  }
  let dividendsEur = 0;
  let interestEur = 0;
  let feesEur = 0;
  for (const t of ledger.ntxs) {
    const { tx } = t;
    if (!ok(tx.accountId) || tx.date < from || tx.date > to) continue;
    if (tx.type === "dividend") dividendsEur += t.cashEur;
    else if (tx.type === "interest") interestEur += t.cashEur;
    if (tx.type === "fee") feesEur += t.grossEur;
    else feesEur += t.feeEur;
  }
  return {
    realizedEur: r2(realizedEur),
    dividendsEur: r2(dividendsEur),
    interestEur: r2(interestEur),
    feesEur: r2(feesEur),
  };
}
