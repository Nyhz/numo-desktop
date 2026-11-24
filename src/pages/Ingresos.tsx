import { useMemo } from "react";
import { useLocation } from "wouter";
import { isoOf } from "../../shared/dates.ts";
import { TX_LABEL } from "../../shared/types.ts";
import { Columns, RankedBars } from "../charts/bars.tsx";
import { Legend } from "../charts/core.tsx";
import { rangeBase, useApp, useDerived } from "../data/store.ts";
import { dateShort, eur, eurAxis, monthLong, monthShort, pct, seriesColor } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Button, Dot, Empty, Section, Stat } from "../ui/kit.tsx";
import { Welcome } from "./Resumen.tsx";

export function Ingresos() {
  const d = useDerived();
  const range = useApp((s) => s.range);
  const [, go] = useLocation();

  const view = useMemo(() => {
    const { from } = rangeBase(range, d.timeline, d.today);
    const since = from < 0 ? "" : isoOf(d.timeline.start + from + 1);
    const rows = d.ledger.ntxs.filter(
      (n) => (n.tx.type === "dividend" || n.tx.type === "interest") && (!d.scope || d.scope.has(n.tx.accountId)) && n.tx.date >= since,
    );
    const byMonth = new Map<string, { div: number; int: number }>();
    const byAsset = new Map<string, number>();
    let gross = 0;
    let taxSource = 0;
    let taxHome = 0;
    let net = 0;
    for (const n of rows) {
      const ym = n.tx.date.slice(0, 7);
      const m = byMonth.get(ym) ?? { div: 0, int: 0 };
      if (n.tx.type === "dividend") m.div += n.cashEur;
      else m.int += n.cashEur;
      byMonth.set(ym, m);
      const key = n.asset?.id ?? "__interest";
      byAsset.set(key, (byAsset.get(key) ?? 0) + n.cashEur);
      gross += n.grossEur;
      taxSource += n.taxSourceEur;
      taxHome += n.taxHomeEur;
      net += n.cashEur;
    }
    // Todos los meses del periodo, también los que no tuvieron cobros.
    const months: string[] = [];
    const firstDate = rows[0]?.tx.date ?? d.today;
    const start = (since && since > firstDate ? firstDate : since || firstDate).slice(0, 7);
    let [y, m] = start.split("-").map(Number) as [number, number];
    const end = d.today.slice(0, 7);
    for (let k = 0; k < 600; k++) {
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      months.push(ym);
      if (ym >= end) break;
      if (++m > 12) {
        m = 1;
        y++;
      }
    }
    const invested = d.positions.reduce((s, p) => s + p.valueEur, 0);
    const lastYear = rows.filter((n) => n.tx.date > isoOf(d.timeline.start + d.timeline.n - 1 - 365)).reduce((s, n) => s + n.cashEur, 0);
    return { rows: [...rows].reverse(), months, byMonth, byAsset, gross, taxSource, taxHome, net, yieldPct: invested > 0 ? lastYear / invested : null };
  }, [d, range]);

  if (d.state.accounts.length === 0) return <Welcome />;
  if (view.rows.length === 0) {
    return (
      <Empty title="No hay dividendos ni intereses en este periodo" action={<Button variant="primary" onClick={() => openDialog({ kind: "tx", preset: { type: "dividend" } })}>Registrar un dividendo</Button>}>
        Aquí verás lo que cobras de tus inversiones: cuánto, de qué activos y con qué retenciones.
      </Empty>
    );
  }

  const ranked = [...view.byAsset.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  return (
    <div className="grid gap-10">
      <section className="grid grid-cols-5 gap-6 border-b border-line pb-5">
        <Stat label="Cobrado neto" sub="en el periodo">
          {eur(view.net)}
        </Stat>
        <Stat label="Bruto">{eur(view.gross)}</Stat>
        <Stat label="Retención en origen" sub={view.gross > 0 ? `${pct(view.taxSource / view.gross)} del bruto` : undefined}>
          {eur(view.taxSource)}
        </Stat>
        <Stat label="Retención en España" sub={view.gross > 0 ? `${pct(view.taxHome / view.gross)} del bruto` : undefined}>
          {eur(view.taxHome)}
        </Stat>
        <Stat label="Rentabilidad por rentas" sub="últimos 12 meses">
          {view.yieldPct == null ? "—" : pct(view.yieldPct, 2)}
        </Stat>
      </section>

      <Section
        title="Cobros netos por mes"
        aside={
          <Legend
            items={[
              { key: "d", label: "Dividendos", color: "var(--s1)" },
              { key: "i", label: "Intereses", color: "var(--s2)" },
            ]}
          />
        }
      >
        <Columns
          categories={view.months.map(monthShort)}
          titles={view.months.map(monthLong)}
          series={[
            { key: "div", label: "Dividendos", color: "var(--s1)", values: view.months.map((ym) => view.byMonth.get(ym)?.div ?? 0) },
            { key: "int", label: "Intereses", color: "var(--s2)", values: view.months.map((ym) => view.byMonth.get(ym)?.int ?? 0) },
          ]}
          height={230}
          format={(v) => eur(v)}
          formatAxis={eurAxis}
        />
      </Section>

      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-12">
        <Section title="De dónde viene">
          <RankedBars
            rows={ranked.map(([id, value]) => ({
              key: id,
              label: id === "__interest" ? "Intereses de cuentas" : (d.assets.get(id)?.name ?? "—"),
              value,
              display: eur(value),
              onClick: id === "__interest" ? undefined : () => go(`/activo/${id}`),
            }))}
          />
        </Section>

        <Section title="Cobros">
          <table className="tbl">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Cuenta</th>
                <th className="r">Bruto</th>
                <th className="r">Retenciones</th>
                <th className="r">Neto</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.slice(0, 60).map((n) => (
                <tr key={n.tx.id} className="click" onClick={() => openDialog({ kind: "tx", tx: n.tx })}>
                  <td className="num">{dateShort(n.tx.date)}</td>
                  <td className="max-w-[220px] truncate">{n.asset?.name ?? TX_LABEL[n.tx.type]}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <Dot color={seriesColor(n.account.color)} />
                      {n.account.name}
                    </span>
                  </td>
                  <td className="r">{eur(n.grossEur)}</td>
                  <td className="r text-ink-2">{n.taxSourceEur + n.taxHomeEur ? eur(n.taxSourceEur + n.taxHomeEur) : ""}</td>
                  <td className="r font-medium">{eur(n.cashEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.rows.length > 60 && <p className="mt-2 text-[12px] text-muted">Se muestran los 60 más recientes de {view.rows.length}. El resto está en Operaciones e Informes.</p>}
        </Section>
      </div>
    </div>
  );
}
