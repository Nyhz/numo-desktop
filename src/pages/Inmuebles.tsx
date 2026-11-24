import { Pencil, Plus, X } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { viewProperties, type PropertyView } from "../../shared/engine/realestate.ts";
import { RATE_TYPE_LABEL, type MortgageEvent } from "../../shared/types.ts";
import { HOME_COLOR, HomeChart, PaidMiniBar, PaidSplit } from "../charts/inmuebles.tsx";
import { homeModel, type HomeYear } from "../charts/inmuebles-model.ts";
import { derive, removeMortgageEvent, removeValuation, useApp, type Result } from "../data/store.ts";
import { dateShort, eur, num, pct, splitMoney } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Card, Empty, HeaderSlot, IconBtn, Kpi, Kpis, Pills, Priv, Swatch, toast } from "../ui/kit.tsx";

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

/** `value` es un importe (el modo privado lo emborrona); `extra`, lo que le sigue y sí se ve. */
type LegendRow = { color: string; label: string; value: string; extra?: string };

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
            <span className="priv">{eur(y.paid, 0)}</span>
            <span className="priv text-ink2">{eur(y.interest, 0)}</span>
            <span className="priv">{eur(y.principal, 0)}</span>
            <PaidMiniBar principal={y.principal} interest={y.interest} />
            <span className="priv font-semibold">{eur(y.remaining, 0)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

type HistoryItem = { key: string; date: string; label: string; detail: ReactNode; tail: ReactNode; purchase?: boolean; remove?: () => Promise<Result> };

function History({ v }: { v: PropertyView }) {
  const { property, loan } = v;
  const events: HistoryItem[] = (loan?.events ?? []).map((e) => ({
    key: `e-${e.id}`,
    date: e.date,
    label: EVENT_LABEL[e.type],
    detail:
      e.type === "rate_change" ? (
        `nuevo tipo ${num(e.ratePct ?? 0, 3, 2)} %`
      ) : e.type === "early_repayment" ? (
        <>
          <Priv>{eur(e.amount ?? 0)}</Priv> · {e.mode === "reduce_installment" ? "reduce cuota" : "reduce plazo"}
        </>
      ) : (
        <>
          <Priv>{eur(e.amount ?? 0)}</Priv> al mes
        </>
      ),
    tail: e.note,
    remove: () => removeMortgageEvent(e.id),
  }));
  const valuations: HistoryItem[] = v.valuations.map((x) => ({ key: `v-${x.id}`, date: x.date, label: "Valoración", detail: <Priv>{eur(x.value, 0)}</Priv>, tail: x.note, remove: () => removeValuation(x.id) }));
  const items: HistoryItem[] = [
    ...events,
    ...valuations,
    {
      key: "compra",
      date: property.purchaseDate,
      label: "Compra",
      detail: <Priv>{eur(property.purchasePrice, 0)}</Priv>,
      tail: (property.purchaseCosts > 0 || !!loan) && (
        <>
          {property.purchaseCosts > 0 && (
            <>
              <Priv>{eur(property.purchaseCosts, 0)}</Priv> de gastos
            </>
          )}
          {property.purchaseCosts > 0 && loan && " · "}
          {loan && (
            <>
              hipoteca de <Priv>{eur(loan.mortgage.principal, 0)}</Priv>
            </>
          )}
        </>
      ),
      purchase: true,
    },
  ].sort((a, b) => b.date.localeCompare(a.date) || Number(!!a.purchase) - Number(!!b.purchase));

  return (
    <section className="card min-w-0">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3.5">
        <span className="wide flex-1 font-semibold">Historial</span>
        {loan && (
          <>
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
  const [hy, setHy] = useState<number | null>(null);
  const [allYears, setAllYears] = useState(false);

  const model = useMemo(() => homeModel(v, today), [v, today]);

  const [heroI, heroD] = splitMoney(eur(v.equity));
  const thisYear = +today.slice(0, 4);
  const tableYears = model.years.filter((y) => y.paid > 0);
  const shownYears = allYears ? tableYears : tableYears.filter((y) => y.year >= thisYear - 1).slice(0, 7);

  // Sin cursor, la leyenda muestra la situación de hoy; sobre un año, la de final de ese año.
  const hot = hy == null ? undefined : model.years.find((y) => y.year === hy);
  const legendTitle = hot ? `A final de ${hot.year}${hot.future ? " · previsto" : ""}` : `Hoy · ${dateShort(today)}`;
  const legend: LegendRow[] = hot
    ? loan
      ? [
          { color: HOME_COLOR.own, label: "Ya es tuyo", value: eur(hot.own, 0), extra: ` · ${pct(hot.value > 0 ? hot.own / hot.value : 0)}` },
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
            <div className="priv mt-0.5 text-[56px] leading-[1.05] font-medium tracking-[-0.02em]" style={{ fontStretch: "108%" }}>
              {heroI}
              <span className="text-mute">{heroD}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-2.5 text-[13.5px]">
              <span className="font-[550] text-acc">{pct(v.ownedShare)} del inmueble</span>
              <span className="text-mute">
                valor <Priv>{eur(v.value, 0)}</Priv>
                {v.valueAsOf ? ` (valorado el ${dateShort(v.valueAsOf)})` : " (precio de compra)"}
                {portfolio > 0 && (
                  <>
                    {" "}
                    · con tu cartera, <Priv>{eur(v.equity + portfolio, 0)}</Priv> de patrimonio neto
                  </>
                )}
              </span>
            </div>
          </div>
          <div className="flex min-w-[270px] flex-col gap-[3px] pb-1 text-[12.5px]" aria-live="off">
            <div className="mb-0.5 text-[12px] text-mute">{legendTitle}</div>
            {legend.map((r) => (
              <div key={r.label} className="flex items-center gap-2">
                <Swatch color={r.color} />
                <span className="flex-1 text-ink2">{r.label}</span>
                <span className="font-medium">
                  <Priv>{r.value}</Priv>
                  {r.extra}
                </span>
              </div>
            ))}
          </div>
        </div>
        <HomeChart model={model} hot={hy} onHover={setHy} />
      </section>

      {loan ? (
        <>
          <Kpis>
            <Kpi priv label="Cuota mensual" note={loan.nextPayment ? <>próxima el {dateShort(loan.nextPayment.date)} · <Priv>{eur(loan.nextPayment.interest, 0)}</Priv> son intereses</> : "hipoteca terminada"}>
              {eur(loan.payment)}
            </Kpi>
            <Kpi priv label="Hipoteca pendiente" note={<>{pct(loan.progress)} devuelto de <Priv>{eur(loan.mortgage.principal, 0)}</Priv></>}>
              {eur(loan.outstanding, 0)}
            </Kpi>
            <Kpi priv label="Pagado hasta hoy" note={<>entrada <Priv>{eur(v.downPayment, 0)}</Priv> · gastos <Priv>{eur(property.purchaseCosts, 0)}</Priv> · cuotas <Priv>{eur(loan.paidToDate, 0)}</Priv></>}>
              {eur(v.totalPaid, 0)}
            </Kpi>
            <Kpi priv label="Intereses pagados" note={<>quedan <Priv>{eur(loan.interestRemaining, 0)}</Priv> por pagar</>}>
              {eur(loan.interestPaid, 0)}
            </Kpi>
            <Kpi label="Última cuota" note={`quedan ${loan.paymentsLeft} cuotas · ${monthsText(loan.paymentsLeft)}`}>
              {loan.endDate ? dateShort(loan.endDate) : "—"}
            </Kpi>
          </Kpis>

          <div className="grid items-start gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
            <Card title="A dónde ha ido lo pagado" aside={<span><Priv>{eur(v.totalPaid, 0)}</Priv> en total</span>}>
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
                {loan.mortgage.lender ? ` · ${loan.mortgage.lender}` : ""} · {monthsText(loan.mortgage.termMonths)} · intereses totales previstos <Priv>{eur(loan.totalInterest, 0)}</Priv>
              </p>
            </Card>
          </div>
        </>
      ) : (
        <Kpis>
          <Kpi priv label="Valor">
            {eur(v.value, 0)}
          </Kpi>
          <Kpi priv label="Precio de compra" note={<>más <Priv>{eur(property.purchaseCosts, 0)}</Priv> de gastos</>}>
            {eur(property.purchasePrice, 0)}
          </Kpi>
          <Kpi priv label="Revalorización" tone={v.appreciation}>
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
        Apunta el precio de compra y la hipoteca y verás cuánto es ya tuyo, cuánto llevas pagado, cuánto queda.
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
        {views.length > 1 && <span className="text-[12px] text-mute">
            <Priv>{eur(totalEquity, 0)}</Priv> entre los {views.length}
          </span>}
      </HeaderSlot>
      <PropertyPanel key={current.property.id} v={current} today={d.today} portfolio={portfolio} />
    </div>
  );
}
