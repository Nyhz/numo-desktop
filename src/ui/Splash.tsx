import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { setSplashPhase, useApp } from "../data/store.ts";
import { Logo } from "./Logo.tsx";

// Pantalla de carga «Marea» y su transición al Resumen. Todo se calcula a partir
// de un único reloj T (segundos desde que se abre la app):
//
//   Carga    el logo late y un anillo avanza activo a activo         (variable)
//   Listo    el anillo se completa y el logo late                     0,5 s
//   Onda     el anillo se expande; una onda sale del logo a los lados 0,6 s
//   Gráfico  la onda se convierte en la curva de valor del Resumen,
//            el logo viaja a su sitio en el menú y la app entra       0,9 s
//   Datos    se descubren el área y el aportado; la cifra cuenta      1,4 s
//
// Dos variantes: completa cuando hay precios que actualizar, y corta (sin Carga
// ni Listo, con los demás tramos algo más breves) cuando la app se abrió hace poco.

type Cues = { ready: number; flow: number; chart: number; data: number; end: number };
const SHORT: Cues = { ready: 0, flow: 0.4, chart: 0.9, data: 1.7, end: 2.6 };
const fullCues = (ready: number): Cues => ({ ready, flow: ready + 0.5, chart: ready + 1.1, data: ready + 2.0, end: ready + 3.4 });

/** La carga se enseña al menos este rato y, si la red no responde, como mucho este otro. */
const MIN_LOAD = 1.4;
const MAX_LOAD = 15;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const seg = (T: number, a: number, b: number, ease: (t: number) => number) => ease(clamp((T - a) / (b - a)));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** La curva de valor del gráfico principal, en coordenadas de la ventana. */
type Target = { xs: number[]; ys: number[] };
function measureTarget(): Target | null {
  const path = document.querySelector<SVGPathElement>('[data-hero="line"] path');
  const ctm = path?.getScreenCTM();
  if (!path || !ctm) return null;
  const length = path.getTotalLength();
  if (!(length > 0)) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= 900; i++) {
    const p = path.getPointAtLength((length * i) / 900).matrixTransform(ctm);
    if (!xs.length || p.x > xs[xs.length - 1]!) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  return xs.length > 2 ? { xs, ys } : null;
}
function yAt(t: Target, x: number): number {
  const { xs, ys } = t;
  if (x <= xs[0]!) return ys[0]!;
  let lo = 0;
  let hi = xs.length - 1;
  if (x >= xs[hi]!) return ys[hi]!;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  return lerp(ys[lo]!, ys[hi]!, (x - xs[lo]!) / (xs[hi]! - xs[lo]!));
}

/** Parámetros de prueba: ?splash=off la quita, ?splash=full enseña la completa con la cartera de ejemplo. */
const param = (() => {
  if ((window as unknown as { __NUMO_NO_SPLASH__?: boolean }).__NUMO_NO_SPLASH__) return "off";
  return new URLSearchParams(location.search).get("splash");
})();
const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const disabled = param === "off" || reduced;

export function Splash() {
  const status = useApp((s) => s.status);
  const splash = useApp((s) => s.splash);
  const syncing = useApp((s) => s.syncing);
  const progress = useApp((s) => s.progress);
  const names = useApp((s) => (s.demo ?? s.loaded).state.assets);
  const [T, setT] = useState(0);
  const start = useRef(performance.now());
  const ready = useRef<number | null>(null);
  const sawSync = useRef(false);
  const target = useRef<Target | null>(null);
  const rail = useRef<{ x: number; y: number } | null>(null);

  const simulated = param === "full";
  const mode = simulated ? "full" : (splash?.mode ?? "full");
  const phase = status === "loading" ? "load" : (splash?.phase ?? "done");
  const active = !disabled && status !== "error" && phase !== "done";

  // La app que hay debajo se entera de la fase por un atributo en <html> (ver styles.css).
  useLayoutEffect(() => {
    if (active) document.documentElement.dataset.splash = phase;
    else delete document.documentElement.dataset.splash;
    return () => void delete document.documentElement.dataset.splash;
  }, [active, phase]);
  useEffect(() => {
    if (disabled) setSplashPhase("done");
  }, [splash?.mode]);

  useEffect(() => {
    if (!active) return;
    let id = requestAnimationFrame(function tick() {
      setT((performance.now() - start.current) / 1000);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [active]);

  if (!active) return null;

  // Avance de la carga: el real mientras se descargan precios, o uno de mentira en la prueba.
  const fake = simulated ? { done: Math.min(names.length, Math.floor((T - 0.3) / 0.3) + 1), total: names.length } : null;
  const load = fake ? { name: names[Math.max(0, fake.done - 1)]?.name ?? "", ...fake } : progress;
  if (syncing) sawSync.current = true;
  if (mode === "full" && ready.current == null && status === "ready") {
    const finished = fake ? T >= 0.3 + 0.3 * fake.total : sawSync.current ? !syncing : T > 2.5;
    if ((finished && T >= MIN_LOAD) || T >= MAX_LOAD) ready.current = T;
  }
  const cues = status !== "ready" ? null : mode === "short" ? SHORT : ready.current == null ? null : fullCues(ready.current);

  // En cuanto la onda empieza a crecer hace falta saber hasta dónde llega el gráfico.
  if (cues && T >= cues.flow && !target.current) target.current = measureTarget();
  // Al empezar el tramo «Gráfico» se mide dónde está la curva y dónde el logo del menú.
  if (cues && T >= cues.chart && phase === "load") {
    target.current = measureTarget();
    const r = document.querySelector("[data-splash-logo]")?.getBoundingClientRect();
    rail.current = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 32, y: 32 };
    queueMicrotask(() => setSplashPhase("enter"));
  } else if (cues && T >= cues.end) {
    queueMicrotask(() => setSplashPhase("done"));
  } else if (cues && T >= cues.data && phase === "enter") {
    queueMicrotask(() => setSplashPhase("data"));
  }

  const [vw, vh] = [window.innerWidth, window.innerHeight];
  const [cx, cy] = [vw / 2, Math.round(vh * 0.41)];
  // Hasta que la base de datos está cargada no se sabe qué variante toca: solo el logo.
  const full = mode === "full" && status === "ready";
  const loading = !cues;
  const t = target.current;

  // Logo: late en «Listo» y viaja al menú en «Gráfico».
  const bump = cues && full ? seg(T, cues.ready, cues.ready + 0.2, easeBack) - seg(T, cues.ready + 0.2, cues.ready + 0.45, easeInOut) : 0;
  const g = cues ? seg(T, cues.chart, cues.chart + 0.85, easeInOut) : 0;
  const scale = lerp(2.556 * (1 + 0.11 * bump), 1, g);
  const to = rail.current ?? { x: cx, y: cy };

  // Anillo: se completa y se va como una onda expansiva.
  const rip = cues ? seg(T, cues.flow, cues.flow + 0.8, easeOut) : 0;
  const ring = loading ? (load && load.total ? load.done / load.total : 0) : 1;

  // La onda que sale del logo y se convierte en la curva.
  const grow = cues ? seg(T, cues.flow, cues.chart, easeOut) : 0;
  const k = cues ? seg(T, cues.chart, cues.data, easeInOut) : 0;
  const [left, right] = t ? [t.xs[0]!, t.xs[t.xs.length - 1]!] : [28, vw - 28];
  const half = 46 + grow * Math.max(cx - left, right - cx);
  const [x0, x1] = [Math.max(left, cx - half), Math.min(right, cx + half)];
  const phi = (((cues ? Math.min(T, cues.data) - cues.flow : 0) / 1.8) * 2 * Math.PI) % (2 * Math.PI);
  let line = "";
  if (cues && T >= cues.flow && T < cues.data) {
    // Bastantes puntos para que, al terminar, coincida con la curva real y el relevo no se note.
    for (let i = 0; i <= 420; i++) {
      const x = lerp(x0, x1, i / 420);
      const wave = cy + 3 + 5.2 * Math.sin(((x - cx) / 51.75) * 2 * Math.PI + phi);
      line += `${i ? "L" : "M"}${x.toFixed(1)} ${(t ? lerp(wave, yAt(t, x), k) : wave).toFixed(1)}`;
    }
  }

  const veil = cues ? 1 - seg(T, cues.chart + 0.05, cues.chart + 0.65, easeInOut) : 1;
  const textOut = cues ? 1 - seg(T, cues.chart, cues.chart + 0.3, easeInOut) : 1;
  const count = load?.total ?? 0;

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden"
      style={{ pointerEvents: cues && T >= cues.chart ? "none" : "auto" }}
      onClick={() => setSplashPhase("done")}
      title={loading ? "Pulsa para saltar la carga" : undefined}
      aria-hidden
    >
      <div className="absolute inset-0 bg-panel" style={{ opacity: veil }} />

      {line && (
        <svg
          viewBox={`0 0 ${vw} ${vh}`}
          className="absolute inset-0 size-full"
          style={{ opacity: t ? 1 : 1 - k, filter: k < 1 ? `drop-shadow(0 0 ${(10 * (1 - k)).toFixed(1)}px color-mix(in oklab, var(--acc) 55%, transparent))` : undefined }}
        >
          <path d={line} fill="none" stroke="var(--acc)" strokeWidth={lerp(5.75, 1.9, k)} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}

      {full && rip < 1 && (
        <svg viewBox="0 0 148 148" className="absolute size-[148px]" style={{ left: cx - 74, top: cy - 74, opacity: 1 - rip, transform: `scale(${1 + 0.9 * rip})` }}>
          {/* El anillo rodea la ficha del logo (92 px, con sus esquinas) sin tocarla. */}
          <g transform="rotate(-90 74 74)" fill="none" strokeWidth="2">
            <circle cx="74" cy="74" r="70" stroke="var(--line)" />
            <circle
              cx="74"
              cy="74"
              r="70"
              stroke="var(--acc)"
              strokeLinecap="round"
              strokeDasharray="439.8"
              strokeDashoffset={439.8 * (1 - ring)}
              style={{ transition: "stroke-dashoffset .4s cubic-bezier(.2,.8,.2,1)" }}
            />
          </g>
        </svg>
      )}

      {full && textOut > 0 && (
        <div className="absolute inset-x-0 text-center" style={{ top: cy + 100, opacity: textOut }}>
          <div className="wide text-[15px] font-semibold">{loading ? "Actualizando precios" : "Precios al día"}</div>
          <div className="mt-1 text-[12.5px] text-mute">
            {loading ? (load && load.total ? `${load.name} · ${load.done} de ${load.total}` : " ") : count ? `${count} ${count === 1 ? "activo" : "activos"} · ahora mismo` : " "}
          </div>
        </div>
      )}

      <div
        className="absolute size-9"
        style={{
          left: cx - 18,
          top: cy - 18,
          transform: `translate(${(to.x - cx) * g}px, ${(to.y - cy) * g}px) scale(${scale})`,
        }}
      >
        <Logo size={36} flow={!cues || T < cues.data} />
      </div>
    </div>
  );
}
