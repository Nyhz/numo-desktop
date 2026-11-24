import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";
import { dayNum, isoOf } from "../../shared/dates.ts";
import { ASSET_KIND_LABEL, TX_LABEL } from "../../shared/types.ts";
import { HeroChart, lineModel } from "../charts/hero.tsx";
import { useDerived, useHeld } from "../data/store.ts";
import { dateShort, eur, eurSigned, money, num, priceDigits, seriesColor, splitMoney, units } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, Card, Dot, Empty, Kpi, Kpis, Money, Priv, Tag, toneOf } from "../ui/kit.tsx";
import { L, THead, TRow, Table } from "./common.tsx";

export function Activo({ id }: { id: string }) {
  const d = useDerived();
  const held = useHeld();
  const asset = d.assets.get(id);

  const data = useMemo(() => {
    if (!asset) return null;
    const { market } = d.ledger;
    const txs = d.ledger.ntxs.filter((n) => (n.tx.assetId === id || n.tx.toAssetId === id) && (!d.scope || d.scope.has(n.tx.accountId)));
    const today = dayNum(d.today);
    const first = txs[0]?.day ?? today - 365;
    const start = Math.min(first - 30, today - 180);
    const dates: string[] = [];
    const values: number[] = [];
    for (let day = start; day <= today; day++) {
      const p = market.price(id, day);
      if (p == null) continue;
      dates.push(isoOf(day));
      values.push(p);
    }
    const index = new Map(dates.map((dt, i) => [dt, i]));
    const marks = txs
      .filter((n) => n.tx.type === "buy" || n.tx.type === "sell")
      .flatMap((n) => {
        const i = index.get(n.tx.date);
        return i == null ? [] : [{ i, filled: n.tx.type === "buy", label: `${TX_LABEL[n.tx.type]} · ${dateShort(n.tx.date)} · ${units(n.qty)} uds.` }];
      });
    const realized = d.ledger.matches.filter((m) => m.assetId === id && (!d.scope || d.scope.has(m.accountId))).reduce((s, m) => s + m.gainEur, 0);
    const income = txs.filter((n) => n.tx.type === "dividend").reduce((s, n) => s + n.cashEur, 0);
    const priceEur = market.priceEur(id, today) ?? 0;
    const lots = (d.ledger.lots.get(id) ?? []).map((l) => ({ ...l, valueEur: l.qty * priceEur }));
    const fmt = (v: number) => money(v, asset.currency, priceDigits(v));
    const model = dates.length > 1 ? lineModel({ dates, values, label: "Precio", format: fmt, axis: (v) => num(v, v < 10 ? 2 : 0), marks }) : null;
    return { txs: [...txs].reverse(), model, marks, realized, income, lots, splits: market.splitsOf(id), last: values[values.length - 1] ?? null };
  }, [asset, id, d]);

  if (!asset || !data) {
    return <Empty title="Este activo ya no existe" action={<Link href="/posiciones"><Btn>Volver a posiciones</Btn></Link>} />;
  }

  const pos = d.positions.find((p) => p.asset.id === id);
  const avg = pos && pos.qty > 0 ? pos.costEur / pos.qty : null;
  const [heroI, heroD] = splitMoney(eur(pos?.valueEur ?? 0));
  const goal = d.state.goals.find((g) => g.id === asset.goalId);

  return (
    <div className="screen flex flex-col gap-5">
      <section className="px-1 pt-2">
        <Link href="/posiciones" className="inline-flex items-center gap-1 text-[12.5px] text-mute hover:text-ink">
          <ArrowLeft size={13} /> Posiciones
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="selectable flex flex-wrap items-center gap-2 text-[12px] text-mute">
              <span className="wide text-[15px] font-semibold text-ink">{asset.name}</span>
              <Tag>{ASSET_KIND_LABEL[asset.kind]}</Tag>
              {/* Lo que no se tiene en ninguna cuenta está archivado: conserva su historia y no se actualiza. */}
              {!held.has(asset.id) && (
                <span title="No lo tienes en cartera: no aparece en Activos ni se actualiza su precio. Vuelve solo al comprarlo.">
                  <Tag>Archivado</Tag>
                </span>
              )}
              {asset.symbol && <span>{asset.symbol}</span>}
              {asset.isin && <span>{asset.isin}</span>}
              <span>{asset.currency}</span>
              <span>· {asset.priceSource === "yahoo" ? "precio de Yahoo Finance" : asset.priceSource === "ft" ? "precio de Financial Times" : "precio manual"}</span>
              {goal && <span>· plan: {goal.name}</span>}
            </div>
            <div className="priv mt-1 text-[56px] leading-[1.05] font-medium tracking-[-0.02em]" style={{ fontStretch: "108%" }}>
              {heroI}
              <span className="text-mute">{heroD}</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2.5 text-[13.5px]">
              {pos ? (
                <>
                  <span className="priv font-[550]" style={{ color: toneOf(pos.unrealizedEur) }}>
                    {eurSigned(pos.unrealizedEur)}
                  </span>
                  <span className="text-mute">
                    de plusvalía latente sobre un coste de <Priv>{eur(pos.costEur)}</Priv>
                  </span>
                </>
              ) : (
                <span className="text-mute">Sin posición abierta en las cuentas seleccionadas</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-2 pb-1">
            <Btn onClick={() => openDialog({ kind: "price", asset })}>Añadir precio</Btn>
            <Btn onClick={() => openDialog({ kind: "asset", asset })}>
              <Pencil size={13} /> Editar
            </Btn>
            <Btn variant="cta" onClick={() => openDialog({ kind: "tx", preset: { assetId: asset.id } })}>
              <Plus size={14} strokeWidth={2.6} /> Operación
            </Btn>
          </div>
        </div>
        <HeroChart
          model={data.model}
          height={260}
          footer={
            data.marks.length > 0 ? (
              <div className="mt-2 flex gap-4 text-[12px] text-ink2">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-ink" /> Compra
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full border-[1.5px] border-ink" /> Venta
                </span>
                <span className="text-mute">Precio en {asset.currency}</span>
              </div>
            ) : null
          }
        />
        {data.splits.length > 0 && (
          <p className="mt-2 text-[12px] text-mute">
            Splits aplicados: {data.splits.map(([day, r]) => `${dateShort(isoOf(day))} (×${num(r, 4)})`).join(", ")}. Las unidades anteriores se muestran ya ajustadas.
          </p>
        )}
      </section>

      <Kpis>
        <Kpi priv label="Unidades">
          {units(pos?.qty ?? 0)}
        </Kpi>
        <Kpi label="Último precio" note={pos?.priceDate ? dateShort(pos.priceDate) : "último precio de operación"}>
          {pos?.price != null ? money(pos.price, asset.currency, priceDigits(pos.price)) : data.last != null ? money(data.last, asset.currency) : "—"}
        </Kpi>
        <Kpi label="Coste medio" note="por unidad, en EUR">
          {avg == null ? "—" : eur(avg, priceDigits(avg))}
        </Kpi>
        <Kpi label="Peso en la cartera">{pos ? `${num(pos.weight * 100, 1, 1)} %` : "—"}</Kpi>
        <Kpi label="Realizado y cobrado" note={<>ventas <Priv>{eur(data.realized, 0)}</Priv> · dividendos <Priv>{eur(data.income, 0)}</Priv></>} tone={data.realized + data.income}>
          <Money value={data.realized + data.income} signed dim="soft" />
        </Kpi>
      </Kpis>

      {data.lots.length > 0 && (
        <Card title="Lotes abiertos" note="en el orden en que se venderían (FIFO)" pad={false} className="overflow-hidden">
          <Table cols="120px 1fr 1fr 1fr 1fr 1fr" minWidth={760}>
            <THead>
              <L>Adquisición</L>
              <span>Unidades</span>
              <span>Coste</span>
              <span>Coste por unidad</span>
              <span>Valor hoy</span>
              <span>Plusvalía</span>
            </THead>
            {data.lots.map((l, i) => (
              <TRow key={i}>
                <L className="text-ink2">{dateShort(l.acqDate)}</L>
                <span className="priv">{units(l.qty)}</span>
                <span className="priv">{eur(l.costEur)}</span>
                <span className="text-mute">{eur(l.costEur / l.qty, 4)}</span>
                <span className="priv">{eur(l.valueEur)}</span>
                <span className="priv font-semibold" style={{ color: toneOf(l.valueEur - l.costEur) }}>
                  {eurSigned(l.valueEur - l.costEur)}
                </span>
              </TRow>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Operaciones" pad={false} className="overflow-hidden">
        {data.txs.length === 0 ? (
          <div className="px-5 pb-5 text-mute">No hay operaciones de este activo en las cuentas seleccionadas.</div>
        ) : (
          <Table cols="110px 110px minmax(150px,1fr) 1fr 1fr 1fr" minWidth={760}>
            <THead>
              <L>Fecha</L>
              <L>Tipo</L>
              <L>Cuenta</L>
              <span>Unidades</span>
              <span>Precio</span>
              <span>Efecto en EUR</span>
            </THead>
            {data.txs.map((n) => (
              <TRow key={n.tx.id} onClick={() => openDialog({ kind: "tx", tx: n.tx })}>
                <L className="text-ink2">{dateShort(n.tx.date)}</L>
                <L className="font-medium">{TX_LABEL[n.tx.type]}</L>
                <L className="flex items-center gap-[7px]">
                  <Dot color={seriesColor(n.account.color)} />
                  {n.account.name}
                </L>
                <span className="priv">{n.tx.quantity != null ? units(n.tx.quantity) : ""}</span>
                <span className="text-ink2">{n.tx.price != null ? money(n.tx.price, n.tx.currency, priceDigits(n.tx.price)) : ""}</span>
                <span className="font-semibold" style={{ color: n.cashEur > 0 ? "var(--up)" : undefined }}>
                  {n.tx.type === "transfer" && !n.cashEur ? <span className="font-normal text-mute">sin efecto</span> : <Money value={n.cashEur} signed dim="soft" />}
                </span>
              </TRow>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
