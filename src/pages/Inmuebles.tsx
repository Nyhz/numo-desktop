import { Pencil, Plus, X } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { simulateRepayment, viewProperties, type PropertyView } from "../../shared/engine/realestate.ts";
import { RATE_TYPE_LABEL, type MortgageEvent } from "../../shared/types.ts";
import { HOME_COLOR, HomeChart, PaidMiniBar, PaidSplit } from "../charts/inmuebles.tsx";
import { homeModel, type HomeYear, type SimMode } from "../charts/inmuebles-model.ts";
import { derive, removeMortgageEvent, removeValuation, useApp, type Result } from "../data/store.ts";
import { dateShort, eur, num, pct, splitMoney } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Card, Empty, HeaderSlot, IconBtn, Kpi, Kpis, Pills, Swatch, toast } from "../ui/kit.tsx";

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

/** Tope del deslizador de la simulación. */
const SIM_MAX = 60_000;
const SIM_STEP = 1_000;

type LegendRow = { color: string; label: string; value: string };

/** Cifra de resultado bajo su rótulo (simulación). */
const Figure = ({ label, children, up = false }: { label: string; children: ReactNode; up?: boolean }) => (
  <div>
    <div className="text-[12px] text-mute">{label}</div>
    <div className={`mt-1 text-[20px] font-[550] ${up ? "text-up" : ""}`} style={{ fontStretch: "106%" }}>
      {children}
    </div>
  </div>
);

function WhatIf({ v, today, extra, setExtra, mode, setMode, max }: { v: PropertyView; today: string; extra: number; setExtra: (n: number) => void; mode: SimMode; setMode: (m: SimMode) => void; max: number }) {
  const loan = v.loan!;
  const amount = Math.min(extra, loan.outstanding);
  const sim = useMemo(() => simulateRepayment(loan, amount, mode, today), [loan, amount, mode, today]);
  const term = mode === "reduce_term";
  const newPayment = sim?.newPayment ?? loan.payment;
  const newEnd = sim ? sim.newEndDate : loan.endDate;
  // Si la hipoteca pendiente no llega al tope, el deslizador termina en ella y solo se rotulan los extremos.
  const marks = max === SIM_MAX ? [0, SIM_MAX / 3, (SIM_MAX * 2) / 3, SIM_MAX] : [0, Math.min(max, loan.outstanding)];
  return (
    <Card title="¿Y si amortizo?" note="una simulación: no registra nada">
      <div className="flex flex-wrap items-center gap-4">
        <span className="min-w-[130px] text-[30px] font-medium tracking-[-0.01em] text-up" style={{ fontStretch: "108%" }}>
          {eur(amount, 0)}
        </span>
        <Pills
          size="sm"
          label="Qué reduce la amortización"
          value={mode}
          onChange={setMode}
          options={[
            ["reduce_term", "Reducir plazo"],
            ["reduce_installment", "Reducir cuota"],
          ]}
        />
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={SIM_STEP}
        value={Math.min(extra, max)}
        onChange={(e) => setExtra(+e.target.value)}
        aria-label="Importe a amortizar"
        aria-valuetext={eur(amount, 0)}
        className="mt-3.5 block w-full"
        style={{ accentColor: "var(--up)" }}
      />
      <div className="flex justify-between text-[11px] text-mute">
        {marks.map((m) => (
          <span key={m}>{eur(m, 0)}</span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <Figure label="Intereses que te ahorras" up>
          {eur(sim?.interestSaved ?? 0, 0)}
        </Figure>
        <Figure label={term ? "Terminas antes" : "La cuota baja a"}>{term ? monthsText(sim?.monthsSaved ?? 0) : eur(newPayment)}</Figure>
        <Figure label={term ? "Nueva última cuota" : "Bajada mensual"}>{term ? (newEnd ? dateShort(newEnd) : "—") : eur(loan.payment - newPayment)}</Figure>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <Btn disabled={!(amount > 0)} onClick={() => openDialog({ kind: "mortgageEvent", mortgage: loan.mortgage, type: "early_repayment", amount, mode })}>
          Registrar esta amortización…
        </Btn>
        <span className="text-[12px] text-mute">en verde en el gráfico de arriba: lo que pasaría a ser tuyo cada año</span>
      </div>
    </Card>
  );
}

const YEAR_COLS: CSSProperties = { gridTemplateColumns: "52px 1fr 1fr 1fr minmax(70px,.8fr) 1.1fr" };

function YearTable({ years, hot, onHover, total, all, onToggle }: { years: HomeYear[]; hot: number | null; onHover: (year: number | null) => void; total: number; all: boolean; onToggle: () => void }) {
  return (
    <section className="card min-w-0 overflow-x-auto">
      <div className="flex items-baseline justify-between gap-4 px-5 pt-4 pb-2.5">
        <span className="wide font-semibold">Cuadro por años</span>
        {(total > years.length || all) && (
          <button type="button" className="text-[12.5px] text-mute hover:text-ink" onClick={onToggle}>
            {all ? "Ver solo los próximos" : `Ver los ${total} años`}
          </button>
        )}
      </div>
      <div className="min-w-[520px] text-right" role="table" aria-label="Cuadro de amortización por años" onMouseLeave={() => onHover(null)}>
        <div className="thead border-t border-line" style={{ ...YEAR_COLS, padding: "8px 20px" }} role="row">
          <span className="text-left">Año</span>
          <span>Pagado</span>
          <span>Intereses</span>
          <span>Capital</span>
          <span />
          <span>Pendiente</span>
        </div>
        {years.map((y) => (
          <div key={y.year} className={`trow ${hot === y.year ? "linked" : y.isNow ? "hot" : ""}`} style={YEAR_COLS} role="row" onMouseEnter={() => onHover(y.year)}>
            <span className={`text-left ${y.isNow ? "font-[650]" : ""}`}>{y.year}</span>
            <span>{eur(y.paid, 0)}</span>
            <span className="text-ink2">{eur(y.interest, 0)}</span>
            <span>{eur(y.principal, 0)}</span>
            <PaidMiniBar principal={y.principal} interest={y.interest} />
            <span className="font-semibold">{eur(y.remaining, 0)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

type HistoryItem = { key: string; date: string; label: string; detail: string; tail: string; purchase?: boolean; remove?: () => Promise<Result> };

function History({ v }: { v: PropertyView }) {
  const { property, loan } = v;
  const events: HistoryItem[] = (loan?.events ?? []).map((e) => ({
    key: `e-${e.id}`,
    date: e.date,
    label: EVENT_LABEL[e.type],
    detail: e.type === "rate_change" ? `nuevo tipo ${num(e.ratePct ?? 0, 3, 2)} %` : e.type === "early_repayment" ? `${eur(e.amount ?? 0)} · ${e.mode === "reduce_installment" ? "reduce cuota" : "reduce plazo"}` : `${eur(e.amount ?? 0)} al mes`,
    tail: e.note,
    remove: () => removeMortgageEvent(e.id),
  }));
  const valuations: HistoryItem[] = v.valuations.map((x) => ({ key: `v-${x.id}`, date: x.date, label: "Valoración", detail: eur(x.value, 0), tail: x.note, remove: () => removeValuation(x.id) }));
  const items: HistoryItem[] = [
    ...events,
    ...valuations,
    {
      key: "compra",
      date: property.purchaseDate,
      label: "Compra",
      detail: eur(property.purchasePrice, 0),
      tail: [property.purchaseCosts > 0 ? `${eur(property.purchaseCosts, 0)} de gastos` : "", loan ? `hipoteca de ${eur(loan.mortgage.principal, 0)}` : ""].filter(Boolean).join(" · "),
      purchase: true,
    },
  ].sort((a, b) => b.date.localeCompare(a.date) || Number(!!a.purchase) - Number(!!b.purchase));

  return (
    <section className="card min-w-0">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3.5">
        <span className="wide flex-1 font-semibold">Historial</span>
        {loan && (
          <>
            <Btn size="sm" onClick={() => openDialog({ kind: "mortgageEvent", mortgage: loan.mortgage, type: "early_repayment" })}>
              <Plus size={12} /> Amortización
            </Btn>
            <Btn size="sm" onClick={() => openDialog({ kind: "mortgageEvent", mortgage: loan.mortgage, type: "rate_change" })}>
              <Plus size={12} /> Revisión del tipo
            </Btn>
            <Btn size="sm" onClick={() => openDialog({ kind: "mortgageEvent", mortgage: loan.mortgage, type: "payment_override" })}>
              <Plus size={12} /> Cuota real
            </Btn>
          </>
        )}
      </div>
      {items.map((h) => (
        <div key={h.key} className="group grid items-baseline gap-3 border-t border-line px-5 py-[var(--row)] transition-colors duration-[120ms] hover:bg-wash" style={{ gridTemplateColumns: "10px 84px minmax(0,1fr) 22px" }}>
          {h.purchase ? <span className="size-2 self-center rounded-full bg-acc" /> : <span className="size-2 rotate-45 self-center border-[1.5px] border-ink2" />}
          <span className="text-ink2">{dateShort(h.date)}</span>
          <span className="selectable">
            <span className="font-[550]">{h.label}</span> · {h.detail}
            {h.tail && <span className="text-mute"> · {h.tail}</span>}
          </span>
          {h.remove ? (
            // Solo aparece al pasar por la fila o al llegar con el teclado; no cambia el alto de la fila.
            <IconBtn
              label={`Quitar ${h.label.toLowerCase()} del ${dateShort(h.date)}`}
              className="-my-1.5 -ml-1 size-[26px]! self-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={async () => {
                const res = await h.remove!();
                if (res.ok) toast(`${h.label} eliminada`);
                else toast(res.error, { tone: "error" });
              }}
            >
              <X size={14} />
            </IconBtn>
          ) : (
            <span />
          )}
        </div>
      ))}
    </section>
  );
}

function PropertyPanel({ v, today, portfolio }: { v: PropertyView; today: string; portfolio: number }) {
  const { property, loan } = v;
  const [extra, setExtra] = useState(10_000);
  const [mode, setMode] = useState<SimMode>("reduce_term");
  const [hy, setHy] = useState<number | null>(null);
  const [allYears, setAllYears] = useState(false);

  const simMax = loan ? Math.max(SIM_STEP, Math.min(SIM_MAX, Math.ceil(loan.outstanding / SIM_STEP) * SIM_STEP)) : 0;
  const amount = loan ? Math.min(extra, simMax, loan.outstanding) : 0;
  // La geometría solo cambia con el inmueble, el importe simulado y el modo.
  const model = useMemo(() => homeModel(v, today, amount, mode), [v, today, amount, mode]);

  const [heroI, heroD] = splitMoney(eur(v.equity));
  const thisYear = +today.slice(0, 4);
  const tableYears = model.years.filter((y) => y.paid > 0);
  const shownYears = allYears ? tableYears : tableYears.filter((y) => y.year >= thisYear - 1).slice(0, 7);

  // Sin cursor, la leyenda muestra la situación de hoy; sobre un año, la de final de ese año.
  const hot = hy == null ? undefined : model.years.find((y) => y.year === hy);
  const legendTitle = hot ? `A final de ${hot.year}${hot.future ? (hot.gain > 0 ? " · previsto si amortizas" : " · previsto") : hot.gain > 0 ? " · si amortizas" : ""}` : `Hoy · ${dateShort(today)}`;
  const legend: LegendRow[] = hot
    ? loan
      ? [
          { color: HOME_COLOR.own, label: "Ya es tuyo", value: `${eur(hot.own + hot.gain, 0)} · ${pct(hot.value > 0 ? (hot.own + hot.gain) / hot.value : 0)}` },
          { color: "var(--line2)", label: "Del banco", value: eur(hot.bank, 0) },
          { color: HOME_COLOR.principal, label: "Capital pagado ese año", value: eur(hot.principal, 0) },
          { color: HOME_COLOR.interest, label: "Intereses ese año", value: eur(hot.interest, 0) },
        ]
      : [{ color: HOME_COLOR.own, label: "Valor del inmueble", value: eur(hot.value, 0) }]
    : [
        { color: HOME_COLOR.own, label: "Valor del inmueble", value: eur(v.value, 0) },
        ...(loan ? [{ color: "var(--mute)", label: "Hipoteca pendiente", value: eur(loan.outstanding, 0) }] : []),
        { color: "transparent", label: "Ya es tuyo", value: eur(v.equity, 0) },
      ];

  return (
    <>
      <section className="px-1 pt-2">
        <div className="flex flex-wrap items-center gap-2.5 text-[12px] text-mute">
          <span className="wide text-[15px] font-semibold text-ink">{property.name}</span>
          {property.address && <span className="selectable">{property.address}</span>}
          <span>· comprado el {dateShort(property.purchaseDate)}</span>
          <Btn size="sm" className="text-ink" onClick={() => openDialog({ kind: "valuation", property })}>
            <Plus size={12} /> Valoración
          </Btn>
          <Btn size="sm" className="text-ink" onClick={() => openDialog({ kind: "property", property })}>
            <Pencil size={12} /> Editar
          </Btn>
        </div>
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-[300px] flex-[1_1_0]">
            <div className="text-[12px] text-mute">{loan ? "Lo que ya es tuyo · valor menos hipoteca pendiente" : "Lo que ya es tuyo · sin hipoteca, el valor entero"}</div>
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
          <div className="flex min-w-[270px] flex-col gap-[3px] pb-1 text-[12.5px]" aria-live="off">
            <div className="mb-0.5 text-[12px] text-mute">{legendTitle}</div>
            {legend.map((r) => (
              <div key={r.label} className="flex items-center gap-2">
                <Swatch color={r.color} />
                <span className="flex-1 text-ink2">{r.label}</span>
                <span className="font-medium">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
        <HomeChart model={model} hot={hy} onHover={setHy} />
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
            {loan.outstanding > 0 && <WhatIf v={v} today={today} extra={extra} setExtra={setExtra} mode={mode} setMode={setMode} max={simMax} />}
            <Card title="A dónde ha ido lo pagado" aside={`${eur(v.totalPaid, 0)} en total`}>
              <PaidSplit
                parts={[
                  { key: "down", label: "Entrada", value: v.downPayment, color: HOME_COLOR.own, display: eur(v.downPayment, 0) },
                  { key: "principal", label: "Capital amortizado", value: loan.principalPaid, color: HOME_COLOR.principal, display: eur(loan.principalPaid, 0) },
                  { key: "interest", label: "Intereses", value: loan.interestPaid, color: HOME_COLOR.interest, display: eur(loan.interestPaid, 0) },
                  { key: "costs", label: "Gastos de compra", value: property.purchaseCosts, color: HOME_COLOR.costs, display: eur(property.purchaseCosts, 0) },
                ]}
              />
              <p className="mt-3.5 text-[12px] text-pretty text-mute">
                Tipo {RATE_TYPE_LABEL[loan.mortgage.rateType].toLowerCase()} al {num(loan.schedule.find((r) => r.date > today)?.ratePct ?? loan.mortgage.ratePct, 3, 2)} % TIN
                {loan.mortgage.lender ? ` · ${loan.mortgage.lender}` : ""} · {monthsText(loan.mortgage.termMonths)} · intereses totales previstos {eur(loan.totalInterest, 0)}
              </p>
            </Card>
          </div>
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

      <div className="grid items-start gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
        {loan && tableYears.length > 0 && <YearTable years={shownYears} hot={hy} onHover={setHy} total={tableYears.length} all={allYears} onToggle={() => setAllYears((x) => !x)} />}
        <History v={v} />
      </div>
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
