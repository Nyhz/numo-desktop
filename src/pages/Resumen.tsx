import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { isoOf } from "../../shared/dates.ts";
import { monthlyReturns, netInvested, periodStats, returnIndex, totalsIn } from "../../shared/engine/timeline.ts";
import { ASSET_KIND_LABEL, type AssetKind } from "../../shared/types.ts";
import { Columns, RankedBars, ReturnHeatmap, SegmentedBar, foldParts, type Part } from "../charts/bars.tsx";
import { Legend } from "../charts/core.tsx";
import { TimeChart, type Series } from "../charts/TimeChart.tsx";
import { rangeBase, setDemo, useApp, useDerived, type Derived, type RangeKey } from "../data/store.ts";
import { eur, eurAxis, monthLong, monthShort, pct, pctSigned, seriesColor } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Button, Delta, Empty, Section, Segmented, Stat } from "../ui/kit.tsx";

// Color fijo por tipo de activo y por divisa: el color sigue a la categoría.
export const KIND_SLOT: Record<AssetKind | "cash", number> = { etf: 1, stock: 2, fund: 3, crypto: 4, bond: 5, other: 6, cash: 7 };
const KIND_ORDER: Array<AssetKind | "cash"> = ["etf", "stock", "fund", "crypto", "bond", "other", "cash"];
export const kindLabel = (k: string) => (k === "cash" ? "Efectivo" : ASSET_KIND_LABEL[k as AssetKind]);
const CCY_SLOT: Record<string, number> = { EUR: 1, USD: 2, GBP: 3, CHF: 4, JPY: 5 };
const ccyColor = (c: string) => seriesColor(CCY_SLOT[c] ?? 6 + ([...c].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 3));

const RANGE_PHRASE: Record<RangeKey, string> = {
  "1M": "en el último mes",
  "3M": "en 3 meses",
  "6M": "en 6 meses",
  YTD: "en lo que va de año",
  "1A": "en el último año",
  "3A": "en 3 años",
  ALL: "desde el inicio",
};

type Mode = "total" | "account" | "kind";
type Split = "kind" | "account" | "currency";

export function Welcome() {
  return (
    <Empty
      title="Tu cartera, en un solo sitio"
      action={
        <>
          <Button variant="primary" onClick={() => openDialog({ kind: "account" })}>
            Crear la primera cuenta
          </Button>
          <Button onClick={() => openDialog({ kind: "import" })}>Importar un CSV</Button>
          <Button variant="ghost" onClick={() => setDemo(true)}>
            Ver una cartera de ejemplo
          </Button>
        </>
      }
    >
      Crea una cuenta por cada bróker, banco o exchange y registra en ella tus compras, ventas y dividendos. Caudal calcula el resto.
    </Empty>
  );
}

function allocation(d: Derived, split: Split): Part[] {
  const tl = d.timeline;
  const last = tl.n - 1;
  if (last < 0) return [];
  if (split === "kind") {
    return KIND_ORDER.map((k) => ({ key: k, label: kindLabel(k), color: seriesColor(KIND_SLOT[k]), value: tl.byKind.get(k)?.[last] ?? 0 }));
  }
  if (split === "account") {
    return d.state.accounts.map((a) => ({ key: a.id, label: a.name, color: seriesColor(a.color), value: tl.byAccount.get(a.id)?.[last] ?? 0 }));
  }
  const by = new Map<string, number>();
  for (const p of d.positions) by.set(p.asset.currency, (by.get(p.asset.currency) ?? 0) + p.valueEur);
  for (const [id, series] of tl.cash) {
    const ccy = d.accounts.get(id)?.currency ?? "EUR";
    by.set(ccy, (by.get(ccy) ?? 0) + series[last]! / d.ledger.market.fx(ccy, tl.start + last));
  }
  return [...by.entries()].map(([c, value]) => ({ key: c, label: c, color: ccyColor(c), value }));
}

export function Resumen() {
  const d = useDerived();
  const range = useApp((s) => s.range);
  const [, go] = useLocation();
  const [mode, setMode] = useState<Mode>("total");
  const [split, setSplit] = useState<Split>("kind");
  const tl = d.timeline;

  const view = useMemo(() => {
    if (tl.n === 0) return null;
    const to = tl.n - 1;
    const { from, fromDate } = rangeBase(range, tl, d.today);
    const i0 = Math.max(from, 0);
    const dates = Array.from({ length: to - i0 + 1 }, (_, k) => isoOf(tl.start + i0 + k));
    const stats = periodStats(tl, from, to);
    const all = periodStats(tl, -1, to);
    const start = fromDate ?? isoOf(tl.start);
    const totals = totalsIn(d.ledger, d.scope, start, d.today);
    const invested = netInvested(tl);
    const ret = returnIndex(d.returns, from, to);
    return { to, from, i0, dates, stats, all, totals, invested, ret, start };
  }, [tl, range, d]);

  if (d.state.accounts.length === 0) return <Welcome />;
  if (!view) {
    return (
      <Empty title="Aún no hay operaciones" action={<Button variant="primary" onClick={() => openDialog({ kind: "tx" })}>Registrar la primera operación</Button>}>
        En cuanto registres una compra o un ingreso verás aquí la evolución de tu cartera.
      </Empty>
    );
  }

  const { to, i0, dates, stats, all, totals, invested, ret } = view;
  const rangeLabel = RANGE_PHRASE[range];
  const unrealized = d.positions.reduce((s, p) => s + p.unrealizedEur, 0);
  const cost = d.positions.reduce((s, p) => s + p.costEur, 0);

  let series: Series[];
  if (mode === "total") {
    series = [{ key: "total", label: "Valor", color: "var(--s1)", values: tl.total.subarray(i0) }];
  } else if (mode === "account") {
    series = d.state.accounts
      .filter((a) => tl.byAccount.has(a.id))
      .map((a) => ({ key: a.id, label: a.name, color: seriesColor(a.color), values: tl.byAccount.get(a.id)!.subarray(i0) }));
  } else {
    series = KIND_ORDER.filter((k) => tl.byKind.has(k)).map((k) => ({ key: k, label: kindLabel(k), color: seriesColor(KIND_SLOT[k]), values: tl.byKind.get(k)!.subarray(i0) }));
  }

  // Ingresos por mes dentro del periodo (como mínimo los últimos 12 meses).
  const months = (() => {
    // Desde el inicio del periodo, pero nunca menos de doce meses (ni antes de la primera operación).
    const yearAgo = isoOf(Math.max(tl.start, tl.start + to - 365)).slice(0, 7);
    const first = view.start.slice(0, 7) < yearAgo ? view.start.slice(0, 7) : yearAgo;
    const list: string[] = [];
    let [y, m] = first.split("-").map(Number) as [number, number];
    const end = d.today.slice(0, 7);
    for (let k = 0; k < 240; k++) {
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      list.push(ym);
      if (ym >= end) break;
      if (++m > 12) {
        m = 1;
        y++;
      }
    }
    const div = new Map<string, number>();
    const int = new Map<string, number>();
    for (const n of d.ledger.ntxs) {
      if (d.scope && !d.scope.has(n.tx.accountId)) continue;
      const ym = n.tx.date.slice(0, 7);
      if (n.tx.type === "dividend") div.set(ym, (div.get(ym) ?? 0) + n.cashEur);
      else if (n.tx.type === "interest") int.set(ym, (int.get(ym) ?? 0) + n.cashEur);
    }
    return { list, div: list.map((ym) => div.get(ym) ?? 0), int: list.map((ym) => int.get(ym) ?? 0) };
  })();
  const hasIncome = months.div.some(Boolean) || months.int.some(Boolean);

  const top = d.positions.slice(0, 8);
  const movers = [...d.positions].sort((a, b) => Math.abs(b.unrealizedEur) - Math.abs(a.unrealizedEur)).slice(0, 8).sort((a, b) => b.unrealizedEur - a.unrealizedEur);

  return (
    <div className="grid gap-10">
      {/* Cifra principal y evolución */}
      <section>
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="text-[13px] text-ink-2">Valor de la cartera</div>
            <div className="mt-1 text-[52px] leading-none font-semibold tracking-[-0.02em]">{eur(stats.endValue)}</div>
            <div className="mt-2.5 flex items-center gap-2 text-[14px]">
              <Delta value={stats.gain} />
              <span className="text-muted">{rangeLabel}</span>
              <span className="text-line-strong">|</span>
              <span className="num text-ink-2">{pctSigned(stats.twr, 2)} de rentabilidad</span>
            </div>
          </div>
          <Segmented
            label="Qué muestra el gráfico"
            value={mode}
            onChange={setMode}
            options={[
              ["total", "Valor y aportado"],
              ["account", "Por cuenta"],
              ["kind", "Por tipo"],
            ]}
          />
        </div>
        <div className="mt-5">
          <TimeChart
            dates={dates}
            series={series}
            stacked={mode !== "total"}
            reference={mode === "total" ? { label: "Aportado neto", values: invested.subarray(i0) } : undefined}
            height={300}
            format={(v) => eur(v, 0)}
            formatAxis={eurAxis}
          />
        </div>
        <div className="mt-2">
          {mode === "total" ? (
            <Legend
              items={[
                { key: "v", label: "Valor de la cartera", color: "var(--s1)", line: true },
                { key: "a", label: "Aportado neto (lo que has puesto menos lo que has retirado)", color: "var(--muted)", line: true },
              ]}
            />
          ) : (
            <Legend items={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))} />
          )}
        </div>
      </section>

      {/* Cifras clave */}
      <section className="grid grid-cols-5 gap-6 border-y border-line py-5">
        <Stat label="Aportado neto" sub="desde el inicio">
          {eur(invested[to]!, 0)}
        </Stat>
        <Stat label="Ganancia total" sub="valor menos aportado">
          <Delta value={all.gain} />
        </Stat>
        <Stat label="Plusvalía latente" sub={cost > 0 ? `${pctSigned(unrealized / cost)} sobre el coste` : "sin posiciones"}>
          <Delta value={unrealized} />
        </Stat>
        <Stat label="Realizado y cobrado" sub={`ventas ${eur(totals.realizedEur, 0)} · rentas ${eur(totals.dividendsEur + totals.interestEur, 0)}`}>
          <Delta value={totals.realizedEur + totals.dividendsEur + totals.interestEur} />
        </Stat>
        <Stat label="TIR anualizada" sub={(stats.xirr ?? all.xirr) == null ? "hace falta más historia" : stats.xirr != null ? rangeLabel : "desde el inicio"}>
          {(stats.xirr ?? all.xirr) == null ? "—" : <Delta ratio={stats.xirr ?? all.xirr} />}
        </Stat>
      </section>

      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-12">
        <Section
          title="Reparto"
          aside={
            <Segmented
              size="sm"
              label="Repartir por"
              value={split}
              onChange={setSplit}
              options={[
                ["kind", "Tipo"],
                ["account", "Cuenta"],
                ["currency", "Divisa"],
              ]}
            />
          }
        >
          <SegmentedBar parts={foldParts(allocation(d, split))} format={(v) => eur(v, 0)} />
        </Section>

        <Section title="Rentabilidad acumulada" aside={<span className="text-[12px] text-muted">ponderada por tiempo, sin el efecto de aportar o retirar</span>}>
          <TimeChart
            dates={dates.slice(dates.length - ret.length)}
            series={[{ key: "twr", label: "Rentabilidad", color: "var(--s1)", values: ret }]}
            height={210}
            zero
            format={(v) => pctSigned(v / 100, 2)}
            formatAxis={(v) => pct(v / 100, 0)}
          />
        </Section>
      </div>

      <Section title="Rentabilidad mes a mes" aside={<span className="text-[12px] text-muted">en %</span>}>
        <ReturnHeatmap months={monthlyReturns(tl)} />
      </Section>

      <div className="grid grid-cols-2 gap-12">
        <Section title="Mayores posiciones" aside={<Button size="sm" variant="ghost" onClick={() => go("/posiciones")}>Ver todas</Button>}>
          {top.length ? (
            <RankedBars
              rows={top.map((p) => ({
                key: p.asset.id,
                label: p.asset.name,
                value: p.valueEur,
                display: (
                  <>
                    {eur(p.valueEur, 0)} <span className="text-muted">{pct(p.weight)}</span>
                  </>
                ),
                onClick: () => go(`/activo/${p.asset.id}`),
              }))}
            />
          ) : (
            <div className="text-muted">No hay posiciones abiertas.</div>
          )}
        </Section>
        <Section title="Plusvalía latente por posición">
          {movers.length ? (
            <RankedBars
              diverging
              rows={movers.map((p) => ({
                key: p.asset.id,
                label: p.asset.name,
                value: p.unrealizedEur,
                display: <Delta value={p.unrealizedEur} />,
                onClick: () => go(`/activo/${p.asset.id}`),
              }))}
            />
          ) : (
            <div className="text-muted">No hay posiciones abiertas.</div>
          )}
        </Section>
      </div>

      {hasIncome && (
        <Section
          title="Dividendos e intereses cobrados"
          aside={
            <Legend
              items={[
                { key: "d", label: "Dividendos", color: "var(--s1)" },
                { key: "i", label: "Intereses", color: "var(--s2)" },
              ]}
            />
          }
        >
          <Columns
            categories={months.list.map((ym) => monthShort(ym))}
            titles={months.list.map(monthLong)}
            series={[
              { key: "div", label: "Dividendos", color: "var(--s1)", values: months.div },
              { key: "int", label: "Intereses", color: "var(--s2)", values: months.int },
            ]}
            height={190}
            format={(v) => eur(v)}
            formatAxis={eurAxis}
          />
        </Section>
      )}
    </div>
  );
}
