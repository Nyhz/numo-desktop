import { Pencil, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { parseNumber } from "../../shared/csv.ts";
import { scheduleByYear, simulateRepayment, valueAt, viewProperties, type PropertyView } from "../../shared/engine/realestate.ts";
import { RATE_TYPE_LABEL, type MortgageEvent } from "../../shared/types.ts";
import { HeroChart, HeroLegend, bandModel, lineModel, type HeroModel, type Row } from "../charts/hero.tsx";
import { SplitBar } from "../charts/viz.tsx";
import { derive, removeMortgageEvent, removeValuation, useApp } from "../data/store.ts";
import { dateShort, eur, eurAxis, num, pct, splitMoney } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Card, Empty, HeaderSlot, IconBtn, Kpi, Kpis, Pills, toast } from "../ui/kit.tsx";
import { L, THead, TRow, Table } from "./common.tsx";

const EVENT_LABEL: Record<MortgageEvent["type"], string> = {
  early_repayment: "Amortización anticipada",
  rate_change: "Revisión del tipo",
  payment_override: "Cuota real",
};
const monthsText = (n: number) => {
  const y = Math.floor(n / 12);
  const m = n % 12;
  return [y ? `${y} ${y === 1 ? "año" : "años"}` : "", m ? `${m} ${m === 1 ? "mes" : "meses"}` : ""].filter(Boolean).join(" y ") || "0 meses";
};

/** Valor del inmueble frente a deuda, de la compra al final de la hipoteca. */
function useChart(v: PropertyView, today: string): HeroModel | null {
  return useMemo(() => {
    const { property, valuations, loan } = v;
    if (!loan) {
      // Sin hipoteca: solo la evolución del valor según las valoraciones registradas.
      const dates = [property.purchaseDate, ...valuations.map((x) => x.date).filter((x) => x > property.purchaseDate), today].filter((x, i, a) => a.indexOf(x) === i).sort();
      if (dates.length < 2) return null;
      return lineModel({ dates, values: dates.map((dt) => valueAt(property, valuations, dt).value), label: "Valor", format: (x) => eur(x, 0), axis: eurAxis });
    }
    const rows = loan.schedule;
    const dates = [property.purchaseDate < rows[0]!.date ? property.purchaseDate : rows[0]!.date, ...rows.map((r) => r.date)].filter((x, i, a) => i === 0 || x !== a[i - 1]);
    // Para cada fecha: capital pendiente tras la última fila del cuadro hasta ese día.
    const pending: number[] = [];
    const value: number[] = [];
    let k = 0;
    let rem = loan.mortgage.principal;
    for (const dt of dates) {
      while (k < rows.length && rows[k]!.date <= dt) rem = rows[k++]!.remaining;
      pending.push(dt < rows[0]!.date ? loan.mortgage.principal : rem);
      value.push(valueAt(property, valuations, dt).value);
    }
    const sum = (a: number, b: number, f: (r: (typeof rows)[number]) => number) => {
      let s = 0;
      for (const r of rows) if (r.date > dates[a]! && r.date <= dates[b]!) s += f(r);
      return s;
    };
    return bandModel({
      dates,
      top: value,
      base: pending,
      zeroBased: true,
      axis: eurAxis,
      now: today,
      lane: (a, b) => ({ up: sum(a, b, (r) => r.principal), down: sum(a, b, (r) => r.interest) }),
      rows: (i): Row[] => [
        { color: "var(--acc)", label: "Valor del inmueble", value: eur(value[i]!, 0) },
        { color: "var(--mute)", label: "Hipoteca pendiente", value: eur(pending[i]!, 0) },
        { color: "transparent", label: "Ya es tuyo", value: eur(value[i]! - pending[i]!, 0) },
      ],
    });
  }, [v, today]);
}

function WhatIf({ v, today }: { v: PropertyView; today: string }) {
  const [text, setText] = useState("10.000");
  const [mode, setMode] = useState<"reduce_term" | "reduce_installment">("reduce_term");
  const loan = v.loan!;
  const amount = parseNumber(text.replace(/\./g, "")) ?? 0;
  const sim = useMemo(() => simulateRepayment(loan, Math.min(amount, loan.outstanding), mode, today), [loan, amount, mode, today]);
  return (
    <Card title="¿Y si amortizo?" note="una simulación: no registra nada">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-40">
          <input className="field h-10 pr-8 text-right text-[18px] font-[550]" inputMode="decimal" aria-label="Importe a amortizar" value={text} onChange={(e) => setText(e.target.value)} />
          <span className="pointer-events-none absolute top-2.5 right-3 text-mute">€</span>
        </div>
        <Pills
          label="Qué reduce la amortización"
          value={mode}
          onChange={setMode}
          options={[
            ["reduce_term", "Reducir plazo"],
            ["reduce_installment", "Reducir cuota"],
          ]}
        />
      </div>
      {sim ? (
        <>
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <div className="text-[12px] text-mute">Intereses que te ahorras</div>
              <div className="mt-[3px] text-[20px] font-[550] text-up" style={{ fontStretch: "106%" }}>
                {eur(sim.interestSaved, 0)}
              </div>
            </div>
            <div>
              <div className="text-[12px] text-mute">{mode === "reduce_term" ? "Terminas antes" : "La cuota baja a"}</div>
              <div className="mt-[3px] text-[20px] font-[550]" style={{ fontStretch: "106%" }}>
                {mode === "reduce_term" ? monthsText(sim.monthsSaved) : eur(sim.newPayment)}
              </div>
            </div>
            <div>
              <div className="text-[12px] text-mute">{mode === "reduce_term" ? "Nueva última cuota" : "Bajada mensual"}</div>
              <div className="mt-[3px] text-[20px] font-[550]" style={{ fontStretch: "106%" }}>
                {mode === "reduce_term" ? (sim.newEndDate ? dateShort(sim.newEndDate) : "—") : eur(sim.paymentBefore - sim.newPayment)}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Btn onClick={() => openDialog({ kind: "mortgageEvent", mortgage: loan.mortgage, type: "early_repayment", amount: Math.min(amount, loan.outstanding), mode })}>Registrar esta amortización…</Btn>
          </div>
        </>
      ) : (
        <div className="mt-4 text-mute">Escribe un importe para ver el efecto.</div>
      )}
    </Card>
  );
}

function PropertyPanel({ v, today, portfolio }: { v: PropertyView; today: string; portfolio: number }) {
  const model = useChart(v, today);
  const [k, setK] = useState<number | null>(null);
  const [allYears, setAllYears] = useState(false);
  const { property, loan } = v;
  const [heroI, heroD] = splitMoney(eur(v.equity));
  const years = useMemo(() => (loan ? scheduleByYear(loan.schedule) : []), [loan]);
  const thisYear = +today.slice(0, 4);
  const shownYears = allYears ? years : years.filter((y) => y.year >= thisYear - 1).slice(0, 7);
  const legend = model ? model.rowsAt(k != null ? Math.min(k, model.n - 1) : Math.max(0, Math.round(((model.nowLeft ?? 100) / 100) * (model.n - 1)))) : [];

  const history = [
    ...(loan?.events ?? []).map((e) => ({
      key: `e-${e.id}`,
      date: e.date,
      label: EVENT_LABEL[e.type],
      detail: e.type === "rate_change" ? `nuevo tipo ${num(e.ratePct ?? 0, 3, 2)} %` : e.type === "early_repayment" ? `${eur(e.amount ?? 0)} · ${e.mode === "reduce_installment" ? "reduce cuota" : "reduce plazo"}` : `${eur(e.amount ?? 0)} al mes`,
      note: e.note,
      remove: () => removeMortgageEvent(e.id),
    })),
    ...v.valuations.map((x) => ({ key: `v-${x.id}`, date: x.date, label: "Valoración", detail: eur(x.value, 0), note: x.note, remove: () => removeValuation(x.id) })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <section className="px-1 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-mute">
              <span className="wide text-[15px] font-semibold text-ink">{property.name}</span>
              {property.address && <span className="selectable">{property.address}</span>}
              <span>· comprado el {dateShort(property.purchaseDate)}</span>
            </div>
            <div className="mt-1 text-[12px] text-mute">Lo que ya es tuyo · valor menos hipoteca pendiente</div>
            <div className="mt-0.5 text-[56px] leading-[1.05] font-medium tracking-[-0.02em]" style={{ fontStretch: "108%" }}>
              {heroI}
              <span className="text-mute">{heroD}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-2.5 text-[13.5px]">
              <span className="font-[550] text-acc">{pct(v.ownedShare)} del inmueble</span>
              <span className="text-mute">
                valor {eur(v.value, 0)}
                {v.valueAsOf ? ` (valorado el ${dateShort(v.valueAsOf)})` : " (precio de compra)"}
                {portfolio > 0 ? ` · con tu cartera, ${eur(v.equity + portfolio, 0)} de patrimonio neto` : ""}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex gap-2">
              <Btn onClick={() => openDialog({ kind: "valuation", property })}>
                <Plus size={13} /> Valoración
              </Btn>
              <Btn onClick={() => openDialog({ kind: "property", property })}>
                <Pencil size={13} /> Editar
              </Btn>
            </div>
            <HeroLegend rows={legend} />
          </div>
        </div>
        <HeroChart
          model={model}
          laneLabel={loan ? "De cada tramo de cuotas: capital que amortizas (arriba) e intereses que pagas (abajo)" : undefined}
          laneColors={["var(--acc)", "color-mix(in oklab, var(--down) 70%, var(--card))"]}
          onHover={(_, kk) => setK(kk)}
        />
      </section>

      {loan ? (
        <>
          <Kpis>
            <Kpi label="Cuota mensual" note={loan.nextPayment ? `próxima el ${dateShort(loan.nextPayment.date)} · ${eur(loan.nextPayment.interest, 0)} son intereses` : "hipoteca terminada"}>
              {eur(loan.payment)}
            </Kpi>
            <Kpi label="Hipoteca pendiente" note={`${pct(loan.progress)} devuelto de ${eur(loan.mortgage.principal, 0)}`}>
              {eur(loan.outstanding, 0)}
            </Kpi>
            <Kpi label="Pagado hasta hoy" note={`entrada ${eur(v.downPayment, 0)} · gastos ${eur(property.purchaseCosts, 0)} · cuotas ${eur(loan.paidToDate, 0)}`}>
              {eur(v.totalPaid, 0)}
            </Kpi>
            <Kpi label="Intereses pagados" note={`quedan ${eur(loan.interestRemaining, 0)} por pagar`}>
              {eur(loan.interestPaid, 0)}
            </Kpi>
            <Kpi label="Última cuota" note={`quedan ${loan.paymentsLeft} cuotas · ${monthsText(loan.paymentsLeft)}`}>
              {loan.endDate ? dateShort(loan.endDate) : "—"}
            </Kpi>
          </Kpis>

          <div className="grid items-start gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
            <Card title="A dónde ha ido lo pagado" aside={`${eur(v.totalPaid, 0)} en total`}>
              <SplitBar
                parts={[
                  { key: "down", label: "Entrada", value: v.downPayment, color: "var(--acc)", display: eur(v.downPayment, 0) },
                  { key: "principal", label: "Capital amortizado", value: loan.principalPaid, color: "color-mix(in oklab, var(--acc) 55%, var(--card))", display: eur(loan.principalPaid, 0) },
                  { key: "interest", label: "Intereses", value: loan.interestPaid, color: "color-mix(in oklab, var(--down) 70%, var(--card))", display: eur(loan.interestPaid, 0) },
                  { key: "costs", label: "Gastos de compra", value: property.purchaseCosts, color: "color-mix(in oklab, var(--ink2) 45%, var(--card))", display: eur(property.purchaseCosts, 0) },
                ]}
              />
              <p className="mt-3.5 text-[12px] text-mute">
                {RATE_TYPE_LABEL[loan.mortgage.rateType]} al {num(loan.schedule.find((r) => r.date > today)?.ratePct ?? loan.mortgage.ratePct, 3, 2)} % TIN
                {loan.mortgage.lender ? ` · ${loan.mortgage.lender}` : ""} · {monthsText(loan.mortgage.termMonths)} · intereses totales previstos {eur(loan.totalInterest, 0)}
              </p>
            </Card>
            {loan.outstanding > 0 && <WhatIf v={v} today={today} />}
          </div>

          <Card
            title="Cuadro de amortización por años"
            pad={false}
            className="overflow-hidden"
            aside={
              years.length > shownYears.length || allYears ? (
                <button type="button" className="text-mute hover:text-ink" onClick={() => setAllYears((x) => !x)}>
                  {allYears ? "Ver solo los próximos" : `Ver los ${years.length} años`}
                </button>
              ) : undefined
            }
          >
            <Table cols="70px 70px 1fr 1fr 1fr minmax(160px,1.3fr) 1fr" minWidth={880}>
              <THead>
                <L>Año</L>
                <span>Cuotas</span>
                <span>Pagado</span>
                <span>Intereses</span>
                <span>Capital</span>
                <L>Reparto de lo pagado</L>
                <span>Pendiente a fin de año</span>
              </THead>
              {shownYears.map((y) => (
                <TRow key={y.year} className={y.year === thisYear ? "linked" : ""}>
                  <L className={y.year === thisYear ? "font-semibold" : "text-ink2"}>{y.year}</L>
                  <span className="text-mute">{y.payments}</span>
                  <span>{eur(y.paid, 0)}</span>
                  <span className="text-ink2">{eur(y.interest, 0)}</span>
                  <span>{eur(y.principal, 0)}</span>
                  <L>
                    <div className="flex h-1.5 gap-[2px]" title={`${pct(y.principal / Math.max(1, y.paid))} capital · ${pct(y.interest / Math.max(1, y.paid))} intereses`}>
                      <div className="rounded-[2px] bg-acc" style={{ flex: `${y.principal} 1 0` }} />
                      <div className="rounded-[2px]" style={{ flex: `${y.interest} 1 0`, background: "color-mix(in oklab, var(--down) 70%, var(--card))" }} />
                    </div>
                  </L>
                  <span className="font-semibold">{eur(y.remaining, 0)}</span>
                </TRow>
              ))}
            </Table>
          </Card>
        </>
      ) : (
        <Kpis>
          <Kpi label="Valor">{eur(v.value, 0)}</Kpi>
          <Kpi label="Precio de compra" note={`más ${eur(property.purchaseCosts, 0)} de gastos`}>
            {eur(property.purchasePrice, 0)}
          </Kpi>
          <Kpi label="Revalorización" tone={v.appreciation}>
            {eur(v.appreciation, 0)}
          </Kpi>
          <Kpi label="Hipoteca" note="edita el inmueble para añadirla">
            sin hipoteca
          </Kpi>
        </Kpis>
      )}

      <Card
        title="Historial"
        note="lo que cambia el cuadro y el valor"
        pad={false}
        aside={
          loan ? (
            <span className="flex flex-wrap gap-2">
              <Btn size="sm" onClick={() => openDialog({ kind: "mortgageEvent", mortgage: loan.mortgage, type: "early_repayment" })}>
                <Plus size={12} /> Amortización
              </Btn>
              <Btn size="sm" onClick={() => openDialog({ kind: "mortgageEvent", mortgage: loan.mortgage, type: "rate_change" })}>
                <Plus size={12} /> Revisión del tipo
              </Btn>
              <Btn size="sm" onClick={() => openDialog({ kind: "mortgageEvent", mortgage: loan.mortgage, type: "payment_override" })}>
                <Plus size={12} /> Cuota real
              </Btn>
            </span>
          ) : undefined
        }
      >
        {history.length === 0 ? (
          <div className="px-5 pb-5 text-mute">Todavía no hay amortizaciones, revisiones ni valoraciones registradas.</div>
        ) : (
          history.map((h) => (
            <div key={h.key} className="flex items-center gap-4 border-t border-line px-5 py-[var(--row)]">
              <span className="w-24 shrink-0 text-ink2">{dateShort(h.date)}</span>
              <span className="w-48 shrink-0 font-[550]">{h.label}</span>
              <span className="flex-1 truncate">
                {h.detail}
                {h.note && <span className="text-mute"> · {h.note}</span>}
              </span>
              <IconBtn
                label="Quitar"
                onClick={async () => {
                  const res = await h.remove();
                  if (res.ok) toast(`${h.label} eliminada`);
                  else toast(res.error, { tone: "error" });
                }}
              >
                <X size={14} />
              </IconBtn>
            </div>
          ))
        )}
      </Card>
    </>
  );
}

export function Inmuebles() {
  const state = useApp((s) => (s.demo ?? s.loaded).state);
  const [picked, setPicked] = useState<string | null>(null);
  const d = derive(state, null);
  const views = useMemo(() => viewProperties(state, d.today), [state, d.today]);
  const portfolio = d.timeline.n ? d.timeline.total[d.timeline.n - 1]! : 0;

  if (views.length === 0) {
    return (
      <Empty title="Registra tu vivienda" action={<Btn variant="cta" onClick={() => openDialog({ kind: "property" })}>Añadir un inmueble</Btn>}>
        Apunta el precio de compra y la hipoteca y verás cuánto es ya tuyo, cuánto llevas pagado, cuánto queda y qué pasaría si amortizas.
      </Empty>
    );
  }

  const current = views.find((v) => v.property.id === picked) ?? views[0]!;
  const totalEquity = views.reduce((s, v) => s + v.equity, 0);

  return (
    <div className="screen flex flex-col gap-5">
      <HeaderSlot>
        {views.length > 1 && <Pills label="Inmueble" value={current.property.id} onChange={setPicked} options={views.map((v) => [v.property.id, v.property.name] as const)} />}
        <Btn size="sm" onClick={() => openDialog({ kind: "property" })}>
          <Plus size={12} /> Inmueble
        </Btn>
        {views.length > 1 && <span className="text-[12px] text-mute">{eur(totalEquity, 0)} entre los {views.length}</span>}
      </HeaderSlot>
      <PropertyPanel key={current.property.id} v={current} today={d.today} portfolio={portfolio} />
    </div>
  );
}
