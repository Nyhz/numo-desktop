import { TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { sessionChange, type Position } from "../../shared/engine/timeline.ts";
import { ASSET_KIND_LABEL } from "../../shared/types.ts";
import { Spark, Strip } from "../charts/viz.tsx";
import { useDerived } from "../data/store.ts";
import { dateShort, eur, eurSigned, money, num, pct, pctSigned, priceDigits, seriesColor, splitMoney } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Dot, Empty, Money, toneOf } from "../ui/kit.tsx";
import { L, TFoot, THead, TRow, Table, Welcome } from "./common.tsx";

type SortKey = "name" | "day" | "value" | "gain" | "weight";
const SORT: Record<SortKey, (p: Position) => number | string> = {
  name: (p) => p.asset.name.toLowerCase(),
  day: (p) => p.dayChangePct ?? Number.NEGATIVE_INFINITY,
  value: (p) => p.valueEur,
  gain: (p) => p.unrealizedEur,
  weight: (p) => p.weight,
};
const COLS = "minmax(230px,2.2fr) 84px 124px 64px 88px 128px 128px 132px";

export function Posiciones() {
  const d = useDerived();
  const [, go] = useLocation();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "value", desc: true });
  const [hot, setHot] = useState<string | null>(null);

  const rows = useMemo(() => {
    const f = SORT[sort.key];
    return [...d.positions].sort((a, b) => {
      const [x, y] = [f(a), f(b)];
      const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
      return sort.desc ? -c : c;
    });
  }, [d.positions, sort]);

  // Tendencia: los últimos ~90 cierres de cada activo.
  const sparks = useMemo(() => {
    const out = new Map<string, number[]>();
    for (const p of d.positions) out.set(p.asset.id, (d.state.prices[p.asset.id] ?? []).slice(-90).map(([, v]) => v));
    return out;
  }, [d.positions, d.state.prices]);

  if (d.state.accounts.length === 0) return <Welcome />;

  const tl = d.timeline;
  const last = tl.n - 1;
  const cash = [...tl.cash.entries()]
    .map(([id, series]) => {
      const account = d.accounts.get(id)!;
      const balance = series[last] ?? 0;
      return { account, balance, eur: balance / d.ledger.market.fx(account.currency, tl.start + last) };
    })
    .filter((c) => Math.abs(c.balance) >= 0.005);

  const value = rows.reduce((s, p) => s + p.valueEur, 0);
  const cost = rows.reduce((s, p) => s + p.costEur, 0);
  const cashTotal = cash.reduce((s, c) => s + c.eur, 0);
  const top3 = d.positions.slice(0, 3).reduce((s, p) => s + p.weight, 0);
  const hotPos = hot ? d.positions.find((p) => p.asset.id === hot) : null;
  const noPrice = rows.filter((p) => p.priceDate == null).length;
  const total = value + cashTotal;
  const [totalI, totalD] = splitMoney(eur(total));
  const session = sessionChange(d.positions);
  const noCashAccounts = d.state.accounts.filter((a) => !a.archived && (!d.scope || d.scope.has(a.id)) && !cash.some((c) => c.account.id === a.id)).length;

  const Th = ({ k, children, left }: { k: SortKey; children: string; left?: boolean }) => (
    <button type="button" className={`hover:text-ink ${left ? "text-left" : "text-right"} ${sort.key === k ? "text-ink2" : ""}`} onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== "name" }))}>
      {children}
      {sort.key === k ? (sort.desc ? " ↓" : " ↑") : ""}
    </button>
  );

  return (
    <div className="screen flex flex-col gap-5">
      {d.ledger.issues.length > 0 && (
        <div className="card flex items-start gap-2.5 px-4 py-3 text-[13px]">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-acc" />
          <div className="text-ink2">
            <strong className="text-ink">
              {d.ledger.issues.length === 1 ? "Una operación saca" : `${d.ledger.issues.length} operaciones sacan`} más unidades de las que constan compradas.
            </strong>{" "}
            Suele faltar una compra anterior. Afecta a: {[...new Set(d.ledger.issues.map((i) => d.assets.get(i.assetId)?.name ?? "?"))].join(", ")}. Hasta corregirlo, esa parte se cuenta
            con coste cero.
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-stretch gap-5">
        <section className="min-w-0 flex-[1_1_520px] px-1 pt-2">
          <div className="text-[12px] text-mute">Valor de la cartera · {dateShort(d.today)}</div>
          <div className="priv mt-0.5 text-[56px] leading-[1.05] font-medium tracking-[-0.02em]" style={{ fontStretch: "108%" }}>
            {totalI}
            <span className="text-mute">{totalD}</span>
          </div>
          {rows.length > 0 && (
            <div className="mt-1.5 flex items-baseline gap-2.5 text-[13.5px]">
              <span className="priv font-[550]" style={{ color: toneOf(session.gainEur) }}>
                {eurSigned(session.gainEur)}
              </span>
              <span style={{ color: toneOf(session.pct, 0.00005) }}>{pctSigned(session.pct, 2)}</span>
              <span className="text-mute">en la última sesión de cada activo</span>
            </div>
          )}
          {total > 0 && (
            <>
              <div className="mt-4 flex h-2.5 gap-[3px]">
                <div className="rounded-[3px] bg-acc" style={{ width: `${(value / total) * 100}%` }} />
                {cashTotal > 0.005 && <div className="flex-1 rounded-[3px] bg-ink2" />}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-7 gap-y-2 text-[12.5px]">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="size-2 rounded-[2px] bg-acc" />
                  <span className="text-ink2">Invertido</span>
                  <span className="priv font-semibold">{eur(value)}</span>
                  <span className="text-mute">
                    {pct(value / total)} · {rows.length} {rows.length === 1 ? "posición" : "posiciones"}
                  </span>
                </span>
                {cash.length > 0 && (
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <span className="size-2 rounded-[2px] bg-ink2" />
                    <span className="text-ink2">Efectivo</span>
                    <span className="priv font-semibold">{eur(cashTotal)}</span>
                    <span className="text-mute">{pct(cashTotal / total)} · sin invertir</span>
                  </span>
                )}
              </div>
            </>
          )}
          {rows.length > 0 && (
            <>
              <div className="mt-6 mb-2 flex flex-wrap justify-between gap-4 text-[12.5px] text-ink2">
                <span>
                  Concentración de lo invertido · las tres mayores suman <span className="font-semibold text-ink">{pct(top3)}</span>
                </span>
                <span className="text-ink">{hotPos ? `${hotPos.asset.name} · ${pct(hotPos.weight)}` : ""}</span>
              </div>
              <Strip items={d.positions.map((p) => ({ key: p.asset.id, value: p.weight }))} hot={hot} onHover={setHot} />
            </>
          )}
        </section>

        {cash.length > 0 && (
          <section className="card flex max-w-[400px] min-w-0 flex-[1_1_320px] flex-col">
            <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
              <span className="wide font-semibold">Efectivo</span>
              <span className="text-[20px] font-[550] whitespace-nowrap" style={{ fontStretch: "106%" }}>
                <Money value={cashTotal} />
              </span>
            </div>
            {cash.map((c) => (
              <div key={c.account.id} className="border-t border-line px-5 py-3 transition-[background] duration-100 hover:bg-wash">
                <div className="flex items-baseline gap-2.5">
                  <span className="self-center">
                    <Dot color={seriesColor(c.account.color)} />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-[550]">{c.account.name}</span>
                  <span className={`priv font-semibold whitespace-nowrap ${c.eur < 0 ? "text-down" : ""}`}>{eur(c.eur)}</span>
                </div>
                <div className="mt-0.5 ml-4 flex justify-between gap-2.5 text-[11.5px] text-mute">
                  <span>
                    saldo <span className="priv">{money(c.balance, c.account.currency)}</span>
                  </span>
                  <span>{cashTotal > 0 ? `${pct(Math.max(0, c.eur) / cashTotal)} del efectivo` : ""}</span>
                </div>
                <div className="mt-2 ml-4 h-1 rounded-[2px] bg-line">
                  <div className="h-full rounded-[2px]" style={{ width: `${cashTotal > 0 ? Math.min(100, (Math.max(0, c.eur) / cashTotal) * 100) : 0}%`, background: seriesColor(c.account.color) }} />
                </div>
              </div>
            ))}
            <div className="flex-1" />
            <div className="border-t border-line px-5 py-3 text-[12px] text-pretty text-mute">
              {cash.some((c) => c.account.currency !== "EUR") ? "Los saldos en divisa se pasan a EUR al cambio de hoy. " : ""}
              {noCashAccounts > 0 ? (noCashAccounts === 1 ? "La otra cuenta no lleva efectivo." : "Las demás cuentas no llevan efectivo.") : ""}
            </div>
          </section>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty title="No hay posiciones abiertas" action={<Btn variant="cta" onClick={() => openDialog({ kind: "tx" })}>Registrar una compra</Btn>}>
          Las posiciones aparecen al registrar compras en las cuentas seleccionadas.
        </Empty>
      ) : (
        <>
          <section className="card overflow-hidden" onMouseLeave={() => setHot(null)}>
            <Table cols={COLS} minWidth={1040}>
              <THead>
                <Th k="name" left>
                  Activo
                </Th>
                <span>Unidades</span>
                <span>Precio</span>
                <Th k="day">Día</Th>
                <span>Tendencia</span>
                <Th k="value">Valor</Th>
                <Th k="gain">Plusvalía</Th>
                <Th k="weight">Peso</Th>
              </THead>
              {rows.map((p) => {
                const series = sparks.get(p.asset.id) ?? [];
                const trend = series.length > 1 ? series[series.length - 1]! - series[0]! : 0;
                return (
                  <TRow key={p.asset.id} onClick={() => go(`/activo/${p.asset.id}`)} onMouseEnter={() => setHot(p.asset.id)} linked={hot === p.asset.id}>
                    <L>
                      <div className="truncate font-[550]">{p.asset.name}</div>
                      <div className="flex items-center gap-1.5 truncate text-[11.5px] text-mute">
                        {p.accounts.map((a) => {
                          const acct = d.accounts.get(a.accountId);
                          return (
                            <span key={a.accountId} className="inline-flex items-center gap-1.5">
                              <Dot color={seriesColor(acct?.color ?? 0)} />
                              {acct?.name}
                            </span>
                          );
                        })}
                        <span>· {ASSET_KIND_LABEL[p.asset.kind]}</span>
                      </div>
                    </L>
                    <span className="priv">{num(p.qty, 6)}</span>
                    <span className="text-ink2">{p.price == null ? "—" : money(p.price, p.asset.currency, priceDigits(p.price))}</span>
                    <span style={{ color: toneOf(p.dayChangePct, 0.0005) }}>{p.dayChangePct == null ? "—" : pctSigned(p.dayChangePct)}</span>
                    {series.length > 1 ? <Spark values={series} color={toneOf(trend, 1e-9)} /> : <span className="text-mute">—</span>}
                    <div>
                      <div className="font-semibold">
                        <Money value={p.valueEur} />
                      </div>
                      <div className="text-[11.5px] text-mute">
                        coste <span className="priv">{eur(p.costEur)}</span>
                      </div>
                    </div>
                    <div style={{ color: toneOf(p.unrealizedEur) }}>
                      <div className="priv">{eurSigned(p.unrealizedEur)}</div>
                      <div className="text-[11.5px] opacity-80">{p.unrealizedPct == null ? "" : pctSigned(p.unrealizedPct)}</div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <span>{pct(p.weight)}</span>
                      <div className="h-1 w-14 rounded-[2px] bg-line">
                        <div className="h-full rounded-[2px] bg-acc" style={{ width: `${Math.min(100, Math.max(2, (p.weight / Math.max(0.0001, d.positions[0]?.weight ?? 1)) * 100))}%` }} />
                      </div>
                    </div>
                  </TRow>
                );
              })}
              <TFoot>
                <L>
                  {rows.length} {rows.length === 1 ? "posición" : "posiciones"}
                </L>
                <span />
                <span />
                <span />
                <span />
                <span className="priv">{eur(value)}</span>
                <span className="priv" style={{ color: toneOf(value - cost) }}>
                  {eurSigned(value - cost)}
                </span>
                <span style={{ color: toneOf(value - cost) }}>{cost > 0 ? pctSigned((value - cost) / cost) : "—"}</span>
              </TFoot>
            </Table>
          </section>
          {noPrice > 0 && (
            <p className="-mt-2 px-1 text-[12px] text-mute">
              {noPrice === 1 ? "Una posición no tiene" : `${noPrice} posiciones no tienen`} precio de mercado y se {noPrice === 1 ? "valora" : "valoran"} al último precio de operación. Abre el
              activo para añadir un precio o un símbolo.
            </p>
          )}
        </>
      )}

    </div>
  );
}
