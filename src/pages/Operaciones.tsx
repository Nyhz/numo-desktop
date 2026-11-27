import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { txsToCsv } from "../../shared/csv.ts";
import { isoOf } from "../../shared/dates.ts";
import type { NTx } from "../../shared/engine/ledger.ts";
import { TX_LABEL, type TxType } from "../../shared/types.ts";
import { FlowColumns, type FlowDot } from "../charts/viz.tsx";
import { rangeBase, useApp, useDerived } from "../data/store.ts";
import { operationsSheet, saveText, saveXlsx } from "../lib/export.ts";
import { dateShort, eur, eurSigned, money, price, seriesColor, units } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Card, Dot, Empty, HeaderSlot, Money, Pills, toast } from "../ui/kit.tsx";
import { useFresh } from "../ui/motion.ts";
import { L, PeriodPills, THead, TRow, Table, Welcome } from "./common.tsx";

type Filter = "all" | "buy" | "sell" | "income" | "cash";
const FILTER: Record<Filter, (t: TxType) => boolean> = {
  all: () => true,
  buy: (t) => t === "buy",
  sell: (t) => t === "sell",
  income: (t) => t === "dividend" || t === "interest",
  cash: (t) => t === "deposit" || t === "withdrawal" || t === "fee",
};
const COLOR: Record<TxType, string> = {
  buy: "var(--acc)",
  sell: "var(--s1)",
  dividend: "var(--up)",
  interest: "var(--up)",
  deposit: "var(--ink2)",
  withdrawal: "var(--ink2)",
  fee: "var(--down)",
  transfer: "var(--mute)",
};
const LEGEND: Array<[string, string]> = [
  ["Compra", "var(--acc)"],
  ["Venta", "var(--s1)"],
  ["Dividendo o interés", "var(--up)"],
  ["Ingreso o retirada", "var(--ink2)"],
  ["Comisión", "var(--down)"],
];
const COLS = "88px 80px minmax(130px,1fr) minmax(150px,1.6fr) 76px 108px 112px 68px 112px";
/** Sin precio ni costes: se ven al abrir la operación. */
const COMPACT = "88px 80px minmax(130px,1fr) minmax(150px,1.6fr) 76px 112px 112px";
const PAGE = 200;

const describeHead = (n: NTx) => `${dateShort(n.tx.date)} · ${TX_LABEL[n.tx.type]}${n.asset ? ` · ${n.asset.name}` : ""}`;
const describe = (n: NTx) => `${describeHead(n)} · ${eurSigned(n.cashEur)}`;

export function Operaciones() {
  const d = useDerived();
  const range = useApp((s) => s.range);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [hot, setHot] = useState<string | null>(null);
  const fresh = useFresh();

  const { from } = rangeBase(range, d.timeline, d.today);
  const since = from < 0 ? (d.timeline.n ? isoOf(d.timeline.start) : d.today) : isoOf(d.timeline.start + from + 1);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return d.ledger.ntxs
      .filter((n) => {
        if (d.scope && !d.scope.has(n.tx.accountId) && !(n.tx.toAccountId && d.scope.has(n.tx.toAccountId))) return false;
        if (n.tx.date < since || !FILTER[filter](n.tx.type)) return false;
        if (!t) return true;
        return (
          n.asset?.name.toLowerCase().includes(t) ||
          n.asset?.symbol?.toLowerCase().includes(t) ||
          n.asset?.isin?.toLowerCase().includes(t) ||
          n.account.name.toLowerCase().includes(t) ||
          TX_LABEL[n.tx.type].toLowerCase().includes(t) ||
          n.tx.note.toLowerCase().includes(t)
        );
      })
      .reverse();
  }, [d.ledger, d.scope, q, filter, since]);

  const dots = useMemo<FlowDot[]>(
    () => rows.filter((n) => Math.abs(n.cashEur) >= 0.005).map((n) => ({ key: n.tx.id, date: n.tx.date, amount: n.cashEur, color: COLOR[n.tx.type], label: describe(n) })),
    [rows],
  );

  if (d.state.accounts.length === 0) return <Welcome />;

  const hotRow = hot ? rows.find((n) => n.tx.id === hot) : null;
  const exportCsv = async () => {
    const path = await saveText(`numo-operaciones-${d.today}.csv`, txsToCsv(d.state, new Set(rows.map((n) => n.tx.id))));
    if (path) toast(`${rows.length} operaciones exportadas`);
  };
  const exportXlsx = async () => {
    const path = await saveXlsx(`numo-operaciones-${d.today}.xlsx`, [operationsSheet([...rows].reverse(), d.accounts, d.assets)]);
    if (path) toast(`${rows.length} operaciones exportadas`);
  };

  return (
    <div className="screen flex flex-col gap-4">
      <HeaderSlot>
        <Pills
          label="Tipo de operación"
          value={filter}
          onChange={setFilter}
          options={[
            ["all", "Todas"],
            ["buy", "Compras"],
            ["sell", "Ventas"],
            ["income", "Rentas"],
            ["cash", "Efectivo"],
          ]}
        />
      </HeaderSlot>

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-9 w-80 max-w-full items-center gap-2 rounded-full bg-wash px-3.5 text-mute focus-within:outline-2 focus-within:outline-acc">
          <Search size={14} />
          <input className="min-w-0 flex-1 border-0 bg-transparent text-ink outline-0 placeholder:text-mute" placeholder="Buscar por activo, cuenta o tipo" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="text-[12.5px] text-mute">
          {rows.length} {rows.length === 1 ? "operación" : "operaciones"}
        </span>
        <div className="flex-1" />
        <Btn onClick={exportCsv} disabled={!rows.length} title="Un CSV legible, para una hoja de cálculo">
          <Download size={13} /> CSV
        </Btn>
        <Btn onClick={exportXlsx} disabled={!rows.length} title="Con todos los importes convertidos a EUR">
          <Download size={13} /> Excel
        </Btn>
      </div>

      <Card title="Flujo de efectivo" note="cada tramo es una operación; su altura, el importe" aside={<span className="truncate text-ink">{hotRow && <>{describeHead(hotRow)} · <span className="priv">{eurSigned(hotRow.cashEur)}</span></>}</span>}>
        {dots.length ? <FlowColumns dots={dots} from={since} to={d.today} hot={hot} onHover={setHot} /> : <div className="py-10 text-center text-mute">Ninguna operación mueve efectivo en este periodo.</div>}
        <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-ink2">
          {LEGEND.map(([label, color]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="size-2 rounded-[2px]" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
        <PeriodPills />
      </Card>

      {rows.length === 0 ? (
        <Empty
          title={d.state.txs.length ? "Ninguna operación coincide" : "Aún no hay operaciones"}
          action={!d.state.txs.length && <Btn variant="cta" onClick={() => openDialog({ kind: "tx" })}>Registrar la primera operación</Btn>}
        >
          {d.state.txs.length ? "Prueba con otro periodo, otro tipo u otro texto de búsqueda." : "Pulsa N en cualquier momento para registrar una operación."}
        </Empty>
      ) : (
        <section className="card overflow-hidden" onMouseLeave={() => setHot(null)}>
          <Table cols={COLS} compact={COMPACT} minWidth={1000}>
            <THead>
              <L>Fecha</L>
              <L>Tipo</L>
              <L>Cuenta</L>
              <L>Activo</L>
              <span>Unidades</span>
              <span className="opt">Precio</span>
              <span>Importe</span>
              <span className="opt">Costes</span>
              <span>Efecto en EUR</span>
            </THead>
            {rows.slice(0, shown).map((n) => {
              const { tx } = n;
              const trade = tx.type === "buy" || tx.type === "sell";
              const gross = trade ? (tx.quantity ?? 0) * (tx.price ?? 0) : (tx.amount ?? 0);
              const costs = n.feeEur + n.taxSourceEur + n.taxHomeEur;
              const to = tx.type === "transfer" ? [tx.toAccountId && d.accounts.get(tx.toAccountId)?.name, tx.toAssetId && d.assets.get(tx.toAssetId)?.name].filter(Boolean).join(" · ") : "";
              return (
                <TRow key={tx.id} fresh={fresh.has(tx.id)} onClick={() => openDialog({ kind: "tx", tx })} onMouseEnter={() => setHot(tx.id)} linked={hot === tx.id}>
                  <L className="text-ink2">{dateShort(tx.date)}</L>
                  <L className="font-medium" >
                    <span style={{ color: tx.type === "buy" || tx.type === "transfer" ? undefined : COLOR[tx.type] }}>{TX_LABEL[tx.type]}</span>
                  </L>
                  <L className="flex items-center gap-[7px]">
                    <Dot color={seriesColor(n.account.color)} />
                    <span className="truncate">{n.account.name}</span>
                  </L>
                  <L className="truncate font-medium">
                    {n.asset?.name ?? <span className="font-normal text-mute">{tx.note || "—"}</span>}
                    {to && <span className="font-normal text-mute"> → {to}</span>}
                  </L>
                  <span className="priv">{tx.quantity != null ? units(tx.quantity) : ""}</span>
                  <span className="opt text-ink2">{tx.price != null ? price(tx.price, tx.currency) : ""}</span>
                  <span className="priv">{tx.type === "transfer" ? "" : money(gross, tx.currency)}</span>
                  <span className="opt priv text-mute" title={n.taxSourceEur + n.taxHomeEur ? "Comisión y retenciones" : "Comisión"}>
                    {costs ? eur(costs) : ""}
                  </span>
                  <span className="font-semibold" style={{ color: n.cashEur > 0.005 ? "var(--up)" : undefined }}>
                    {tx.type === "transfer" && !n.cashEur ? <span className="font-normal text-mute">sin efecto</span> : <Money value={n.cashEur} signed dim="soft" />}
                  </span>
                </TRow>
              );
            })}
          </Table>
          {rows.length > shown && (
            <div className="border-t border-line py-3 text-center">
              <Btn onClick={() => setShown((s) => s + PAGE)}>Mostrar {Math.min(PAGE, rows.length - shown)} más</Btn>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
