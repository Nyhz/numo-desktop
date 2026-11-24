import { TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { Position } from "../../shared/engine/timeline.ts";
import { ASSET_KIND_LABEL } from "../../shared/types.ts";
import { Spark, Strip } from "../charts/viz.tsx";
import { useDerived } from "../data/store.ts";
import { eur, eurSigned, money, num, pct, pctSigned, priceDigits, seriesColor } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Card, Dot, Empty, Money, toneOf } from "../ui/kit.tsx";
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

      {rows.length === 0 ? (
        <Empty title="No hay posiciones abiertas" action={<Btn variant="cta" onClick={() => openDialog({ kind: "tx" })}>Registrar una compra</Btn>}>
          Las posiciones aparecen al registrar compras en las cuentas seleccionadas.
        </Empty>
      ) : (
        <>
          <section className="px-1 pt-2">
            <div className="mb-2 flex flex-wrap justify-between gap-4 text-[12.5px] text-ink2">
              <span>
                Concentración · las tres mayores suman <span className="font-semibold text-ink">{pct(top3)}</span>
              </span>
              <span className="text-ink">{hotPos ? `${hotPos.asset.name} · ${pct(hotPos.weight)}` : ""}</span>
            </div>
            <Strip items={d.positions.map((p) => ({ key: p.asset.id, value: p.weight }))} hot={hot} onHover={setHot} />
          </section>

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
                    <span>{num(p.qty, 6)}</span>
                    <span className="text-ink2">{p.price == null ? "—" : money(p.price, p.asset.currency, priceDigits(p.price))}</span>
                    <span style={{ color: toneOf(p.dayChangePct, 0.0005) }}>{p.dayChangePct == null ? "—" : pctSigned(p.dayChangePct)}</span>
                    {series.length > 1 ? <Spark values={series} color={toneOf(trend, 1e-9)} /> : <span className="text-mute">—</span>}
                    <div>
                      <div className="font-semibold">
                        <Money value={p.valueEur} />
                      </div>
                      <div className="text-[11.5px] text-mute">coste {eur(p.costEur)}</div>
                    </div>
                    <div style={{ color: toneOf(p.unrealizedEur) }}>
                      <div>{eurSigned(p.unrealizedEur)}</div>
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
                <span>{eur(value)}</span>
                <span style={{ color: toneOf(value - cost) }}>{eurSigned(value - cost)}</span>
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

      {cash.length > 0 && (
        <Card title="Efectivo" pad={false} className="max-w-[620px]">
          {cash.map((c) => (
            <div key={c.account.id} className="flex items-center gap-2.5 border-t border-line px-5 py-[var(--row)]">
              <Dot color={seriesColor(c.account.color)} />
              <span className="flex-1">{c.account.name}</span>
              <span className="w-[130px] text-right text-mute">{c.account.currency === "EUR" ? "" : money(c.balance, c.account.currency)}</span>
              <span className={`w-[110px] text-right font-medium ${c.eur < 0 ? "text-down" : ""}`}>{eur(c.eur)}</span>
            </div>
          ))}
          <div className="flex border-t border-line2 px-5 py-3.5 font-[650]">
            <span className="flex-1">Total con posiciones</span>
            <span>{eur(value + cashTotal)}</span>
          </div>
        </Card>
      )}
    </div>
  );
}
