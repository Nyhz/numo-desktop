import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { setSplashPhase, useApp } from "../data/store.ts";
import logo from "../assets/logo.png";
import { Logo } from "./Logo.tsx";

// Pantalla de carga «Marea» y su transición al Resumen. Todo se calcula a partir
// de un único reloj T (segundos desde que se abre la app):
//
//   Carga    el logo empieza apagado y se llena de abajo arriba: el nivel es
//            el avance, y su borde, una línea luminosa que ondula   (variable)
//   Listo    el nivel sube del todo, el logo late y lo cruza un destello 0,6 s
//   Onda     una línea luminosa sale de los bordes del logo a los lados  0,6 s
//   Gráfico  la línea se convierte en la curva de valor del Resumen,
//            el logo viaja a su sitio en el menú y la app entra          0,9 s
//   Datos    se descubren el área y el aportado; la cifra cuenta         1,4 s
//
// Dos variantes: completa cuando hay precios que actualizar, y corta (sin Carga
// ni Listo, con los demás tramos algo más breves) cuando la app se abrió hace poco.

type Cues = { ready: number; flow: number; chart: number; data: number; end: number };
const SHORT: Cues = { ready: 0, flow: 0.4, chart: 0.9, data: 1.7, end: 2.6 };
const fullCues = (ready: number): Cues => ({ ready, flow: ready + 0.6, chart: ready + 1.2, data: ready + 2.1, end: ready + 3.5 });

/** La carga se enseña al menos este rato y, si la red no responde, como mucho este otro. */
const MIN_LOAD = 1.4;
const MAX_LOAD = 15;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const seg = (T: number, a: number, b: number, ease: (t: number) => number) => ease(clamp((T - a) / (b - a)));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** La ola de la marea: periodo 60, de x = −60 a 180 en el lienzo de 120 del logo. */
const TIDE = "M-60 0q15-4 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0";

/** La curva de valor del gráfico principal, en coordenadas de la ventana. */
type Target = { xs: number[]; ys: number[]; d: string };
const heroLine = () => document.querySelector<SVGPathElement>('[data-hero="line"] path');
function measureTarget(): Target | null {
  const path = heroLine();
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
  return xs.length > 2 ? { xs, ys, d: path.getAttribute("d") ?? "" } : null;
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
  // El nivel del relleno sigue al avance real sin saltos.
  const level = useRef({ value: 0, at: 0 });

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
  // La curva puede cambiar mientras tanto (en Rentabilidad llega después el índice, que
  // cambia la escala): si cambia, se vuelve a medir y la onda va hacia la nueva.
  if (cues && T >= cues.flow && T < cues.data && (!target.current || target.current.d !== (heroLine()?.getAttribute("d") ?? ""))) target.current = measureTarget();
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

  // Nivel de la marea: lo actualizado entre el total, suavizado; al terminar sube del todo.
  const goal = loading ? (load && load.total ? load.done / load.total : 0) : 1;
  level.current.value += (goal - level.current.value) * (1 - Math.exp(-Math.max(0, T - level.current.at) / 0.16));
  level.current.at = T;
  const ring = level.current.value;
  const fill = cues ? seg(T, cues.ready, cues.ready + 0.35, easeInOut) : 0;
  const tideY = lerp(120 * (0.84 - 0.68 * ring), -10, fill);
  const tideX = -((T / 2.2) % 1) * 60;
  const sheen = cues && full ? seg(T, cues.ready + 0.1, cues.ready + 0.6, easeOut) : 0;

  // Logo: late en «Listo» y viaja al menú en «Gráfico». En la carga mide 148 px; en el menú, 44.
  const bump = cues && full ? seg(T, cues.ready, cues.ready + 0.2, easeBack) - seg(T, cues.ready + 0.2, cues.ready + 0.45, easeInOut) : 0;
  const g = cues ? seg(T, cues.chart, cues.chart + 0.85, easeInOut) : 0;
  const scale = lerp(3.364 * (1 + 0.07 * bump), 1, g);
  const to = rail.current ?? { x: cx, y: cy };

  // La línea que sale del logo y se convierte en la curva. No se dibuja detrás del logo:
  // el hueco se cierra cuando este se va al menú.
  const grow = cues ? seg(T, cues.flow, cues.chart, easeOut) : 0;
  const k = cues ? seg(T, cues.chart, cues.data, easeInOut) : 0;
  const [left, right] = t ? [t.xs[0]!, t.xs[t.xs.length - 1]!] : [28, vw - 28];
  const half = 44 + grow * Math.max(cx - left, right - cx);
  const [x0, x1] = [Math.max(left, cx - half), Math.min(right, cx + half)];
  const gap = 44 * (1 - (cues ? seg(T, cues.chart, cues.chart + 0.4, easeInOut) : 0));
  const phi = ((cues ? Math.min(T, cues.data) : 0) / 2.2) * 2 * Math.PI;
  let line = "";
  if (cues && T >= cues.flow && T < cues.data) {
    // Bastantes puntos para que, al terminar, coincida con la curva real y el relevo no se note.
    let pen = false;
    for (let i = 0; i <= 420; i++) {
      const x = lerp(x0, x1, i / 420);
      if (Math.abs(x - cx) < gap) {
        pen = false;
        continue;
      }
      // Sale a la altura por la que la línea del logo deja su silueta: 7 px sobre el centro.
      const wave = cy - 7 + 4 * Math.sin(((x - cx) / 74) * 2 * Math.PI + phi);
      line += `${pen ? "L" : "M"}${x.toFixed(1)} ${(t ? lerp(wave, yAt(t, x), k) : wave).toFixed(1)}`;
      pen = true;
    }
  }

  const veil = cues ? 1 - seg(T, cues.chart + 0.05, cues.chart + 0.65, easeInOut) : 1;
  const textOut = cues ? 1 - seg(T, cues.chart, cues.chart + 0.3, easeInOut) : 1;
  const count = load?.total ?? 0;
  const width = lerp(2.6, 1.9, k);

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
          style={{ opacity: t ? 1 : 1 - k, filter: k < 1 ? `drop-shadow(0 0 ${(8 * (1 - k)).toFixed(1)}px color-mix(in oklab, var(--glow) 70%, transparent))` : undefined }}
        >
          {/* Debajo, el trazo en el color que tendrá la curva; encima, la luz, que se apaga al llegar. */}
          <path d={line} fill="none" stroke="var(--acc)" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
          <path d={line} fill="none" stroke="var(--glow-line)" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" opacity={1 - k} />
        </svg>
      )}

      {full && textOut > 0 && (
        <div className="absolute inset-x-0 text-center" style={{ top: cy + 88, opacity: textOut }}>
          <div className="wide text-[15px] font-semibold">{loading ? "Actualizando precios" : "Precios al día"}</div>
          <div className="mt-1 h-[18px] text-[12.5px] text-mute">
            {loading ? (load && load.total ? `${load.name} · ${load.done} de ${load.total}` : " ") : count ? `${count} ${count === 1 ? "activo" : "activos"} · ahora mismo` : " "}
          </div>
        </div>
      )}

      <div
        className="absolute size-11"
        style={{
          left: cx - 22,
          top: cy - 22,
          transform: `translate(${(to.x - cx) * g}px, ${(to.y - cy) * g}px) scale(${scale})`,
        }}
      >
        {/* Halo: crece con el avance y se queda atrás cuando el logo se va al menú. */}
        <div
          className="absolute -inset-2.5 rounded-full"
          style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--accent) 20%, transparent), transparent)", opacity: (0.2 + 0.8 * ring) * (1 - g) }}
        />
        <Logo size={44} />
        {/* Lo que falta por llenar: un velo del color del fondo sobre la ola, y la línea luminosa en su
            borde. Van en el mismo grupo, que es el que se mueve, y recortados con la silueta del logo. */}
        <svg viewBox="0 0 120 120" className="absolute inset-0 size-full overflow-visible">
          <defs>
            <mask id="splash-logo-shape" style={{ maskType: "alpha" }}>
              <image href={logo} width="120" height="120" />
            </mask>
          </defs>
          <g mask="url(#splash-logo-shape)">
            <g transform={`translate(${tideX.toFixed(2)} ${tideY.toFixed(2)})`}>
              <path d={`${TIDE}V-200H-60Z`} fill="var(--panel)" fillOpacity={0.86} />
              <path d={TIDE} fill="none" stroke="var(--glow-line)" strokeWidth={1.4} opacity={(ring > 0.01 ? 1 : 0) * (1 - fill)} style={{ filter: "drop-shadow(0 0 2px var(--glow))" }} />
            </g>
          </g>
        </svg>
        {sheen > 0 && sheen < 1 && (
          <div className="absolute inset-0 overflow-hidden" style={{ maskImage: `url(${logo})`, WebkitMaskImage: `url(${logo})`, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }}>
            <div className="absolute inset-0" style={{ background: "linear-gradient(105deg, transparent 35%, rgba(255,255,255,.7) 50%, transparent 65%)", transform: `translateX(${-100 + 200 * sheen}%)` }} />
          </div>
        )}
      </div>
    </div>
  );
}
