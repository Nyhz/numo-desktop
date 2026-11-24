import { ArrowDown, ArrowUp, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { Position } from "../../shared/engine/timeline.ts";
import { ASSET_KIND_LABEL } from "../../shared/types.ts";
import { useDerived } from "../data/store.ts";
import { dateShort, eur, money, num, pct, pctSigned, seriesColor } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Button, Delta, Dot, Empty, Section, Tag } from "../ui/kit.tsx";
import { Welcome } from "./Resumen.tsx";

type SortKey = "name" | "value" | "cost" | "gain" | "gainPct" | "weight" | "day";
const SORT: Record<SortKey, (p: Position) => number | string> = {
  name: (p) => p.asset.name.toLowerCase(),
  value: (p) => p.valueEur,
  cost: (p) => p.costEur,
  gain: (p) => p.unrealizedEur,
  gainPct: (p) => p.unrealizedPct ?? -Infinity,
  weight: (p) => p.weight,
  day: (p) => p.dayChangePct ?? -Infinity,
};

export function Posiciones() {
  const d = useDerived();
  const [, go] = useLocation();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "value", desc: true });

  const rows = useMemo(() => {
    const f = SORT[sort.key];
    return [...d.positions].sort((a, b) => {
      const [x, y] = [f(a), f(b)];
      const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
      return sort.desc ? -c : c;
    });
  }, [d.positions, sort]);

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
  const stale = rows.filter((p) => p.asset.priceSource === "manual" && p.priceDate == null);

  const Th = ({ k, children, right = true }: { k: SortKey; children: string; right?: boolean }) => (
    <th className={right ? "r" : ""} aria-sort={sort.key === k ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== "name" }))}>
        {children}
        {sort.key === k && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );

  return (
    <div className="grid gap-10">
      {d.ledger.issues.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-md bg-wash-strong px-3.5 py-2.5 text-[13px]">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" />
          <div>
            <strong>Hay {d.ledger.issues.length === 1 ? "una operación que saca" : `${d.ledger.issues.length} operaciones que sacan`} más unidades de las que constan compradas.</strong>{" "}
            Suele faltar una compra anterior. Afecta a: {[...new Set(d.ledger.issues.map((i) => d.assets.get(i.assetId)?.name ?? "?"))].join(", ")}. Hasta corregirlo, la parte
            sin compra se cuenta con coste cero.
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty title="No hay posiciones abiertas" action={<Button variant="primary" onClick={() => openDialog({ kind: "tx" })}>Registrar una compra</Button>}>
          Las posiciones aparecen al registrar compras en las cuentas seleccionadas.
        </Empty>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <Th k="name" right={false}>
                Activo
              </Th>
              <th className="r">Unidades</th>
              <th className="r">Precio</th>
              <Th k="day">Último día</Th>
              <Th k="value">Valor</Th>
              <Th k="cost">Coste</Th>
              <Th k="gain">Plusvalía</Th>
              <Th k="gainPct">%</Th>
              <Th k="weight">Peso</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.asset.id} className="click" onClick={() => go(`/activo/${p.asset.id}`)}>
                <td className="max-w-[320px]">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.asset.name}</span>
                    <Tag>{ASSET_KIND_LABEL[p.asset.kind]}</Tag>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
                    {p.accounts.map((a) => {
                      const acct = d.accounts.get(a.accountId);
                      return (
                        <span key={a.accountId} className="inline-flex items-center gap-1">
                          <Dot color={seriesColor(acct?.color ?? 0)} />
                          {acct?.name}
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td className="r">{num(p.qty, 6)}</td>
                <td className="r">
                  {p.price == null ? "—" : money(p.price, p.asset.currency)}
                  <div className="text-[12px] text-muted">{p.priceDate ? dateShort(p.priceDate) : "último precio de operación"}</div>
                </td>
                <td className="r">{p.dayChangePct == null ? <span className="text-muted">—</span> : <Delta ratio={p.dayChangePct} />}</td>
                <td className="r font-medium">{eur(p.valueEur)}</td>
                <td className="r text-ink-2">{eur(p.costEur)}</td>
                <td className="r">
                  <Delta value={p.unrealizedEur} />
                </td>
                <td className="r">{p.unrealizedPct == null ? "—" : <span className={p.unrealizedEur >= 0 ? "text-up" : "text-down"}>{pctSigned(p.unrealizedPct)}</span>}</td>
                <td className="r">
                  <div className="flex items-center justify-end gap-2">
                    <span>{pct(p.weight)}</span>
                    <span className="h-[6px] w-12 overflow-hidden rounded-full bg-wash-strong">
                      <span className="block h-full rounded-full bg-[var(--s1)]" style={{ width: `${Math.max(2, p.weight * 100)}%` }} />
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                {rows.length} {rows.length === 1 ? "posición" : "posiciones"}
              </td>
              <td colSpan={3} />
              <td className="r">{eur(value)}</td>
              <td className="r">{eur(cost)}</td>
              <td className="r">
                <Delta value={value - cost} />
              </td>
              <td className="r">{cost > 0 ? pctSigned((value - cost) / cost) : "—"}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}

      {stale.length > 0 && (
        <p className="-mt-6 text-[12px] text-muted">
          {stale.length === 1 ? "Una posición no tiene" : `${stale.length} posiciones no tienen`} precio de mercado y se {stale.length === 1 ? "valora" : "valoran"} al último precio
          de operación. Abre el activo para añadir un precio o un símbolo.
        </p>
      )}

      {cash.length > 0 && (
        <Section title="Efectivo">
          <table className="tbl">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th className="r">Saldo</th>
                <th className="r">En EUR</th>
              </tr>
            </thead>
            <tbody>
              {cash.map((c) => (
                <tr key={c.account.id}>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <Dot color={seriesColor(c.account.color)} />
                      {c.account.name}
                    </span>
                  </td>
                  <td className={`r ${c.balance < 0 ? "text-down" : ""}`}>{money(c.balance, c.account.currency)}</td>
                  <td className="r">{eur(c.eur)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total con posiciones</td>
                <td />
                <td className="r">{eur(value + cashTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </Section>
      )}
    </div>
  );
}
