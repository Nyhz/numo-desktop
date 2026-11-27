import { useSyncExternalStore } from "react";
import { reducedMotion } from "./motion.ts";
import type { Account, Asset, Mortgage, MortgageEventType, Property, Tx, TxType } from "../../shared/types.ts";

/** Qué diálogo está abierto. Solo hay uno a la vez. */
export type DialogState =
  | { kind: "tx"; tx?: Tx; preset?: { type?: TxType; assetId?: string; accountId?: string } }
  | { kind: "account"; account?: Account }
  | { kind: "asset"; asset?: Asset; stay?: boolean }
  | { kind: "price"; asset: Asset }
  | { kind: "import" }
  | { kind: "restore" }
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

/**
 * Cierra el diálogo abierto. Antes de quitarlo lo marca como `closing` un
 * instante para que se vaya animado (styles.css); si mientras tanto se abre
 * otro, ese se queda.
 */
export function closeDialog(): void {
  const closing = state;
  const el = document.querySelector("dialog[open]");
  if (!closing || !el || reducedMotion()) return openDialog(null);
  if (el.classList.contains("closing")) return;
  el.classList.add("closing");
  setTimeout(() => {
    if (state === closing) openDialog(null);
  }, 140);
}

export const useDialog = (): DialogState =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => state,
  );
