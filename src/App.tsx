import { Activity, ArrowLeftRight, Check, ChevronDown, CircleArrowUp, CloudOff, Eye, EyeOff, FileText, House, Landmark, Layers, LineChart, Moon, PanelLeft, Plus, RefreshCw, Settings, Sun, Target, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Route, Router, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { backend, hideUpdate, installUpdate, isExample, setDemo, setScope, sync, syncOnFocus, updateOnFocus, useApp, useHealth } from "./data/store.ts";
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
import { togglePrivate, usePrivate } from "./ui/privacy.ts";
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
  { href: "/activos", label: "Activos", icon: Activity },
  { href: "/cuentas", label: "Cuentas", icon: Landmark },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

const isMac = /Mac/i.test(navigator.platform);
const matches = (n: Nav, loc: string) => (n.href === "/" ? loc === "/" : loc.startsWith(n.href) || (n.href === "/posiciones" && loc.startsWith("/activo/")));

// El menú lateral se puede contraer a una tira de iconos. El icono de cada fila
// ocupa siempre la misma casilla de 40 px, en el mismo sitio; lo único que cambia
// es el ancho del menú, que al abrirse deja ver los rótulos. Así nada salta: la
// fila activa pasa sola de cuadrado a píldora y los rótulos aparecen deslizándose.
const MENU_KEY = "numo.menu";
const MENU_EASE = "cubic-bezier(.2,.8,.2,1)";

function useMenu(): [boolean, () => void] {
  const [open, setOpen] = useState(() => localStorage.getItem(MENU_KEY) !== "closed");
  const toggle = () => {
    localStorage.setItem(MENU_KEY, open ? "closed" : "open");
    setOpen(!open);
  };
  return [open, toggle];
}

/** Clases de una fila del menú. `quiet`: las acciones del pie, más discretas que las secciones. */
const railItem = (active: boolean, quiet = false) =>
  `group relative flex h-10 w-full flex-none items-center overflow-hidden rounded-[11px] text-left transition-[background,color,transform] duration-150 active:scale-[.97] ${
    active ? "bg-raised text-ink shadow-[var(--shadow-active)]" : quiet ? "text-mute hover:text-ink" : "text-ink2 hover:text-ink"
  }`;

/** Icono (siempre visible) y rótulo (solo con el menú abierto) de una fila. */
function RailBody({ open, label, quiet = false, accent = false, dot = false, children }: { open: boolean; label: string; quiet?: boolean; accent?: boolean; dot?: boolean; children: ReactNode }) {
  return (
    <>
      <span className={`relative grid size-10 flex-none place-items-center transition-colors duration-150 ${accent ? "text-acc" : "text-mute group-hover:text-ink"}`}>
        {children}
        {dot && <span className="absolute top-2 right-2 size-1.5 rounded-full bg-acc" />}
      </span>
      <span
        aria-hidden={!open}
        className={`truncate pr-3 whitespace-nowrap transition-[opacity,transform] duration-300 ${quiet ? "text-[12.5px]" : "text-[13.5px] font-semibold"} ${open ? "delay-75" : "-translate-x-1.5 opacity-0"}`}
        style={{ transitionTimingFunction: MENU_EASE }}
      >
        {label}
      </span>
    </>
  );
}

function RailLink({ nav, open, alerts = 0 }: { nav: Nav; open: boolean; alerts?: number }) {
  const [loc] = useLocation();
  const active = matches(nav, loc);
  const Icon = nav.icon;
  const label = alerts ? `${nav.label} · ${alerts === 1 ? "1 precio necesita" : `${alerts} precios necesitan`} atención` : nav.label;
  return (
    <Link href={nav.href} title={open && !alerts ? undefined : label} aria-label={label} aria-current={active ? "page" : undefined} className={railItem(active)}>
      <RailBody open={open} label={nav.label} accent={active} dot={alerts > 0}>
        <Icon size={19} strokeWidth={1.8} />
      </RailBody>
    </Link>
  );
}

/** Colores de acento que se pueden elegir. Ni verde ni rojo: en la app significan ganancia y pérdida. */
export const ACCENTS = [
  ["ambar", "Ámbar"],
  ["azul", "Azul"],
  ["turquesa", "Turquesa"],
  ["violeta", "Violeta"],
  ["rosa", "Rosa"],
  ["plata", "Plata"],
] as const;
export type Accent = (typeof ACCENTS)[number][0];

/** El acento vive en <html data-accent> (sus colores, en styles.css) y se recuerda entre aperturas. */
export function useAccent(): [Accent, (accent: Accent) => void] {
  const read = () => (document.documentElement.dataset.accent as Accent | undefined) ?? "ambar";
  const [accent, setAccent] = useState<Accent>(read);
  const pick = (next: Accent) => {
    if (next === "ambar") delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = next;
    localStorage.setItem("numo.accent", next);
    setAccent(next);
  };
  return [accent, pick];
}

export function useTheme(): [boolean, () => void] {
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light");
  const flip = () => {
    const next = !light;
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    localStorage.setItem("numo.theme", next ? "light" : "dark");
    setLight(next);
    window.dispatchEvent(new Event("numo-theme"));
  };
  useEffect(() => {
    const onChange = () => setLight(document.documentElement.dataset.theme === "light");
    window.addEventListener("numo-theme", onChange);
    return () => window.removeEventListener("numo-theme", onChange);
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
      {/* Con cuentas elegidas, la píldora lleva su propia «×»: un clic y se vuelve a todas, sin abrir la lista. */}
      <div className="inline-flex shrink-0 items-center rounded-full border text-[12.5px] font-medium transition-colors" style={{ borderColor: scope ? "color-mix(in oklab, var(--acc) 55%, var(--line2))" : "var(--line2)" }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`inline-flex items-center gap-2 rounded-full py-[7px] pl-3.5 whitespace-nowrap transition-[background,transform] duration-150 hover:bg-wash active:scale-[.97] ${scope ? "pr-2" : "pr-3.5"}`}
        >
          {picked.length === 1 && <Dot color={seriesColor(picked[0]!.color)} />}
          {label}
          <ChevronDown size={11} className="text-mute" />
        </button>
        {scope && (
          <button
            type="button"
            aria-label="Volver a todas las cuentas"
            title="Volver a todas las cuentas"
            onClick={() => {
              setOpen(false);
              setScope(null);
            }}
            className="mr-1 grid size-[26px] place-items-center rounded-full text-mute transition-colors hover:bg-wash hover:text-ink"
          >
            <X size={13} />
          </button>
        )}
      </div>
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

function SyncButton({ open }: { open: boolean }) {
  const syncing = useApp((s) => s.syncing);
  const issues = useApp((s) => s.issues);
  const lastSync = useApp((s) => s.loaded.state.lastSync);
  const example = useApp((s) => isExample(s));
  if (example) return null;
  const title = syncing ? "Actualizando precios…" : `Precios actualizados ${ago(lastSync)}${issues.length ? ` · ${issues.length} avisos (ver Activos)` : ""}. Pulsa para actualizar ahora.`;
  return (
    <button type="button" title={title} aria-label="Actualizar precios" disabled={syncing} onClick={() => void sync(true)} className={railItem(false, true)}>
      <RailBody open={open} quiet label={syncing ? "Actualizando precios…" : lastSync ? `Precios de ${ago(lastSync)}` : "Sin precios todavía"} dot={issues.length > 0 && !syncing}>
        <RefreshCw size={17} strokeWidth={1.8} className={syncing ? "animate-spin" : ""} />
      </RailBody>
    </button>
  );
}

/** La sincronización entre equipos falla: se avisa en el menú, no solo en Ajustes. */
function DevicesNotice({ open }: { open: boolean }) {
  const error = useApp((s) => s.devices.error);
  const [, go] = useLocation();
  if (!error) return null;
  return (
    <button type="button" title={`La sincronización entre equipos falla: ${error}`} aria-label="La sincronización entre equipos falla" onClick={() => go("/ajustes")} className={railItem(false, true)}>
      <RailBody open={open} quiet accent label="Falla la sincronización">
        <CloudOff size={18} strokeWidth={1.8} />
      </RailBody>
    </button>
  );
}

/** Aviso discreto, sobre la pantalla, de que hay una versión nueva; desde él se instala. */
function UpdateBanner() {
  const update = useApp((s) => s.update);
  const busy = update.status === "installing";
  if (update.hidden || !update.version || !(update.status === "available" || busy || update.status === "error")) return null;
  return (
    <div role="status" className="mx-7 mb-1 flex items-center gap-3 rounded-xl border border-line2 bg-raised px-3.5 py-2 text-[12.5px]" style={{ boxShadow: "var(--shadow-active)" }}>
      <CircleArrowUp size={15} className="shrink-0 text-acc" />
      <span className="min-w-0 flex-1 truncate">
        {busy ? (
          <>
            Descargando Numo App {update.version}… <span className="text-ink2">{update.progress} % · la app se reiniciará sola</span>
          </>
        ) : update.status === "error" ? (
          <>
            No se pudo instalar la {update.version}: <span className="text-ink2">{update.error}</span>
          </>
        ) : (
          <>
            <span className="font-[550]">Numo App {update.version}</span> <span className="text-ink2">ya está disponible. Se instala en un momento y tus datos se conservan.</span>
          </>
        )}
      </span>
      {!busy && (
        <>
          <Btn size="sm" variant="cta" onClick={() => void installUpdate()}>
            {update.status === "error" ? "Reintentar" : "Actualizar"}
          </Btn>
          <button type="button" className="text-ink2 underline decoration-line2 underline-offset-2 hover:text-ink" onClick={() => void backend.openReleases()}>
            Novedades
          </button>
          <button type="button" aria-label="Cerrar el aviso" title="Cerrar; sigue en Ajustes → Versión" className="grid size-6 place-items-center rounded-full text-mute hover:bg-wash hover:text-ink" onClick={hideUpdate}>
            <X size={13} />
          </button>
        </>
      )}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const hasAccounts = useApp((s) => (s.demo ?? s.loaded).state.accounts.length > 0);
  const demo = useApp((s) => s.demo != null);
  const example = useApp((s) => isExample(s));
  const dialog = useDialog();
  const [light, flipTheme] = useTheme();
  const hidden = usePrivate();
  const [menu, toggleMenu] = useMenu();
  const wideRail = backend.native && isMac;
  const { attention, fxLate } = useHealth();
  const here = [...NAV_MAIN, ...NAV_SUB].find((n) => matches(n, loc));

  // Al volver a la ventana se mira si otro equipo ha dejado cambios y si hay una versión nueva.
  useEffect(() => {
    const onFocus = () => {
      syncOnFocus();
      updateOnFocus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // «N» abre una operación nueva desde cualquier pantalla; «P» pone o quita el modo privado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (dialog || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key.toLowerCase() === "n" && hasAccounts) {
        e.preventDefault();
        openDialog({ kind: "tx" });
      }
      if (e.key.toLowerCase() === "p") togglePrivate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, hasAccounts]);

  return (
    <div className="flex h-full bg-bg transition-colors duration-300">
      {/* Menú lateral: desplegado enseña los rótulos; contraído, solo los iconos. */}
      <nav
        data-tauri-drag-region
        aria-label="Secciones"
        // En macOS deja hueco arriba y a los lados: los botones de la ventana ocupan unos 70 px de ancho.
        className={`flex flex-none flex-col gap-1.5 overflow-hidden pb-3.5 transition-[width] duration-[320ms] ${wideRail ? "px-[19px] pt-[46px]" : "px-3 pt-3.5"}`}
        style={{ width: menu ? (wideRail ? 226 : 212) : wideRail ? 78 : 64, transitionTimingFunction: MENU_EASE }}
      >
        <div data-tauri-drag-region className="-mt-1 mb-2.5 -ml-0.5 flex h-11 flex-none items-center gap-1.5" title="Numo App">
          <div data-splash-logo className="size-11 flex-none">
            <Logo size={44} className="pointer-events-none" />
          </div>
          <span
            aria-hidden={!menu}
            className={`pointer-events-none text-[17px] font-bold tracking-[-0.01em] whitespace-nowrap transition-[opacity,transform] duration-300 ${menu ? "delay-75" : "-translate-x-1.5 opacity-0"}`}
            style={{ fontStretch: "112%", transitionTimingFunction: MENU_EASE }}
          >
            Numo
          </span>
        </div>
        {NAV_MAIN.map((n) => (
          <RailLink key={n.href} nav={n} open={menu} />
        ))}
        <div data-tauri-drag-region className="flex-1 self-stretch" />
        {NAV_SUB.map((n) => (
          <RailLink key={n.href} nav={n} open={menu} alerts={n.href === "/activos" ? attention + fxLate : 0} />
        ))}
        <div className="mx-2 my-1.5 h-px flex-none bg-line2" />
        <DevicesNotice open={menu} />
        <SyncButton open={menu} />
        <button type="button" title={`${hidden ? "Mostrar los importes" : "Modo privado: emborronar los importes"} · atajo: P`} aria-label="Modo privado" aria-pressed={hidden} onClick={togglePrivate} className={railItem(false, true)}>
          <RailBody open={menu} quiet accent={hidden} label="Modo privado">
            {hidden ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
          </RailBody>
        </button>
        <button type="button" title={light ? "Cambiar a tema oscuro" : "Cambiar a tema claro"} aria-label="Cambiar tema" onClick={flipTheme} className={railItem(false, true)}>
          <RailBody open={menu} quiet label={light ? "Tema oscuro" : "Tema claro"}>
            {light ? <Moon size={18} strokeWidth={1.8} /> : <Sun size={18} strokeWidth={1.8} />}
          </RailBody>
        </button>
        <button type="button" title={menu ? "Contraer el menú" : "Desplegar el menú"} aria-label={menu ? "Contraer el menú" : "Desplegar el menú"} aria-expanded={menu} onClick={toggleMenu} className={railItem(false, true)}>
          <RailBody open={menu} quiet label="Contraer menú">
            <PanelLeft size={18} strokeWidth={1.8} />
          </RailBody>
        </button>
      </nav>

      <main
        // Es un contenedor: la cabecera se aprieta según el ancho del panel, que depende de la ventana y del menú.
        className="@container my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-line bg-panel transition-colors duration-300"
        style={{ boxShadow: "var(--panel-shadow)" }}
      >
        <header data-tauri-drag-region className="flex items-center gap-3.5 px-7 py-3 whitespace-nowrap @max-[920px]:gap-2 @max-[920px]:px-4">
          <div data-tauri-drag-region className="flex items-center gap-2 text-[13px] text-mute">
            {/* Con poco sitio, el nombre de la app cede el suyo a las pestañas. */}
            <span className="@max-[1100px]:hidden">Numo App</span>
            <span className="opacity-50 @max-[1100px]:hidden">/</span>
            <span className="font-semibold text-ink" style={{ fontStretch: "110%" }}>
              {here?.label ?? "Numo App"}
            </span>
          </div>
          <div id="header-slot" className="flex flex-none items-center gap-3" />
          <div data-tauri-drag-region className="min-w-0 flex-[1_1_0] self-stretch" />
          {example && (
            <div className="flex min-w-0 items-center gap-2 text-[12px] text-mute">
              <span className="truncate">Cartera de ejemplo · nada se guarda</span>
              {demo && (
                <button type="button" className="shrink-0 font-medium text-ink underline decoration-line2 underline-offset-2 hover:decoration-ink" onClick={() => setDemo(false)}>
                  Volver a mis datos
                </button>
              )}
            </div>
          )}
          {hasAccounts && here?.scoped && <AccountFilter />}
          {hasAccounts && (
            <Btn variant="cta" onClick={() => openDialog({ kind: "tx" })} title="Atajo: N">
              <Plus size={14} strokeWidth={2.6} /> <span className="@max-[920px]:hidden">Operación</span>
            </Btn>
          )}
        </header>
        <UpdateBanner />
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
