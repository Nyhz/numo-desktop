import type { CSSProperties, ReactNode } from "react";
import { ASSET_KIND_LABEL, type AssetKind } from "../../shared/types.ts";
import { RANGES, setDemo, setRange, useApp, type RangeKey } from "../data/store.ts";
import { seriesColor } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Empty, Pills } from "../ui/kit.tsx";

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
  return (
    <Empty
      title="Tu cartera, en un solo sitio"
      action={
        <>
          <Btn variant="cta" onClick={() => openDialog({ kind: "account" })}>
            Crear la primera cuenta
          </Btn>
          <Btn onClick={() => openDialog({ kind: "import" })}>Importar un CSV</Btn>
          <Btn variant="ghost" onClick={() => setDemo(true)}>
            Ver una cartera de ejemplo
          </Btn>
        </>
      }
    >
      Crea una cuenta por cada bróker, banco o exchange y registra en ella tus compras, ventas y dividendos. Caudal calcula el resto.
    </Empty>
  );
}

// ── Tablas en rejilla ──────────────────────────────────────────────────────
// Cada tabla define su plantilla de columnas una vez y la comparten cabecera,
// filas y pie. Los numéricos van a la derecha: se alinean con `l` los que no.

export function Table({ cols, minWidth, children }: { cols: string; minWidth: number; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <div className="text-right" style={{ minWidth, "--cols": cols } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}
const grid: CSSProperties = { gridTemplateColumns: "var(--cols)" };

export const THead = ({ children }: { children: ReactNode }) => (
  <div className="thead" style={grid} role="row">
    {children}
  </div>
);
export const TRow = ({ children, onClick, onMouseEnter, linked, className = "" }: { children: ReactNode; onClick?: () => void; onMouseEnter?: () => void; linked?: boolean; className?: string }) => (
  <div className={`trow hover:bg-wash ${onClick ? "cursor-pointer" : ""} ${linked ? "linked" : ""} ${className}`} style={grid} role="row" onClick={onClick} onMouseEnter={onMouseEnter}>
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
