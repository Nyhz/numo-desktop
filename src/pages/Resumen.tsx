import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { isoOf } from "../../shared/dates.ts";
import { equitySeries, viewProperties } from "../../shared/engine/realestate.ts";
import { monthlyReturns, netInvested, periodStats, returnIndex, sessionChange, totalsIn } from "../../shared/engine/timeline.ts";
import { IncomeColumns, type IncomeItem } from "../charts/income.tsx";
import { HeroChart, HeroLegend, bandModel, lineModel, stackModel, type HeroModel, type Row } from "../charts/hero.tsx";
import { GroupRows, MonthColumns, ReturnBars, treeGroups, type TreeCell, type TreeItem } from "../charts/viz.tsx";
import { BENCHMARK, benchmarkReturns } from "../data/benchmark.ts";
import { ensureBenchmark, rangeBase, useApp, useBenchmark, useDerived, type Derived } from "../data/store.ts";
import { dateShort, eur, eurAxis, eurSigned, num, pct, pctSigned, seriesColor, splitMoney } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Card, Delta, Empty, HeaderSlot, Kpi, Kpis, Money, Pills, Priv, toneOf } from "../ui/kit.tsx";
import { KIND_ORDER, PeriodPills, RANGE_PHRASE, Welcome, kindColor, kindLabel } from "./common.tsx";

type Mode = "valor" | "pat" | "cuenta" | "tipo" | "rent";
type Group = "Tipo" | "Cuenta" | "Divisa";

function treeItems(d: Derived, g: Group): TreeItem[] {
  const tl = d.timeline;
  const last = tl.n - 1;
  const items: TreeItem[] = [];
  for (const p of d.positions) {
    // Una posición repartida entre cuentas se parte en proporción a sus unidades.
    const parts = g === "Cuenta" ? p.accounts.map((a) => ({ id: a.accountId, share: p.qty ? a.qty / p.qty : 0 })) : [{ id: "", share: 1 }];
    for (const part of parts) {
      const acct = d.accounts.get(part.id);
      items.push({
        key: `${p.asset.id}|${part.id}`,
        name: p.asset.name,
        value: p.valueEur * part.share,
        group: g === "Tipo" ? kindLabel(p.asset.kind) : g === "Cuenta" ? (acct?.name ?? "—") : p.asset.currency,
        color: acct ? seriesColor(acct.color) : undefined,
      });
    }
  }
  for (const [id, series] of tl.cash) {
    const acct = d.accounts.get(id);
    if (!acct || last < 0) continue;
    const value = series[last]! / d.ledger.market.fx(acct.currency, tl.start + last);
    items.push({
      key: `cash|${id}`,
      name: `Efectivo · ${acct.name}`,
      value,
      group: g === "Tipo" ? "Efectivo" : g === "Cuenta" ? acct.name : acct.currency,
      color: seriesColor(acct.color),
    });
  }
  return items;
}

/**
 * Al abrir la app, la cifra principal cuenta desde el valor que había antes de
 * actualizar precios hasta el nuevo, cuando la animación de arranque descubre los datos.
 */
function useBootCount(target: number): number | null {
  const splash = useApp((s) => s.splash);
  const [value, setValue] = useState<number | null>(null);
  const [from, phase] = [splash?.from ?? null, splash?.phase];
  useEffect(() => {
    if (phase !== "data" || from == null || Math.abs(from - target) < 0.005) return;
    const t0 = performance.now();
    let id = requestAnimationFrame(function tick() {
      const k = Math.min(1, (performance.now() - t0) / 900);
      setValue(k < 1 ? from + (target - from) * (1 - (1 - k) ** 3) : null);
      if (k < 1) id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo se lanza al entrar en la fase de datos
  }, [phase]);
  // Mientras la app espera detrás de la carga se enseña el valor anterior; después, la cuenta.
  if (from != null && Math.abs(from - target) >= 0.005 && (phase === "load" || phase === "enter")) return from;
  return value;
}

export function Resumen() {
  const d = useDerived();
  const range = useApp((s) => s.range);
  const [, go] = useLocation();
  const [picked, setMode] = useState<Mode>("valor");
  const [group, setGroup] = useState<Group>("Tipo");
  const [hover, setHover] = useState<{ src: number; k: number } | null>(null);
  const [cell, setCell] = useState<TreeCell | null>(null);
  const tl = d.timeline;
  // Con todas las cuentas a la vista, el Resumen es el del patrimonio: la cartera más
  // lo que ya es tuyo de los inmuebles. Con cuentas filtradas, solo esas cuentas.
  const homes = useMemo(() => (d.scope ? [] : viewProperties(d.state, d.today)), [d.state, d.scope, d.today]);
  const withHomes = homes.length > 0;
  const mode: Mode = picked === "pat" && !withHomes ? "valor" : picked;
  // El índice con el que se compara la rentabilidad se baja al abrir ese modo, sin esperar por él.
  const bench = useBenchmark(tl.n ? isoOf(tl.start) : null);
  useEffect(() => {
    if (mode === "rent") ensureBenchmark();
  }, [mode, tl.start, d.today]);

  const view = useMemo(() => {
    if (tl.n === 0) return null;
    const to = tl.n - 1;
    const { from, fromDate } = rangeBase(range, tl, d.today);
    const i0 = Math.max(from, 0);
    const dates = Array.from({ length: to - i0 + 1 }, (_, k) => isoOf(tl.start + i0 + k));
    const invested = netInvested(tl);
    const V = tl.total.subarray(i0);
    const C = invested.subarray(i0);
    const start = fromDate ?? isoOf(tl.start);
    return {
      to,
      from,
      i0,
      dates,
      V,
      C,
      // Lo que ya es tuyo de los inmuebles en cada fecha (ceros si no hay ninguno).
      E: equitySeries(homes, dates),
      invested,
      stats: periodStats(tl, from, to),
      all: periodStats(tl, -1, to),
      start,
      totals: totalsIn(d.ledger, d.scope, start, d.today),
      ret: returnIndex(d.returns, from, to),
    };
  }, [tl, range, d, homes]);

  // La geometría del gráfico solo depende del periodo y del modo: el hover no la recalcula.
  const model = useMemo<HeroModel | null>(() => {
    if (!view || view.dates.length < 2) return null;
    const { dates, V, C, E, i0, ret } = view;
    const lane = (a: number, b: number) => {
      const g = V[b]! - V[a]! - (C[b]! - C[a]!);
      return { up: Math.max(g, 0), down: Math.max(-g, 0) };
    };
    if (mode === "rent") {
      // returnIndex puede traer un punto menos cuando el periodo empieza con la cartera.
      const off = dates.length - ret.length;
      const shown = dates.slice(off);
      // El índice, sobre las mismas fechas y con la misma base; si no lo hay, la línea sola.
      const index = bench && benchmarkReturns(bench, shown);
      return lineModel({ dates: shown, values: ret, label: "Rentabilidad acumulada", format: (v) => pctSigned(v / 100, 2), axis: (v) => `${num(v, 0)} %`, zero: true, lane: (a, b) => lane(a + off, b + off), compare: index ? { label: BENCHMARK.label, values: index } : undefined });
    }
    if (mode === "pat") {
      return stackModel({
        dates,
        axis: eurAxis,
        format: (v) => eur(v, 0),
        priv: true,
        series: [
          { label: "Inmuebles · lo que ya es tuyo", color: "var(--s8)", values: E },
          { label: "Cartera", color: "var(--acc)", values: V },
        ],
      });
    }
    if (mode === "cuenta") {
      return stackModel({
        dates,
        axis: eurAxis,
        format: (v) => eur(v, 0),
        priv: true,
        lane,
        series: d.state.accounts.filter((a) => tl.byAccount.has(a.id)).map((a) => ({ label: a.name, color: seriesColor(a.color), values: tl.byAccount.get(a.id)!.subarray(i0) })),
      });
    }
    if (mode === "tipo") {
      return stackModel({
        dates,
        axis: eurAxis,
        format: (v) => eur(v, 0),
        priv: true,
        lane,
        series: KIND_ORDER.filter((k) => tl.byKind.has(k)).map((k) => ({ label: kindLabel(k), color: kindColor(k), values: tl.byKind.get(k)!.subarray(i0) })),
      });
    }
    return bandModel({
      dates,
      top: V,
      base: C,
      axis: eurAxis,
      priv: true,
      lane,
      rows: (i): Row[] => [
        { color: "var(--acc)", label: withHomes ? "Valor de la cartera" : "Valor", value: eur(V[i]!) },
        { color: "var(--mute)", label: "Aportado neto", value: eur(C[i]!, 0) },
        { color: "transparent", label: "Ganancia", value: eurSigned(V[i]! - C[i]!) },
      ],
    });
  }, [view, mode, withHomes, d.state.accounts, tl, bench]);

  const groups = useMemo(() => {
    // Con el patrimonio a la vista, lo que ya es tuyo de cada inmueble entra en el reparto.
    const items = treeItems(d, group);
    for (const h of homes) if (h.equity > 0) items.push({ key: `home|${h.property.id}`, name: h.property.name, value: h.equity, group: group === "Divisa" ? "EUR" : "Inmuebles", color: "var(--s8)" });
    return treeGroups(items, group === "Cuenta");
  }, [d, group, homes]);
  const session = useMemo(() => sessionChange(d.positions), [d.positions]);
  const months = useMemo(() => monthlyReturns(tl), [tl]);
  // Dividendos e intereses cobrados (netos) en el periodo, para ver cómo llegan y de quién.
  const income = useMemo<IncomeItem[]>(() => {
    const since = view?.start ?? d.today;
    return d.ledger.ntxs
      .filter((n) => (n.tx.type === "dividend" || n.tx.type === "interest") && n.tx.date >= since && (!d.scope || d.scope.has(n.tx.accountId)))
      .map((n) => ({ date: n.tx.date, amount: n.cashEur, kind: n.tx.type as "dividend" | "interest", name: n.asset?.name ?? `Intereses · ${n.account.name}` }));
  }, [d.ledger, d.scope, d.today, view?.start]);

  // (Antes de cualquier salida anticipada: los hooks han de llamarse siempre en el mismo orden.)
  const counted = useBootCount(tl.n ? tl.total[tl.n - 1]! : 0);
  if (d.state.accounts.length === 0) return <Welcome />;
  if (!view) {
    return (
      <Empty title="Aún no hay operaciones" action={<Btn variant="cta" onClick={() => openDialog({ kind: "tx" })}>Registrar la primera operación</Btn>}>
        En cuanto registres una compra o un ingreso verás aquí la evolución de tu cartera.
      </Empty>
    );
  }

  const { stats, all, totals, invested, to, V, dates } = view;
  // Con el cursor sobre el gráfico, la cifra principal pasa a ser la de esa fecha.
  const off = mode === "rent" ? dates.length - view.ret.length : 0;
  const at = hover ? Math.min(V.length - 1, hover.src + off) : V.length - 1;
  const portfolioAt = !hover && counted != null ? counted : V[at]!;
  const homesAt = view.E[at]!;
  const [heroI, heroD] = splitMoney(eur(portfolioAt + homesAt));
  const unrealized = d.positions.reduce((s, p) => s + p.unrealizedEur, 0);
  const cost = d.positions.reduce((s, p) => s + p.costEur, 0);
  const xirr = stats.xirr ?? all.xirr;
  const legend = model ? model.rowsAt(hover ? Math.min(hover.k, model.n - 1) : model.n - 1) : [];

  return (
    <div className="screen flex flex-col gap-5">
      <HeaderSlot>
        <Pills
          label="Qué muestra el gráfico"
          value={mode}
          onChange={(m) => {
            setHover(null);
            setMode(m);
          }}
          options={[
            ["valor", "Valor y aportado"],
            ...(withHomes ? ([["pat", "Patrimonio"]] as const) : []),
            ["cuenta", "Por cuenta"],
            ["tipo", "Por tipo"],
            ["rent", "Rentabilidad"],
          ]}
        />
      </HeaderSlot>

      <section className="px-1 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[12px] text-mute">
              {withHomes ? "Patrimonio neto" : "Valor de la cartera"} · {dateShort(dates[at]!)}
            </div>
            <div className="priv mt-0.5 text-[56px] leading-[1.05] font-medium tracking-[-0.02em]" style={{ fontStretch: "108%" }}>
              {heroI}
              <span className="text-mute">{heroD}</span>
            </div>
            {withHomes && (
              <div className="mt-1.5 text-[13.5px] text-ink2">
                cartera <Priv>{eur(portfolioAt)}</Priv> · inmuebles <Priv>{eur(homesAt)}</Priv> <span className="text-mute">que ya son tuyos</span>
              </div>
            )}
            <div className="mt-1.5 flex min-h-5 items-baseline gap-2.5 text-[13.5px]">
              <span className="priv font-[550]" style={{ color: toneOf(stats.gain) }}>
                {eurSigned(stats.gain)}
              </span>
              <span style={{ color: toneOf(stats.twr, 0.00005) }}>{pctSigned(stats.twr, 2)}</span>
              <span className="text-mute">
                {RANGE_PHRASE[range]} · rentabilidad {withHomes ? "de la cartera, " : ""}sin contar lo aportado
              </span>
            </div>
          </div>
          <HeroLegend rows={legend} />
        </div>
        <HeroChart
          model={model}
          laneLabel="Ganancia o pérdida de cada tramo, sin contar lo aportado"
          onHover={(src, k) => setHover(src == null || k == null ? null : { src, k })}
          footer={<PeriodPills />}
        />
      </section>

      <Kpis>
        <Kpi label="Última sesión" note={`${pctSigned(session.pct, 2)} · lo que ha movido el precio de lo que tienes`} tone={session.gainEur}>
          <Money value={session.gainEur} signed dim="soft" />
        </Kpi>
        <Kpi priv label="Aportado neto" note="desde el inicio">
          {eur(invested[to]!, 0)}
        </Kpi>
        <Kpi label="Ganancia total" note="valor menos aportado" tone={all.gain}>
          <Money value={all.gain} signed dim="soft" />
        </Kpi>
        <Kpi label="Plusvalía latente" note={cost > 0 ? `${pctSigned(unrealized / cost)} sobre el coste` : "sin posiciones"} tone={unrealized}>
          <Money value={unrealized} signed dim="soft" />
        </Kpi>
        <Kpi label="Realizado y cobrado" note={<>ventas <Priv>{eur(totals.realizedEur, 0)}</Priv> · rentas <Priv>{eur(totals.dividendsEur + totals.interestEur, 0)}</Priv> · {RANGE_PHRASE[range]}</>} tone={totals.realizedEur + totals.dividendsEur + totals.interestEur}>
          <Money value={totals.realizedEur + totals.dividendsEur + totals.interestEur} signed dim="soft" />
        </Kpi>
        <Kpi label="TIR anualizada" note={xirr == null ? "hace falta más historia" : stats.xirr != null ? RANGE_PHRASE[range] : "desde el inicio"} tone={xirr}>
          {xirr == null ? "—" : pctSigned(xirr)}
        </Kpi>
      </Kpis>

      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
        <Card
          className="col-span-full"
          title="Reparto"
          aside={<span className="truncate">{cell ? <>{cell.name} · <Priv>{eur(cell.value, 0)}</Priv> · {pct(cell.share)}</> : "pasa el cursor para ver el detalle"}</span>}
          note={<Pills size="sm" label="Repartir por" value={group} onChange={setGroup} options={[["Tipo", "Tipo"], ["Cuenta", "Cuenta"], ["Divisa", "Divisa"]]} />}
        >
          <GroupRows groups={groups} hot={cell?.key ?? null} onHover={setCell} />
        </Card>

        <Card className="col-span-full" title="Dividendos e intereses" note={`lo cobrado ${RANGE_PHRASE[range]}, ya sin retenciones`}>
          <IncomeColumns items={income} from={view.start} to={d.today} />
        </Card>

        <Card title="Rentabilidad mes a mes" aside={<span className="text-[12px] text-mute">altura = rentabilidad del mes, en %</span>}>
          <MonthColumns months={months} />
        </Card>

        <Card title="Rentabilidad de cada posición" aside={<span className="text-[12px] text-mute">largo = % sobre el coste · grosor = peso en la cartera</span>}>
          {d.positions.length ? (
            <ReturnBars
              rows={d.positions
                .filter((p) => p.unrealizedPct != null)
                .map((p) => ({ key: p.asset.id, name: p.asset.name, ret: p.unrealizedPct!, gain: p.unrealizedEur, weight: p.weight, onClick: () => go(`/activo/${p.asset.id}`) }))}
            />
          ) : (
            <div className="py-6 text-mute">No hay posiciones abiertas.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
