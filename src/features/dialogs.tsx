import { useState } from "react";
import { detectCsv, matchSeries, parseNumber, parseSeriesCsv, parseTxCsv, planImport, type ImportPlan } from "../../shared/csv.ts";
import { todayIso } from "../../shared/dates.ts";
import { ACCOUNT_KINDS, ACCOUNT_KIND_LABEL, ASSET_KINDS, ASSET_KIND_LABEL, type Account, type Asset } from "../../shared/types.ts";
import { getApp, importPlan, importSeries, removeAccount, removeAsset, saveAccount, saveAsset, setPrice, useDerived } from "../data/store.ts";
import { dateShort, num } from "../lib/format.ts";
import { closeDialog, useDialog } from "../ui/dialogs.ts";
import { Button, Dialog, Field, toast } from "../ui/kit.tsx";
import { TxDialog } from "./TxDialog.tsx";

const ErrorLine = ({ text }: { text: string | null }) =>
  text ? (
    <div role="alert" className="rounded-md bg-wash-strong px-3 py-2 text-[13px] text-down">
      {text}
    </div>
  ) : null;

// ── Cuenta ─────────────────────────────────────────────────────────────────

function AccountDialog({ account }: { account?: Account }) {
  const d = useDerived();
  const [f, setF] = useState({
    name: account?.name ?? "",
    institution: account?.institution ?? "",
    kind: account?.kind ?? "broker",
    currency: account?.currency ?? "EUR",
    trackCash: account?.trackCash ?? false,
    archived: account?.archived ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const txCount = account ? d.state.txs.filter((t) => t.accountId === account.id || t.toAccountId === account.id).length : 0;

  const save = async () => {
    const res = await saveAccount(f, account?.id);
    if (!res.ok) return setError(res.error);
    toast(account ? "Cuenta guardada" : "Cuenta creada");
    closeDialog();
  };
  const remove = async () => {
    if (!account) return;
    const res = await removeAccount(account.id);
    if (!res.ok) return setError(res.error);
    toast("Cuenta eliminada");
    closeDialog();
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title={account ? "Editar cuenta" : "Nueva cuenta"}
      width={460}
      footer={
        confirming ? (
          <>
            <span className="mr-auto text-[13px] text-ink-2">
              {txCount ? `Se borrarán también sus ${txCount} operaciones. No se puede deshacer.` : "La cuenta se borrará."}
            </span>
            <Button onClick={() => setConfirming(false)}>Conservar</Button>
            <Button variant="danger" onClick={remove}>
              Eliminar cuenta
            </Button>
          </>
        ) : (
          <>
            {account && (
              <Button variant="danger" className="mr-auto" onClick={() => setConfirming(true)}>
                Eliminar
              </Button>
            )}
            <Button onClick={closeDialog}>Cancelar</Button>
            <Button variant="primary" onClick={save}>
              {account ? "Guardar" : "Crear cuenta"}
            </Button>
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
        <Field label="Nombre">
          <input className="field" autoFocus placeholder="p. ej. Bróker principal" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Entidad" hint="opcional">
          <input className="field" value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} />
        </Field>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field label="Tipo">
            <select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Account["kind"] })}>
              {ACCOUNT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ACCOUNT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Divisa">
            <input className="field uppercase" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
          </Field>
        </div>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-[3px] accent-[var(--ink)]" checked={f.trackCash} onChange={(e) => setF({ ...f, trackCash: e.target.checked })} />
          <span>
            Llevar el efectivo de esta cuenta
            <span className="block text-[12px] text-muted">
              Actívalo si vas a registrar ingresos y retiradas: las compras restarán del saldo y los dividendos sumarán. Si no, la cuenta solo sigue tus inversiones.
            </span>
          </span>
        </label>
        {account && (
          <label className="flex items-center gap-2.5">
            <input type="checkbox" className="accent-[var(--ink)]" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />
            Archivada: se conserva su historia pero no aparece al registrar operaciones
          </label>
        )}
        <ErrorLine text={error} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ── Activo ─────────────────────────────────────────────────────────────────

function AssetDialog({ asset }: { asset: Asset }) {
  const [f, setF] = useState({
    name: asset.name,
    kind: asset.kind,
    symbol: asset.symbol ?? "",
    isin: asset.isin ?? "",
    currency: asset.currency,
  });
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const res = await saveAsset({ ...f, symbol: f.symbol.trim() || null, isin: f.isin.trim() || null, priceSource: f.symbol.trim() ? "yahoo" : "manual" }, asset.id);
    if (!res.ok) return setError(res.error);
    toast("Activo guardado");
    closeDialog();
  };
  const remove = async () => {
    const res = await removeAsset(asset.id);
    if (!res.ok) return setError(res.error);
    toast("Activo eliminado");
    closeDialog();
    history.back();
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title="Editar activo"
      width={480}
      footer={
        <>
          <Button variant="danger" className="mr-auto" onClick={remove}>
            Eliminar
          </Button>
          <Button onClick={closeDialog}>Cancelar</Button>
          <Button variant="primary" onClick={save}>
            Guardar
          </Button>
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
        <Field label="Nombre">
          <input className="field" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field label="Tipo">
            <select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Asset["kind"] })}>
              {ASSET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ASSET_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Divisa">
            <input className="field uppercase" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ISIN" hint="opcional">
            <input className="field uppercase" maxLength={12} value={f.isin} onChange={(e) => setF({ ...f, isin: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Símbolo de Yahoo Finance" hint="vacío = precio manual">
            <input className="field" placeholder="p. ej. VWCE.DE" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })} />
          </Field>
        </div>
        <p className="text-[12px] text-muted">
          Con símbolo, el precio se actualiza solo. Si cambias el símbolo o la divisa se descarta el histórico de precios guardado y se vuelve a descargar.
        </p>
        <ErrorLine text={error} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ── Precio manual ──────────────────────────────────────────────────────────

function PriceDialog({ asset }: { asset: Asset }) {
  const d = useDerived();
  const [date, setDate] = useState(todayIso());
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recent = [...(d.state.prices[asset.id] ?? [])].slice(-6).reverse();

  const save = async () => {
    const close = parseNumber(value);
    if (close == null || !(close > 0)) return setError("Escribe un precio mayor que cero");
    const res = await setPrice(asset.id, date, close);
    if (!res.ok) return setError(res.error);
    toast("Precio guardado");
    closeDialog();
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title={`Precio de ${asset.name}`}
      width={420}
      footer={
        <>
          <Button onClick={closeDialog}>Cancelar</Button>
          <Button variant="primary" onClick={save}>
            Guardar precio
          </Button>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">
            <input type="date" className="field" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={`Precio (${asset.currency})`}>
            <input className="field" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </div>
        {recent.length > 0 && (
          <div>
            <div className="mb-1 text-[12px] text-ink-2">Últimos precios guardados</div>
            <table className="tbl">
              <tbody>
                {recent.map(([dt, v]) => (
                  <tr key={dt}>
                    <td>{dateShort(dt)}</td>
                    <td className="r">{num(v, 4, 2)}</td>
                    <td className="r w-0">
                      <Button size="sm" variant="ghost" onClick={() => void setPrice(asset.id, dt, null)}>
                        Quitar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorLine text={error} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ── Importar CSV ───────────────────────────────────────────────────────────

type Issue = { line: number; message: string };
type Loaded =
  | { kind: "operations"; file: string; plan: ImportPlan; errors: Issue[] }
  | { kind: "prices" | "splits"; file: string; text: string; rows: number; errors: Issue[] }
  | { kind: "unknown"; file: string };

const column = (kind: "prices" | "splits") => (kind === "prices" ? "cierre" : "ratio");

function ImportDialog() {
  const d = useDerived();
  const [files, setFiles] = useState<Loaded[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const read = async (list: FileList | null) => {
    setError(null);
    const out: Loaded[] = [];
    for (const file of Array.from(list ?? [])) {
      const text = await file.text();
      const kind = detectCsv(text);
      if (kind === "operations") {
        const parsed = parseTxCsv(text);
        out.push({ kind, file: file.name, plan: planImport(parsed.rows, d.state), errors: parsed.errors });
      } else if (kind === "prices" || kind === "splits") {
        const parsed = parseSeriesCsv(text, column(kind));
        out.push({ kind, file: file.name, text, rows: parsed.rows.length, errors: parsed.errors });
      } else out.push({ kind: "unknown", file: file.name });
    }
    // Las operaciones primero: crean los activos a los que se refieren precios y splits.
    out.sort((a, b) => (a.kind === "operations" ? 0 : 1) - (b.kind === "operations" ? 0 : 1));
    setFiles(out);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    const done: string[] = [];
    try {
      for (const f of files) {
        if (f.kind === "operations") {
          if (!f.plan.rows.length) continue;
          const res = await importPlan(f.plan);
          if (!res.ok) return setError(`${f.file}: ${res.error}`);
          done.push(`${res.value} operaciones`);
        } else if (f.kind === "prices" || f.kind === "splits") {
          // Se empareja ahora, cuando los activos del archivo de operaciones ya existen.
          const app = getApp();
          const { byAsset, unknown } = matchSeries(parseSeriesCsv(f.text, column(f.kind)).rows, (app.demo ?? app.loaded).state);
          const res = await importSeries(f.kind, byAsset);
          if (!res.ok) return setError(`${f.file}: ${res.error}`);
          done.push(`${res.value} ${f.kind === "prices" ? "precios" : "splits"}`);
          if (unknown.length) {
            toast(`${f.file}: sin emparejar ${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? ` y ${unknown.length - 3} más` : ""}`, { tone: "error" });
          }
        }
      }
      toast(`Importado: ${done.join(", ") || "nada"}`);
      closeDialog();
    } finally {
      setBusy(false);
    }
  };

  const blocking = files.some((f) => f.kind === "operations" && f.errors.length > 0);
  const anything = files.some((f) => f.kind !== "unknown");

  return (
    <Dialog
      open
      onClose={closeDialog}
      title="Importar desde CSV"
      width={600}
      footer={
        <>
          <Button onClick={closeDialog}>Cancelar</Button>
          <Button variant="primary" disabled={!anything || blocking || busy} onClick={run}>
            {busy ? "Importando…" : "Importar"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-ink-2">
          Elige uno o varios archivos. Caudal reconoce por la cabecera si son <strong>operaciones</strong>, <strong>precios históricos</strong> o <strong>splits</strong>, y
          crea las cuentas y los activos que falten. Se importa todo o nada: si una línea falla no se guarda ninguna.
        </p>
        <input type="file" accept=".csv,text/csv,text/plain" multiple className="field h-auto py-1.5" onChange={(e) => void read(e.target.files)} />

        {files.map((f) => (
          <div key={f.file} className="border-t border-line pt-3">
            <div className="mb-1 font-semibold">{f.file}</div>
            {f.kind === "unknown" && <div className="text-down">No se reconoce la cabecera. Una exportación de operaciones de Caudal sirve de plantilla.</div>}
            {f.kind === "operations" && (
              <>
                <div className="text-ink-2">
                  {f.plan.rows.length} operaciones
                  {f.plan.newAccounts.length > 0 && ` · ${f.plan.newAccounts.length} cuentas nuevas (${f.plan.newAccounts.map((a) => a.name).join(", ")})`}
                  {f.plan.newAssets.length > 0 && ` · ${f.plan.newAssets.length} activos nuevos`}
                </div>
                {f.errors.length > 0 && (
                  <ul className="mt-2 max-h-36 overflow-y-auto text-[12.5px] text-down">
                    {f.errors.slice(0, 50).map((e, i) => (
                      <li key={i}>
                        Línea {e.line}: {e.message}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {(f.kind === "prices" || f.kind === "splits") && (
              <div className="text-ink-2">
                {f.rows} {f.kind === "prices" ? "precios" : "splits"}
                {f.errors.length > 0 && <span className="text-warn"> · {f.errors.length} líneas ilegibles que se omitirán</span>}
              </div>
            )}
          </div>
        ))}
        <ErrorLine text={error} />
      </div>
    </Dialog>
  );
}

/** Monta el diálogo abierto, si hay alguno. */
export function Dialogs() {
  const dlg = useDialog();
  if (!dlg) return null;
  switch (dlg.kind) {
    case "tx":
      return <TxDialog key={dlg.tx?.id ?? "new"} tx={dlg.tx} preset={dlg.preset} />;
    case "account":
      return <AccountDialog account={dlg.account} />;
    case "asset":
      return <AssetDialog asset={dlg.asset} />;
    case "price":
      return <PriceDialog asset={dlg.asset} />;
    case "import":
      return <ImportDialog />;
  }
}
