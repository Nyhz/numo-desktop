import { Download, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { txsToCsv } from "../../shared/csv.ts";
import { isoOf } from "../../shared/dates.ts";
import { TX_LABEL, TX_TYPES, type TxType } from "../../shared/types.ts";
import { rangeBase, useApp, useDerived } from "../data/store.ts";
import { operationsSheet, saveText, saveXlsx } from "../lib/export.ts";
import { dateShort, eur, money, num, seriesColor } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Button, Dot, Empty, toast } from "../ui/kit.tsx";
import { Welcome } from "./Resumen.tsx";

const PAGE = 250;

export function Operaciones() {
  const d = useDerived();
  const range = useApp((s) => s.range);
  const [q, setQ] = useState("");
  const [type, setType] = useState<TxType | "">("");
  const [shown, setShown] = useState(PAGE);

  const { from } = rangeBase(range, d.timeline, d.today);
  const since = from < 0 ? "" : isoOf(d.timeline.start + from + 1);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return d.ledger.ntxs
      .filter((n) => {
        if (d.scope && !d.scope.has(n.tx.accountId) && !(n.tx.toAccountId && d.scope.has(n.tx.toAccountId))) return false;
        if (since && n.tx.date < since) return false;
        if (type && n.tx.type !== type) return false;
        if (!t) return true;
        return (
          n.asset?.name.toLowerCase().includes(t) ||
          n.asset?.symbol?.toLowerCase().includes(t) ||
          n.asset?.isin?.toLowerCase().includes(t) ||
          n.account.name.toLowerCase().includes(t) ||
          n.tx.note.toLowerCase().includes(t)
        );
      })
      .reverse();
  }, [d.ledger, d.scope, q, type, since]);

  if (d.state.accounts.length === 0) return <Welcome />;

  const stamp = d.today;
  const exportCsv = async () => {
    const path = await saveText(`caudal-operaciones-${stamp}.csv`, txsToCsv(d.state, new Set(rows.map((n) => n.tx.id))));
    if (path) toast(`${rows.length} operaciones exportadas`);
  };
  const exportXlsx = async () => {
    const path = await saveXlsx(`caudal-operaciones-${stamp}.xlsx`, [operationsSheet([...rows].reverse(), d.accounts, d.assets)]);
    if (path) toast(`${rows.length} operaciones exportadas`);
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2.5">
        <div className="relative w-72">
          <Search size={14} className="pointer-events-none absolute top-[9px] left-2.5 text-muted" />
          <input className="field pl-8" placeholder="Buscar por activo, cuenta o nota" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="field w-44" value={type} onChange={(e) => setType(e.target.value as TxType | "")} aria-label="Tipo de operación">
          <option value="">Todos los tipos</option>
          {TX_TYPES.map((t) => (
            <option key={t} value={t}>
              {TX_LABEL[t]}
            </option>
          ))}
        </select>
        <span className="num text-[12.5px] text-muted">
          {rows.length} {rows.length === 1 ? "operación" : "operaciones"}
        </span>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => openDialog({ kind: "import" })}>
            <Upload size={13} /> Importar
          </Button>
          <Button onClick={exportCsv} disabled={!rows.length} title="El mismo formato que entiende «Importar»">
            <Download size={13} /> CSV
          </Button>
          <Button onClick={exportXlsx} disabled={!rows.length} title="Con todos los importes convertidos a EUR">
            <Download size={13} /> Excel
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty
          title={d.state.txs.length ? "Ninguna operación coincide" : "Aún no hay operaciones"}
          action={!d.state.txs.length && <Button variant="primary" onClick={() => openDialog({ kind: "tx" })}>Registrar la primera operación</Button>}
        >
          {d.state.txs.length ? "Prueba con otro periodo, otra cuenta u otro texto de búsqueda." : "Pulsa N en cualquier momento para registrar una operación."}
        </Empty>
      ) : (
        <>
          <table className="tbl">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Cuenta</th>
                <th>Activo</th>
                <th className="r">Unidades</th>
                <th className="r">Precio</th>
                <th className="r">Importe</th>
                <th className="r">Comisión y retenciones</th>
                <th className="r">Efecto en EUR</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((n) => {
                const { tx } = n;
                const trade = tx.type === "buy" || tx.type === "sell";
                const gross = trade ? (tx.quantity ?? 0) * (tx.price ?? 0) : (tx.amount ?? 0);
                const costs = n.feeEur + n.taxSourceEur + n.taxHomeEur;
                const to = tx.type === "transfer" ? [tx.toAccountId && d.accounts.get(tx.toAccountId)?.name, tx.toAssetId && d.assets.get(tx.toAssetId)?.name].filter(Boolean).join(" · ") : "";
                return (
                  <tr key={tx.id} className="click" onClick={() => openDialog({ kind: "tx", tx })}>
                    <td className="num">{dateShort(tx.date)}</td>
                    <td>{TX_LABEL[tx.type]}</td>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        <Dot color={seriesColor(n.account.color)} />
                        {n.account.name}
                      </span>
                    </td>
                    <td className="max-w-[260px]">
                      <div className="truncate">{n.asset?.name ?? <span className="text-muted">{tx.note || "—"}</span>}</div>
                      {to && <div className="truncate text-[12px] text-muted">→ {to}</div>}
                    </td>
                    <td className="r">{tx.quantity != null ? num(tx.quantity, 6) : ""}</td>
                    <td className="r">{tx.price != null ? money(tx.price, tx.currency, tx.price < 10 ? 4 : 2) : ""}</td>
                    <td className="r">{tx.type === "transfer" ? "" : money(gross, tx.currency)}</td>
                    <td className="r text-ink-2">{costs ? eur(costs) : ""}</td>
                    <td className={`r font-medium ${tx.type === "transfer" ? "text-muted" : ""}`}>{tx.type === "transfer" && !n.cashEur ? "sin efecto" : eur(n.cashEur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > shown && (
            <div className="mt-4 text-center">
              <Button onClick={() => setShown((s) => s + PAGE)}>Mostrar {Math.min(PAGE, rows.length - shown)} más</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
