import { ChevronDown, Download, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { dayNum } from "../../shared/dates.ts";
import { buildYearReport, lossCarryover, taxYearBases, yearsWithActivity } from "../../shared/engine/reports.ts";
import { ASSET_KIND_LABEL, TX_LABEL } from "../../shared/types.ts";
import { LotsTimeline, SplitBar } from "../charts/viz.tsx";
import { useApp, useDerived } from "../data/store.ts";
import { cashSheet, gainsSheet, holdingsSheet, incomeSheet, operationsSheet, saveCsv, saveXlsx, summarySheet, txsOfYear, type Sheet } from "../lib/export.ts";
import { dateNumeric, dateShort, eur, eurSigned, money, num, priceDigits, units } from "../lib/format.ts";
import { Btn, Card, HeaderSlot, Kpi, Kpis, Money, Pills, Priv, Tag, toast, toneOf } from "../ui/kit.tsx";
import { L, TFoot, THead, TRow, Table, Welcome } from "./common.tsx";

type Tab = "pat" | "div" | "pos";

export function Informes() {
  const d = useDerived();
  const scopeIds = useApp((s) => s.scope);
  const years = useMemo(() => yearsWithActivity(d.state, d.today), [d.state, d.today]);
  const [year, setYear] = useState(() => {
    // Por defecto el último ejercicio cerrado, que es el que se declara.
    const current = +d.today.slice(0, 4);
    return years.find((y) => y < current) ?? years[0] ?? current;
  });
  const [tab, setTab] = useState<Tab>("pat");
  const rep = useMemo(() => buildYearReport(d.ledger, d.state, d.timeline, d.scope, year, d.today), [d, year]);

  const carry = useMemo(() => lossCarryover(taxYearBases(d.ledger, d.scope)).find((y) => y.year === year), [d.ledger, d.scope, year]);

  if (d.state.accounts.length === 0) return <Welcome />;

  const t = rep.totals;
  const scopeLabel = scopeIds ? d.state.accounts.filter((a) => scopeIds.includes(a.id)).map((a) => a.name).join(", ") : "Todas las cuentas";
  const ops = txsOfYear(d.ledger, d.scope, year);
  const sheets = (): Sheet[] => [summarySheet(rep, scopeLabel), gainsSheet(rep), incomeSheet(rep), holdingsSheet(rep), cashSheet(rep), operationsSheet(ops, d.accounts, d.assets)];
  const closed = rep.asOf.endsWith("-12-31");
  const review = rep.gains.filter((g) => g.review).length;
  const gross = t.dividendsGrossEur + t.interestGrossEur;

  const excel = async () => {
    const path = await saveXlsx(`numo-informe-${year}.xlsx`, sheets());
    if (path) toast(`Informe ${year} guardado`);
  };
  const CsvLink = ({ sheet, slug }: { sheet: () => Sheet; slug: string }) => (
    <button
      type="button"
      className="flex items-center gap-[5px] text-[12px] text-mute hover:text-ink"
      onClick={async () => {
        const path = await saveCsv(`numo-${slug}-${year}.csv`, sheet().rows);
        if (path) toast("Archivo guardado");
      }}
    >
      <Download size={12} /> CSV
    </button>
  );

  return (
    <div className="screen flex flex-col gap-5">
      <HeaderSlot>
        <Pills
          label="Qué tabla se muestra"
          value={tab}
          onChange={setTab}
          options={[
            ["pat", "Ganancias y pérdidas"],
            ["div", "Dividendos e intereses"],
            ["pos", "Posiciones y efectivo"],
          ]}
        />
      </HeaderSlot>

      <section className="flex flex-wrap items-end justify-between gap-5 px-1 pt-2">
        <div className="max-w-[640px]">
          <div className="text-[12px] text-mute">Ejercicio fiscal</div>
          <div className="flex items-center gap-3">
            <span className="text-[54px] leading-[1.05] font-medium tracking-[-0.02em]" style={{ fontStretch: "108%" }}>
              {year}
            </span>
            {/* El selector nativo va encima del botón, invisible: se abre al pulsarlo. */}
            <span className="relative grid size-[30px] place-items-center rounded-full border border-line2 text-mute hover:bg-wash">
              <ChevronDown size={14} />
              <select className="absolute inset-0 cursor-pointer opacity-0" value={year} onChange={(e) => setYear(+e.target.value)} aria-label="Ejercicio">
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div className="mt-2 text-pretty text-ink2">
            {scopeLabel}. Todo en EUR al cambio de cada operación; las ventas se emparejan con sus compras por FIFO, juntando todas tus cuentas para un mismo valor.
            {!closed && " El año no ha terminado: posiciones y efectivo son los de hoy."}
          </div>
        </div>
        <Btn variant="ink" onClick={excel} className="!px-[15px] !py-2">
          <Download size={14} /> Descargar informe en Excel
        </Btn>
      </section>

      <Kpis>
        <Kpi label="Resultado de ventas" note={<>ganancias <Priv>{eur(t.gainsEur, 0)}</Priv> · pérdidas <Priv>{eur(t.lossesEur, 0)}</Priv></>} tone={t.netGainEur}>
          <Money value={t.netGainEur} signed dim="soft" />
        </Kpi>
        <Kpi priv label="Dividendos brutos">
          {eur(t.dividendsGrossEur)}
        </Kpi>
        <Kpi priv label="Intereses brutos">
          {eur(t.interestGrossEur)}
        </Kpi>
        <Kpi priv label="Retenciones" note={<>origen <Priv>{eur(t.taxSourceEur)}</Priv> · España <Priv>{eur(t.taxHomeEur)}</Priv></>}>
          {eur(t.taxSourceEur + t.taxHomeEur)}
        </Kpi>
        <Kpi priv label="Comisiones y gastos">
          {eur(t.feesEur)}
        </Kpi>
      </Kpis>

      {tab === "pat" && (
        <>
          <Card title={`Lo vendido en ${year}`} note="desde que se compró cada lote hasta que se vendió">
            <LotsTimeline
              year={year}
              lots={rep.gains
                .filter((g) => g.acqDate)
                .map((g, i) => ({
                  key: `${g.sellTxId}-${i}`,
                  name: g.asset.name,
                  from: g.acqDate!,
                  to: g.sellDate,
                  detail: `${units(g.qty)} uds · ${num(dayNum(g.sellDate) - dayNum(g.acqDate!), 0)} días`,
                  result: eurSigned(g.gainEur),
                  gain: g.gainEur,
                }))}
            />
          </Card>

          <Card title="Ganancias y pérdidas patrimoniales" aside={<CsvLink sheet={() => gainsSheet(rep)} slug="ganancias" />} pad={false} className="overflow-hidden">
            {rep.gains.length === 0 ? (
              <div className="px-5 pb-5 text-mute">No hubo ventas en {year}.</div>
            ) : (
              <Table cols="minmax(200px,1.6fr) 130px 70px 100px 130px 100px 130px 130px" minWidth={1000}>
                <THead>
                  <L>Activo</L>
                  <L>Cuenta</L>
                  <span>Unidades</span>
                  <span>Adquisición</span>
                  <span>Valor de adquisición</span>
                  <span>Transmisión</span>
                  <span>Valor de transmisión</span>
                  <span>Ganancia o pérdida</span>
                </THead>
                {rep.gains.map((g, i) => (
                  <TRow key={i}>
                    <L>
                      <div className="flex items-center gap-2">
                        <span className="truncate font-[550]">{g.asset.name}</span>
                        {g.review && (
                          <span title="Pérdida con una compra cercana del mismo valor: revisa si es compensable">
                            <Tag tone="warn">Revisar recompra</Tag>
                          </span>
                        )}
                      </div>
                      <div className="selectable text-[11.5px] text-mute">{[g.asset.isin, ASSET_KIND_LABEL[g.asset.kind]].filter(Boolean).join(" · ")}</div>
                    </L>
                    <L className="truncate">{g.account.name}</L>
                    <span className="priv">{units(g.qty)}</span>
                    <span className="text-ink2">{g.acqDate ? dateNumeric(g.acqDate) : <span className="text-acc">sin compra</span>}</span>
                    <span className="priv">{eur(g.acqValueEur)}</span>
                    <span className="text-ink2">{dateNumeric(g.sellDate)}</span>
                    <span className="priv">{eur(g.saleValueEur)}</span>
                    <span className="priv font-semibold" style={{ color: toneOf(g.gainEur) }}>
                      {eurSigned(g.gainEur)}
                    </span>
                  </TRow>
                ))}
                <TFoot>
                  <L>Total</L>
                  <span />
                  <span />
                  <span />
                  <span className="priv">{eur(t.acqValueEur)}</span>
                  <span />
                  <span className="priv">{eur(t.saleValueEur)}</span>
                  <span className="priv" style={{ color: toneOf(t.netGainEur) }}>
                    {eurSigned(t.netGainEur)}
                  </span>
                </TFoot>
              </Table>
            )}
          </Card>
          {carry && (carry.pendingInEur > 0 || carry.offsetByIncomeEur > 0 || carry.pendingOut.length > 0 || carry.expiredEur > 0) && (
            <Card title="Pérdidas pendientes de compensar" note="orientativo, con lo registrado aquí">
              <div className="grid gap-x-8 gap-y-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
                <div>
                  <div className="text-[12px] text-mute">Venían de años anteriores</div>
                  <div className="priv mt-0.5 text-[18px] font-[550]">{eur(carry.pendingInEur)}</div>
                </div>
                <div>
                  <div className="text-[12px] text-mute">Se compensan en {year}</div>
                  <div className="priv mt-0.5 text-[18px] font-[550]">{eur(carry.usedEur + carry.offsetByIncomeEur)}</div>
                  {carry.offsetByIncomeEur > 0 && (
                    <div className="text-[11.5px] text-mute">
                      <Priv>{eur(carry.offsetByIncomeEur)}</Priv> de la pérdida del año, con dividendos e intereses
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[12px] text-mute">Quedan para los siguientes</div>
                  <div className="priv mt-0.5 text-[18px] font-[550]">{eur(carry.pendingOut.reduce((s, p) => s + p.lossEur, 0))}</div>
                  {carry.pendingOut.map((p) => (
                    <div key={p.year} className="text-[11.5px] text-mute">
                      de {p.year}: <Priv>{eur(p.lossEur)}</Priv> · hasta {p.until}
                    </div>
                  ))}
                </div>
                {carry.expiredEur > 0 && (
                  <div>
                    <div className="text-[12px] text-mute">Caducan sin compensar</div>
                    <div className="priv mt-0.5 text-[18px] font-[550] text-acc">{eur(carry.expiredEur)}</div>
                  </div>
                )}
              </div>
              <p className="mt-3.5 text-[12px] text-pretty text-mute">
                La pérdida de un año se compensa primero con el 25 % de los dividendos e intereses de ese año, y el resto con las ganancias de los cuatro siguientes, empezando por la más antigua. Solo cuenta lo
                registrado en Numo{scopeIds ? " y en las cuentas seleccionadas" : ""}: no conoce pérdidas anteriores ni de otras cuentas, y no sustituye a tu declaración.
              </p>
            </Card>
          )}
          {review > 0 && (
            <p className="-mt-2 flex max-w-3xl items-start gap-2 px-1 text-[12.5px] text-ink2">
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-acc" />
              <span>
                {review === 1 ? "Una pérdida tiene" : `${review} pérdidas tienen`} una compra del mismo valor dentro del plazo de recompra (2 meses en cotizados, 12 en fondos). Es un aviso
                orientativo: Numo no decide si la pérdida es compensable ni ajusta el coste.
              </span>
            </p>
          )}
        </>
      )}

      {tab === "div" && (
        <>
          {gross > 0 && (
            <Card title="Del bruto al neto" aside={<span><Priv>{eur(gross)}</Priv> brutos</span>}>
              <SplitBar
                parts={[
                  { key: "net", label: "Cobrado neto", value: Math.max(0, t.incomeNetEur), color: "var(--acc)", display: eur(t.incomeNetEur) },
                  { key: "home", label: "Retención en España", value: t.taxHomeEur, color: "color-mix(in oklab, var(--down) 70%, var(--card))", display: eur(t.taxHomeEur) },
                  { key: "src", label: "Retención en origen", value: t.taxSourceEur, color: "color-mix(in oklab, var(--down) 38%, var(--card))", display: eur(t.taxSourceEur) },
                ]}
              />
            </Card>
          )}
          <Card title="Dividendos e intereses" aside={<CsvLink sheet={() => incomeSheet(rep)} slug="rendimientos" />} pad={false} className="overflow-hidden">
            {rep.income.length === 0 ? (
              <div className="px-5 pb-5 text-mute">No hubo cobros en {year}.</div>
            ) : (
              <Table cols="96px minmax(240px,2fr) 44px 110px 76px 84px 84px 90px 90px" minWidth={1000}>
                <THead>
                  <L>Fecha</L>
                  <L>Concepto</L>
                  <L>País</L>
                  <span>Bruto en divisa</span>
                  <span>Cambio</span>
                  <span>Bruto</span>
                  <span>Ret. origen</span>
                  <span>Ret. España</span>
                  <span>Neto</span>
                </THead>
                {rep.income.map((r) => (
                  <TRow key={r.txId}>
                    <L className="text-ink2">{dateShort(r.date)}</L>
                    <L className="truncate">
                      <span className="font-medium">{r.asset?.name ?? TX_LABEL[r.type]}</span> <span className="text-mute">· {r.account.name}</span>
                    </L>
                    <L className="text-ink2">{r.country || "—"}</L>
                    <span className="priv">{r.currency === "EUR" ? "" : money(r.grossNative, r.currency)}</span>
                    <span className="text-mute">{r.currency === "EUR" ? "" : num(r.fxRate, 4, 4)}</span>
                    <span className="priv">{eur(r.grossEur)}</span>
                    <span className="priv text-mute">{r.taxSourceEur ? eur(r.taxSourceEur) : ""}</span>
                    <span className="priv text-mute">{r.taxHomeEur ? eur(r.taxHomeEur) : ""}</span>
                    <span className="priv font-semibold">{eur(r.netEur)}</span>
                  </TRow>
                ))}
                <TFoot>
                  <L>Total</L>
                  <span />
                  <span />
                  <span />
                  <span />
                  <span className="priv">{eur(gross)}</span>
                  <span className="priv">{eur(t.taxSourceEur)}</span>
                  <span className="priv">{eur(t.taxHomeEur)}</span>
                  <span className="priv">{eur(t.incomeNetEur)}</span>
                </TFoot>
              </Table>
            )}
          </Card>
        </>
      )}

      {tab === "pos" && (
        <>
          <Card title={`Posiciones a ${dateShort(rep.asOf)}`} aside={<CsvLink sheet={() => holdingsSheet(rep)} slug="posiciones" />} pad={false} className="overflow-hidden">
            {rep.holdings.length === 0 ? (
              <div className="px-5 pb-5 text-mute">No había posiciones abiertas.</div>
            ) : (
              <Table cols="150px minmax(220px,2fr) 44px 110px 130px 80px 130px" minWidth={940}>
                <THead>
                  <L>Cuenta</L>
                  <L>Activo</L>
                  <L>País</L>
                  <span>Unidades</span>
                  <span>Precio</span>
                  <span>Cambio</span>
                  <span>Valor</span>
                </THead>
                {rep.holdings.map((h, i) => (
                  <TRow key={i}>
                    <L className="truncate">{h.account.name}</L>
                    <L>
                      <div className="truncate font-[550]">{h.asset.name}</div>
                      {h.asset.isin && <div className="selectable text-[11.5px] text-mute">{h.asset.isin}</div>}
                    </L>
                    <L className="text-ink2">{h.country || "—"}</L>
                    <span className="priv">{units(h.qty)}</span>
                    <span className="text-ink2">{h.price == null ? <span className="text-acc">sin precio</span> : money(h.price, h.currency, priceDigits(h.price))}</span>
                    <span className="text-mute">{h.currency === "EUR" ? "" : num(h.fxRate, 4, 4)}</span>
                    <span className="priv font-semibold">{eur(h.valueEur)}</span>
                  </TRow>
                ))}
                <TFoot>
                  <L>Total</L>
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span className="priv">{eur(t.holdingsEur)}</span>
                </TFoot>
              </Table>
            )}
          </Card>

          {rep.cash.length > 0 && (
            <Card title={`Efectivo a ${dateShort(rep.asOf)}`} aside={<CsvLink sheet={() => cashSheet(rep)} slug="efectivo" />} pad={false} className="overflow-hidden">
              <Table cols="minmax(160px,1.4fr) minmax(140px,1fr) 150px 140px 200px" minWidth={860}>
                <THead>
                  <L>Cuenta</L>
                  <L>Entidad</L>
                  <span>Saldo</span>
                  <span>Saldo en EUR</span>
                  <span>Saldo medio del 4.º trimestre</span>
                </THead>
                {rep.cash.map((c) => (
                  <TRow key={c.account.id}>
                    <L className="truncate font-[550]">{c.account.name}</L>
                    <L className="truncate text-ink2">{c.account.institution}</L>
                    <span className="priv">{money(c.balance, c.account.currency)}</span>
                    <span className="priv">{eur(c.balanceEur)}</span>
                    <span className="priv">{eur(c.avgQ4Eur)}</span>
                  </TRow>
                ))}
              </Table>
            </Card>
          )}

          <Card title={`Extracto de operaciones de ${year}`} aside={<CsvLink sheet={() => operationsSheet(ops, d.accounts, d.assets)} slug="operaciones" />}>
            <p className="text-ink2">
              {ops.length} {ops.length === 1 ? "operación" : "operaciones"}. El detalle completo va en la hoja «Operaciones» del Excel y en el CSV, con cada importe convertido a EUR.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
