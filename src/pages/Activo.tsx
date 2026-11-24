import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";
import { dayNum, isoOf } from "../../shared/dates.ts";
import { ASSET_KIND_LABEL, TX_LABEL } from "../../shared/types.ts";
import { Legend } from "../charts/core.tsx";
import { TimeChart, type Marker } from "../charts/TimeChart.tsx";
import { useDerived } from "../data/store.ts";
import { dateShort, eur, money, num, seriesColor } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Button, Delta, Dot, Empty, Section, Stat, Tag } from "../ui/kit.tsx";

export function Activo({ id }: { id: string }) {
  const d = useDerived();
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
    const markers: Marker[] = [];
    for (const n of txs) {
      if (n.tx.type !== "buy" && n.tx.type !== "sell") continue;
      const i = index.get(n.tx.date);
      if (i != null) markers.push({ i, kind: n.tx.type, label: `${TX_LABEL[n.tx.type]} · ${dateShort(n.tx.date)} · ${num(n.qty, 6)} uds.` });
    }
    const realized = d.ledger.matches.filter((m) => m.assetId === id && (!d.scope || d.scope.has(m.accountId))).reduce((s, m) => s + m.gainEur, 0);
    const income = txs.filter((n) => n.tx.type === "dividend").reduce((s, n) => s + n.cashEur, 0);
    const priceEur = market.priceEur(id, today) ?? 0;
    const lots = (d.ledger.lots.get(id) ?? []).map((l) => ({ ...l, valueEur: l.qty * priceEur }));
    return { txs: [...txs].reverse(), dates, values, markers, realized, income, lots, splits: market.splitsOf(id) };
  }, [asset, id, d]);

  if (!asset || !data) {
    return (
      <Empty title="Este activo ya no existe" action={<Link href="/posiciones"><Button>Volver a posiciones</Button></Link>} />
    );
  }

  const pos = d.positions.find((p) => p.asset.id === id);
  const avg = pos && pos.qty > 0 ? pos.costEur / pos.qty : null;

  return (
    <div className="grid gap-9">
      <header>
        <Link href="/posiciones" className="inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink">
          <ArrowLeft size={13} /> Posiciones
        </Link>
        <div className="mt-2 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h2 className="wide truncate text-[22px] leading-tight font-semibold">{asset.name}</h2>
            <div className="selectable mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
              <Tag>{ASSET_KIND_LABEL[asset.kind]}</Tag>
              {asset.symbol && <span>{asset.symbol}</span>}
              {asset.isin && <span>{asset.isin}</span>}
              <span>{asset.currency}</span>
              <span className="text-muted">{asset.priceSource === "yahoo" ? "precio automático" : "precio manual"}</span>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button onClick={() => openDialog({ kind: "price", asset })}>Añadir precio</Button>
            <Button onClick={() => openDialog({ kind: "asset", asset })}>
              <Pencil size={13} /> Editar
            </Button>
            <Button variant="primary" onClick={() => openDialog({ kind: "tx", preset: { assetId: asset.id } })}>
              <Plus size={15} strokeWidth={2.4} /> Operación
            </Button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-6 gap-6 border-y border-line py-5">
        <Stat label="Valor">{eur(pos?.valueEur ?? 0)}</Stat>
        <Stat label="Unidades">{num(pos?.qty ?? 0, 6)}</Stat>
        <Stat label="Último precio" sub={pos?.priceDate ? dateShort(pos.priceDate) : undefined}>
          {pos?.price != null ? money(pos.price, asset.currency) : data.values.length ? money(data.values[data.values.length - 1]!, asset.currency) : "—"}
        </Stat>
        <Stat label="Coste medio" sub="por unidad, en EUR">
          {avg == null ? "—" : eur(avg, avg < 10 ? 4 : 2)}
        </Stat>
        <Stat label="Plusvalía latente">{pos ? <Delta value={pos.unrealizedEur} /> : "—"}</Stat>
        <Stat label="Realizado y cobrado" sub={`ventas ${eur(data.realized, 0)} · rentas ${eur(data.income, 0)}`}>
          <Delta value={data.realized + data.income} />
        </Stat>
      </section>

      <Section
        title={`Precio en ${asset.currency}`}
        aside={
          data.markers.length > 0 && (
            <Legend items={[]}>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-ink" /> Compra
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full border-2 border-ink" /> Venta
              </span>
            </Legend>
          )
        }
      >
        <TimeChart
          dates={data.dates}
          series={[{ key: "p", label: "Precio", color: "var(--s1)", values: data.values }]}
          markers={data.markers}
          height={260}
          format={(v) => money(v, asset.currency, v < 10 ? 4 : 2)}
          formatAxis={(v) => num(v, v < 10 ? 2 : 0)}
        />
        {data.splits.length > 0 && (
          <p className="mt-2 text-[12px] text-muted">
            Splits aplicados: {data.splits.map(([day, r]) => `${dateShort(isoOf(day))} (×${num(r, 4)})`).join(", ")}. Las unidades anteriores se muestran ya ajustadas.
          </p>
        )}
      </Section>

      {data.lots.length > 0 && (
        <Section title="Lotes abiertos" aside={<span className="text-[12px] text-muted">por orden de venta (FIFO)</span>}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Adquisición</th>
                <th className="r">Unidades</th>
                <th className="r">Coste</th>
                <th className="r">Coste por unidad</th>
                <th className="r">Valor hoy</th>
                <th className="r">Plusvalía</th>
              </tr>
            </thead>
            <tbody>
              {data.lots.map((l, i) => (
                <tr key={i}>
                  <td>{dateShort(l.acqDate)}</td>
                  <td className="r">{num(l.qty, 6)}</td>
                  <td className="r">{eur(l.costEur)}</td>
                  <td className="r text-ink-2">{eur(l.costEur / l.qty, 4)}</td>
                  <td className="r">{eur(l.valueEur)}</td>
                  <td className="r">
                    <Delta value={l.valueEur - l.costEur} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Operaciones">
        {data.txs.length === 0 ? (
          <div className="text-muted">No hay operaciones de este activo en las cuentas seleccionadas.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Cuenta</th>
                <th className="r">Unidades</th>
                <th className="r">Precio</th>
                <th className="r">Efecto en EUR</th>
              </tr>
            </thead>
            <tbody>
              {data.txs.map((n) => (
                <tr key={n.tx.id} className="click" onClick={() => openDialog({ kind: "tx", tx: n.tx })}>
                  <td>{dateShort(n.tx.date)}</td>
                  <td>{TX_LABEL[n.tx.type]}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <Dot color={seriesColor(n.account.color)} />
                      {n.account.name}
                    </span>
                  </td>
                  <td className="r">{n.tx.quantity != null ? num(n.tx.quantity, 6) : ""}</td>
                  <td className="r">{n.tx.price != null ? money(n.tx.price, n.tx.currency, n.tx.price < 10 ? 4 : 2) : ""}</td>
                  <td className="r">{n.tx.type === "transfer" ? <span className="text-muted">sin efecto</span> : eur(n.cashEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
