import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

// Movimiento de la interfaz. Una sola regla: algo se mueve cuando cambia, por
// algo que has hecho o porque han llegado datos nuevos; nunca en bucle ni para
// adornar. Todo dura unos 300 ms, con la misma curva, y se apaga entero si el
// sistema pide menos movimiento.

export const EASE = "cubic-bezier(.2,.8,.2,1)";

export const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Una cifra que pasa de su valor anterior al nuevo en vez de saltar. No cuenta
 * desde cero al aparecer: solo se mueve cuando el dato cambia. Con `snap` sigue
 * al dato sin retraso (la cifra que acompaña al cursor sobre un gráfico).
 */
export function useTween(target: number, { ms = 320, snap = false }: { ms?: number; snap?: boolean } = {}): number {
  const [shown, setShown] = useState(target);
  // Lo último que se pintó: de ahí sale la siguiente transición, aunque la anterior no hubiera terminado.
  const last = useRef(target);
  useEffect(() => {
    const from = last.current;
    if (snap || reducedMotion() || !Number.isFinite(from) || !Number.isFinite(target) || Math.abs(target - from) < 0.005) {
      last.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let id = requestAnimationFrame(function tick() {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const v = k < 1 ? from + (target - from) * (1 - (1 - k) ** 3) : target;
      last.current = v;
      setShown(v);
      if (k < 1) id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [target, snap, ms]);
  return snap ? target : shown;
}

/**
 * Destello breve en un dato que acaba de cambiar (un precio que se actualiza):
 * verde si sube y rojo si baja. No salta al aparecer el elemento.
 */
export function useFlash<T extends HTMLElement>(value: number | null | undefined): RefObject<T | null> {
  const ref = useRef<T>(null);
  const prev = useRef(value);
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    const el = ref.current;
    if (!el || before == null || value == null || Math.abs(value - before) < 1e-9) return;
    el.classList.remove("flash-up", "flash-down");
    // Leer el ancho obliga a recalcular estilos: así la animación vuelve a empezar si ya estaba en marcha.
    void el.offsetWidth;
    el.classList.add(value > before ? "flash-up" : "flash-down");
    // La clase se quita al terminar: si se quedara, el destello se repetiría al reordenar la tabla
    // (el navegador reinicia las animaciones CSS de un elemento cuando lo cambia de sitio).
    el.addEventListener("animationend", () => el.classList.remove("flash-up", "flash-down"), { once: true });
  }, [value]);
  return ref;
}

/**
 * Filas que se desplazan a su sitio nuevo al reordenar, en vez de recolocarse de
 * golpe. Se pone la referencia en el contenedor (que ha de ser `relative`) y
 * `data-flip="<clave>"` en cada fila; `order` cambia cuando cambia el orden.
 */
export function useFlip<T extends HTMLElement>(order: string): RefObject<T | null> {
  const ref = useRef<T>(null);
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const next = new Map<string, number>();
    const still = reducedMotion();
    for (const row of box.querySelectorAll<HTMLElement>("[data-flip]")) {
      const key = row.dataset.flip!;
      const top = row.offsetTop;
      next.set(key, top);
      const before = tops.current.get(key);
      if (!still && before != null && before !== top) row.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], { duration: 320, easing: EASE });
    }
    tops.current = next;
  }, [order]);
  return ref;
}

/**
 * Barras que crecen desde su origen al aparecer: se pone como `ref` y el origen
 * con `origin-left`, `origin-right`, `origin-bottom` u `origin-top`. Va por
 * código y no por CSS porque una animación CSS volvería a empezar cada vez que
 * la fila cambia de sitio en la tabla.
 */
const grow = (axis: "X" | "Y") => (el: HTMLElement | null) => {
  if (!el || reducedMotion()) return;
  // En el arranque espera a que su bloque haya entrado.
  const delay = document.documentElement.dataset.splash ? 900 : 120;
  el.animate([{ transform: `scale${axis}(0)` }, { transform: "none" }], { duration: 600, delay, easing: EASE, fill: "backwards" });
};
export const growX = grow("X");
export const growY = grow("Y");

/**
 * Para lo que se abre y se cierra (desplegables): sigue montado un momento
 * después de cerrarse, marcado como `leaving`, para que pueda irse animado.
 */
export function usePresence(open: boolean, ms = 130): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) return setMounted(true);
    if (reducedMotion()) return setMounted(false);
    const id = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(id);
  }, [open, ms]);
  return { mounted: open || mounted, leaving: !open && mounted };
}

/** Cuenta las veces que cambia `signature` después de montar: 0 = es lo que había al aparecer. */
export function useChanges(signature: string): number {
  const ref = useRef({ signature, n: 0 });
  if (ref.current.signature !== signature) ref.current = { signature, n: ref.current.n + 1 };
  return ref.current.n;
}

// ── Lo recién guardado ─────────────────────────────────────────────────────
// Al guardar una operación, su fila (y la del activo) se resaltan un momento:
// confirma el guardado y enseña dónde ha ido a parar.

let fresh: ReadonlySet<string> = new Set();
let clear: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();

export function markFresh(...ids: Array<string | null | undefined>): void {
  fresh = new Set(ids.filter((id): id is string => !!id));
  subs.forEach((f) => f());
  clearTimeout(clear);
  clear = setTimeout(() => {
    fresh = new Set();
    subs.forEach((f) => f());
  }, 2400);
}

export const useFresh = (): ReadonlySet<string> =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => fresh,
  );
