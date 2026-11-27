import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ASSET_KIND_LABEL, type AssetKind } from "../../shared/types.ts";
import { RANGES, backend, chooseSyncFolder, setDemo, setRange, syncDevices, syncFolder, useApp, type RangeKey } from "../data/store.ts";
import { num, seriesColor } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Empty, Pills, toast } from "../ui/kit.tsx";
import { useFlip } from "../ui/motion.ts";

// Color fijo por tipo de activo y por divisa: el color sigue a la categoría.
export type Kind = AssetKind | "cash";
export const KIND_ORDER: Kind[] = ["etf", "stock", "fund", "crypto", "bond", "other", "cash"];
const KIND_SLOT: Record<Kind, number> = { etf: 1, stock: 2, fund: 3, crypto: 4, bond: 5, other: 6, cash: 0 };
export const kindColor = (k: Kind) => seriesColor(KIND_SLOT[k]);
export const kindLabel = (k: string) => (k === "cash" ? "Efectivo" : ASSET_KIND_LABEL[k as AssetKind]);

export const RANGE_PHRASE: Record<RangeKey, string> = {
  "1M": "en el último mes",
  "3M": "en 3 meses",
  "6M": "en 6 meses",
  YTD: "en lo que va de año",
  "1A": "en el último año",
  "3A": "en 3 años",
  ALL: "desde el inicio",
};

/** Selector de periodo, centrado bajo el gráfico al que afecta. */
export function PeriodPills() {
  const range = useApp((s) => s.range);
  return (
    <div className="mt-3.5 flex justify-center">
      <Pills bare label="Periodo" value={range} options={RANGES.map(([k, t]) => [k, t.replace(" ", "")] as const)} onChange={setRange} />
    </div>
  );
}

export function Welcome() {
  const dir = useApp((s) => syncFolder(s));
  const busy = useApp((s) => s.devices.busy);
  // Un equipo recién instalado empieza vacío: la cartera de otro equipo llega al elegir aquí la misma carpeta compartida.
  const bring = async () => {
    const res = dir ? await syncDevices() : await chooseSyncFolder();
    if (!res.ok) return toast(res.error, { tone: "error" });
    if (!res.value) return;
    toast(res.value.pulled ? `Sincronizado: ${res.value.pulled} registros traídos de tus otros equipos` : "En esa carpeta todavía no hay nada de otro equipo");
  };
  return (
    <Empty
      title="Tu cartera, en un solo sitio"
      action={
        <>
          <Btn variant="cta" onClick={() => openDialog({ kind: "account" })}>
            Crear la primera cuenta
          </Btn>
          <Btn onClick={() => openDialog({ kind: "import" })}>Importar un CSV</Btn>
          {backend.native && (
            <Btn onClick={() => void bring()} disabled={busy}>
              {busy ? "Sincronizando…" : dir ? "Sincronizar ahora" : "Ya uso Numo en otro equipo"}
            </Btn>
          )}
          <Btn variant="ghost" onClick={() => setDemo(true)}>
            Ver una cartera de ejemplo
          </Btn>
        </>
      }
    >
      Crea una cuenta por cada bróker o exchange y registra en ella tus compras, ventas y dividendos. Numo calcula el resto.
      {dir && (
        <span className="mt-3 block text-mute">
          Este equipo ya sincroniza, pero en la carpeta compartida aún no hay nada de otro equipo. Elige esa misma carpeta en el otro (Ajustes → Sincronización entre equipos) y espera a que tu
          servicio de nube la traiga aquí.
        </span>
      )}
    </Empty>
  );
}

// ── Tablas en rejilla ──────────────────────────────────────────────────────
// Cada tabla define su plantilla de columnas una vez y la comparten cabecera,
// filas y pie. Los numéricos van a la derecha: se alinean con `l` los que no.

/**
 * `order`: las claves de las filas en su orden; al cambiar, las filas con `flip` se desplazan a su sitio nuevo.
 * `compact`: otra plantilla, sin las columnas secundarias, para cuando la tabla
 * entera no cabe. Las celdas de esas columnas llevan la clase `opt` y se esconden.
 */
export function Table({ cols, compact, minWidth, order = "", children }: { cols: string; compact?: string; minWidth: number; order?: string; children: ReactNode }) {
  const box = useFlip<HTMLDivElement>(order);
  const { ref, edges, width } = useEdges();
  const full = Math.max(minWidth, tableFloor(cols));
  const small = !!compact && width > 0 && width < full;
  return (
    <div className="relative">
      <div ref={ref} className="overflow-x-auto">
        <div
          ref={box}
          data-compact={small ? "" : undefined}
          className="relative text-right"
          style={{ minWidth: small ? tableFloor(compact) : full, "--cols": small ? compact : cols } as CSSProperties}
        >
          {children}
        </div>
      </div>
      {/* Si ni así cabe, un degradado en el borde avisa de que hay más tabla a ese lado. */}
      <span aria-hidden className={`table-edge left-0 ${edges.left ? "opacity-100" : "opacity-0"}`} />
      <span aria-hidden className={`table-edge right-0 rotate-180 ${edges.right ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}

/**
 * Lo mínimo que ocupa una plantilla de columnas: sus anchos fijos y los mínimos de
 * cada `minmax`, más los huecos entre columnas (12 px) y el relleno de las filas
 * (20 px a cada lado). Por debajo de eso la rejilla se saldría de su caja y la
 * última columna quedaría recortada.
 */
export function tableFloor(cols: string): number {
  const tracks = cols.match(/minmax\([^)]*\)|\S+/g) ?? [];
  const fixed = tracks.reduce((sum, t) => sum + Number((t.startsWith("minmax") ? t.slice(7) : t).match(/^(\d+(?:\.\d+)?)px/)?.[1] ?? 0), 0);
  return fixed + Math.max(0, tracks.length - 1) * 12 + 40;
}

/** Si una caja con scroll horizontal tiene contenido escondido a la izquierda o a la derecha. */
function useEdges() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [width, setWidth] = useState(0);
  // De layout: la tabla se pinta ya con la plantilla que le toca, sin un fotograma con la otra.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
      setWidth(el.clientWidth);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const watch = new ResizeObserver(check);
    watch.observe(el);
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", check);
      watch.disconnect();
    };
  }, []);
  return { ref, edges, width };
}
const grid: CSSProperties = { gridTemplateColumns: "var(--cols)" };

export const THead = ({ children }: { children: ReactNode }) => (
  <div className="thead" style={grid} role="row">
    {children}
  </div>
);
export const TRow = ({
  children,
  onClick,
  onMouseEnter,
  linked,
  flip,
  fresh,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  onMouseEnter?: () => void;
  linked?: boolean;
  /** Clave de la fila para desplazarla al reordenar (ver `order` en Table). */
  flip?: string;
  /** Recién guardada: se resalta un momento. */
  fresh?: boolean;
  className?: string;
}) => (
  <div
    className={`trow hover:bg-wash ${onClick ? "cursor-pointer" : ""} ${linked ? "linked" : ""} ${fresh ? "fresh" : ""} ${className}`}
    style={grid}
    role="row"
    data-flip={flip}
    onClick={onClick}
    onMouseEnter={onMouseEnter}
  >
    {children}
  </div>
);
export const TFoot = ({ children }: { children: ReactNode }) => (
  <div className="tfoot" style={grid} role="row">
    {children}
  </div>
);
/** Celda alineada a la izquierda. */
export const L = ({ children, className = "" }: { children?: ReactNode; className?: string }) => <span className={`min-w-0 text-left ${className}`}>{children}</span>;

// ── Paginación ─────────────────────────────────────────────────────────────
// Las listas que crecen con los años (operaciones, lotes) se ven por páginas: la
// pantalla no se alarga sin fin y no se pintan miles de filas de golpe.

/**
 * Una página de `rows`. Vuelve a la primera cuando cambia `reset` (otro filtro,
 * otra búsqueda…). `anchor` va en la tarjeta de la tabla: al cambiar de página
 * desde el pie, se vuelve a su principio.
 */
export function usePaged<T>(rows: T[], size: number, reset: unknown) {
  const [page, setPage] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => setPage(0), [reset]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  const from = current * size;
  const go = (n: number) => {
    setPage(Math.max(0, Math.min(pages - 1, n)));
    const el = anchor.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  };
  return { rows: rows.slice(from, from + size), page: current, pages, from, to: Math.min(rows.length, from + size), total: rows.length, go, anchor };
}

/** Qué números enseñar: el primero, el último y los de alrededor del actual; el resto, «…». */
function pageList(page: number, pages: number): Array<number | null> {
  const keep = new Set([0, pages - 1, page - 1, page, page + 1].filter((n) => n >= 0 && n < pages));
  if (page <= 2) [1, 2, 3].forEach((n) => n < pages && keep.add(n));
  if (page >= pages - 3) [pages - 4, pages - 3, pages - 2].forEach((n) => n >= 0 && keep.add(n));
  const out: Array<number | null> = [];
  let prev = -1;
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - prev > 1) out.push(null);
    out.push(n);
    prev = n;
  }
  return out;
}

/** Pie de una tabla paginada: qué filas se ven y los botones de página. Con una sola página no aparece. */
export function Pager({ paged, noun }: { paged: Pick<ReturnType<typeof usePaged>, "page" | "pages" | "from" | "to" | "total" | "go">; noun: string }) {
  const { page, pages, from, to, total, go } = paged;
  if (pages <= 1) return null;
  const btn = "grid h-8 min-w-8 place-items-center rounded-lg px-2 text-[12.5px] tabular-nums transition-colors duration-150";
  return (
    <nav aria-label="Páginas" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-2.5">
      <span className="text-[12.5px] text-mute">
        {num(from + 1)}–{num(to)} de {num(total)} {noun}
      </span>
      <div className="flex items-center gap-0.5">
        <button type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => go(page - 1)} className={`${btn} text-ink2 hover:bg-wash disabled:opacity-35 disabled:hover:bg-transparent`}>
          <ChevronLeft size={15} />
        </button>
        {pageList(page, pages).map((n, i) =>
          n == null ? (
            <span key={`gap-${i}`} className="px-1 text-mute">
              …
            </span>
          ) : (
            <button key={n} type="button" aria-current={n === page ? "page" : undefined} onClick={() => go(n)} className={`${btn} ${n === page ? "bg-wash2 font-[550] text-ink" : "text-ink2 hover:bg-wash"}`}>
              {n + 1}
            </button>
          ),
        )}
        <button type="button" aria-label="Página siguiente" disabled={page === pages - 1} onClick={() => go(page + 1)} className={`${btn} text-ink2 hover:bg-wash disabled:opacity-35 disabled:hover:bg-transparent`}>
          <ChevronRight size={15} />
        </button>
      </div>
    </nav>
  );
}
