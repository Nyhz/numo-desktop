import { eur, pct } from "../lib/format.ts";
import { flowBuckets } from "./viz.tsx";

// Rentas cobradas a lo largo del tiempo (Resumen): una columna por mes,
// trimestre o año según el periodo, y debajo quién las paga.

export type IncomeItem = { date: string; amount: number; kind: "dividend" | "interest"; name: string };

const COLOR = { dividend: "var(--up)", interest: "var(--s2)" } as const;

export function IncomeColumns({ items, from, to }: { items: IncomeItem[]; from: string; to: string }) {
  const buckets = flowBuckets(from, to);
  const span = buckets.length > 1 ? +buckets[1]!.key - +buckets[0]!.key : 1;
  const cols = buckets.map((b) => ({ ...b, dividend: 0, interest: 0 }));
  const index = new Map(cols.map((c, i) => [c.key, i]));
  const payers = new Map<string, number>();
  for (const it of items) {
    const m = +it.date.slice(0, 4) * 12 + (+it.date.slice(5, 7) - 1);
    const col = cols[index.get(String(Math.floor(m / span) * span)) ?? -1];
    if (!col) continue;
    col[it.kind] += it.amount;
    payers.set(it.name, (payers.get(it.name) ?? 0) + it.amount);
  }
  const total = cols.reduce((s, c) => s + c.dividend + c.interest, 0);
  if (!(total > 0)) return <div className="py-6 text-mute">No se ha cobrado ningún dividendo ni interés en este periodo.</div>;
  // La columna más alta deja sitio encima para su cifra.
  const max = Math.max(...cols.map((c) => c.dividend + c.interest)) * 1.2;
  const top = [...payers].sort((a, b) => b[1] - a[1]);
  const shown = top.slice(0, 5);
  const rest = top.slice(5).reduce((s, [, v]) => s + v, 0);
  const hasInterest = cols.some((c) => c.interest > 0);
  const unit = span === 1 ? "mes" : span === 3 ? "trimestre" : "año";

  return (
    <>
      <div className="flex items-baseline gap-2.5">
        <span className="priv text-[20px] font-[550]" style={{ fontStretch: "106%" }}>
          {eur(total)}
        </span>
        <span className="text-[12px] text-mute">
          netos · media de <span className="priv">{eur(total / cols.length, 0)}</span> al {unit}
        </span>
      </div>
      <div className="mt-3 flex h-[132px] items-end gap-1.5">
        {cols.map((c) => {
          const sum = c.dividend + c.interest;
          return (
            <div key={c.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-px">
              <span className="priv pb-[3px] text-[11px] font-[550] whitespace-nowrap">{sum > 0 ? eur(sum, 0) : ""}</span>
              {c.interest > 0 && <div className="w-full max-w-[56px] rounded-t-[3px]" style={{ height: `${(c.interest / max) * 100}%`, minHeight: 2, background: COLOR.interest }} />}
              {c.dividend > 0 && <div className={`w-full max-w-[56px] ${c.interest > 0 ? "" : "rounded-t-[3px]"}`} style={{ height: `${(c.dividend / max) * 100}%`, minHeight: 2, background: COLOR.dividend }} />}
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 border-t border-line2 pt-1.5">
        {cols.map((c) => (
          <span key={c.key} className="min-w-0 flex-1 truncate text-center text-[11px] text-mute">
            {c.label}
          </span>
        ))}
      </div>
      {hasInterest && (
        <div className="mt-2.5 flex gap-4 text-[12px] text-ink2">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: COLOR.dividend }} /> Dividendos
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: COLOR.interest }} /> Intereses
          </span>
        </div>
      )}
      <div className="mt-3.5 border-t border-line pt-3">
        <div className="mb-1.5 text-[12px] text-mute">Quién las paga</div>
        {shown.map(([name, value]) => (
          <div key={name} className="grid items-center gap-3 py-[3px] text-[12.5px]" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) 96px 52px" }}>
            <span className="truncate">{name}</span>
            <div className="h-1.5 rounded-[2px] bg-line">
              <div className="h-full rounded-[2px] bg-up" style={{ width: `${(value / shown[0]![1]) * 100}%` }} />
            </div>
            <span className="priv text-right font-medium">{eur(value)}</span>
            <span className="text-right text-mute">{pct(value / total, 0)}</span>
          </div>
        ))}
        {rest > 0 && (
          <div className="pt-1 text-[12px] text-mute">
            y {top.length - shown.length} más, que suman <span className="priv">{eur(rest)}</span>
          </div>
        )}
      </div>
    </>
  );
}
