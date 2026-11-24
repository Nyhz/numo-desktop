import { useSyncExternalStore } from "react";
import type { Account, Asset, Mortgage, MortgageEventType, Property, Tx, TxType } from "../../shared/types.ts";

/** Qué diálogo está abierto. Solo hay uno a la vez. */
export type DialogState =
  | { kind: "tx"; tx?: Tx; preset?: { type?: TxType; assetId?: string; accountId?: string } }
  | { kind: "account"; account?: Account }
  | { kind: "asset"; asset: Asset }
  | { kind: "price"; asset: Asset }
  | { kind: "import" }
  | { kind: "property"; property?: Property }
  | { kind: "mortgageEvent"; mortgage: Mortgage; type: MortgageEventType; amount?: number; mode?: "reduce_term" | "reduce_installment" }
  | { kind: "valuation"; property: Property }
  | null;

let state: DialogState = null;
const subs = new Set<() => void>();

export function openDialog(next: DialogState): void {
  state = next;
  subs.forEach((f) => f());
}
export const closeDialog = () => openDialog(null);

export const useDialog = (): DialogState =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => state,
  );
