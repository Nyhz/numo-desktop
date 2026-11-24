import { ArrowLeftRight, Check, ChevronDown, FileText, House, Landmark, Layers, LineChart, Moon, Plus, Radar, RefreshCw, Settings, Sun, Target } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Route, Router, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { backend, isExample, setDemo, setScope, sync, syncOnFocus, useApp, useHealth } from "./data/store.ts";
import { Dialogs } from "./features/dialogs.tsx";
import { ago, seriesColor } from "./lib/format.ts";
import { Activo } from "./pages/Activo.tsx";
import { Activos } from "./pages/Activos.tsx";
import { Ajustes } from "./pages/Ajustes.tsx";
import { Cuentas } from "./pages/Cuentas.tsx";
import { Informes } from "./pages/Informes.tsx";
import { Inmuebles } from "./pages/Inmuebles.tsx";
import { Operaciones } from "./pages/Operaciones.tsx";
import { Plan } from "./pages/Plan.tsx";
import { Posiciones } from "./pages/Posiciones.tsx";
import { Resumen } from "./pages/Resumen.tsx";
import { openDialog, useDialog } from "./ui/dialogs.ts";
import { Btn, Dot, Toaster } from "./ui/kit.tsx";
import { Logo } from "./ui/Logo.tsx";
import { Splash } from "./ui/Splash.tsx";

type Nav = { href: string; label: string; icon: typeof LineChart; scoped?: boolean };
const NAV_MAIN: Nav[] = [
  { href: "/", label: "Resumen", icon: LineChart, scoped: true },
  { href: "/posiciones", label: "Posiciones", icon: Layers, scoped: true },
  { href: "/operaciones", label: "Operaciones", icon: ArrowLeftRight, scoped: true },
  { href: "/plan", label: "Plan", icon: Target },
  { href: "/inmuebles", label: "Inmuebles", icon: House },
  { href: "/informes", label: "Informes", icon: FileText, scoped: true },
];
const NAV_SUB: Nav[] = [
  { href: "/activos", label: "Activos", icon: Radar },
  { href: "/cuentas", label: "Cuentas", icon: Landmark },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

const isMac = /Mac/i.test(navigator.platform);
const matches = (n: Nav, loc: string) => (n.href === "/" ? loc === "/" : loc.startsWith(n.href) || (n.href === "/posiciones" && loc.startsWith("/activo/")));

function RailLink({ nav, alerts = 0 }: { nav: Nav; alerts?: number }) {
  const [loc] = useLocation();
  const active = matches(nav, loc);
  const Icon = nav.icon;
  const label = alerts ? `${nav.label} · ${alerts === 1 ? "1 precio necesita" : `${alerts} precios necesitan`} atención` : nav.label;
  return (
    <Link
      href={nav.href}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`relative grid size-10 place-items-center rounded-[11px] transition-[background,color] duration-150 active:scale-[.94] ${
        active ? "bg-raised text-acc shadow-[var(--shadow-active)]" : "text-mute hover:text-ink"
      }`}
    >
      <Icon size={19} strokeWidth={1.8} />
      {alerts > 0 && <span className="absolute top-2 right-2 size-1.5 rounded-full bg-acc" />}
    </Link>
  );
}

export function useTheme(): [boolean, () => void] {
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light");
  const flip = () => {
    const next = !light;
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    localStorage.setItem("caudal.theme", next ? "light" : "dark");
    setLight(next);
    window.dispatchEvent(new Event("caudal-theme"));
  };
  useEffect(() => {
    const onChange = () => setLight(document.documentElement.dataset.theme === "light");
    window.addEventListener("caudal-theme", onChange);
    return () => window.removeEventListener("caudal-theme", onChange);
  }, []);
  return [light, flip];
}

function AccountFilter() {
  const accounts = useApp((s) => (s.demo ?? s.loaded).state.accounts);
  const scope = useApp((s) => s.scope);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (accounts.length < 2) return null;

  const picked = scope ? accounts.filter((a) => scope.includes(a.id)) : [];
  const label = !scope ? "Todas las cuentas" : picked.length === 1 ? picked[0]!.name : `${picked.length} cuentas`;
  const toggle = (id: string) => {
    const cur = new Set(scope ?? []);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    setScope(cur.size === accounts.length ? null : [...cur]);
  };
  const row = "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] hover:bg-wash";

  return (
    <div ref={box} className="relative flex-none">
      <Btn onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} className="!gap-2">
        {picked.length === 1 && <Dot color={seriesColor(picked[0]!.color)} />}
        {label}
        <ChevronDown size={11} className="text-mute" />
      </Btn>
      {open && (
        <div role="listbox" aria-multiselectable className="absolute right-0 z-30 mt-1.5 w-64 rounded-xl border border-line2 bg-raised p-1" style={{ boxShadow: "var(--shadow-pop)" }}>
          <button type="button" role="option" aria-selected={!scope} className={row} onClick={() => setScope(null)}>
            <span className="w-3.5 text-acc">{!scope && <Check size={14} strokeWidth={2.6} />}</span>
            Todas las cuentas
          </button>
          <div className="mx-2 my-1 border-t border-line" />
          {accounts.map((a) => {
            const on = !!scope?.includes(a.id);
            return (
              <button key={a.id} type="button" role="option" aria-selected={on} className={row} onClick={() => toggle(a.id)}>
                <span className="w-3.5 text-acc">{on && <Check size={14} strokeWidth={2.6} />}</span>
                <Dot color={seriesColor(a.color)} />
                <span className="truncate">{a.name}</span>
                {a.archived && <span className="ml-auto text-[11.5px] text-mute">archivada</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SyncButton() {
  const syncing = useApp((s) => s.syncing);
  const issues = useApp((s) => s.issues);
  const lastSync = useApp((s) => s.loaded.state.lastSync);
  const example = useApp((s) => isExample(s));
  if (example) return null;
  const title = syncing ? "Actualizando precios…" : `Precios actualizados ${ago(lastSync)}${issues.length ? ` · ${issues.length} avisos (ver Activos)` : ""}. Pulsa para actualizar ahora.`;
  return (
    <button
      type="button"
      title={title}
      aria-label="Actualizar precios"
      disabled={syncing}
      onClick={() => void sync(true)}
      className="relative grid size-10 place-items-center rounded-[11px] text-mute transition-colors hover:text-ink"
    >
      <RefreshCw size={17} strokeWidth={1.8} className={syncing ? "animate-spin" : ""} />
      {issues.length > 0 && !syncing && <span className="absolute top-2 right-2 size-1.5 rounded-full bg-acc" />}
    </button>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const hasAccounts = useApp((s) => (s.demo ?? s.loaded).state.accounts.length > 0);
  const demo = useApp((s) => s.demo != null);
  const example = useApp((s) => isExample(s));
  const dialog = useDialog();
  const [light, flipTheme] = useTheme();
  const { attention, fxLate } = useHealth();
  const here = [...NAV_MAIN, ...NAV_SUB].find((n) => matches(n, loc));

  // Al volver a la ventana se mira si otro equipo ha dejado cambios.
  useEffect(() => {
    window.addEventListener("focus", syncOnFocus);
    return () => window.removeEventListener("focus", syncOnFocus);
  }, []);

  // «N» abre una operación nueva desde cualquier pantalla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (dialog || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key.toLowerCase() === "n" && hasAccounts) {
        e.preventDefault();
        openDialog({ kind: "tx" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, hasAccounts]);

  return (
    <div className="flex h-full bg-bg transition-colors duration-300">
      {/* Rail: solo iconos. En macOS se ensancha y deja hueco arriba: los botones de la ventana
          ocupan unos 70 px de ancho y no deben quedar sobre el panel. */}
      <nav data-tauri-drag-region className={`flex flex-none flex-col items-center gap-1.5 pb-3.5 ${backend.native && isMac ? "w-[78px] pt-[46px]" : "w-16 pt-3.5"}`} aria-label="Secciones">
        <div data-tauri-drag-region data-splash-logo className="mb-3.5 size-9 rounded-full" style={{ boxShadow: "0 0 0 1px var(--line2), var(--shadow)" }} title="Caudal">
          <Logo size={36} className="pointer-events-none" />
        </div>
        {NAV_MAIN.map((n) => (
          <RailLink key={n.href} nav={n} />
        ))}
        <div data-tauri-drag-region className="flex-1 self-stretch" />
        {NAV_SUB.map((n) => (
          <RailLink key={n.href} nav={n} alerts={n.href === "/activos" ? attention + fxLate : 0} />
        ))}
        <div className="my-1.5 h-px w-6 bg-line2" />
        <SyncButton />
        <button
          type="button"
          title={light ? "Cambiar a tema oscuro" : "Cambiar a tema claro"}
          aria-label="Cambiar tema"
          onClick={flipTheme}
          className="grid size-10 place-items-center rounded-[11px] text-mute transition-colors hover:text-ink"
        >
          {light ? <Moon size={18} strokeWidth={1.8} /> : <Sun size={18} strokeWidth={1.8} />}
        </button>
      </nav>

      <main
        className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-line bg-panel transition-colors duration-300"
        style={{ boxShadow: "var(--panel-shadow)" }}
      >
        <header data-tauri-drag-region className="flex items-center gap-3.5 px-7 py-3 whitespace-nowrap">
          <div data-tauri-drag-region className="flex items-center gap-2 text-[13px] text-mute">
            <span>Caudal</span>
            <span className="opacity-50">/</span>
            <span className="font-semibold text-ink" style={{ fontStretch: "110%" }}>
              {here?.label ?? "Caudal"}
            </span>
          </div>
          <div id="header-slot" className="flex min-w-0 items-center gap-3" />
          <div data-tauri-drag-region className="min-w-0 flex-[1_1_0] self-stretch" />
          {example && (
            <div className="flex items-center gap-2 text-[12px] text-mute">
              Cartera de ejemplo · nada se guarda
              {demo && (
                <button type="button" className="font-medium text-ink underline decoration-line2 underline-offset-2 hover:decoration-ink" onClick={() => setDemo(false)}>
                  Volver a mis datos
                </button>
              )}
            </div>
          )}
          {hasAccounts && here?.scoped && <AccountFilter />}
          {hasAccounts && (
            <Btn variant="cta" onClick={() => openDialog({ kind: "tx" })} title="Atajo: N">
              <Plus size={14} strokeWidth={2.6} /> Operación
            </Btn>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-7 pt-4 pb-14">
          <div className="mx-auto max-w-[1240px]">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function App() {
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);

  if (status === "loading")
    return (
      <>
        <div data-tauri-drag-region className="h-full bg-bg" />
        <Splash />
      </>
    );
  if (status === "error") {
    return (
      <div data-tauri-drag-region className="flex h-full flex-col items-center justify-center gap-3 bg-bg p-10 text-center">
        <div className="wide text-[18px] font-semibold">No se pudo abrir la base de datos</div>
        <p className="selectable max-w-lg text-ink2">{error}</p>
        <p className="max-w-lg text-[12px] text-mute">Tus datos no se han modificado. Cierra la app y vuelve a abrirla; si se repite, restaura una copia de la carpeta «copias».</p>
      </div>
    );
  }
  return (
    <Router hook={useHashLocation}>
      <Shell>
        <Switch>
          <Route path="/" component={Resumen} />
          <Route path="/posiciones" component={Posiciones} />
          <Route path="/activo/:id">{(p) => <Activo id={p.id} />}</Route>
          <Route path="/operaciones" component={Operaciones} />
          <Route path="/plan" component={Plan} />
          <Route path="/inmuebles" component={Inmuebles} />
          <Route path="/informes" component={Informes} />
          <Route path="/activos" component={Activos} />
          <Route path="/cuentas" component={Cuentas} />
          <Route path="/ajustes" component={Ajustes} />
          <Route>
            <Resumen />
          </Route>
        </Switch>
      </Shell>
      <Dialogs />
      <Toaster />
      <Splash />
    </Router>
  );
}
