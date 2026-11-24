import { Plus } from "lucide-react";
import { useMemo } from "react";
import { periodStats } from "../../shared/engine/timeline.ts";
import { ACCOUNT_KIND_LABEL } from "../../shared/types.ts";
import { Sparkline } from "../charts/TimeChart.tsx";
import { derive, setScope, useApp } from "../data/store.ts";
import { eur, money, seriesColor } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Button, Delta, Dot, Tag } from "../ui/kit.tsx";
import { useLocation } from "wouter";
import { Welcome } from "./Resumen.tsx";

export function Cuentas() {
  const state = useApp((s) => (s.demo ?? s.loaded).state);
  const [, go] = useLocation();

  // Aquí se ven siempre todas las cuentas, con independencia del filtro.
  const rows = useMemo(
    () =>
      state.accounts.map((account) => {
        const d = derive(state, [account.id]);
        const tl = d.timeline;
        const last = tl.n - 1;
        const stats = periodStats(tl, -1, last);
        const cash = tl.cash.get(account.id)?.[last] ?? null;
        return {
          account,
          value: last >= 0 ? tl.total[last]! : 0,
          gain: stats.gain,
          cash,
          positions: d.positions.length,
          txs: state.txs.filter((t) => t.accountId === account.id || t.toAccountId === account.id).length,
          spark: tl.total.subarray(Math.max(0, tl.n - 365)),
        };
      }),
    [state],
  );

  if (state.accounts.length === 0) return <Welcome />;
  const total = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-ink-2">Una cuenta por cada bróker, banco o exchange. Pulsa una fila para editarla.</p>
        <Button variant="primary" onClick={() => openDialog({ kind: "account" })}>
          <Plus size={15} strokeWidth={2.4} /> Cuenta
        </Button>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Cuenta</th>
            <th>Tipo</th>
            <th className="r">Posiciones</th>
            <th className="r">Operaciones</th>
            <th className="r">Efectivo</th>
            <th>Último año</th>
            <th className="r">Ganancia total</th>
            <th className="r">Valor</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.account.id} className="click" onClick={() => openDialog({ kind: "account", account: r.account })}>
              <td>
                <div className="flex items-center gap-2">
                  <Dot color={seriesColor(r.account.color)} />
                  <span className="font-medium">{r.account.name}</span>
                  {r.account.archived && <Tag>Archivada</Tag>}
                </div>
                {r.account.institution && <div className="mt-0.5 pl-4 text-[12px] text-muted">{r.account.institution}</div>}
              </td>
              <td className="text-ink-2">
                {ACCOUNT_KIND_LABEL[r.account.kind]} · {r.account.currency}
              </td>
              <td className="r">{r.positions}</td>
              <td className="r">{r.txs}</td>
              <td className="r">{r.cash == null ? <span className="text-muted">no se lleva</span> : money(r.cash, r.account.currency)}</td>
              <td>
                <Sparkline values={r.spark} color={seriesColor(r.account.color)} />
              </td>
              <td className="r">
                <Delta value={r.gain} />
              </td>
              <td className="r font-medium">{eur(r.value)}</td>
              <td className="r w-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setScope([r.account.id]);
                    go("/");
                  }}
                >
                  Ver solo esta
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={7}>Total</td>
            <td className="r">{eur(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
