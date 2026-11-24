import { Download, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { buildYearReport, yearsWithActivity } from "../../shared/engine/reports.ts";
import { ASSET_KIND_LABEL, TX_LABEL } from "../../shared/types.ts";
import { useApp, useDerived } from "../data/store.ts";
import { cashSheet, gainsSheet, holdingsSheet, incomeSheet, operationsSheet, saveCsv, saveXlsx, summarySheet, txsOfYear, type Sheet } from "../lib/export.ts";
import { dateNumeric, dateShort, eur, money, num } from "../lib/format.ts";
import { Button, Delta, Section, Stat, Tag, toast } from "../ui/kit.tsx";
import { Welcome } from "./Resumen.tsx";

export function Informes() {
  const d = useDerived();
  const scopeIds = useApp((s) => s.scope);
  const years = useMemo(() => yearsWithActivity(d.state, d.today), [d.state, d.today]);
  const [year, setYear] = useState(() => {
    // Por defecto el último ejercicio cerrado, que es el que se declara.
    const current = +d.today.slice(0, 4);
    return years.find((y) => y < current) ?? years[0] ?? current;
  });
  const rep = useMemo(() => buildYearReport(d.ledger, d.state, d.timeline, d.scope, year, d.today), [d, year]);

  if (d.state.accounts.length === 0) return <Welcome />;

  const t = rep.totals;
  const scopeLabel = scopeIds ? d.state.accounts.filter((a) => scopeIds.includes(a.id)).map((a) => a.name).join(", ") : "Todas las cuentas";
  const ops = txsOfYear(d.ledger, d.scope, year);
  const sheets = (): Sheet[] => [summarySheet(rep, scopeLabel), gainsSheet(rep), incomeSheet(rep), holdingsSheet(rep), cashSheet(rep), operationsSheet(ops, d.accounts, d.assets)];
  const closed = rep.asOf.endsWith("-12-31");

  const excel = async () => {
    const path = await saveXlsx(`caudal-informe-${year}.xlsx`, sheets());
    if (path) toast(`Informe ${year} guardado`);
  };
  const csv = async (sheet: Sheet, slug: string) => {
    const path = await saveCsv(`caudal-${slug}-${year}.csv`, sheet.rows);
    if (path) toast("Archivo guardado");
  };
  const CsvButton = ({ sheet, slug }: { sheet: () => Sheet; slug: string }) => (
    <Button size="sm" variant="ghost" onClick={() => void csv(sheet(), slug)}>
      <Download size={12} /> CSV
    </Button>
  );
  const review = rep.gains.filter((g) => g.review).length;

  return (
    <div className="grid gap-10">
      <header className="flex items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="wide text-[22px] leading-tight font-semibold">Ejercicio</h2>
            <select className="field h-9 w-28 text-[16px] font-semibold" value={year} onChange={(e) => setYear(+e.target.value)} aria-label="Ejercicio">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1.5 max-w-2xl text-ink-2">
            {scopeLabel}. Todo en EUR al cambio de cada operación; las ventas se emparejan con sus compras por FIFO, juntando todas tus cuentas para un mismo valor.
            {!closed && " El año no ha terminado: posiciones y efectivo son los de hoy."}
          </p>
        </div>
        <Button variant="primary" onClick={excel}>
          <Download size={14} /> Descargar informe en Excel
        </Button>
      </header>

      <section className="grid grid-cols-5 gap-6 border-y border-line py-5">
        <Stat label="Resultado de ventas" sub={`ganancias ${eur(t.gainsEur, 0)} · pérdidas ${eur(t.lossesEur, 0)}`}>
          <Delta value={t.netGainEur} />
        </Stat>
        <Stat label="Dividendos brutos">{eur(t.dividendsGrossEur)}</Stat>
        <Stat label="Intereses brutos">{eur(t.interestGrossEur)}</Stat>
        <Stat label="Retenciones" sub={`origen ${eur(t.taxSourceEur)} · España ${eur(t.taxHomeEur)}`}>
          {eur(t.taxSourceEur + t.taxHomeEur)}
        </Stat>
        <Stat label="Comisiones y gastos">{eur(t.feesEur)}</Stat>
      </section>

      <Section title="Ganancias y pérdidas patrimoniales" aside={<CsvButton sheet={() => gainsSheet(rep)} slug="ganancias" />}>
        {rep.gains.length === 0 ? (
          <div className="text-muted">No hubo ventas en {year}.</div>
        ) : (
          <>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Activo</th>
                  <th>Cuenta</th>
                  <th className="r">Unidades</th>
                  <th className="r">Adquisición</th>
                  <th className="r">Valor de adquisición</th>
                  <th className="r">Transmisión</th>
                  <th className="r">Valor de transmisión</th>
                  <th className="r">Ganancia o pérdida</th>
                </tr>
              </thead>
              <tbody>
                {rep.gains.map((g, i) => (
                  <tr key={i}>
                    <td className="max-w-[260px]">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{g.asset.name}</span>
                        {g.review && (
                          <span title="Pérdida con una compra cercana del mismo valor: revisa si es compensable">
                            <Tag tone="warn">Revisar recompra</Tag>
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] text-muted">{[g.asset.isin, ASSET_KIND_LABEL[g.asset.kind]].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td>{g.account.name}</td>
                    <td className="r">{num(g.qty, 6)}</td>
                    <td className="r">{g.acqDate ? dateNumeric(g.acqDate) : <span className="text-warn">sin compra</span>}</td>
                    <td className="r">{eur(g.acqValueEur)}</td>
                    <td className="r">{dateNumeric(g.sellDate)}</td>
                    <td className="r">{eur(g.saleValueEur)}</td>
                    <td className="r">
                      <Delta value={g.gainEur} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="r">{eur(t.acqValueEur)}</td>
                  <td />
                  <td className="r">{eur(t.saleValueEur)}</td>
                  <td className="r">
                    <Delta value={t.netGainEur} />
                  </td>
                </tr>
              </tfoot>
            </table>
            {review > 0 && (
              <p className="mt-3 flex max-w-3xl items-start gap-2 text-[12.5px] text-ink-2">
                <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" />
                <span>
                  {review === 1 ? "Una pérdida tiene" : `${review} pérdidas tienen`} una compra del mismo valor dentro del plazo de recompra (2 meses en cotizados, 12 en fondos). Es
                  un aviso orientativo: Caudal no decide si la pérdida es compensable ni ajusta el coste.
                </span>
              </p>
            )}
          </>
        )}
      </Section>

      <Section title="Dividendos e intereses" aside={<CsvButton sheet={() => incomeSheet(rep)} slug="rendimientos" />}>
        {rep.income.length === 0 ? (
          <div className="text-muted">No hubo cobros en {year}.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>País</th>
                <th className="r">Bruto en divisa</th>
                <th className="r">Cambio</th>
                <th className="r">Bruto</th>
                <th className="r">Ret. origen</th>
                <th className="r">Ret. España</th>
                <th className="r">Neto</th>
              </tr>
            </thead>
            <tbody>
              {rep.income.map((r) => (
                <tr key={r.txId}>
                  <td className="num">{dateShort(r.date)}</td>
                  <td className="max-w-[260px] truncate">
                    {r.asset?.name ?? TX_LABEL[r.type]} <span className="text-muted">· {r.account.name}</span>
                  </td>
                  <td>{r.country || <span className="text-muted">—</span>}</td>
                  <td className="r">{r.currency === "EUR" ? "" : money(r.grossNative, r.currency)}</td>
                  <td className="r text-ink-2">{r.currency === "EUR" ? "" : num(r.fxRate, 4, 4)}</td>
                  <td className="r">{eur(r.grossEur)}</td>
                  <td className="r">{r.taxSourceEur ? eur(r.taxSourceEur) : ""}</td>
                  <td className="r">{r.taxHomeEur ? eur(r.taxHomeEur) : ""}</td>
                  <td className="r font-medium">{eur(r.netEur)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Total</td>
                <td className="r">{eur(t.dividendsGrossEur + t.interestGrossEur)}</td>
                <td className="r">{eur(t.taxSourceEur)}</td>
                <td className="r">{eur(t.taxHomeEur)}</td>
                <td className="r">{eur(t.incomeNetEur)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </Section>

      <Section title={`Posiciones a ${dateShort(rep.asOf)}`} aside={<CsvButton sheet={() => holdingsSheet(rep)} slug="posiciones" />}>
        {rep.holdings.length === 0 ? (
          <div className="text-muted">No había posiciones abiertas.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Activo</th>
                <th>País</th>
                <th className="r">Unidades</th>
                <th className="r">Precio</th>
                <th className="r">Cambio</th>
                <th className="r">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rep.holdings.map((h, i) => (
                <tr key={i}>
                  <td>{h.account.name}</td>
                  <td className="max-w-[280px]">
                    <div className="truncate">{h.asset.name}</div>
                    {h.asset.isin && <div className="text-[12px] text-muted">{h.asset.isin}</div>}
                  </td>
                  <td>{h.country || <span className="text-muted">—</span>}</td>
                  <td className="r">{num(h.qty, 6)}</td>
                  <td className="r">{h.price == null ? <span className="text-warn">sin precio</span> : money(h.price, h.currency, h.price < 10 ? 4 : 2)}</td>
                  <td className="r text-ink-2">{h.currency === "EUR" ? "" : num(h.fxRate, 4, 4)}</td>
                  <td className="r font-medium">{eur(h.valueEur)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>Total</td>
                <td className="r">{eur(t.holdingsEur)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </Section>

      {rep.cash.length > 0 && (
        <Section title={`Efectivo a ${dateShort(rep.asOf)}`} aside={<CsvButton sheet={() => cashSheet(rep)} slug="efectivo" />}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Entidad</th>
                <th className="r">Saldo</th>
                <th className="r">Saldo en EUR</th>
                <th className="r">Saldo medio del 4.º trimestre</th>
              </tr>
            </thead>
            <tbody>
              {rep.cash.map((c) => (
                <tr key={c.account.id}>
                  <td>{c.account.name}</td>
                  <td className="text-ink-2">{c.account.institution}</td>
                  <td className="r">{money(c.balance, c.account.currency)}</td>
                  <td className="r">{eur(c.balanceEur)}</td>
                  <td className="r">{eur(c.avgQ4Eur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title={`Extracto de operaciones de ${year}`} aside={<CsvButton sheet={() => operationsSheet(ops, d.accounts, d.assets)} slug="operaciones" />}>
        <p className="text-ink-2">
          {ops.length} {ops.length === 1 ? "operación" : "operaciones"}. El detalle completo va en la hoja «Operaciones» del Excel y en el CSV, con cada importe convertido a EUR.
        </p>
      </Section>
    </div>
  );
}
