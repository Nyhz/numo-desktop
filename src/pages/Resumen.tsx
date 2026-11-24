import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { isoOf } from "../../shared/dates.ts";
import { equitySeries, viewProperties } from "../../shared/engine/realestate.ts";
import { monthlyReturns, netInvested, periodStats, returnIndex, sessionChange, totalsIn } from "../../shared/engine/timeline.ts";
import { HeroChart, HeroLegend, bandModel, lineModel, stackModel, type HeroModel, type Row } from "../charts/hero.tsx";
import { DrawdownCard } from "../charts/drawdown.tsx";
import { MonthColumns, RepartoRing, ReturnBars, treeGroups, type TreeItem } from "../charts/viz.tsx";
import { BENCHMARK, benchmarkReturns } from "../data/benchmark.ts";
import { ensureBenchmark, rangeBase, useApp, useBenchmark, useInvested, type Derived } from "../data/store.ts";
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
  // La cartera (sin el fondo de emergencia, que no se invierte) y, aparte, ese fondo.
  const { d, reserve, filtered } = useInvested();
  const range = useApp((s) => s.range);
  const [, go] = useLocation();
  const [picked, setMode] = useState<Mode>("valor");
  const [group, setGroup] = useState<Group>("Tipo");
  const [hover, setHover] = useState<{ src: number; k: number } | null>(null);
  const tl = d.timeline;
  // Con todas las cuentas a la vista, el Resumen es el del patrimonio: la cartera, el fondo
  // de emergencia y lo que ya es tuyo de los inmuebles. Con cuentas filtradas, solo esas cuentas.
  const homes = useMemo(() => (filtered ? [] : viewProperties(d.state, d.today)), [d.state, filtered, d.today]);
  const withHomes = homes.length > 0;
  /** Hay patrimonio además de la cartera. */
  const net = withHomes || !!reserve;
  const mode: Mode = picked === "pat" && !net ? "valor" : picked;
  // El índice con el que se compara la rentabilidad se baja al abrir ese modo, sin esperar por él.
  const bench = useBenchmark(tl.n ? isoOf(tl.start) : null);
  useEffect(() => {
    if (mode === "rent") ensureBenchmark();
  }, [mode, tl.start, d.today]);

  const view = useMemo(() => {
    if (tl.n === 0) return null;
    const to = tl.n - 1;
    const { from } = rangeBase(range, tl, d.today);
    const i0 = Math.max(from, 0);
    const dates = Array.from({ length: to - i0 + 1 }, (_, k) => isoOf(tl.start + i0 + k));
    const invested = netInvested(tl);
    const V = tl.total.subarray(i0);
    const C = invested.subarray(i0);
    return {
      to,
      from,
      i0,
      dates,
      V,
      C,
      // Lo que ya es tuyo de los inmuebles en cada fecha (ceros si no hay ninguno).
      E: equitySeries(homes, dates),
      // El fondo de emergencia en cada fecha. Su serie empieza cuando él, no cuando la cartera.
      R: Float64Array.from(dates, (_, k) => {
        const rt = reserve?.timeline;
        const j = rt ? tl.start + i0 + k - rt.start : -1;
        return rt && j >= 0 && rt.n ? rt.total[Math.min(j, rt.n - 1)]! : 0;
      }),
      invested,
      stats: periodStats(tl, from, to),
      all: periodStats(tl, -1, to),
      // Las cifras clave de debajo del gráfico son de toda la historia: el periodo solo manda arriba.
      totals: totalsIn(d.ledger, d.scope, isoOf(tl.start), d.today),
      ret: returnIndex(d.returns, from, to),
    };
  }, [tl, range, d, homes, reserve]);

  // La geometría del gráfico solo depende del periodo y del modo: el hover no la recalcula.
  const model = useMemo<HeroModel | null>(() => {
    if (!view || view.dates.length < 2) return null;
    const { dates, V, C, E, R, i0, ret } = view;
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
          ...(withHomes ? [{ label: "Inmuebles · lo que ya es tuyo", color: "var(--s8)", values: E }] : []),
          ...(reserve ? [{ label: "Fondo de emergencia", color: "var(--s2)", values: R }] : []),
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
        { color: "var(--acc)", label: net ? "Valor de la cartera" : "Valor", value: eur(V[i]!) },
        { color: "var(--mute)", label: "Aportado neto", value: eur(C[i]!, 0) },
        { color: "transparent", label: "Ganancia", value: eurSigned(V[i]! - C[i]!) },
      ],
    });
  }, [view, mode, withHomes, net, reserve, d.state.accounts, tl, bench]);

  const groups = useMemo(() => {
    // Con el patrimonio a la vista, lo que ya es tuyo de cada inmueble entra en el reparto.
    const items = treeItems(d, group);
    for (const h of homes) if (h.equity > 0) items.push({ key: `home|${h.property.id}`, name: h.property.name, value: h.equity, group: group === "Divisa" ? "EUR" : "Inmuebles" });
    // Y el fondo de emergencia, cuenta a cuenta.
    for (const [id, series] of reserve?.timeline.byAccount ?? []) {
      const acct = reserve!.accounts.get(id);
      const value = series[series.length - 1] ?? 0;
      if (acct && value > 0) items.push({ key: `reserve|${id}`, name: acct.name, value, group: group === "Tipo" ? "Fondo de emergencia" : group === "Cuenta" ? acct.name : acct.currency });
    }
    return treeGroups(items);
  }, [d, group, homes, reserve]);
  const parts = groups.reduce((n, g) => n + g.cells.length, 0);
  const session = useMemo(() => sessionChange(d.positions), [d.positions]);
  const months = useMemo(() => monthlyReturns(tl), [tl]);

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
  const reserveAt = view.R[at]!;
  const [heroI, heroD] = splitMoney(eur(portfolioAt + homesAt + reserveAt));
  const unrealized = d.positions.reduce((s, p) => s + p.unrealizedEur, 0);
  const cost = d.positions.reduce((s, p) => s + p.costEur, 0);
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
            ...(net ? ([["pat", "Patrimonio"]] as const) : []),
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
              {net ? "Patrimonio neto" : "Valor de la cartera"} · {dateShort(dates[at]!)}
            </div>
            <div className="priv mt-0.5 text-[56px] leading-[1.05] font-medium tracking-[-0.02em]" style={{ fontStretch: "108%" }}>
              {heroI}
              <span className="text-mute">{heroD}</span>
            </div>
            {net && (
              <div className="mt-1.5 text-[13.5px] text-ink2">
                cartera <Priv>{eur(portfolioAt)}</Priv>
                {reserve && (
                  <>
                    {" "}
                    · fondo de emergencia <Priv>{eur(reserveAt)}</Priv>
                  </>
                )}
                {withHomes && (
                  <>
                    {" "}
                    · inmuebles <Priv>{eur(homesAt)}</Priv> <span className="text-mute">que ya son tuyos</span>
                  </>
                )}
              </div>
            )}
            <div className="mt-1.5 flex min-h-5 items-baseline gap-2.5 text-[13.5px]">
              <span className="priv font-[550]" style={{ color: toneOf(stats.gain) }}>
                {eurSigned(stats.gain)}
              </span>
              <span style={{ color: toneOf(stats.twr, 0.00005) }}>{pctSigned(stats.twr, 2)}</span>
              <span className="text-mute">
                {RANGE_PHRASE[range]} · rentabilidad {net ? "de la cartera, " : ""}sin contar lo aportado
                {/* La TIR del periodo solo tiene sentido con tres meses o más. */}
                {stats.xirr != null && ` · TIR ${pctSigned(stats.xirr)} anual`}
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
        <Kpi label="Realizado y cobrado" note={<>ventas <Priv>{eur(totals.realizedEur, 0)}</Priv> · rentas <Priv>{eur(totals.dividendsEur + totals.interestEur, 0)}</Priv> · desde el inicio</>} tone={totals.realizedEur + totals.dividendsEur + totals.interestEur}>
          <Money value={totals.realizedEur + totals.dividendsEur + totals.interestEur} signed dim="soft" />
        </Kpi>
        <Kpi label="TIR anualizada" note={all.xirr == null ? "hace falta más historia" : "desde el inicio"} tone={all.xirr}>
          {all.xirr == null ? "—" : pctSigned(all.xirr)}
        </Kpi>
      </Kpis>

      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
        <Card
          title="Reparto"
          note={<Pills size="sm" label="Repartir por" value={group} onChange={setGroup} options={[["Tipo", "Tipo"], ["Cuenta", "Cuenta"], ["Divisa", "Divisa"]]} />}
          aside={<span className="text-mute">{parts === 1 ? "1 posición o saldo" : `${parts} posiciones y saldos`}</span>}
        >
          <RepartoRing groups={groups} />
        </Card>

        <DrawdownCard returns={d.returns} start={tl.start} />

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
