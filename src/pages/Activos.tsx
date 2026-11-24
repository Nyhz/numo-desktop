import { Archive, ChevronDown, CirclePlus, Pencil, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { fxHealth, needsAttention, parseFailure, type Failure, type HealthStatus, type PriceHealth } from "../../shared/engine/health.ts";
import { ASSET_KIND_LABEL, PRICE_SOURCE_SHORT, SOURCE_BY_ISIN, type Asset } from "../../shared/types.ts";
import { derive, isExample, sync, useApp, useHealth } from "../data/store.ts";
import { ago, dateBrief, eur, money, num, price, units } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Dot, Empty, HeaderSlot, IconBtn, Kpi, Kpis, Pills } from "../ui/kit.tsx";
import { L, THead, TRow, Table } from "./common.tsx";

type Filter = "all" | "attention";

const STATUS: Record<HealthStatus, { label: string; color: string; rank: number }> = {
  failed: { label: "Falló la descarga", color: "var(--down)", rank: 0 },
  none: { label: "Sin precio", color: "var(--down)", rank: 1 },
  late: { label: "Atrasado", color: "var(--acc)", rank: 2 },
  manual: { label: "Manual", color: "var(--mute)", rank: 3 },
  ok: { label: "Al día", color: "var(--up)", rank: 4 },
};

const daysAgo = (n: number | null) => (n == null ? "" : n === 0 ? "hoy" : n === 1 ? "ayer" : `hace ${n} días`);

/** Por qué está en ese estado, en una línea. */
function reason(a: Asset, h: PriceHealth, example: boolean): string {
  switch (h.status) {
    case "failed":
      return `${h.failure!.message} · ${ago(h.failure!.at)}`;
    case "none":
      return a.priceSource === "manual" ? "ponle un precio o una fuente" : "todavía no se ha descargado";
    case "late":
      return `sin precio nuevo desde ${daysAgo(h.ageDays)}`;
    case "manual":
      return "no se actualiza solo";
    case "ok":
      return example ? "precio de ejemplo" : h.fetchedAt ? `comprobado ${ago(h.fetchedAt)}` : "";
  }
}

const COLS = "minmax(210px,2.1fr) 150px 118px 112px minmax(190px,1.5fr) 118px 64px";

export function Activos() {
  const state = useApp((s) => (s.demo ?? s.loaded).state);
  const meta = useApp((s) => (s.demo ?? s.loaded).meta);
  const example = useApp((s) => isExample(s));
  const syncing = useApp((s) => s.syncing);
  const issues = useApp((s) => s.issues);
  const { byAsset } = useHealth();
  const [, go] = useLocation();
  const [filter, setFilter] = useState<Filter>("all");
  const [showArchived, setShowArchived] = useState(false);

  // Aquí se ven siempre todos los activos, con independencia del filtro de cuentas.
  const d = derive(state, null);
  const everything = useMemo(() => {
    const held = new Map(d.positions.map((p) => [p.asset.id, p]));
    return state.assets
      .map((asset) => ({ asset, health: byAsset.get(asset.id)!, position: held.get(asset.id) ?? null }))
      .filter((r) => r.health)
      // Lo que necesita atención, arriba.
      .sort((a, b) => STATUS[a.health.status].rank - STATUS[b.health.status].rank || a.asset.name.localeCompare(b.asset.name, "es"));
  }, [state.assets, byAsset, d.positions]);
  // La lista es de lo que se tiene. Lo que no se tiene en ninguna cuenta está archivado: va
  // aparte, al final, y no cuenta en nada de esta pantalla. Nadie lo archiva ni lo recupera:
  // sale de las operaciones (se vende entero, se archiva; se compra, vuelve).
  const rows = useMemo(() => everything.filter((r) => r.position), [everything]);
  const archived = useMemo(() => everything.filter((r) => !r.position).sort((a, b) => a.asset.name.localeCompare(b.asset.name, "es")), [everything]);

  // Las divisas solo se mencionan aquí si su tipo de cambio se ha quedado atrás (el detalle está en Ajustes).
  const lateFx = useMemo(() => {
    const set = new Set<string>([...rows.map((r) => r.asset), ...state.accounts].map((a) => a.currency));
    set.delete("EUR");
    return [...set].sort().map((c) => ({ currency: c, ...fxHealth(state.fx[c], d.today) })).filter((c) => c.late);
  }, [state.fx, rows, state.accounts, d.today]);

  const addButton = (
    <Btn variant="ink" onClick={() => openDialog({ kind: "asset", stay: true })}>
      <Plus size={14} strokeWidth={2.6} /> Activo
    </Btn>
  );

  if (state.assets.length === 0) {
    return (
      <Empty title="Todavía no tienes ningún activo" action={addButton}>
        Los activos aparecen aquí al registrar su primera compra, y desde entonces su precio se actualiza solo. También puedes darlos de alta antes.
      </Empty>
    );
  }

  const attention = rows.filter((r) => needsAttention(r.health));
  const count = (st: HealthStatus) => rows.filter((r) => r.health.status === st).length;
  const breakdown = (
    [
      ["failed", "con fallo"],
      ["none", "sin precio"],
      ["late", count("late") === 1 ? "atrasado" : "atrasados"],
      ["manual", count("manual") === 1 ? "manual" : "manuales"],
    ] as const
  )
    .filter(([st]) => count(st) > 0)
    .map(([st, text]) => `${count(st)} ${text}`)
    .join(" · ");

  const shown = rows.filter((r) => (filter === "attention" ? needsAttention(r.health) : true));

  return (
    <div className="screen flex flex-col gap-5">
      <HeaderSlot>
        <Pills
          label="Qué activos ver"
          value={filter}
          onChange={setFilter}
          options={[
            ["all", `En cartera · ${rows.length}`],
            ["attention", `Con avisos · ${attention.length}`],
          ]}
        />
      </HeaderSlot>

      <div className="flex flex-wrap items-center justify-between gap-4 px-1 pt-2">
        <span className="max-w-[640px] text-pretty text-ink2">Lo que tienes en cartera: de qué día es cada precio y si se está actualizando. Lo que vendes entero se archiva solo, y vuelve al comprarlo.</span>
        <div className="flex gap-2">
          {!example && (
            <Btn onClick={() => void sync(true)} disabled={syncing}>
              <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> {syncing ? "Actualizando…" : "Actualizar ahora"}
            </Btn>
          )}
          {addButton}
        </div>
      </div>

      <Kpis>
        <Kpi label="Activos en cartera" note={archived.length ? `${archived.length} ${archived.length === 1 ? "archivado" : "archivados"}, sin posición` : "ninguno archivado"}>
          {rows.length}
        </Kpi>
        <Kpi label="Al día" note="con el precio de la última sesión">
          {count("ok")}
        </Kpi>
        <Kpi label="Necesitan atención" note={breakdown || "ninguno: todo se actualiza solo"}>
          <span style={{ color: attention.length ? "var(--acc)" : undefined }}>{attention.length}</span>
        </Kpi>
        <Kpi label="Última descarga" note={example ? "la cartera de ejemplo no se actualiza" : "al abrir la app, si han pasado 6 horas"}>
          {example ? "—" : ago(state.lastSync)}
        </Kpi>
      </Kpis>

      {issues.length > 0 && (
        <div className="card flex items-start gap-2.5 px-4 py-3 text-[13px]">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-acc" />
          <div className="min-w-0">
            <div className="font-[550]">Avisos de la última actualización</div>
            <ul className="selectable mt-1 grid gap-0.5 text-[12.5px] text-ink2">
              {issues.map((i, k) => (
                <li key={k}>
                  <span className="font-medium text-ink">{i.what}:</span> {i.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {lateFx.length > 0 && !example && (
        <div className="card flex items-start gap-2.5 px-4 py-3 text-[13px]">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-acc" />
          <div className="min-w-0 text-ink2">
            <span className="font-[550] text-ink">{lateFx.length === 1 ? "Un tipo de cambio se ha quedado atrás" : "Hay tipos de cambio que se han quedado atrás"}:</span>{" "}
            {lateFx.map((c) => `${c.currency} (${c.date ? `último del ${dateBrief(c.date, d.today)}` : "sin datos"})`).join(", ")}. Lo que tengas en esa divisa se convierte a euros con ese cambio hasta
            que el BCE publique otro.
          </div>
        </div>
      )}

      <section className="card overflow-hidden">
        <Table cols={COLS} minWidth={1060}>
          <THead>
            <L>Activo</L>
            <L>Fuente del precio</L>
            <span>Último precio</span>
            <span>Fecha</span>
            <L>Estado</L>
            <span>En cartera</span>
            <span />
          </THead>
          {shown.map(({ asset: a, health: h, position: p }) => {
            const st = STATUS[h.status];
            // Si la fuente principal falló y el precio vino del respaldo, se dice.
            const backup = parseFailure(meta[`backup:asset:${a.id}`]) as (Failure & { source?: string }) | null;
            const why = backup && h.status === "ok" ? `por respaldo (${backup.source ?? "otra fuente"}) · ${backup.message}` : reason(a, h, example);
            return (
              <TRow key={a.id} onClick={() => go(`/activo/${a.id}`)}>
                <L>
                  <div className="truncate font-[550]">{a.name}</div>
                  <div className="truncate text-[11.5px] text-mute">{[ASSET_KIND_LABEL[a.kind], a.isin].filter(Boolean).join(" · ")}</div>
                </L>
                <L>
                  <div className={a.priceSource === "manual" ? "text-mute" : "text-ink2"}>{PRICE_SOURCE_SHORT[a.priceSource]}</div>
                  <div className="selectable truncate text-[11.5px] text-mute">{a.priceSource === "manual" ? "sin fuente automática" : ((SOURCE_BY_ISIN[a.priceSource] ? a.isin : a.symbol) ?? "—")}</div>
                </L>
                <span className={h.status === "ok" ? "" : "text-ink2"}>{h.price == null ? "—" : price(h.price, a.currency)}</span>
                <div>
                  <div className={h.status === "ok" ? "text-ink2" : ""}>{h.priceDate ? dateBrief(h.priceDate, d.today) : "—"}</div>
                  <div className="text-[11.5px] text-mute">{daysAgo(h.ageDays)}</div>
                </div>
                <L>
                  <div className="flex items-center gap-2">
                    <Dot color={backup && h.status === "ok" ? "var(--acc)" : st.color} size={7} />
                    <span className={h.status === "ok" ? "text-ink2" : "font-[550]"}>{st.label}</span>
                  </div>
                  <div className="truncate pl-[15px] text-[11.5px] text-mute" title={why}>
                    {why}
                  </div>
                </L>
                <div>
                  <div className={p ? "priv" : "text-mute"}>{p ? eur(p.valueEur) : "—"}</div>
                  <div className={`text-[11.5px] text-mute ${p ? "priv" : ""}`}>{p ? `${units(p.qty)} uds.` : "sin posición"}</div>
                </div>
                <span className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  {a.priceSource === "manual" && (
                    <IconBtn label="Añadir un precio" onClick={() => openDialog({ kind: "price", asset: a })}>
                      <CirclePlus size={15} />
                    </IconBtn>
                  )}
                  <IconBtn label="Editar el activo y su fuente" onClick={() => openDialog({ kind: "asset", asset: a, stay: true })}>
                    <Pencil size={14} />
                  </IconBtn>
                </span>
              </TRow>
            );
          })}
          {shown.length === 0 && (
            <div className="border-t border-line px-5 py-8 text-center text-mute">{rows.length ? "Ningún activo con avisos: todo se actualiza solo." : "Ahora mismo no tienes ninguna posición abierta."}</div>
          )}
        </Table>
      </section>
      <p className="-mt-2 max-w-[820px] px-1 text-[12px] text-pretty text-mute">
        Un activo se marca como atrasado cuando le falta más de una sesión de bolsa (se tolera un festivo), más de tres en los fondos, que publican su valor con retraso, o un día en las
        criptomonedas. Los manuales se cuentan siempre: no se actualizan solos.
      </p>

      {archived.length > 0 && (
        <section className="card overflow-hidden">
          <button type="button" className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left hover:bg-wash" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
            <Archive size={14} className="flex-none text-mute" />
            <span className="wide font-semibold">Archivados</span>
            <span className="min-w-0 truncate text-[12px] text-mute">{archived.length} · no los tienes: no se actualizan, pero sus operaciones y su historia siguen contando</span>
            <ChevronDown size={13} className={`ml-auto flex-none text-mute transition-transform duration-200 ${showArchived ? "rotate-180" : ""}`} />
          </button>
          {showArchived &&
            archived.map(({ asset: a, health: h }) => (
              <div key={a.id} className="flex cursor-pointer items-center gap-4 border-t border-line px-5 py-2.5 hover:bg-wash" onClick={() => go(`/activo/${a.id}`)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ink2">{a.name}</div>
                  <div className="truncate text-[11.5px] text-mute">{[ASSET_KIND_LABEL[a.kind], a.isin ?? a.symbol].filter(Boolean).join(" · ")}</div>
                </div>
                <span className="text-right text-[12px] whitespace-nowrap text-mute">
                  {h.price == null ? "sin precio guardado" : `último precio ${price(h.price, a.currency)}`}
                  {h.priceDate ? ` · ${dateBrief(h.priceDate, d.today)}` : ""}
                </span>
                <span onClick={(e) => e.stopPropagation()}>
                  <IconBtn label="Editar el activo y su fuente" onClick={() => openDialog({ kind: "asset", asset: a, stay: true })}>
                    <Pencil size={14} />
                  </IconBtn>
                </span>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
