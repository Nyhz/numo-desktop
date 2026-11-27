import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { isoOf } from "../../shared/dates.ts";
import { equitySeries, viewProperties } from "../../shared/engine/realestate.ts";
import { monthlyReturns, netInvested, periodStats, returnIndex, sessionChange, totalsIn } from "../../shared/engine/timeline.ts";
import { HeroChart, HeroLegend, bandModel, lineModel, stackModel, type HeroModel, type Row } from "../charts/hero.tsx";
import { DrawdownCard } from "../charts/drawdown.tsx";
import { MonthColumns, RepartoRing, ReturnBars, treeGroups, type TreeItem } from "../charts/viz.tsx";
import { BENCHMARK, benchmarkReturns } from "../data/benchmark.ts";
import { exposureOf, REGION_LABEL, SECTOR_LABEL, sectorExposureOf, type RegionKey, type SectorKey, type StoredRegions } from "../data/regions.ts";
import { ensureBenchmark, rangeBase, useApp, useBenchmark, useInvested, useRegions, type Derived } from "../data/store.ts";
import { dateShort, eur, eurAxis, eurSigned, num, pctSigned, seriesColor } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { usePrivate } from "../ui/privacy.ts";
import { BigMoney, Btn, Card, Empty, HeaderSlot, Kpi, Kpis, Money, Num, Pills, Priv, toneOf } from "../ui/kit.tsx";
import { KIND_ORDER, PeriodPills, RANGE_PHRASE, Welcome, kindColor, kindLabel } from "./common.tsx";

type Mode = "valor" | "pat" | "cuenta" | "tipo" | "rent";
/** Cómo se reparte «Dónde está tu dinero». */
type Where = "Región" | "Divisa";

const NO_BREAKDOWN = "Sin desglose";

/**
 * Reparto por regiones de la cartera: cada ETF y fondo se parte según lo que lleva
 * dentro (Morningstar), cada acción va a la región de su país y las criptomonedas
 * y lo que no tiene desglose (renta fija, materias primas…) van aparte. Ni el
 * fondo de emergencia ni los inmuebles entran: no son dinero invertido.
 */
function regionItems(d: Derived, regions: Map<string, StoredRegions>): TreeItem[] {
  const items: TreeItem[] = [];
  for (const p of d.positions) {
    const ex = exposureOf(p.asset, regions.get(p.asset.id) ?? null);
    if (ex.kind === "regions") {
      for (const [r, w] of Object.entries(ex.weights)) items.push({ key: `${p.asset.id}|${r}`, name: p.asset.name, value: p.valueEur * w, group: REGION_LABEL[r as RegionKey] });
    } else items.push({ key: p.asset.id, name: p.asset.name, value: p.valueEur, group: ex.kind === "crypto" ? "Cripto" : NO_BREAKDOWN });
  }
  // Sin saldos: el único efectivo que se lleva es el del fondo de emergencia, que no se invierte
  // en ninguna región. Tampoco cuando el filtro de cuentas lo incluye.
  return items;
}

/** «Por sectores»: solo la cartera; cada ETF y fondo según su reparto, cada acción en el suyo. */
function sectorItems(d: Derived, regions: Map<string, StoredRegions>): TreeItem[] {
  const items: TreeItem[] = [];
  for (const p of d.positions) {
    const ex = sectorExposureOf(p.asset, regions.get(p.asset.id) ?? null);
    if (ex.kind === "sectors") {
      for (const [k, w] of Object.entries(ex.weights)) items.push({ key: `${p.asset.id}|${k}`, name: p.asset.name, value: p.valueEur * w, group: SECTOR_LABEL[k as SectorKey] });
    } else items.push({ key: p.asset.id, name: p.asset.name, value: p.valueEur, group: ex.kind === "crypto" ? "Cripto" : NO_BREAKDOWN });
  }
  return items;
}

/** «Qué tienes»: cada posición en su tipo de activo, y el fondo de emergencia aparte. */
function kindItems(d: Derived): TreeItem[] {
  const tl = d.timeline;
  const last = tl.n - 1;
  const items: TreeItem[] = d.positions.map((p) => ({ key: p.asset.id, name: p.asset.name, value: p.valueEur, group: kindLabel(p.asset.kind) }));
  // Solo el fondo de emergencia lleva efectivo: aparece aquí cuando el filtro de cuentas lo incluye.
  for (const [id, series] of tl.cash) {
    const acct = d.accounts.get(id);
    if (!acct || last < 0) continue;
    items.push({ key: `cash|${id}`, name: acct.name, value: series[last]! / d.ledger.market.fx(acct.currency, tl.start + last), group: "Fondo de emergencia" });
  }
  return items;
}

/** «Dónde está tu dinero» por divisa: solo la cartera, cada posición en la divisa en que cotiza. */
const currencyItems = (d: Derived): TreeItem[] => d.positions.map((p) => ({ key: p.asset.id, name: p.asset.name, value: p.valueEur, group: p.asset.currency }));

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
  const hidden = usePrivate();
  const [, go] = useLocation();
  const [picked, setMode] = useState<Mode>("rent");
  const [where, setWhere] = useState<Where>("Región");
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

  // «Qué tienes»: todo el patrimonio, con lo que ya es tuyo de cada inmueble y el fondo de emergencia.
  const kinds = useMemo(() => {
    const items = kindItems(d);
    for (const h of homes) if (h.equity > 0) items.push({ key: `home|${h.property.id}`, name: h.property.name, value: h.equity, group: "Inmuebles" });
    for (const [id, series] of reserve?.timeline.byAccount ?? []) {
      const acct = reserve!.accounts.get(id);
      const value = series[series.length - 1] ?? 0;
      if (acct && value > 0) items.push({ key: `reserve|${id}`, name: acct.name, value, group: "Fondo de emergencia" });
    }
    return treeGroups(items);
  }, [d, homes, reserve]);
  // «Dónde está tu dinero»: solo la cartera. El piso y el fondo de emergencia no dicen nada de dónde inviertes.
  const regions = useRegions();
  const places = useMemo(() => treeGroups(where === "Región" ? regionItems(d, regions) : currencyItems(d)), [d, where, regions]);
  const sectors = useMemo(() => treeGroups(sectorItems(d, regions)), [d, regions]);
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
            ["rent", "Rentabilidad"],
            ["valor", "Valor y aportado"],
            ...(net ? ([["pat", "Patrimonio"]] as const) : []),
            ["cuenta", "Por cuenta"],
            ["tipo", "Por tipo"],
          ]}
        />
      </HeaderSlot>

      <section className="px-1 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[12px] text-mute">
              {net ? "Patrimonio neto" : "Valor de la cartera"} · {dateShort(dates[at]!)}
            </div>
            <BigMoney value={portfolioAt + homesAt + reserveAt} snap={hover != null || counted != null} />
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
                <Num value={stats.gain} format={eurSigned} />
              </span>
              <span style={{ color: toneOf(stats.twr, 0.00005) }}>
                <Num value={stats.twr} format={pctSigned} />
              </span>
              {/* Lo justo a la vista; qué mide cada cifra, al pasar el cursor. */}
              <span
                className="text-mute"
                title="Ganancia y rentabilidad de la cartera en el periodo, sin contar lo que has aportado (rentabilidad ponderada por tiempo). La TIR sí tiene en cuenta cuándo entró cada aportación, y solo se calcula con tres meses o más."
              >
                {net ? "la cartera, " : ""}
                {RANGE_PHRASE[range]}
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
        <Kpi label="Última sesión" note={`${pctSigned(session.pct, 2)} · por los precios`} tone={session.gainEur}>
          <Money value={session.gainEur} signed dim="soft" />
        </Kpi>
        <Kpi priv label="Aportado neto" note="desde el inicio">
          <Num value={invested[to]!} format={(v) => eur(v, 0)} />
        </Kpi>
        <Kpi label="Ganancia total" note="valor menos aportado" tone={all.gain}>
          <Money value={all.gain} signed dim="soft" />
        </Kpi>
        <Kpi label="Plusvalía latente" note={cost > 0 ? `${pctSigned(unrealized / cost)} sobre el coste` : "sin posiciones"} tone={unrealized}>
          <Money value={unrealized} signed dim="soft" />
        </Kpi>
        {/* El desglose no cabe en la nota sin partirla en dos líneas: va al pasar el cursor (y no en modo privado). */}
        <Kpi
          label="Realizado y cobrado"
          note="ventas y rentas"
          hint={hidden ? undefined : `Ventas ${eur(totals.realizedEur, 0)} · dividendos e intereses ${eur(totals.dividendsEur + totals.interestEur, 0)}, desde el inicio`}
          tone={totals.realizedEur + totals.dividendsEur + totals.interestEur}
        >
          <Money value={totals.realizedEur + totals.dividendsEur + totals.interestEur} signed dim="soft" />
        </Kpi>
        <Kpi label="TIR anualizada" note={all.xirr == null ? "hace falta más historia" : "desde el inicio"} tone={all.xirr}>
          {all.xirr == null ? "—" : <Num value={all.xirr} format={pctSigned} />}
        </Kpi>
      </Kpis>

      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
        <Card title="Qué tienes" aside={<span className="text-mute">todo tu patrimonio</span>}>
          <RepartoRing groups={kinds} />
        </Card>

        <Card
          title="Dónde está tu dinero"
          note={<Pills size="sm" label="Repartir por" value={where} onChange={setWhere} options={[["Región", "Región"], ["Divisa", "Divisa"]]} />}
          aside={
            <span className="text-mute" title={where === "Región" ? "Lo que hay dentro de cada ETF y fondo, según Morningstar; se actualiza una vez al mes" : undefined}>
              solo la cartera
            </span>
          }
        >
          <RepartoRing groups={places} muted={[NO_BREAKDOWN]} empty="No hay posiciones abiertas." />
        </Card>

        {/* Seis tarjetas en tres parejas de alto parecido: el reparto, luego sectores y caídas, y las dos tablas largas juntas. */}
        <Card title="Por sectores" aside={<span className="text-mute" title="Lo que hay dentro de cada ETF y fondo y el sector de cada acción, según Morningstar; se actualiza una vez al mes">solo la cartera</span>}>
          <RepartoRing groups={sectors} muted={[NO_BREAKDOWN, "Cripto"]} empty="No hay posiciones abiertas." />
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
