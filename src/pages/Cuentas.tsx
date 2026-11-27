import { Plus } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";
import { periodStats } from "../../shared/engine/timeline.ts";
import { ACCOUNT_KIND_LABEL } from "../../shared/types.ts";
import { Trend } from "../charts/viz.tsx";
import { derive, setScope, useApp } from "../data/store.ts";
import { countryName, eur, eurSigned, money, pct, seriesColor, splitMoney } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Dot, Tag, toneOf } from "../ui/kit.tsx";
import { Welcome } from "./common.tsx";

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
        return {
          account,
          value: last >= 0 ? tl.total[last]! : 0,
          gain: periodStats(tl, -1, last).gain,
          cash: tl.cash.get(account.id)?.[last] ?? null,
          positions: d.positions.length,
          txs: state.txs.filter((t) => t.accountId === account.id || t.toAccountId === account.id).length,
          trend: tl.total.subarray(Math.max(0, tl.n - 365)),
        };
      }),
    [state],
  );

  if (state.accounts.length === 0) return <Welcome />;
  // El fondo de emergencia no es cartera: los pesos se miden entre las cuentas que sí lo son.
  const invested = rows.filter((r) => r.account.kind !== "emergency");
  const total = invested.reduce((s, r) => s + Math.max(0, r.value), 0);

  return (
    <div className="screen flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4 px-1 pt-2">
        <span className="text-ink2">Una cuenta por cada bróker o exchange, y otra para tu fondo de emergencia. Pulsa una para editarla.</span>
        <Btn onClick={() => openDialog({ kind: "account" })}>
          <Plus size={14} /> Cuenta
        </Btn>
      </div>

      {total > 0 && (
        <div className="flex h-2.5 gap-[3px]">
          {invested
            .filter((r) => r.value > 0)
            .map((r) => (
              <div key={r.account.id} title={`${r.account.name}: ${pct(r.value / total)}`} className="rounded-[3px]" style={{ flex: `${r.value} 1 0`, background: seriesColor(r.account.color) }} />
            ))}
        </div>
      )}

      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        {rows.map((r) => {
          const color = seriesColor(r.account.color);
          const [vi, vd] = splitMoney(eur(r.value));
          const fund = r.account.kind === "emergency";
          return (
            <section
              key={r.account.id}
              role="button"
              tabIndex={0}
              onClick={() => openDialog({ kind: "account", account: r.account })}
              onKeyDown={(e) => e.key === "Enter" && openDialog({ kind: "account", account: r.account })}
              className="card cursor-pointer px-5 py-[18px] transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-line2"
            >
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <div className="wide flex items-center gap-2 text-[15px] font-semibold">
                    <Dot color={color} size={8} />
                    <span className="truncate">{r.account.name}</span>
                    {r.account.archived && <Tag>Archivada</Tag>}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-mute">
                    {[r.account.institution, ACCOUNT_KIND_LABEL[r.account.kind], r.account.country !== "ES" ? countryName(r.account.country) : "", r.account.currency !== "EUR" ? r.account.currency : ""].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span className="shrink-0 text-[12px] text-mute">{fund ? "aparte de la cartera" : total > 0 ? `${pct(Math.max(0, r.value) / total)} de la cartera` : ""}</span>
              </div>
              <div className="mt-[18px] flex items-end justify-between gap-4">
                <div className="shrink-0">
                  <div className="priv text-[30px] leading-[1.1] font-medium tracking-[-0.01em]" style={{ fontStretch: "108%" }}>
                    {vi}
                    <span className="text-mute">{vd}</span>
                  </div>
                  <div className="mt-1 whitespace-nowrap" style={{ color: toneOf(r.gain) }}>
                    <span className="priv">{eurSigned(r.gain)}</span> <span className="text-mute">{fund ? "de intereses" : "de ganancia total"}</span>
                  </div>
                </div>
                <Trend values={r.trend} color={color} className="h-12 max-w-[220px] min-w-0 flex-1" />
              </div>
              {/* Un fondo de emergencia es su saldo, que ya está arriba: no hay nada más que contar. */}
              {!fund && (
                <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-line pt-3 text-[12.5px] whitespace-nowrap">
                  <span>
                    <span className="mr-2 text-mute">Posiciones</span>
                    <span className="font-medium">{r.positions}</span>
                  </span>
                  <span>
                    <span className="mr-2 text-mute">Operaciones</span>
                    <span className="font-medium">{r.txs}</span>
                  </span>
                  {/* El efectivo solo se menciona en las cuentas que lo llevan. */}
                  {r.cash != null && (
                    <span>
                      <span className="mr-2 text-mute">Efectivo</span>
                      <span className={`priv font-medium ${r.cash < 0 ? "text-down" : ""}`}>{money(r.cash, r.account.currency)}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    className="ml-auto text-mute hover:text-ink"
                    onClick={(e) => {
                      e.stopPropagation();
                      setScope([r.account.id]);
                      go("/");
                    }}
                  >
                    Ver solo esta →
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
