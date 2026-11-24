import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { parseNumber } from "../../shared/csv.ts";
import { buildPlan, planContribution } from "../../shared/engine/plan.ts";
import type { Goal } from "../../shared/types.ts";
import { contributionSpan, offAfter } from "../charts/plan-math.ts";
import { NO_BLOCK, PlanBars, PlanCurve, PlanSplit, type PlanHot } from "../charts/plan.tsx";
import { assignAsset, derive, removeGoal, saveGoal, useApp } from "../data/store.ts";
import { eur, num, pct, seriesColor } from "../lib/format.ts";
import { Btn, Card, Dot, Empty, IconBtn, Kpi, Kpis, toast } from "../ui/kit.tsx";
import { L, THead, TRow, Table, Welcome } from "./common.tsx";

const pp = (v: number, d = 1) => `${num(v, d, d)} %`;
/** Atajos de importe para la próxima aportación. */
const SHORTCUTS = [500, 1000, 2500, 5000];
const AMOUNT_KEY = "caudal.aportacion";

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
      <input className="field h-8 min-w-0 flex-1" aria-label="Nombre del bloque" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={onKey} />
      <div className="relative w-[84px] shrink-0">
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

  // Los pasos del stepper se ven al instante y se guardan en orden, uno detrás de otro:
  // `draft` es el objetivo pulsado que el almacén aún no ha confirmado.
  const [draft, setDraft] = useState<Record<string, number>>({});
  const saving = useRef<Promise<void>>(Promise.resolve());
  const goals = useMemo(() => state.goals.map((g) => (draft[g.id] == null ? g : { ...g, targetPct: draft[g.id]! })), [state.goals, draft]);
  useEffect(() => {
    setDraft((cur) => {
      const left = Object.entries(cur).filter(([id, v]) => state.goals.some((g) => g.id === id && g.targetPct !== v));
      return left.length === Object.keys(cur).length ? cur : Object.fromEntries(left);
    });
  }, [state.goals]);

  const plan = useMemo(() => buildPlan(d.positions, goals), [d.positions, goals]);
  const [amountText, setAmountText] = useState(() => localStorage.getItem(AMOUNT_KEY) ?? num(SHORTCUTS[1]!, 0));
  const [typing, setTyping] = useState(false);
  const [newName, setNewName] = useState("");
  const [hot, setHot] = useState<PlanHot>(null);

  const parsed = parseNumber(amountText.replace(/\./g, ""));
  const amount = parsed != null && parsed > 0 ? parsed : 0;
  const alloc = useMemo(() => planContribution(plan, amount), [plan, amount]);
  const after = useMemo(() => offAfter(plan, amount, alloc), [plan, amount, alloc]);

  if (state.accounts.length === 0) return <Welcome />;

  const writeAmount = (text: string) => {
    setAmountText(text);
    localStorage.setItem(AMOUNT_KEY, text);
  };
  const setAmount = (v: number) => {
    setTyping(false);
    writeAmount(num(v, 2));
  };

  const addGoal = async () => {
    if (!newName.trim()) return;
    const res = await saveGoal({ name: newName, targetPct: Math.max(0, Math.round(100 - plan.targetSum)) });
    if (!res.ok) return toast(res.error, { tone: "error" });
    setNewName("");
  };

  const stepTarget = (goal: Goal, delta: number) => {
    const next = Math.round(Math.max(0, Math.min(100, goal.targetPct + delta)) * 100) / 100;
    if (next === goal.targetPct) return;
    setDraft((cur) => ({ ...cur, [goal.id]: next }));
    saving.current = saving.current.then(async () => {
      const res = await saveGoal({ name: goal.name, targetPct: next }, goal.id);
      if (res.ok) return;
      toast(res.error, { tone: "error" });
      setDraft((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => id !== goal.id)));
    });
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

  const [offInt, offDec = "0"] = num(plan.offPct, 1, 1).split(",");
  const offEur = (plan.offPct / 100) * plan.totalEur;
  const sumOff = Math.abs(plan.targetSum - 100) > 0.005;
  const held = new Set(d.positions.map((p) => p.asset.id));
  const withGoal = plan.buckets.filter((b) => b.goal);
  const under = [...withGoal].sort((x, y) => y.gapEur - x.gapEur)[0];
  const over = [...withGoal].sort((x, y) => x.gapEur - y.gapEur)[0];
  const loose = plan.buckets.find((b) => !b.goal);
  const custom = amount > 0 && !SHORTCUTS.includes(amount);
  // El campo de importe exacto solo enseña cifra cuando no coincide con un atajo (o mientras se escribe).
  const shown = custom || typing ? amountText : "";
  const amountLabel = eur(amount, Number.isInteger(amount) ? 0 : 2);
  const span = contributionSpan(plan, amount, Math.max(...SHORTCUTS));
  const receives = alloc.some((a) => a.amountEur > 0);

  return (
    <div className="screen flex flex-col gap-5">
      <section className="px-1 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[12px] text-mute">Fuera de sitio respecto al plan</div>
            <div className="mt-0.5 text-[56px] leading-[1.05] font-medium tracking-[-0.02em]" style={{ fontStretch: "108%" }}>
              {offInt}
              <span className="text-mute">,{offDec} %</span>
            </div>
            <div className="mt-1.5 flex min-h-5 flex-wrap items-baseline gap-2.5 text-[13.5px]">
              <span className="text-ink2">{eur(offEur, 0)} habría que mover para cumplirlo exactamente</span>
              {sumOff && <span className="font-[550] text-acc">· los objetivos suman {pp(plan.targetSum, 0)}, no 100 %</span>}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 pb-0.5">
            <div className="text-[12px] text-mute">Próxima aportación</div>
            <div className="flex flex-wrap items-center justify-end gap-3.5">
              <span className="text-[30px] leading-[1.1] font-medium tracking-[-0.01em] whitespace-nowrap text-up" style={{ fontStretch: "108%" }}>
                +{amountLabel}
              </span>
              <div role="group" aria-label="Importe de la próxima aportación" className="flex items-center gap-0.5 rounded-full bg-wash p-[3px]">
                {SHORTCUTS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={amount === v}
                    onClick={() => setAmount(v)}
                    className={`rounded-full px-[11px] py-1 text-[12px] font-medium whitespace-nowrap transition-[background,color] duration-200 active:scale-[.96] ${
                      amount === v ? "bg-raised text-ink shadow-[var(--shadow-active)]" : "text-mute hover:text-ink"
                    }`}
                  >
                    {eur(v, 0)}
                  </button>
                ))}
                {/* Importe exacto: una píldora más del grupo, activa cuando el importe no es ninguno de los atajos. */}
                <label
                  className={`flex cursor-text items-center gap-1 rounded-full py-1 pr-[11px] pl-2 text-[12px] font-medium transition-[background,color] duration-200 focus-within:outline-2 focus-within:outline-acc ${
                    custom ? "bg-raised text-ink shadow-[var(--shadow-active)]" : "text-mute hover:text-ink"
                  }`}
                >
                  <input
                    className="bg-transparent text-right text-ink placeholder:text-mute"
                    // Tan ancho como lo escrito; el contorno de foco lo dibuja la píldora entera.
                    style={{ width: `${Math.max(4, shown.length)}ch`, outline: "none" }}
                    inputMode="decimal"
                    placeholder="otro"
                    aria-label="Importe exacto de la aportación"
                    value={shown}
                    onChange={(e) => {
                      setTyping(true);
                      writeAmount(e.target.value);
                    }}
                    onBlur={() => {
                      setTyping(false);
                      if (amount > 0) writeAmount(num(amount, 2));
                    }}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  />
                  €
                </label>
              </div>
            </div>
            <div className="text-[12.5px] whitespace-nowrap text-ink2">
              {!receives ? (
                "elige un importe y verás cuánto corrige"
              ) : after < plan.offPct - 0.005 ? (
                <>
                  la desviación bajaría de <span className="font-semibold text-ink">{pp(plan.offPct)}</span> a <span className="font-semibold text-up">{pp(after)}</span>
                </>
              ) : (
                <>
                  la desviación se quedaría en <span className="font-semibold text-ink">{pp(after)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <PlanBars plan={plan} alloc={alloc} hot={hot} onHover={setHot} onStep={stepTarget} />
      </section>

      <Kpis>
        <Kpi
          label="Bloques"
          note={
            <>
              <span className={sumOff ? "font-[550] text-acc" : ""}>suman {pp(plan.targetSum, 0)}</span> · en el plan {eur(plan.totalEur, 0)}
            </>
          }
        >
          {state.goals.length}
        </Kpi>
        <Kpi label="Donde más falta" note={under && under.gapEur > 0 ? under.goal!.name : "ningún bloque por debajo"}>
          <span className={under && under.gapEur > 0 ? "text-acc" : ""}>{eur(Math.max(0, under?.gapEur ?? 0), 0)}</span>
        </Kpi>
        <Kpi label="Donde más sobra" note={over && over.gapEur < 0 ? over.goal!.name : "ningún bloque por encima"}>
          {eur(Math.max(0, -(over?.gapEur ?? 0)), 0)}
        </Kpi>
        <Kpi label="Sin bloque" note={plan.excluded.length ? `posiciones por asignar · fuera del plan ${eur(plan.excludedEur, 0)} (${plan.excluded.length})` : "posiciones por asignar"}>
          {eur(loose?.valueEur ?? 0, 0)}
        </Kpi>
      </Kpis>

      <div className="grid items-start gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
        <Card title="Cuánto corrige cada euro" note="pulsa o arrastra para elegir el importe">
          <PlanCurve plan={plan} amount={amount} max={span} onPick={setAmount} />
          <p className="mt-3 text-[12px] text-pretty text-mute">Cuanto más baja la curva, más cerca del plan. Aportando solo no siempre se llega a cero: lo que sobra en un bloque no se vende.</p>
        </Card>

        <Card title={`Dónde poner los ${amountLabel}`} note="sin vender nada">
          {receives ? (
            <>
              <PlanSplit alloc={alloc} amount={amount} />
              <p className="mt-2.5 text-[12px] text-pretty text-mute">Se rellena primero lo más retrasado. Los bloques que ya superan su objetivo no reciben nada.</p>
            </>
          ) : (
            <div className="text-mute">{amount > 0 ? "Ningún bloque tiene objetivo todavía: dale un peso a alguno y verás cómo repartirlo." : "Elige o escribe cuánto vas a aportar y verás cómo repartirlo."}</div>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <Card title="Bloques del plan" pad={false} className="flex-[1_1_340px]" aside={<span className={sumOff ? "font-[550] text-acc" : "text-mute"}>suman {pp(plan.targetSum, 0)}</span>}>
          {[...goals]
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
            <Plus size={14} className="shrink-0 text-mute" />
            <input className="field h-8 min-w-0 flex-1" placeholder="Nuevo bloque" aria-label="Nombre del nuevo bloque" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Btn type="submit" disabled={!newName.trim()}>
              Añadir
            </Btn>
          </form>
        </Card>

        <Card title="Qué activo va en cada bloque" pad={false} className="flex-[2.4_1_560px] overflow-hidden" note="lo que marques como «fuera del plan» no cuenta en ningún bloque">
          <div onMouseLeave={() => setHot(null)}>
            <Table cols="minmax(150px,1fr) 92px 62px 184px 122px" minWidth={700}>
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
                  const block = a.planExcluded ? null : (g?.id ?? NO_BLOCK);
                  const set = async (goalId: string | null, excluded: boolean) => {
                    const res = await assignAsset(a.id, goalId, excluded);
                    if (!res.ok) toast(res.error, { tone: "error" });
                  };
                  return (
                    <TRow key={a.id} linked={block != null && hot?.block === block} onMouseEnter={() => setHot(block ? { block, asset: a.id } : null)}>
                      <L className="truncate">
                        <button type="button" className="max-w-full truncate font-[550] hover:text-acc" onClick={() => go(`/activo/${a.id}`)}>
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
                        <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] whitespace-nowrap text-ink2">
                          <input type="checkbox" className="accent-[var(--acc)]" checked={!a.planExcluded} onChange={(e) => void set(a.goalId, !e.target.checked)} />
                          {a.planExcluded ? "fuera del plan" : "cuenta"}
                        </label>
                      </L>
                    </TRow>
                  );
                })}
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
