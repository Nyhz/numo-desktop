import { TriangleAlert } from "lucide-react";
import { useLocation } from "wouter";
import { BLOCK_LABEL, FOREIGN_STEP, FOREIGN_THRESHOLD, MODEL_LABEL, isForeign, type BlockStatus, type ModelStatus } from "../../shared/engine/foreign.ts";
import type { AppState } from "../../shared/types.ts";
import { confirmFiling, removeFiling, useApp } from "../data/store.ts";
import { countryName, dateShort, eur, seriesColor } from "../lib/format.ts";
import { Btn, Card, Dot, Priv, Tag, toast } from "../ui/kit.tsx";
import { L, TFoot, THead, TRow, Table } from "./common.tsx";

const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** 2027-03-31 → 31 de marzo de 2027 */
const longDate = (iso: string) => `${+iso.slice(8, 10)} de ${MONTHS_LONG[+iso.slice(5, 7) - 1]} de ${iso.slice(0, 4)}`;

const names = (models: ModelStatus[]) => {
  const list = models.map((m) => m.model);
  return list.length === 1 ? `el modelo ${list[0]}` : `los modelos ${list.join(" y ")}`;
};

/** Lo pendiente del ejercicio: hay que presentarlo y no consta que se haya hecho. */
const pendingOf = (statuses: ModelStatus[]) => statuses.filter((m) => m.due && !m.filing);

/** Aviso sobre las pestañas cuando el ejercicio obliga a presentar alguno de los dos modelos. */
export function ForeignBanner({ year, statuses, onOpen }: { year: number; statuses: ModelStatus[]; onOpen?: () => void }) {
  const pending = pendingOf(statuses);
  if (!pending.length) return null;
  const { phase, deadline } = pending[0]!;
  const text =
    phase === "open"
      ? `Si a 31 de diciembre sigue así, tendrás que presentar ${names(pending)} de ${year} entre el 1 de enero y el ${longDate(deadline)}.`
      : phase === "window"
        ? `Tienes que presentar ${names(pending)} de ${year} antes del ${longDate(deadline)}.`
        : `${names(pending).replace(/^el/, "El").replace(/^los/, "Los")} de ${year} había que presentarlo antes del ${longDate(deadline)} y no consta que lo hicieras.`;
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-line2 bg-raised px-4 py-3" style={{ boxShadow: "var(--shadow-active)" }}>
      <TriangleAlert size={16} className="shrink-0 text-acc" />
      <span className="min-w-0 flex-1 text-pretty">{text}</span>
      {onOpen && (
        <Btn size="sm" onClick={onOpen}>
          Ver detalle
        </Btn>
      )}
    </div>
  );
}

/** Qué entra en cada modelo, si hay que presentarlo y la confirmación de que se presentó. */
export function ForeignTab({ year, statuses }: { year: number; statuses: ModelStatus[] }) {
  const state = useApp((s) => (s.demo ?? s.loaded).state);
  const [, go] = useLocation();
  const abroad = state.accounts.filter(isForeign);

  if (!abroad.length) {
    return (
      <Card title="Bienes en el extranjero">
        <p className="max-w-[640px] text-pretty text-ink2">
          Ninguna de tus cuentas es de una entidad de fuera de España. Si alguna lo es (un bróker o un exchange extranjero, un banco de otro país), indica su país en Cuentas y aquí verás si tienes
          que presentar el modelo 720 o el 721.
        </p>
        <div className="mt-4">
          <Btn onClick={() => go("/cuentas")}>Ir a Cuentas</Btn>
        </div>
      </Card>
    );
  }

  return (
    <>
      <p className="max-w-[820px] px-1 text-pretty text-ink2">
        Se declara lo que tienes en entidades de fuera de España, por bloques: cuentas, valores y fondos (modelo 720) y criptomonedas (modelo 721). La primera vez, cuando un bloque supera{" "}
        {eur(FOREIGN_THRESHOLD, 0)}; después, solo si sube más de {eur(FOREIGN_STEP, 0)} desde la última declaración o si dejas de tener algo declarado. Se presenta del 1 de enero al 31 de marzo del
        año siguiente. Cuenta el país de la entidad de cada cuenta (en Cuentas), no el del activo, y siempre con todas las cuentas.
      </p>
      {statuses.map((m) => (
        <ModelCard key={m.model} year={year} status={m} state={state} />
      ))}
      <p className="max-w-[820px] px-1 text-[12.5px] text-pretty text-mute">
        Es una cuenta orientativa con lo que registras en Numo: no presenta nada ni decide por ti. Los valores son a 31 de diciembre, al precio y al cambio de ese día. Los inmuebles en el extranjero
        no se tienen en cuenta.
      </p>
    </>
  );
}

function ModelCard({ year, status: m, state }: { year: number; status: ModelStatus; state: AppState }) {
  const items = m.blocks.flatMap((b) => b.items);
  const total = items.reduce((s, i) => s + i.valueEur, 0);
  const asOf = m.phase === "open" ? "hoy" : `31 dic ${year}`;

  const confirm = async () => {
    const res = await confirmFiling(m, year);
    if (!res.ok) return toast(res.error, { tone: "error" });
    toast(`Modelo ${m.model} de ${year} marcado como presentado`, { action: { label: "Deshacer", run: () => void removeFiling(res.value.id) } });
  };
  const undo = async () => {
    if (!m.filing) return;
    const res = await removeFiling(m.filing.id);
    if (!res.ok) toast(res.error, { tone: "error" });
  };

  const tag = m.filing ? <Tag>Presentado</Tag> : m.due ? <Tag tone="warn">{m.phase === "open" ? "Habrá que presentarlo" : "Hay que presentarlo"}</Tag> : <Tag>No hace falta</Tag>;

  return (
    <Card title={MODEL_LABEL[m.model]} aside={tag} pad={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 pb-4">
        <div className="min-w-[260px] flex-1 text-pretty text-ink2">
          {m.filing ? (
            <>
              Confirmaste que lo presentaste el {dateShort(m.filing.createdAt.slice(0, 10))}. Lo declarado entonces es la referencia para los años siguientes.
            </>
          ) : m.due ? (
            m.phase === "open" ? (
              <>Con lo que tienes hoy habrá que presentarlo entre el 1 de enero y el {longDate(m.deadline)}. Al empezar el año podrás confirmar aquí que lo has hecho.</>
            ) : m.phase === "window" ? (
              <>Hay que presentarlo antes del {longDate(m.deadline)}. Cuando lo hayas hecho, confírmalo aquí y dejará de avisarse.</>
            ) : (
              <>El plazo acabó el {longDate(m.deadline)}. Si lo presentaste, confírmalo: lo declarado es la referencia para los años siguientes.</>
            )
          ) : (
            <>No hace falta presentarlo{m.phase === "open" ? " con lo que tienes hoy" : ""}.</>
          )}
        </div>
        {m.filing ? (
          <Btn size="sm" onClick={() => void undo()}>
            Deshacer
          </Btn>
        ) : (
          m.due &&
          m.phase !== "open" && (
            <Btn variant="cta" onClick={() => void confirm()}>
              Ya lo he presentado
            </Btn>
          )
        )}
      </div>

      <Table cols="minmax(150px,1fr) 130px 150px minmax(150px,1.1fr) minmax(220px,2fr)" compact="minmax(150px,1fr) 130px minmax(150px,1.1fr) minmax(200px,2fr)" minWidth={820}>
        <THead>
          <L>Bloque</L>
          <span>Valor a {asOf}</span>
          <span className="opt">Saldo medio 4.º trim.</span>
          <span>Última declaración</span>
          <L>Situación</L>
        </THead>
        {m.blocks.map((b) => (
          <BlockRow key={b.block} b={b} state={state} />
        ))}
      </Table>

      {items.length > 0 && (
        <div className="border-t border-line">
          <div className="px-5 pt-4 pb-1 text-[12.5px] font-[550] text-ink2">Qué entra</div>
          <Table cols="minmax(170px,1.2fr) 130px minmax(180px,1.6fr) 120px 130px" compact="minmax(170px,1.2fr) minmax(180px,1.6fr) 120px 130px" minWidth={760}>
            <THead>
              <L>Cuenta</L>
              <L className="opt">País</L>
              <L>Activo</L>
              <L>Bloque</L>
              <span>Valor a {asOf}</span>
            </THead>
            {items.map((i) => (
              <TRow key={i.key}>
                <L className="flex items-center gap-[7px]">
                  <Dot color={seriesColor(i.account.color)} />
                  <span className="truncate">{i.account.name}</span>
                </L>
                <L className="opt truncate text-ink2">{countryName(i.account.country)}</L>
                <L className="truncate">{i.asset ? i.asset.name : <span className="text-mute">saldo</span>}</L>
                <L className="text-ink2">{BLOCK_LABEL[i.block]}</L>
                <span className="priv">{i.noPrice ? <span className="text-acc">sin precio</span> : eur(i.valueEur)}</span>
              </TRow>
            ))}
            <TFoot>
              <L>Total</L>
              <span className="opt" />
              <span />
              <span />
              <span className="priv">{eur(total)}</span>
            </TFoot>
          </Table>
        </div>
      )}
    </Card>
  );
}

function Reason({ b }: { b: BlockStatus }) {
  const r = b.rule;
  if (r.kind === "ended") return <>{b.ended.length === 1 ? "Dejaste de tener algo que estaba declarado" : `Dejaste de tener ${b.ended.length} cosas que estaban declaradas`}</>;
  if (r.kind === "empty") return <>Nada fuera de España</>;
  if (r.kind === "first") return <>{r.over ? `Supera ${eur(FOREIGN_THRESHOLD, 0)} y no lo has declarado nunca` : `No llega a ${eur(FOREIGN_THRESHOLD, 0)}`}</>;
  return (
    <>
      {r.rise >= 0 ? "Ha subido " : "Ha bajado "}
      <Priv>{eur(Math.abs(r.rise), 0)}</Priv> desde lo que declaraste en {b.last!.year}
      {r.over ? `: más de ${eur(FOREIGN_STEP, 0)}` : ": no hace falta volver a presentarlo"}
    </>
  );
}

function BlockRow({ b, state }: { b: BlockStatus; state: AppState }) {
  // Lo declarado que ya no se tiene, con su nombre.
  const ended = b.ended.map((key) => {
    const [accountId, assetId] = key.split("|");
    const account = state.accounts.find((a) => a.id === accountId);
    const asset = assetId ? state.assets.find((a) => a.id === assetId) : null;
    return [asset?.name, account?.name].filter(Boolean).join(" en ") || "un bien";
  });
  return (
    <TRow>
      <L className="font-[550]">{BLOCK_LABEL[b.block]}</L>
      <span className="priv">{b.items.length ? eur(b.valueEur, 0) : <span className="text-mute">—</span>}</span>
      <span className="opt priv text-ink2">{b.avgQ4Eur != null && b.items.length ? eur(b.avgQ4Eur, 0) : ""}</span>
      <span className="text-ink2">
        {b.last ? (
          <>
            {b.last.year} · <Priv>{eur(b.last.valueEur, 0)}</Priv>
          </>
        ) : (
          <span className="text-mute">nunca</span>
        )}
      </span>
      <L className={`text-pretty ${b.due ? "text-acc" : "text-ink2"}`}>
        <Reason b={b} />
        {ended.length > 0 && <span className="block text-[12px] text-ink2">{ended.join(" · ")}</span>}
      </L>
    </TRow>
  );
}
