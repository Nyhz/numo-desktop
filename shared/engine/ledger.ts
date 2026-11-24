import { addMonths, dayNum } from "../dates.ts";
import type { Account, AppState, Asset, AssetKind, Tx, TxType } from "../types.ts";
import { Market } from "./market.ts";

/** Redondeo a céntimos. */
export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const QTY_EPS = 1e-9;

/**
 * Meses de la ventana de recompra que limita compensar pérdidas: 2 para valores
 * cotizados, 12 para no cotizados. 0 = no se revisa. Es solo un aviso orientativo.
 */
export const rebuyWindowMonths = (kind: AssetKind): number =>
  kind === "stock" || kind === "etf" || kind === "bond" ? 2 : kind === "fund" ? 12 : 0;

// Orden dentro de un mismo día: primero lo que aporta, después lo que consume.
const ORDER: Record<TxType, number> = {
  deposit: 0,
  buy: 1,
  transfer: 2,
  dividend: 3,
  interest: 4,
  sell: 5,
  fee: 6,
  withdrawal: 7,
};

/** Operación normalizada: importes en EUR al cambio de la operación y unidades actuales. */
export type NTx = {
  tx: Tx;
  day: number;
  account: Account;
  asset: Asset | null;
  /** Unidades ajustadas por splits posteriores. */
  qty: number;
  toQty: number;
  /** Bruto en EUR: unidades × precio, o importe. */
  grossEur: number;
  feeEur: number;
  taxSourceEur: number;
  taxHomeEur: number;
  /** Efecto con signo sobre el efectivo, en EUR al cambio de la operación. */
  cashEur: number;
  /** Efecto con signo sobre el efectivo, en la divisa de la cuenta. */
  cashAcct: number;
};

/** Lote de compra pendiente de vender. */
export type Lot = {
  assetId: string;
  acqDate: string;
  acqDay: number;
  qty: number;
  costEur: number;
  /** Operación que originó el lote (la compra original, también tras un traspaso). */
  srcTxId: string;
};

/** Venta emparejada con un lote de compra (FIFO). */
export type Match = {
  sellTxId: string;
  assetId: string;
  accountId: string;
  sellDate: string;
  /** null si la venta no tenía compra previa registrada. */
  acqDate: string | null;
  qty: number;
  costEur: number;
  proceedsEur: number;
  gainEur: number;
  srcTxId: string | null;
  /** Tras la venta siguen en cartera unidades compradas dentro de la ventana de recompra. */
  heldRecent: boolean;
};

export type Issue = {
  txId: string;
  kind: "oversell" | "overtransfer";
  assetId: string;
  missingQty: number;
};

export type Ledger = {
  ntxs: NTx[];
  /** Lotes abiertos por activo, del más antiguo al más reciente. */
  lots: Map<string, Lot[]>;
  matches: Match[];
  issues: Issue[];
  market: Market;
};

function normalize(state: AppState, market: Market): NTx[] {
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const assets = new Map(state.assets.map((a) => [a.id, a]));
  const out: NTx[] = [];

  for (const tx of state.txs) {
    const account = accounts.get(tx.accountId);
    if (!account) continue; // operación huérfana: no debería existir, se ignora
    const asset = tx.assetId ? (assets.get(tx.assetId) ?? null) : null;
    const day = dayNum(tx.date);
    const fx = tx.currency === "EUR" || !(tx.fxRate > 0) ? 1 : tx.fxRate;
    const eur = (native: number) => r2(native / fx);

    const rawQty = tx.quantity ?? 0;
    const factor = tx.assetId ? market.splitFactor(tx.assetId, day) : 1;
    const toFactor =
      tx.type === "transfer" && tx.toAssetId ? market.splitFactor(tx.toAssetId, day) : factor;

    const isTrade = tx.type === "buy" || tx.type === "sell";
    const grossNative = isTrade ? rawQty * (tx.price ?? 0) : (tx.amount ?? 0);
    const feeIsEur = tx.feeCurrency === "EUR";
    const fee = tx.type === "fee" ? 0 : tx.fee || 0;
    const feeEur = feeIsEur ? r2(fee) : eur(fee);
    const feeNative = feeIsEur ? fee * fx : fee;
    const taxSource = tx.taxSource || 0;
    const taxHome = tx.taxHome || 0;

    let netNative = 0;
    switch (tx.type) {
      case "buy":
        netNative = -(grossNative + feeNative);
        break;
      case "sell":
        netNative = grossNative - feeNative;
        break;
      case "dividend":
      case "interest":
        netNative = grossNative - taxSource - taxHome - feeNative;
        break;
      case "deposit":
        netNative = grossNative;
        break;
      case "withdrawal":
      case "fee":
        netNative = -grossNative;
        break;
      case "transfer":
        netNative = -feeNative;
        break;
    }

    const grossEur = eur(grossNative);
    const taxSourceEur = eur(taxSource);
    const taxHomeEur = eur(taxHome);
    let cashEur: number;
    switch (tx.type) {
      case "buy":
        cashEur = -(grossEur + feeEur);
        break;
      case "sell":
        cashEur = grossEur - feeEur;
        break;
      case "dividend":
      case "interest":
        cashEur = r2(grossEur - taxSourceEur - taxHomeEur - feeEur);
        break;
      case "deposit":
        cashEur = grossEur;
        break;
      case "withdrawal":
      case "fee":
        cashEur = -grossEur;
        break;
      default:
        cashEur = -feeEur;
    }
    cashEur = r2(cashEur);

    let cashAcct: number;
    if (tx.currency === account.currency) cashAcct = netNative;
    else if (account.currency === "EUR") cashAcct = cashEur;
    else cashAcct = cashEur * market.fx(account.currency, day);

    out.push({
      tx,
      day,
      account,
      asset,
      qty: rawQty * factor,
      toQty: (tx.toQuantity ?? rawQty) * toFactor,
      grossEur,
      feeEur,
      taxSourceEur,
      taxHomeEur,
      cashEur,
      cashAcct,
    });
  }

  out.sort(
    (a, b) =>
      a.day - b.day ||
      ORDER[a.tx.type] - ORDER[b.tx.type] ||
      a.tx.createdAt.localeCompare(b.tx.createdAt) ||
      a.tx.id.localeCompare(b.tx.id),
  );
  return out;
}

type Portion = { lot: Lot; take: number; costEur: number };

/** Consume unidades de los lotes más antiguos. Devuelve las porciones y lo que faltó. */
function consume(lots: Lot[], qty: number): { portions: Portion[]; missing: number } {
  const portions: Portion[] = [];
  let left = qty;
  while (left > QTY_EPS && lots.length) {
    const lot = lots[0]!;
    const take = Math.min(lot.qty, left);
    const whole = lot.qty - take <= QTY_EPS;
    // Al agotar el lote se lleva todo el coste restante: nunca quedan céntimos sueltos.
    const costEur = whole ? lot.costEur : r2((lot.costEur * take) / lot.qty);
    portions.push({ lot: { ...lot }, take, costEur });
    if (whole) lots.shift();
    else {
      lot.qty -= take;
      lot.costEur = r2(lot.costEur - costEur);
    }
    left -= take;
  }
  return { portions, missing: left > QTY_EPS ? left : 0 };
}

function insertLot(lots: Lot[], lot: Lot): void {
  // Mantiene el orden por fecha de adquisición (los traspasos heredan fechas antiguas).
  let i = lots.length;
  while (i > 0 && lots[i - 1]!.acqDay > lot.acqDay) i--;
  lots.splice(i, 0, lot);
}

/**
 * Recorre todas las operaciones y construye los lotes FIFO.
 *
 * El FIFO es global por activo, no por cuenta: es como la normativa española
 * trata los valores homogéneos aunque estén en entidades distintas. Por eso se
 * calcula siempre con todas las cuentas y el filtro se aplica después.
 */
export function buildLedger(state: AppState): Ledger {
  const market = new Market(state);
  const ntxs = normalize(state, market);
  const lots = new Map<string, Lot[]>();
  const matches: Match[] = [];
  const issues: Issue[] = [];
  const lotsOf = (id: string) => {
    let l = lots.get(id);
    if (!l) lots.set(id, (l = []));
    return l;
  };

  for (const n of ntxs) {
    const { tx } = n;
    if (!tx.assetId) continue;

    if (tx.type === "buy" && n.qty > QTY_EPS) {
      insertLot(lotsOf(tx.assetId), {
        assetId: tx.assetId,
        acqDate: tx.date,
        acqDay: n.day,
        qty: n.qty,
        costEur: r2(n.grossEur + n.feeEur),
        srcTxId: tx.id,
      });
    } else if (tx.type === "sell" && n.qty > QTY_EPS) {
      const { portions, missing } = consume(lotsOf(tx.assetId), n.qty);
      const months = n.asset ? rebuyWindowMonths(n.asset.kind) : 0;
      const since = months ? dayNum(addMonths(tx.date, -months)) : Number.POSITIVE_INFINITY;
      const heldRecent = lotsOf(tx.assetId).some((l) => l.acqDay >= since);
      const proceeds = r2(n.grossEur - n.feeEur);
      let allocated = 0;
      const rows = portions.map((p) => ({ ...p, proceedsEur: 0 }));
      rows.forEach((p, i) => {
        const last = i === rows.length - 1 && missing === 0;
        p.proceedsEur = last ? r2(proceeds - allocated) : r2((proceeds * p.take) / n.qty);
        allocated = r2(allocated + p.proceedsEur);
      });
      for (const p of rows) {
        matches.push({
          sellTxId: tx.id,
          assetId: tx.assetId,
          accountId: tx.accountId,
          sellDate: tx.date,
          acqDate: p.lot.acqDate,
          qty: p.take,
          costEur: p.costEur,
          proceedsEur: p.proceedsEur,
          gainEur: r2(p.proceedsEur - p.costEur),
          srcTxId: p.lot.srcTxId,
          heldRecent,
        });
      }
      if (missing > 0) {
        const rest = r2(proceeds - allocated);
        matches.push({
          sellTxId: tx.id,
          assetId: tx.assetId,
          accountId: tx.accountId,
          sellDate: tx.date,
          acqDate: null,
          qty: missing,
          costEur: 0,
          proceedsEur: rest,
          gainEur: rest,
          srcTxId: null,
          heldRecent,
        });
        issues.push({ txId: tx.id, kind: "oversell", assetId: tx.assetId, missingQty: missing });
      }
    } else if (tx.type === "transfer" && tx.toAssetId && tx.toAssetId !== tx.assetId) {
      // Traspaso entre activos distintos (p. ej. entre fondos): no hay venta;
      // el destino hereda fecha y coste de adquisición de cada lote de origen.
      const { portions, missing } = consume(lotsOf(tx.assetId), n.qty);
      const dest = lotsOf(tx.toAssetId);
      const moved = n.qty - missing;
      for (const p of portions) {
        insertLot(dest, {
          assetId: tx.toAssetId,
          acqDate: p.lot.acqDate,
          acqDay: p.lot.acqDay,
          qty: moved > 0 ? (n.toQty * p.take) / moved : 0,
          costEur: p.costEur,
          srcTxId: p.lot.srcTxId,
        });
      }
      if (missing > 0) {
        issues.push({
          txId: tx.id,
          kind: "overtransfer",
          assetId: tx.assetId,
          missingQty: missing,
        });
      }
    }
  }

  return { ntxs, lots, matches, issues, market };
}

/** Unidades actuales por cuenta y activo. Clave: `${accountId}|${assetId}`. */
export function holdingsAt(ledger: Ledger, uptoDay: number): Map<string, number> {
  const h = new Map<string, number>();
  const add = (acct: string, asset: string, q: number) => {
    const k = `${acct}|${asset}`;
    const v = (h.get(k) ?? 0) + q;
    if (Math.abs(v) <= QTY_EPS) h.delete(k);
    else h.set(k, v);
  };
  for (const n of ledger.ntxs) {
    if (n.day > uptoDay) break;
    const { tx } = n;
    if (!tx.assetId) continue;
    if (tx.type === "buy") add(tx.accountId, tx.assetId, n.qty);
    else if (tx.type === "sell") add(tx.accountId, tx.assetId, -n.qty);
    else if (tx.type === "transfer") {
      add(tx.accountId, tx.assetId, -n.qty);
      add(tx.toAccountId ?? tx.accountId, tx.toAssetId ?? tx.assetId, n.toQty);
    }
  }
  return h;
}
