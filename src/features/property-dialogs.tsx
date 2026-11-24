import { useState } from "react";
import { parseNumber } from "../../shared/csv.ts";
import { addMonths, todayIso } from "../../shared/dates.ts";
import { annuity } from "../../shared/engine/realestate.ts";
import { RATE_TYPE_LABEL, type Mortgage, type MortgageEventType, type Property, type RateType } from "../../shared/types.ts";
import { removeProperty, saveMortgageEvent, saveProperty, saveValuation, useApp } from "../data/store.ts";
import { eur } from "../lib/format.ts";
import { closeDialog } from "../ui/dialogs.ts";
import { Btn, Dialog, ErrorLine, Field, Pills, toast } from "../ui/kit.tsx";

const str = (n: number | null | undefined) => (n == null || n === 0 ? "" : String(n).replace(".", ","));
const numOf = (s: string) => parseNumber(s.replace(/\.(?=\d{3}(\D|$))/g, ""));

// ── Inmueble e hipoteca ────────────────────────────────────────────────────

export function PropertyDialog({ property }: { property?: Property }) {
  const mortgage = useApp((s) => (s.demo ?? s.loaded).state.mortgages.find((m) => m.propertyId === property?.id)) as Mortgage | undefined;
  const [f, setF] = useState({
    name: property?.name ?? "",
    address: property?.address ?? "",
    purchaseDate: property?.purchaseDate ?? todayIso(),
    purchasePrice: str(property?.purchasePrice),
    purchaseCosts: str(property?.purchaseCosts),
    note: property?.note ?? "",
  });
  const [has, setHas] = useState(property ? !!mortgage : true);
  const [m, setM] = useState({
    lender: mortgage?.lender ?? "",
    principal: str(mortgage?.principal),
    rateType: (mortgage?.rateType ?? "fixed") as RateType,
    ratePct: str(mortgage?.ratePct),
    years: mortgage ? String(Math.floor(mortgage.termMonths / 12)) : "30",
    months: mortgage ? String(mortgage.termMonths % 12 || "") : "",
    firstPaymentDate: mortgage?.firstPaymentDate ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const termMonths = (parseInt(m.years || "0", 10) || 0) * 12 + (parseInt(m.months || "0", 10) || 0);
  const principal = numOf(m.principal) ?? 0;
  const rate = numOf(m.ratePct);
  // Cuota en vivo mientras se rellena el formulario.
  const payment = has && principal > 0 && rate != null && !Number.isNaN(rate) && termMonths > 0 ? annuity(principal, rate, termMonths) : null;
  const price = numOf(f.purchasePrice) ?? 0;

  const save = async () => {
    setError(null);
    const res = await saveProperty(
      { ...f, purchasePrice: numOf(f.purchasePrice) ?? 0, purchaseCosts: numOf(f.purchaseCosts) ?? 0 },
      has
        ? {
            lender: m.lender,
            principal,
            rateType: m.rateType,
            ratePct: rate ?? Number.NaN,
            termMonths,
            firstPaymentDate: m.firstPaymentDate || addMonths(f.purchaseDate, 1),
          }
        : null,
      property?.id,
    );
    if (!res.ok) return setError(res.error);
    toast(property ? "Inmueble guardado" : "Inmueble añadido");
    closeDialog();
  };
  const remove = async () => {
    if (!property) return;
    const res = await removeProperty(property.id);
    if (!res.ok) return setError(res.error);
    toast("Inmueble eliminado");
    closeDialog();
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title={property ? "Editar inmueble" : "Nuevo inmueble"}
      width={600}
      footer={
        confirming ? (
          <>
            <span className="mr-auto text-[13px] text-ink2">Se borrarán también su hipoteca, eventos y valoraciones.</span>
            <Btn onClick={() => setConfirming(false)}>Conservar</Btn>
            <Btn variant="danger" onClick={remove}>
              Eliminar inmueble
            </Btn>
          </>
        ) : (
          <>
            {property && (
              <Btn variant="danger" className="mr-auto" onClick={() => setConfirming(true)}>
                Eliminar
              </Btn>
            )}
            {!property && payment != null && (
              <span className="mr-auto text-[12.5px] text-ink2">
                Cuota estimada <span className="font-semibold text-ink">{eur(payment)}</span> al mes
              </span>
            )}
            <Btn onClick={closeDialog}>Cancelar</Btn>
            <Btn variant="cta" onClick={save}>
              {property ? "Guardar" : "Añadir inmueble"}
            </Btn>
          </>
        )
      }
    >
      <form
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre">
            <input className="field" data-autofocus placeholder="p. ej. Casa" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Dirección" hint="opcional">
            <input className="field" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Fecha de compra">
            <input type="date" className="field" max={todayIso()} value={f.purchaseDate} onChange={(e) => setF({ ...f, purchaseDate: e.target.value })} />
          </Field>
          <Field label="Precio de compra (€)">
            <input className="field" inputMode="decimal" value={f.purchasePrice} onChange={(e) => setF({ ...f, purchasePrice: e.target.value })} />
          </Field>
          <Field label="Gastos (€)" hint="impuestos, notaría…">
            <input className="field" inputMode="decimal" value={f.purchaseCosts} onChange={(e) => setF({ ...f, purchaseCosts: e.target.value })} />
          </Field>
        </div>

        <label className="mt-1 flex items-center gap-2.5 border-t border-line pt-3.5">
          <input type="checkbox" className="accent-[var(--acc)]" checked={has} onChange={(e) => setHas(e.target.checked)} />
          <span className="font-[550]">Tiene hipoteca</span>
          {has && price > 0 && principal > 0 && <span className="ml-auto text-[12px] text-mute">entrada de {eur(Math.max(0, price - principal), 0)}</span>}
        </label>

        {has && (
          <>
            <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-3">
              <Field label="Capital prestado (€)">
                <input className="field" inputMode="decimal" value={m.principal} onChange={(e) => setM({ ...m, principal: e.target.value })} />
              </Field>
              <Field label="Tipo de interés (TIN, %)">
                <input className="field" inputMode="decimal" placeholder="p. ej. 2,65" value={m.ratePct} onChange={(e) => setM({ ...m, ratePct: e.target.value })} />
              </Field>
              <Field label="Clase de tipo">
                <Pills size="sm" label="Clase de tipo" value={m.rateType} onChange={(rateType) => setM({ ...m, rateType })} options={(["fixed", "variable", "mixed"] as const).map((k) => [k, RATE_TYPE_LABEL[k]] as const)} />
              </Field>
            </div>
            <div className="grid grid-cols-[90px_90px_1fr_1fr] gap-3">
              <Field label="Plazo: años">
                <input className="field" inputMode="numeric" value={m.years} onChange={(e) => setM({ ...m, years: e.target.value })} />
              </Field>
              <Field label="y meses">
                <input className="field" inputMode="numeric" placeholder="0" value={m.months} onChange={(e) => setM({ ...m, months: e.target.value })} />
              </Field>
              <Field label="Primera cuota" hint="si no, al mes">
                <input type="date" className="field" value={m.firstPaymentDate} onChange={(e) => setM({ ...m, firstPaymentDate: e.target.value })} />
              </Field>
              <Field label="Entidad" hint="opcional">
                <input className="field" value={m.lender} onChange={(e) => setM({ ...m, lender: e.target.value })} />
              </Field>
            </div>
            {property && payment != null && (
              <p className="text-[12px] text-mute">
                Cuota de las condiciones iniciales: {eur(payment)} al mes. Las amortizaciones y revisiones del tipo se registran aparte y no se pierden al editar.
              </p>
            )}
          </>
        )}
        <ErrorLine text={error} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ── Evento de la hipoteca ──────────────────────────────────────────────────

const EVENT_TITLE: Record<MortgageEventType, string> = {
  early_repayment: "Amortización anticipada",
  rate_change: "Revisión del tipo de interés",
  payment_override: "Cuota real del recibo",
};

export function MortgageEventDialog({ mortgage, type, amount, mode }: { mortgage: Mortgage; type: MortgageEventType; amount?: number; mode?: "reduce_term" | "reduce_installment" }) {
  const [date, setDate] = useState(todayIso());
  const [value, setValue] = useState(str(amount));
  const [how, setHow] = useState<"reduce_term" | "reduce_installment">(mode ?? "reduce_term");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const n = numOf(value);
    if (n == null || Number.isNaN(n)) return setError("Escribe una cifra");
    const res = await saveMortgageEvent(mortgage.id, {
      date,
      type,
      amount: type === "rate_change" ? null : n,
      mode: type === "early_repayment" ? how : null,
      ratePct: type === "rate_change" ? n : null,
      note,
    });
    if (!res.ok) return setError(res.error);
    toast(`${EVENT_TITLE[type]} registrada`);
    closeDialog();
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title={EVENT_TITLE[type]}
      width={460}
      footer={
        <>
          <Btn onClick={closeDialog}>Cancelar</Btn>
          <Btn variant="cta" onClick={save}>
            Registrar
          </Btn>
        </>
      }
    >
      <form
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-[12.5px] text-pretty text-ink2">
          {type === "early_repayment" && "Dinero que entregas al banco además de las cuotas. El cuadro se recalcula desde esa fecha."}
          {type === "rate_change" && "El nuevo tipo se aplica a las cuotas posteriores a la fecha: revisión del euríbor, cambio de tramo en una mixta o novación."}
          {type === "payment_override" && "Si el recibo del banco no coincide con la cuota calculada, apunta la real: se usa desde esa cuota en adelante."}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={type === "payment_override" ? "Fecha de la cuota" : "Fecha"}>
            <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={type === "rate_change" ? "Nuevo tipo (TIN, %)" : type === "payment_override" ? "Cuota mensual (€)" : "Importe (€)"}>
            <input className="field" inputMode="decimal" data-autofocus value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </div>
        {type === "early_repayment" && (
          <Field label="Qué reduce">
            <Pills
              label="Qué reduce la amortización"
              value={how}
              onChange={setHow}
              options={[
                ["reduce_term", "El plazo (misma cuota, terminas antes)"],
                ["reduce_installment", "La cuota (mismo plazo)"],
              ]}
            />
          </Field>
        )}
        <Field label="Nota" hint="opcional">
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorLine text={error} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ── Valoración ─────────────────────────────────────────────────────────────

export function ValuationDialog({ property }: { property: Property }) {
  const [date, setDate] = useState(todayIso());
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const res = await saveValuation(property.id, { date, value: numOf(value) ?? 0, note });
    if (!res.ok) return setError(res.error);
    toast("Valoración guardada");
    closeDialog();
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title={`Valoración de ${property.name}`}
      width={440}
      footer={
        <>
          <Btn onClick={closeDialog}>Cancelar</Btn>
          <Btn variant="cta" onClick={save}>
            Guardar valoración
          </Btn>
        </>
      }
    >
      <form
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-[12.5px] text-pretty text-ink2">Cuánto vale hoy (una tasación, una estimación tras una reforma…). Mientras no haya ninguna se usa el precio de compra.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">
            <input type="date" className="field" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Valor (€)">
            <input className="field" inputMode="decimal" data-autofocus value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </div>
        <Field label="Nota" hint="opcional">
          <input className="field" placeholder="p. ej. Tasación del banco" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorLine text={error} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
