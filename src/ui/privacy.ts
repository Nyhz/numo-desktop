import { useSyncExternalStore } from "react";

// Modo privado: emborrona importes, saldos y unidades para poder enseñar la app
// sin enseñar cuánto hay. Es solo visual: marca <html data-private> y el CSS
// desenfoca lo que lleve la clase `.priv` (styles.css). Porcentajes, precios de
// mercado y fechas se siguen viendo. No toca los datos ni lo que se exporta.
// index.html lo aplica antes de pintar para que nada se vea al abrir.

const KEY = "caudal.private";
const listeners = new Set<() => void>();

export const isPrivate = (): boolean => document.documentElement.dataset.private != null;

export function togglePrivate(): void {
  const on = !isPrivate();
  if (on) document.documentElement.dataset.private = "";
  else delete document.documentElement.dataset.private;
  localStorage.setItem(KEY, on ? "1" : "0");
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** true con el modo privado activo. Para lo que el CSS no alcanza: los `title`, que no se pueden emborronar. */
export const usePrivate = (): boolean => useSyncExternalStore(subscribe, isPrivate);
