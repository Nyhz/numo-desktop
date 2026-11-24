import { Check, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { detectCsv, matchSeries, parseNumber, parseSeriesCsv, parseTxCsv, planImport, type ImportPlan } from "../../shared/csv.ts";
import { todayIso } from "../../shared/dates.ts";
import { looksLikeExtras } from "../../shared/extras.ts";
import { ACCOUNT_KINDS, ACCOUNT_KIND_LABEL, ASSET_KINDS, ASSET_KIND_LABEL, PRICE_SOURCES, PRICE_SOURCE_LABEL, PRICE_SOURCE_SHORT, SOURCE_BY_ISIN, SOURCE_CODE, type Account, type Asset, type PriceSource } from "../../shared/types.ts";
import { probeSource, searchMarket, type Probe, type ProbeInput, type SearchHit } from "../data/market.ts";
import { backend, getApp, importExtras, importPlan, importSeries, isExample, sync, syncSoon, removeAccount, removeAsset, saveAccount, saveAsset, setPrice, useApp, useDerived } from "../data/store.ts";
import { dateBrief, dateShort, money, num, priceDigits } from "../lib/format.ts";
import { closeDialog, useDialog } from "../ui/dialogs.ts";
import { Btn, Dialog, ErrorLine, Field, toast } from "../ui/kit.tsx";
import { MortgageEventDialog, PropertyDialog, ValuationDialog } from "./property-dialogs.tsx";
import { TxDialog } from "./TxDialog.tsx";

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
            <span className="mr-auto text-[13px] text-ink2">
              {txCount ? `Se borrarán también sus ${txCount} operaciones. No se puede deshacer.` : "La cuenta se borrará."}
            </span>
            <Btn onClick={() => setConfirming(false)}>Conservar</Btn>
            <Btn variant="danger" onClick={remove}>
              Eliminar cuenta
            </Btn>
          </>
        ) : (
          <>
            {account && (
              <Btn variant="danger" className="mr-auto" onClick={() => setConfirming(true)}>
                Eliminar
              </Btn>
            )}
            <Btn onClick={closeDialog}>Cancelar</Btn>
            <Btn variant="cta" onClick={save}>
              {account ? "Guardar" : "Crear cuenta"}
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
          <input type="checkbox" className="mt-[3px] accent-[var(--acc)]" checked={f.trackCash} onChange={(e) => setF({ ...f, trackCash: e.target.checked })} />
          <span>
            Llevar el efectivo de esta cuenta
            <span className="block text-[12px] text-mute">
              Actívalo si vas a registrar ingresos y retiradas: las compras restarán del saldo y los dividendos sumarán. Si no, la cuenta solo sigue tus inversiones.
            </span>
          </span>
        </label>
        {account && (
          <label className="flex items-center gap-2.5">
            <input type="checkbox" className="accent-[var(--acc)]" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />
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

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
type AssetForm = { name: string; kind: Asset["kind"]; symbol: string; isin: string; currency: string; priceSource: Asset["priceSource"] };
const sourceKey = (f: Pick<AssetForm, "priceSource" | "symbol" | "isin" | "currency">) =>
  `${f.priceSource}|${f.priceSource === "manual" ? "" : SOURCE_BY_ISIN[f.priceSource] ? f.isin.trim() : f.symbol.trim()}|${f.currency}`;
/** Qué le falta al formulario para poder preguntar a la fuente elegida. */
const missing = (f: Pick<AssetForm, "priceSource" | "symbol" | "isin">): string | null => {
  const src = f.priceSource;
  if (src === "manual" || src === "indexa") return null;
  if (SOURCE_BY_ISIN[src]) return f.isin.trim() ? null : `Para usar ${PRICE_SOURCE_SHORT[src]} hace falta el ISIN`;
  return f.symbol.trim() ? null : `Para usar ${PRICE_SOURCE_SHORT[src]} hace falta ${src === "binance" ? "el par, por ejemplo ETHEUR" : src === "nasdaq" ? "el ticker" : "el símbolo"}`;
};
/** A qué bolsa corresponde un resultado de la búsqueda, para preferirla a Yahoo. */
const exchangeFor = (symbol: string, hasIsin: boolean): PriceSource | null =>
  /\.(DE|F)$/i.test(symbol) ? (hasIsin ? "xetra" : null) : /\.MC$/i.test(symbol) ? (hasIsin ? "bme" : null) : /^[A-Z][A-Z.-]{0,5}$/.test(symbol) && !symbol.includes(".") ? "nasdaq" : null;

/**
 * Alta y edición de un activo. Se puede buscar en el mercado para rellenarlo y,
 * antes de guardar, se pregunta a la fuente para no dejar un activo sin precio.
 */
function AssetDialog({ asset, stay }: { asset?: Asset; stay?: boolean }) {
  const example = useApp((s) => isExample(s));
  const assets = useApp((s) => (s.demo ?? s.loaded).state.assets);
  const meta = useApp((s) => (s.demo ?? s.loaded).meta);
  const [f, setF] = useState<AssetForm>({
    name: asset?.name ?? "",
    kind: asset?.kind ?? "stock",
    symbol: asset?.symbol ?? "",
    isin: asset?.isin ?? "",
    currency: asset?.currency ?? "EUR",
    priceSource: asset?.priceSource ?? "yahoo",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Última comprobación correcta y a qué datos corresponde. */
  const [check, setCheck] = useState<{ key: string; probe: Probe } | null>(null);
  /** Clave de la fuente que falló: permite guardar igualmente sin volver a preguntar. */
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const key = sourceKey(f);
  const verified = check?.key === key ? check.probe : null;
  const code = SOURCE_CODE[f.priceSource];
  const needsKey = !example && f.priceSource === "indexa" && !meta["connected:indexa"];
  const term = q.trim();
  const termIsin = ISIN.test(term.toUpperCase()) ? term.toUpperCase() : null;

  useEffect(() => {
    setHits([]);
    if (example || term.length < 2) return;
    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchMarket(backend.httpGet, term);
        if (alive) setHits(found.filter((h) => !assets.some((a) => a.id !== asset?.id && a.symbol === h.symbol)).slice(0, 6));
      } catch {
        // Sin conexión o con el límite de peticiones se puede seguir rellenando a mano.
      } finally {
        if (alive) setSearching(false);
      }
    }, 320);
    return () => {
      alive = false;
      clearTimeout(timer);
      setSearching(false);
    };
  }, [term, example, assets, asset?.id]);

  /** Rellena el formulario con lo que dice la fuente y lo deja comprobado. */
  const adopt = async (next: AssetForm, takeName: boolean, fallback?: PriceSource) => {
    setBusy(true);
    setError(null);
    try {
      const ask = (f: AssetForm) => probeSource(backend.httpGet, { priceSource: f.priceSource as ProbeInput["priceSource"], symbol: f.symbol || null, isin: f.isin || null, currency: f.currency });
      let probe: Probe;
      try {
        probe = await ask(next);
      } catch (e) {
        // La bolsa no lo reconoce: se queda con la fuente de respaldo si la hay.
        if (!fallback) throw e;
        next = { ...next, priceSource: fallback };
        probe = await ask(next);
      }
      const filled = { ...next, symbol: probe.code ?? next.symbol, currency: probe.currency, kind: probe.kind ?? next.kind, name: takeName && probe.name ? probe.name : next.name };
      setF(filled);
      setCheck({ key: sourceKey(filled), probe });
      setFailedKey(null);
      setQ("");
    } catch (e) {
      setError(`No se pudo consultar ${next.priceSource === "ft" ? next.isin : next.symbol}: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  const pickHit = (h: SearchHit) => {
    const isin = termIsin ?? f.isin;
    // Si se sabe en qué bolsa cotiza, el precio se pide a la bolsa y Yahoo queda de respaldo.
    const exchange = h.kind === "crypto" || h.kind === "fund" ? null : exchangeFor(h.symbol, !!isin);
    return adopt({ ...f, name: asset ? f.name : h.name, kind: h.kind, symbol: h.symbol, priceSource: exchange ?? "yahoo", isin }, false, exchange ? "yahoo" : undefined);
  };
  const pickFund = () => adopt({ ...f, kind: "fund", symbol: "", isin: termIsin!, priceSource: "fundinfo" }, !asset || !f.name.trim(), "ft");

  const save = async () => {
    setError(null);
    let data = { ...f, symbol: f.symbol.trim(), isin: f.isin.trim().toUpperCase() };
    const lacks = missing(data);
    if (lacks) return setError(lacks);
    const changed = !asset || sourceKey({ priceSource: asset.priceSource, symbol: asset.symbol ?? "", isin: asset.isin ?? "", currency: asset.currency }) !== key;
    let probe = verified;
    // Antes de guardar una fuente nueva se comprueba que da precio.
    if (data.priceSource !== "manual" && changed && !probe && failedKey !== key && !example) {
      setBusy(true);
      try {
        probe = await probeSource(backend.httpGet, { priceSource: data.priceSource, symbol: data.symbol || null, isin: data.isin || null, currency: data.currency });
        data = { ...data, symbol: probe.code ?? data.symbol, currency: probe.currency, name: data.name.trim() || probe.name || "" };
      } catch (e) {
        setFailedKey(key);
        return setError(
          `${PRICE_SOURCE_SHORT[data.priceSource]} no da precio${SOURCE_BY_ISIN[data.priceSource] ? ` para ${data.isin}` : data.symbol ? ` para ${data.symbol}` : ""}: ${e instanceof Error ? e.message : e}. Corrige el dato, o guárdalo igualmente y quedará con aviso en Activos.`,
        );
      } finally {
        setBusy(false);
      }
    }
    const res = await saveAsset({ ...data, symbol: data.symbol || null, isin: data.isin || null }, asset?.id);
    if (!res.ok) return setError(res.error);
    toast(probe ? `${asset ? "Activo guardado" : "Activo añadido"} · ${money(probe.price, probe.currency, priceDigits(probe.price))} a ${dateBrief(probe.date, todayIso())}` : asset ? "Activo guardado" : "Activo añadido");
    closeDialog();
    if (changed) syncSoon();
  };
  const remove = async () => {
    if (!asset) return;
    const res = await removeAsset(asset.id);
    if (!res.ok) return setError(res.error);
    toast("Activo eliminado");
    closeDialog();
    if (!stay) history.back();
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      title={asset ? "Editar activo" : "Añadir activo"}
      width={500}
      footer={
        <>
          {asset && (
            <Btn variant="danger" className="mr-auto" onClick={remove}>
              Eliminar
            </Btn>
          )}
          <Btn onClick={closeDialog}>Cancelar</Btn>
          <Btn variant="cta" onClick={save} disabled={busy}>
            {busy ? "Comprobando…" : failedKey === key ? "Guardar igualmente" : asset ? "Guardar" : "Añadir activo"}
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
        {!example && (
          <div className="pt-0.5">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute top-2.5 left-3 text-mute" />
              <input
                className="field pl-9"
                data-autofocus={asset ? undefined : ""}
                placeholder={asset ? "Buscar otra cotización: nombre, símbolo o ISIN" : "Buscar en el mercado: nombre, símbolo o ISIN"}
                value={q}
                disabled={busy}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && term) {
                    e.preventDefault();
                    if (hits[0]) void pickHit(hits[0]);
                    else if (termIsin) void pickFund();
                  }
                }}
              />
            </div>
            {term.length >= 2 && (
              <ul className="mt-1.5 rounded-xl border border-line2 bg-raised p-1">
                {hits.map((h) => (
                  <li key={h.symbol}>
                    <button type="button" className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-wash" onClick={() => void pickHit(h)}>
                      <span className="truncate">{h.name}</span>
                      <span className="ml-auto shrink-0 text-[12px] text-mute">{[h.symbol, h.exchange, ASSET_KIND_LABEL[h.kind]].filter(Boolean).join("  ")}</span>
                    </button>
                  </li>
                ))}
                {termIsin && (
                  <li>
                    <button type="button" className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-wash" onClick={() => void pickFund()}>
                      <span className="text-ink2">Buscar {termIsin} como fondo de inversión</span>
                      <span className="ml-auto shrink-0 text-[12px] text-mute">en {f.currency}</span>
                    </button>
                  </li>
                )}
                {searching && <li className="px-2.5 py-1.5 text-[12px] text-mute">Buscando…</li>}
                {!searching && hits.length === 0 && !termIsin && <li className="px-2.5 py-1.5 text-[12px] text-mute">Sin resultados. Puedes rellenar los datos a mano.</li>}
              </ul>
            )}
          </div>
        )}
        <Field label="Nombre">
          <input className="field" data-autofocus={asset ? "" : undefined} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
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
        <Field label="De dónde sale el precio">
          <select className="field" value={f.priceSource} onChange={(e) => setF({ ...f, priceSource: e.target.value as Asset["priceSource"] })}>
            {PRICE_SOURCES.map((k) => (
              <option key={k} value={k}>
                {PRICE_SOURCE_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ISIN" hint={SOURCE_BY_ISIN[f.priceSource] ? "necesario" : "opcional"}>
            <input className="field uppercase" maxLength={12} value={f.isin} onChange={(e) => setF({ ...f, isin: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={code?.label ?? "Código en la fuente"} hint={!code ? "no se usa" : code.required ? "necesario" : (code.hint ?? "opcional")}>
            <input className="field" placeholder={code ? `p. ej. ${code.example}` : ""} disabled={!code} value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })} />
          </Field>
        </div>
        {verified ? (
          <p className="flex items-center gap-2 text-[12.5px] text-ink2">
            <Check size={14} strokeWidth={2.4} className="shrink-0 text-up" />
            <span>
              {PRICE_SOURCE_SHORT[f.priceSource]} lo cotiza a <span className="font-medium text-ink">{money(verified.price, verified.currency, priceDigits(verified.price))}</span>, precio del{" "}
              {dateBrief(verified.date, todayIso())}.
            </span>
          </p>
        ) : (
          <p className="text-[12px] text-pretty text-mute">
            {f.priceSource === "manual"
              ? "Con precio manual el activo no se actualiza solo: tendrás que poner tú cada precio y aparecerá con aviso en Activos."
              : needsKey
                ? "Indexa necesita tu token: ponlo antes en Ajustes → Conexiones."
                : "Al guardar se comprueba que la fuente da precio. Después se actualiza solo, lo tengas o no en cartera."}
          </p>
        )}
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
          <Btn onClick={closeDialog}>Cancelar</Btn>
          <Btn variant="cta" onClick={save}>
            Guardar precio
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
            <div className="mb-1 text-[12px] text-ink2">Últimos precios guardados</div>
            <table className="tbl">
              <tbody>
                {recent.map(([dt, v]) => (
                  <tr key={dt}>
                    <td>{dateShort(dt)}</td>
                    <td className="r">{num(v, 4, 2)}</td>
                    <td className="r w-0">
                      <Btn size="sm" variant="ghost" onClick={() => void setPrice(asset.id, dt, null)}>
                        Quitar
                      </Btn>
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
  | { kind: "extras"; file: string; text: string }
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
      if (looksLikeExtras(text)) {
        out.push({ kind: "extras", file: file.name, text });
        continue;
      }
      const kind = detectCsv(text);
      if (kind === "operations") {
        const parsed = parseTxCsv(text);
        out.push({ kind, file: file.name, plan: planImport(parsed.rows, d.state), errors: parsed.errors });
      } else if (kind === "prices" || kind === "splits") {
        const parsed = parseSeriesCsv(text, column(kind));
        out.push({ kind, file: file.name, text, rows: parsed.rows.length, errors: parsed.errors });
      } else out.push({ kind: "unknown", file: file.name });
    }
    // Las operaciones primero (crean los activos); el plan y los inmuebles al final.
    const order = ["operations", "prices", "splits", "extras", "unknown"];
    out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
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
        } else if (f.kind === "extras") {
          let json: unknown;
          try {
            json = JSON.parse(f.text);
          } catch {
            return setError(`${f.file}: no es un JSON válido`);
          }
          const res = await importExtras(json);
          if (!res.ok) return setError(`${f.file}: ${res.error}`);
          done.push(`${res.value.goals} bloques, ${res.value.assigned} activos asignados, ${res.value.properties} inmuebles`);
          if (res.value.unmatched.length) toast(`${f.file}: ${res.value.unmatched.length} asignaciones sin emparejar`, { tone: "error" });
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
      void sync(false);
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
      title="Importar"
      width={600}
      footer={
        <>
          <Btn onClick={closeDialog}>Cancelar</Btn>
          <Btn variant="cta" disabled={!anything || blocking || busy} onClick={run}>
            {busy ? "Importando…" : "Importar"}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-ink2">
          Elige uno o varios archivos. Caudal reconoce si son <strong>operaciones</strong>, <strong>precios históricos</strong>, <strong>splits</strong> o el <strong>plan e
          inmuebles</strong>, y crea las cuentas y los activos que falten. Se importa todo o nada: si una línea falla no se guarda ninguna.
        </p>
        <input type="file" accept=".csv,.json,text/csv,text/plain,application/json" multiple className="field h-auto py-2" onChange={(e) => void read(e.target.files)} />

        {files.map((f) => (
          <div key={f.file} className="border-t border-line pt-3">
            <div className="mb-1 font-semibold">{f.file}</div>
            {f.kind === "unknown" && <div className="text-down">No se reconoce la cabecera. Una exportación de operaciones de Caudal sirve de plantilla.</div>}
            {f.kind === "operations" && (
              <>
                <div className="text-ink2">
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
            {f.kind === "extras" && <div className="text-ink2">Plan e inmuebles</div>}
            {(f.kind === "prices" || f.kind === "splits") && (
              <div className="text-ink2">
                {f.rows} {f.kind === "prices" ? "precios" : "splits"}
                {f.errors.length > 0 && <span className="text-acc"> · {f.errors.length} líneas ilegibles que se omitirán</span>}
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
      return <AssetDialog key={dlg.asset?.id ?? "new"} asset={dlg.asset} stay={dlg.stay} />;
    case "price":
      return <PriceDialog asset={dlg.asset} />;
    case "import":
      return <ImportDialog />;
    case "property":
      return <PropertyDialog property={dlg.property} />;
    case "mortgageEvent":
      return <MortgageEventDialog mortgage={dlg.mortgage} type={dlg.type} amount={dlg.amount} mode={dlg.mode} />;
    case "valuation":
      return <ValuationDialog property={dlg.property} />;
  }
}
