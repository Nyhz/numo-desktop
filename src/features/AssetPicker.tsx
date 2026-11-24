import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, todayIso } from "../../shared/dates.ts";
import { ASSET_KINDS, ASSET_KIND_LABEL, type Asset, type AssetKind } from "../../shared/types.ts";
import { searchMarket, yahooChart, type SearchHit } from "../data/market.ts";
import { backend, isExample, saveAsset, useApp } from "../data/store.ts";
import { Button, toast } from "../ui/kit.tsx";

type Item =
  | { kind: "own"; asset: Asset }
  | { kind: "market"; hit: SearchHit }
  | { kind: "manual"; name: string };

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/**
 * Elegir un activo escribiendo: primero los que ya tienes, después el mercado
 * (por nombre, símbolo o ISIN) y, si no aparece, crearlo con precio manual.
 */
export function AssetPicker({ value, onChange, autoFocus, exclude }: { value: string; onChange: (id: string) => void; autoFocus?: boolean; exclude?: string }) {
  const assets = useApp((s) => (s.demo ?? s.loaded).state.assets);
  const example = useApp((s) => isExample(s));
  const selected = assets.find((a) => a.id === value);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<{ name: string; kind: AssetKind; currency: string; isin: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const term = q.trim();
  const own = useMemo(() => {
    const t = term.toLowerCase();
    return assets
      .filter((a) => a.id !== exclude)
      .filter((a) => !t || a.name.toLowerCase().includes(t) || a.symbol?.toLowerCase().includes(t) || a.isin?.toLowerCase().includes(t))
      .slice(0, 8);
  }, [assets, term, exclude]);

  // Búsqueda en el mercado, con espera para no lanzar una petición por tecla.
  useEffect(() => {
    setHits([]);
    if (!open || example || term.length < 2) return;
    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchMarket(backend.httpGet, term);
        if (alive) setHits(found.filter((h) => !assets.some((a) => a.symbol === h.symbol)));
      } catch {
        // Sin conexión o límite de peticiones: se sigue pudiendo crear a mano.
      } finally {
        if (alive) setSearching(false);
      }
    }, 320);
    return () => {
      alive = false;
      clearTimeout(timer);
      setSearching(false);
    };
  }, [term, open, example, assets]);

  const items: Item[] = [
    ...own.map((asset) => ({ kind: "own", asset }) as Item),
    ...hits.map((hit) => ({ kind: "market", hit }) as Item),
    ...(term.length >= 2 ? [{ kind: "manual", name: term } as Item] : []),
  ];
  useEffect(() => setCursor(0), [term]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
    setManual(null);
  };

  const choose = async (it: Item) => {
    if (it.kind === "own") return pick(it.asset.id);
    if (it.kind === "manual") {
      const isin = ISIN.test(it.name.toUpperCase());
      setOpen(false);
      return setManual({ name: isin ? "" : it.name, kind: "fund", currency: "EUR", isin: isin ? it.name.toUpperCase() : "" });
    }
    // Del mercado: hace falta una consulta más para saber en qué divisa cotiza.
    setBusy(true);
    try {
      const quote = await yahooChart(backend.httpGet, it.hit.symbol, addDays(todayIso(), -10), todayIso());
      const res = await saveAsset({
        name: it.hit.name,
        kind: it.hit.kind,
        symbol: it.hit.symbol,
        isin: ISIN.test(term.toUpperCase()) ? term.toUpperCase() : null,
        currency: quote.currency,
        priceSource: "yahoo",
      });
      if (res.ok) pick(res.value.id);
      else toast(res.error, { tone: "error" });
    } catch (e) {
      toast(`No se pudo consultar ${it.hit.symbol}: ${e instanceof Error ? e.message : e}. Prueba otra vez o créalo con precio manual.`, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (manual) {
    const create = async () => {
      const res = await saveAsset({ ...manual, symbol: null, isin: manual.isin || null, priceSource: "manual" });
      if (res.ok) pick(res.value.id);
      else toast(res.error, { tone: "error" });
    };
    return (
      <div className="rounded-md border border-line-strong p-3">
        <div className="mb-2 text-[12px] text-ink-2">Activo nuevo con precio manual</div>
        <div className="grid grid-cols-[1fr_120px_76px] gap-2">
          <input className="field" placeholder="Nombre" autoFocus value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
          <select className="field" value={manual.kind} onChange={(e) => setManual({ ...manual, kind: e.target.value as AssetKind })}>
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {ASSET_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input className="field uppercase" placeholder="EUR" maxLength={3} value={manual.currency} onChange={(e) => setManual({ ...manual, currency: e.target.value.toUpperCase() })} />
        </div>
        <div className="mt-2 flex gap-2">
          <input className="field uppercase" placeholder="ISIN (opcional)" maxLength={12} value={manual.isin} onChange={(e) => setManual({ ...manual, isin: e.target.value.toUpperCase() })} />
          <Button onClick={() => setManual(null)}>Cancelar</Button>
          <Button variant="primary" onClick={create}>
            Crear activo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search size={14} className="pointer-events-none absolute top-[9px] left-2.5 text-muted" />
      <input
        ref={input}
        className="field pl-8"
        autoFocus={autoFocus}
        data-autofocus={autoFocus ? "" : undefined}
        role="combobox"
        aria-expanded={open}
        aria-controls="asset-options"
        placeholder={selected ? selected.name : "Nombre, símbolo o ISIN"}
        value={open ? q : (selected?.name ?? "")}
        disabled={busy}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setCursor((c) => Math.min(items.length - 1, c + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.key === "Enter" && open && items[cursor]) {
            e.preventDefault();
            void choose(items[cursor]!);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (items.length > 0 || searching) && (
        <ul id="asset-options" role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg bg-raised py-1" style={{ boxShadow: "var(--shadow)" }}>
          {items.map((it, i) => {
            const first = i === 0 || items[i - 1]!.kind !== it.kind;
            return (
              <li key={i} role="option" aria-selected={i === cursor}>
                {first && it.kind !== "manual" && <div className="px-3 pt-1.5 pb-0.5 text-[11.5px] text-muted">{it.kind === "own" ? "Tus activos" : "En el mercado"}</div>}
                <button
                  type="button"
                  className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left ${i === cursor ? "bg-wash-strong" : "hover:bg-wash"}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => void choose(it)}
                >
                  {it.kind === "own" && (
                    <>
                      <span className="truncate">{it.asset.name}</span>
                      <span className="ml-auto shrink-0 text-[12px] text-muted">{[it.asset.symbol, it.asset.isin, it.asset.currency].filter(Boolean).join("  ")}</span>
                    </>
                  )}
                  {it.kind === "market" && (
                    <>
                      <span className="truncate">{it.hit.name}</span>
                      <span className="ml-auto shrink-0 text-[12px] text-muted">{[it.hit.symbol, it.hit.exchange, ASSET_KIND_LABEL[it.hit.kind]].filter(Boolean).join("  ")}</span>
                    </>
                  )}
                  {it.kind === "manual" && <span className="text-ink-2">Crear «{it.name}» con precio manual</span>}
                </button>
              </li>
            );
          })}
          {searching && <li className="px-3 py-1.5 text-[12px] text-muted">Buscando en el mercado…</li>}
        </ul>
      )}
    </div>
  );
}
