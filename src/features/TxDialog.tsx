import { useEffect, useMemo, useRef, useState } from "react";
import { parseNumber } from "../../shared/csv.ts";
import { dayNum, isIsoDate, todayIso } from "../../shared/dates.ts";
import { holdingsAt } from "../../shared/engine/ledger.ts";
import { TX_LABEL, TX_TYPES, cashOnly, needsAsset, type Tx, type TxType } from "../../shared/types.ts";
import { ecbRate, removeTx, restoreTx, saveTx, useDerived } from "../data/store.ts";
import { dateShort, eur, money, num } from "../lib/format.ts";
import { closeDialog } from "../ui/dialogs.ts";
import { Button, Dialog, Field, Segmented, toast } from "../ui/kit.tsx";
import { AssetPicker } from "./AssetPicker.tsx";

type Form = {
  type: TxType;
  date: string;
  accountId: string;
  assetId: string;
  quantity: string;
  price: string;
  amount: string;
  currency: string;
  fxRate: string;
  fee: string;
  feeCurrency: string;
  taxSource: string;
  taxHome: string;
  toAccountId: string;
  toAssetId: string;
  toQuantity: string;
  note: string;
};

const str = (n: number | null | undefined) => (n == null || n === 0 ? "" : String(n).replace(".", ","));
const LAST_ACCOUNT = "caudal.lastAccount";
const SAVED: Record<TxType, string> = {
  buy: "Compra guardada",
  sell: "Venta guardada",
  dividend: "Dividendo guardado",
  interest: "Interés guardado",
  deposit: "Ingreso guardado",
  withdrawal: "Retirada guardada",
  fee: "Comisión guardada",
  transfer: "Traspaso guardado",
};

export function TxDialog({ tx, preset }: { tx?: Tx; preset?: { type?: TxType; assetId?: string; accountId?: string } }) {
  const d = useDerived();
  const accounts = d.state.accounts.filter((a) => !a.archived || a.id === tx?.accountId);

  const initial = (): Form => {
    if (tx) {
      return {
        type: tx.type,
        date: tx.date,
        accountId: tx.accountId,
        assetId: tx.assetId ?? "",
        quantity: str(tx.quantity),
        price: str(tx.price),
        amount: str(tx.amount),
        currency: tx.currency,
        fxRate: tx.currency === "EUR" ? "" : str(tx.fxRate),
        fee: str(tx.fee),
        feeCurrency: tx.feeCurrency,
        taxSource: str(tx.taxSource),
        taxHome: str(tx.taxHome),
        toAccountId: tx.toAccountId ?? "",
        toAssetId: tx.toAssetId ?? "",
        toQuantity: str(tx.toQuantity),
        note: tx.note,
      };
    }
    const remembered = localStorage.getItem(LAST_ACCOUNT);
    const accountId = preset?.accountId ?? (accounts.some((a) => a.id === remembered) ? remembered! : (accounts[0]?.id ?? ""));
    return {
      type: preset?.type ?? "buy",
      date: todayIso(),
      accountId,
      assetId: preset?.assetId ?? "",
      quantity: "",
      price: "",
      amount: "",
      currency: "EUR",
      fxRate: "",
      fee: "",
      feeCurrency: "EUR",
      taxSource: "",
      taxHome: "",
      toAccountId: "",
      toAssetId: "",
      toQuantity: "",
      note: "",
    };
  };

  const [f, setF] = useState<Form>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Si el usuario escribe el cambio a mano (o edita una operación guardada) no se pisa.
  const [fxManual, setFxManual] = useState(!!tx);
  const [fxSource, setFxSource] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  const account = d.accounts.get(f.accountId);
  const asset = d.assets.get(f.assetId);
  const isTrade = f.type === "buy" || f.type === "sell";
  const isIncome = f.type === "dividend" || f.type === "interest";
  const isTransfer = f.type === "transfer";

  // La divisa la marca el activo en compraventas; en el resto se propone y se puede cambiar.
  useEffect(() => {
    if (tx) return;
    if (isTrade || isTransfer) {
      if (asset && asset.currency !== f.currency) set({ currency: asset.currency, feeCurrency: f.feeCurrency === "EUR" ? "EUR" : asset.currency });
    } else if (f.type === "dividend") {
      if (asset) set({ currency: asset.currency });
    } else if (account) set({ currency: account.currency });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.type, f.assetId, f.accountId]);

  const currency = f.currency.toUpperCase();
  const foreign = currency !== "EUR" && /^[A-Z]{3}$/.test(currency);

  // Tipo de referencia del BCE para la fecha, salvo que se haya escrito otro.
  useEffect(() => {
    if (!foreign || fxManual || !isIsoDate(f.date)) return;
    let alive = true;
    void ecbRate(currency, f.date).then((hit) => {
      if (!alive) return;
      if (hit) {
        set({ fxRate: String(hit.rate).replace(".", ",") });
        setFxSource(`BCE, ${dateShort(hit.date)}`);
      } else setFxSource("El BCE no publica esta divisa: escribe el cambio");
    });
    return () => {
      alive = false;
    };
  }, [currency, f.date, foreign, fxManual]);

  const n = (s: string) => parseNumber(s);
  const qty = n(f.quantity) ?? 0;
  const price = n(f.price) ?? 0;
  const fee = n(f.fee) ?? 0;
  const fx = foreign ? (n(f.fxRate) ?? 0) : 1;

  // Cierre del día como ayuda para el precio (en las unidades de la fecha de la operación).
  const closeHint = useMemo(() => {
    if (!isTrade || !asset || !isIsoDate(f.date)) return null;
    const day = dayNum(f.date);
    const p = d.ledger.market.price(asset.id, day);
    return p == null ? null : p * d.ledger.market.splitFactor(asset.id, day);
  }, [isTrade, asset, f.date, d.ledger]);

  const held = useMemo(() => {
    if (!asset || (f.type !== "sell" && !isTransfer)) return null;
    return holdingsAt(d.ledger, dayNum(d.today)).get(`${f.accountId}|${asset.id}`) ?? 0;
  }, [asset, f.type, f.accountId, isTransfer, d.ledger, d.today]);

  const total = useMemo(() => {
    if (isTransfer) return null;
    let native: number;
    if (isTrade) {
      const feeNative = f.feeCurrency === "EUR" ? fee * fx : fee;
      native = f.type === "buy" ? qty * price + feeNative : qty * price - feeNative;
    } else {
      native = (n(f.amount) ?? 0) - (isIncome ? (n(f.taxSource) ?? 0) + (n(f.taxHome) ?? 0) : 0);
    }
    if (!(native > 0) || !(fx > 0)) return null;
    return { native, eur: native / fx };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, qty, price, fee, fx]);

  const submit = async (again: boolean) => {
    if (saving) return;
    setError(null);
    const numbers = {
      quantity: n(f.quantity),
      price: n(f.price),
      amount: n(f.amount),
      fxRate: foreign ? n(f.fxRate) : 1,
      fee: n(f.fee) ?? 0,
      taxSource: n(f.taxSource) ?? 0,
      taxHome: n(f.taxHome) ?? 0,
      toQuantity: n(f.toQuantity),
    };
    if (Object.values(numbers).some((v) => v != null && Number.isNaN(v))) return setError("Hay un número que no se entiende. Usa coma o punto para los decimales.");
    if (foreign && !(numbers.fxRate! > 0)) return setError(`Indica el cambio de ${currency}`);
    setSaving(true);
    const res = await saveTx(
      {
        date: f.date,
        type: f.type,
        accountId: f.accountId,
        assetId: f.assetId || null,
        ...numbers,
        currency,
        feeCurrency: foreign ? f.feeCurrency : "EUR",
        toAccountId: f.toAccountId || null,
        toAssetId: f.toAssetId || null,
        note: f.note,
      },
      tx?.id,
    );
    setSaving(false);
    if (!res.ok) return setError(res.error);
    localStorage.setItem(LAST_ACCOUNT, f.accountId);
    toast(SAVED[f.type]);
    if (again) {
      // Se conservan tipo, fecha y cuenta: lo habitual es meter varias seguidas.
      set({ assetId: "", quantity: "", price: "", amount: "", fee: "", taxSource: "", taxHome: "", toQuantity: "", note: "" });
      firstField.current?.focus();
    } else closeDialog();
  };

  const remove = async () => {
    if (!tx) return;
    const res = await removeTx(tx.id);
    if (!res.ok) return setError(res.error);
    closeDialog();
    const removed = res.value;
    toast("Operación eliminada", removed ? { action: { label: "Deshacer", run: () => void restoreTx(removed) } } : {});
  };

  const types = TX_TYPES.filter((t) => !cashOnly(t) || account?.trackCash || t === f.type);

  return (
    <Dialog
      open
      onClose={closeDialog}
      title={tx ? `Editar ${TX_LABEL[tx.type].toLowerCase()}` : "Nueva operación"}
      width={600}
      footer={
        <>
          {tx && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Eliminar
            </Button>
          )}
          {!tx && (
            <div className="mr-auto min-w-0 truncate text-[12.5px] text-ink-2">
              {total && (
                <>
                  {f.type === "buy" ? "Coste total" : "Neto"}{" "}
                  <span className="num font-semibold text-ink">{foreign ? `${money(total.native, currency)} · ${eur(total.eur)}` : eur(total.eur)}</span>
                </>
              )}
            </div>
          )}
          <Button onClick={closeDialog}>Cancelar</Button>
          {!tx && (
            <Button disabled={saving} onClick={() => void submit(true)} title="⌘ Intro">
              Guardar y añadir otra
            </Button>
          )}
          <Button variant="primary" disabled={saving} onClick={() => void submit(false)}>
            Guardar
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit(!tx);
          }
        }}
      >
        <Segmented size="sm" label="Tipo de operación" value={f.type} options={types.map((t) => [t, TX_LABEL[t]] as const)} onChange={(type) => set({ type })} />

        <div className="grid grid-cols-[150px_1fr] gap-3">
          <Field label="Fecha">
            <input ref={firstField} type="date" className="field" value={f.date} max={todayIso()} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label="Cuenta">
            <select className="field" value={f.accountId} onChange={(e) => set({ accountId: e.target.value })}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {needsAsset(f.type) && (
          <Field label="Activo" hint={held != null && asset ? `Tienes ${num(held, 6)} en esta cuenta` : undefined}>
            <AssetPicker value={f.assetId} onChange={(assetId) => set({ assetId })} autoFocus={!tx && !preset?.assetId} />
          </Field>
        )}

        {isTrade && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Unidades">
              <input className="field" inputMode="decimal" value={f.quantity} onChange={(e) => set({ quantity: e.target.value })} />
            </Field>
            <Field
              label={`Precio${asset ? ` (${currency})` : ""}`}
              hint={
                closeHint != null && (
                  <button type="button" tabIndex={-1} className="underline decoration-dotted underline-offset-2 hover:text-ink" onClick={() => set({ price: String(+closeHint.toFixed(4)).replace(".", ",") })}>
                    cierre {num(closeHint, 4)}
                  </button>
                )
              }
            >
              <input className="field" inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value })} />
            </Field>
            <Field
              label="Comisión"
              hint={
                foreign && (
                  <button type="button" tabIndex={-1} className="underline decoration-dotted underline-offset-2 hover:text-ink" onClick={() => set({ feeCurrency: f.feeCurrency === "EUR" ? currency : "EUR" })}>
                    en {f.feeCurrency === "EUR" ? "EUR" : currency}
                  </button>
                )
              }
            >
              <input className="field" inputMode="decimal" value={f.fee} onChange={(e) => set({ fee: e.target.value })} />
            </Field>
          </div>
        )}

        {isIncome && (
          <div className="grid grid-cols-[1fr_76px_1fr_1fr] gap-3">
            <Field label="Importe bruto">
              <input className="field" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />
            </Field>
            <Field label="Divisa">
              <input className="field uppercase" maxLength={3} value={f.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Retención en origen">
              <input className="field" inputMode="decimal" value={f.taxSource} onChange={(e) => set({ taxSource: e.target.value })} />
            </Field>
            <Field label="Retención en España">
              <input className="field" inputMode="decimal" value={f.taxHome} onChange={(e) => set({ taxHome: e.target.value })} />
            </Field>
          </div>
        )}

        {(cashOnly(f.type) || f.type === "fee") && (
          <div className="grid grid-cols-[1fr_76px] gap-3">
            <Field label="Importe">
              <input className="field" inputMode="decimal" autoFocus={!tx} value={f.amount} onChange={(e) => set({ amount: e.target.value })} />
            </Field>
            <Field label="Divisa">
              <input className="field uppercase" maxLength={3} value={f.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
            </Field>
          </div>
        )}

        {isTransfer && (
          <>
            <div className="grid grid-cols-[1fr_1.4fr] gap-3">
              <Field label="Unidades que salen">
                <input className="field" inputMode="decimal" value={f.quantity} onChange={(e) => set({ quantity: e.target.value })} />
              </Field>
              <Field label="Cuenta de destino" hint="si cambia">
                <select className="field" value={f.toAccountId} onChange={(e) => set({ toAccountId: e.target.value })}>
                  <option value="">La misma cuenta</option>
                  {accounts
                    .filter((a) => a.id !== f.accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-[1.4fr_1fr] gap-3">
              <Field label="Activo de destino" hint="si es un traspaso entre fondos">
                <AssetPicker value={f.toAssetId} onChange={(toAssetId) => set({ toAssetId })} exclude={f.assetId} />
              </Field>
              <Field label="Unidades recibidas">
                <input className="field" inputMode="decimal" disabled={!f.toAssetId} value={f.toQuantity} onChange={(e) => set({ toQuantity: e.target.value })} />
              </Field>
            </div>
            <p className="text-[12px] text-muted">Un traspaso no es una venta: el destino hereda la fecha y el coste de adquisición de lo que sale.</p>
          </>
        )}

        {foreign && !isTransfer && (
          <Field label={`Cambio: 1 EUR en ${currency}`} hint={fxManual ? (tx ? "el guardado con la operación" : "escrito a mano") : fxSource}>
            <div className="flex gap-2">
              <input
                className="field"
                inputMode="decimal"
                value={f.fxRate}
                onChange={(e) => {
                  setFxManual(true);
                  set({ fxRate: e.target.value });
                }}
              />
              {fxManual && (
                <Button onClick={() => setFxManual(false)} title="Sustituye el cambio por el de referencia del BCE de esa fecha">
                  Usar el del BCE
                </Button>
              )}
            </div>
          </Field>
        )}

        <Field label="Nota" hint="opcional">
          <input className="field" value={f.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>

        {error && (
          <div role="alert" className="rounded-md bg-wash-strong px-3 py-2 text-[13px] text-down">
            {error}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
