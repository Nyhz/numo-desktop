import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { parseNumber } from "../../shared/csv.ts";
import { buildPlan, planContribution } from "../../shared/engine/plan.ts";
import type { Goal } from "../../shared/types.ts";
import { Dumbbell } from "../charts/viz.tsx";
import { assignAsset, derive, removeGoal, saveGoal, useApp } from "../data/store.ts";
import { eur, num, pct, seriesColor } from "../lib/format.ts";
import { Btn, Card, Dot, Empty, IconBtn, Kpi, Kpis, toast } from "../ui/kit.tsx";
import { L, THead, TRow, Table, Welcome } from "./common.tsx";

const pp = (v: number, d = 1) => `${num(v, d, d)} %`;

/** Fila editable de un bloque: se guarda al salir del campo o con Intro. */
function GoalRow({ goal, used }: { goal: Goal; used: number }) {
  const [name, setName] = useState(goal.name);
  const [target, setTarget] = useState(String(goal.targetPct).replace(".", ","));
  useEffect(() => {
    setName(goal.name);
    setTarget(String(goal.targetPct).replace(".", ","));
  }, [goal.name, goal.targetPct]);

  const save = async () => {
    const targetPct = parseNumber(target);
    if (targetPct == null || Number.isNaN(targetPct)) return setTarget(String(goal.targetPct).replace(".", ","));
    if (name.trim() === goal.name && targetPct === goal.targetPct) return;
    const res = await saveGoal({ name, targetPct }, goal.id);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      setName(goal.name);
      setTarget(String(goal.targetPct).replace(".", ","));
    }
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && e.currentTarget.blur();
  const remove = async () => {
    const res = await removeGoal(goal.id);
    if (res.ok) toast(`Bloque «${goal.name}» eliminado${used ? "; sus activos quedan sin asignar" : ""}`);
    else toast(res.error, { tone: "error" });
  };

  return (
    <div className="flex items-center gap-2.5 border-t border-line px-5 py-2">
      <Dot color={seriesColor(goal.color)} size={8} />
      <input className="field h-8 flex-1" aria-label="Nombre del bloque" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={onKey} />
      <div className="relative w-[92px]">
        <input className="field h-8 pr-7 text-right" inputMode="decimal" aria-label={`Peso objetivo de ${goal.name}`} value={target} onChange={(e) => setTarget(e.target.value)} onBlur={save} onKeyDown={onKey} />
        <span className="pointer-events-none absolute top-1.5 right-2.5 text-mute">%</span>
      </div>
      <IconBtn label={`Eliminar el bloque ${goal.name}`} onClick={remove}>
        <Trash2 size={14} />
      </IconBtn>
    </div>
  );
}

export function Plan() {
  const state = useApp((s) => (s.demo ?? s.loaded).state);
  const [, go] = useLocation();
  // El plan es de toda la cartera: no depende del filtro de cuentas.
  const d = derive(state, null);
  const plan = useMemo(() => buildPlan(d.positions, state.goals), [d.positions, state.goals]);
  const [amountText, setAmountText] = useState(() => localStorage.getItem("caudal.aportacion") ?? "1.000");
  const [newName, setNewName] = useState("");
  const [hot, setHot] = useState<string | null>(null);

  const amount = parseNumber(amountText.replace(/\./g, "")) ?? 0;
  const alloc = useMemo(() => planContribution(plan, amount > 0 ? amount : 0), [plan, amount]);
  // Desviación que quedaría tras la aportación: la mitad de la suma de diferencias absolutas.
  const offAfter = alloc.length ? alloc.reduce((s, a) => s + Math.abs(a.weightAfterPct - a.targetPct), 0) / 2 : plan.offPct;

  if (state.accounts.length === 0) return <Welcome />;

  const addGoal = async () => {
    if (!newName.trim()) return;
    const res = await saveGoal({ name: newName, targetPct: Math.max(0, Math.round(100 - plan.targetSum)) });
    if (!res.ok) return toast(res.error, { tone: "error" });
    setNewName("");
  };

  if (state.goals.length === 0) {
    return (
      <Empty
        title="Define tu plan de inversión"
        action={
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addGoal();
            }}
          >
            <input className="field w-56" data-autofocus autoFocus placeholder="p. ej. Global" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Btn variant="cta" type="submit">
              Crear el primer bloque
            </Btn>
          </form>
        }
      >
        Un plan reparte tu cartera en bloques con un peso objetivo: Global 60 %, Emergentes 15 %, Oro 5 %… Caudal te dice cuánto te alejas de él y dónde poner la próxima aportación.
      </Empty>
    );
  }

  const scale = Math.max(1, ...plan.buckets.map((b) => Math.max(b.weightPct, b.targetPct))) * 1.08;
  const offEur = (plan.offPct / 100) * plan.totalEur;
  const hotBucket = plan.buckets.find((b) => (b.goal?.id ?? "__none") === hot);
  const held = new Set(d.positions.map((p) => p.asset.id));
  const withGoal = plan.buckets.filter((b) => b.goal);
  const under = [...withGoal].sort((x, y) => y.gapEur - x.gapEur)[0];
  const over = [...withGoal].sort((x, y) => x.gapEur - y.gapEur)[0];

  return (
    <div className="screen flex flex-col gap-5">
      <section className="px-1 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[12px] text-mute">Fuera de sitio respecto al plan</div>
            <div className="mt-0.5 text-[56px] leading-[1.05] font-medium tracking-[-0.02em]" style={{ fontStretch: "108%" }}>
              {num(plan.offPct, 1, 1)}
              <span className="text-mute"> %</span>
            </div>
            <div className="mt-1.5 flex min-h-5 flex-wrap items-baseline gap-2.5 text-[13.5px] text-mute">
              <span className="text-ink2">{eur(offEur, 0)} habría que mover para cumplirlo exactamente</span>
              {Math.abs(plan.targetSum - 100) > 0.005 && <span className="font-[550] text-acc">· los objetivos suman {pp(plan.targetSum, 0)}, no 100 %</span>}
            </div>
          </div>
          <div className="flex min-w-[210px] flex-col gap-[3px] pb-1 text-[12.5px]">
            <div className="flex gap-2">
              <span className="flex-1 text-ink2">En el plan</span>
              <span className="font-medium">{eur(plan.totalEur, 0)}</span>
            </div>
            <div className="flex gap-2">
              <span className="flex-1 text-ink2">Fuera del plan ({plan.excluded.length})</span>
              <span className="font-medium">{eur(plan.excludedEur, 0)}</span>
            </div>
          </div>
        </div>
      </section>

      <Kpis>
        <Kpi label="Bloques" note={`objetivos: ${pp(plan.targetSum, 0)}`}>
          {state.goals.length}
        </Kpi>
        <Kpi label="Donde más falta" note={under && under.gapEur > 0 ? under.goal!.name : "ningún bloque por debajo"}>
          {eur(Math.max(0, under?.gapEur ?? 0), 0)}
        </Kpi>
        <Kpi label="Donde más sobra" note={over && over.gapEur < 0 ? over.goal!.name : "ningún bloque por encima"}>
          {eur(Math.max(0, -(over?.gapEur ?? 0)), 0)}
        </Kpi>
        <Kpi label="Sin bloque" note="posiciones por asignar">
          {eur(plan.buckets.find((b) => !b.goal)?.valueEur ?? 0, 0)}
        </Kpi>
      </Kpis>

      <Card
        title="Plan frente a realidad"
        note="barra = peso real · marca = objetivo"
        aside={<span className="truncate text-ink">{hotBucket ? hotBucket.positions.map((p) => `${p.asset.name} ${pct(p.valueEur / Math.max(1, plan.totalEur))}`).join(" · ") || "sin posiciones" : ""}</span>}
      >
        <div onMouseLeave={() => setHot(null)}>
          {plan.buckets.map((b) => {
            const key = b.goal?.id ?? "__none";
            const color = b.goal ? seriesColor(b.goal.color) : "var(--mute)";
            const near = Math.abs(b.driftPct) < 0.5;
            return (
              <div key={key} onMouseEnter={() => setHot(key)} className={`grid items-center gap-4 rounded-lg px-2 py-2.5 transition-colors duration-100 ${hot === key ? "bg-wash" : ""}`} style={{ gridTemplateColumns: "minmax(0,170px) minmax(0,1fr) 150px 170px" }}>
                <span className="flex min-w-0 items-center gap-2">
                  <Dot color={color} size={8} />
                  <span className="truncate font-[550]">{b.goal?.name ?? "Sin bloque"}</span>
                </span>
                <div className="relative h-5">
                  <div className="absolute inset-x-0 top-2 h-1 rounded-[2px] bg-line" />
                  <div className="absolute top-[5px] h-2.5 rounded-[3px]" style={{ width: `${(b.weightPct / scale) * 100}%`, background: `color-mix(in oklab, ${color} 78%, var(--card))` }} />
                  {b.goal && <div className="absolute top-0 h-5 w-[2px] rounded-full bg-ink" style={{ left: `calc(${(b.targetPct / scale) * 100}% - 1px)` }} title={`Objetivo ${pp(b.targetPct, 0)}`} />}
                </div>
                <span className="text-right">
                  <span className="font-semibold">{pp(b.weightPct)}</span>
                  <span className="text-mute"> de {b.goal ? pp(b.targetPct, 0) : "—"}</span>
                </span>
                <span className="text-right text-[12.5px]">
                  {!b.goal ? (
                    <span className="text-mute">{eur(b.valueEur, 0)} sin asignar</span>
                  ) : near ? (
                    <span className="text-mute">en su sitio</span>
                  ) : b.gapEur > 0 ? (
                    <span className="text-acc">faltan {eur(b.gapEur, 0)}</span>
                  ) : (
                    <span className="text-ink2">sobran {eur(-b.gapEur, 0)}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid items-start gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
        <Card
          title="Próxima aportación"
          note="dónde ponerla para acercarte al plan sin vender nada"
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative w-40">
              <input
                className="field h-10 pr-8 text-right text-[18px] font-[550]"
                inputMode="decimal"
                aria-label="Importe de la aportación"
                value={amountText}
                onChange={(e) => {
                  setAmountText(e.target.value);
                  localStorage.setItem("caudal.aportacion", e.target.value);
                }}
              />
              <span className="pointer-events-none absolute top-2.5 right-3 text-mute">€</span>
            </div>
            {amount > 0 && alloc.length > 0 && (
              <span className="text-[12.5px] text-ink2">
                la desviación pasaría de <span className="font-semibold text-ink">{pp(plan.offPct)}</span> a <span className="font-semibold text-ink">{pp(offAfter)}</span>
              </span>
            )}
          </div>
          {amount > 0 && alloc.length > 0 ? (
            <>
              <Dumbbell
                axis={(v) => `${num(v, 0)} %`}
                toneOf={() => "var(--acc)"}
                rows={alloc
                  .filter((a) => a.amountEur > 0)
                  .sort((a, b) => b.amountEur - a.amountEur)
                  .map((a) => ({
                    key: a.goal.id,
                    name: a.goal.name,
                    from: a.weightBeforePct,
                    to: a.weightAfterPct,
                    right: (
                      <>
                        <span className="font-semibold text-ink">{eur(a.amountEur)}</span> <span className="text-[11.5px] text-mute">obj. {pp(a.targetPct, 0)}</span>
                      </>
                    ),
                  }))}
              />
              <p className="mt-3 text-[12px] text-mute">Punto hueco = peso de hoy · punto relleno = peso tras aportar. Los bloques que ya superan su objetivo no reciben nada.</p>
            </>
          ) : (
            <div className="text-mute">Escribe cuánto vas a aportar y verás cómo repartirlo.</div>
          )}
        </Card>

        <Card title="Bloques del plan" pad={false} aside={<span className={Math.abs(plan.targetSum - 100) > 0.005 ? "font-[550] text-acc" : "text-mute"}>suman {pp(plan.targetSum, 0)}</span>}>
          {[...state.goals]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((g) => (
              <GoalRow key={g.id} goal={g} used={plan.buckets.find((b) => b.goal?.id === g.id)?.positions.length ?? 0} />
            ))}
          <form
            className="flex items-center gap-2.5 border-t border-line px-5 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void addGoal();
            }}
          >
            <Plus size={14} className="text-mute" />
            <input className="field h-8 flex-1" placeholder="Nuevo bloque" aria-label="Nombre del nuevo bloque" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Btn type="submit" disabled={!newName.trim()}>
              Añadir
            </Btn>
          </form>
        </Card>
      </div>

      <Card title="Qué activo va en cada bloque" pad={false} className="overflow-hidden" note="lo que marques como «fuera del plan» no cuenta en ningún bloque">
        <Table cols="minmax(220px,2fr) 130px 90px 220px 130px" minWidth={860}>
          <THead>
            <L>Activo</L>
            <span>Valor</span>
            <span>Peso</span>
            <L>Bloque</L>
            <L>En el plan</L>
          </THead>
          {[...state.assets]
            .filter((a) => held.has(a.id))
            .sort((a, b) => (d.positions.find((p) => p.asset.id === b.id)?.valueEur ?? 0) - (d.positions.find((p) => p.asset.id === a.id)?.valueEur ?? 0))
            .map((a) => {
              const p = d.positions.find((x) => x.asset.id === a.id);
              const g = state.goals.find((x) => x.id === a.goalId);
              const set = async (goalId: string | null, excluded: boolean) => {
                const res = await assignAsset(a.id, goalId, excluded);
                if (!res.ok) toast(res.error, { tone: "error" });
              };
              return (
                <TRow key={a.id}>
                  <L className="truncate">
                    <button type="button" className="truncate font-[550] hover:text-acc" onClick={() => go(`/activo/${a.id}`)}>
                      {a.name}
                    </button>
                  </L>
                  <span>{eur(p?.valueEur ?? 0, 0)}</span>
                  <span className="text-ink2">{a.planExcluded || !plan.totalEur ? "—" : pct((p?.valueEur ?? 0) / plan.totalEur)}</span>
                  <L className="flex items-center gap-2">
                    <Dot color={g ? seriesColor(g.color) : "var(--line2)"} size={8} />
                    <select className="field h-8" aria-label={`Bloque de ${a.name}`} disabled={a.planExcluded} value={a.goalId ?? ""} onChange={(e) => void set(e.target.value || null, false)}>
                      <option value="">Sin bloque</option>
                      {state.goals.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </L>
                  <L>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-ink2">
                      <input type="checkbox" className="accent-[var(--acc)]" checked={!a.planExcluded} onChange={(e) => void set(a.goalId, !e.target.checked)} />
                      {a.planExcluded ? "fuera del plan" : "cuenta"}
                    </label>
                  </L>
                </TRow>
              );
            })}
        </Table>
      </Card>
    </div>
  );
}
