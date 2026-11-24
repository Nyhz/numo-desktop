import { ArrowLeftRight, Check, ChevronDown, Coins, FileText, Landmark, Layers, LineChart, Moon, Plus, RefreshCw, Settings, Sun, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Route, Router, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { RANGES, isExample, setDemo, setRange, setScope, sync, useApp, useDerived } from "./data/store.ts";
import { Dialogs } from "./features/dialogs.tsx";
import { ago, seriesColor } from "./lib/format.ts";
import { Activo } from "./pages/Activo.tsx";
import { Ajustes } from "./pages/Ajustes.tsx";
import { Cuentas } from "./pages/Cuentas.tsx";
import { Informes } from "./pages/Informes.tsx";
import { Ingresos } from "./pages/Ingresos.tsx";
import { Operaciones } from "./pages/Operaciones.tsx";
import { Posiciones } from "./pages/Posiciones.tsx";
import { Resumen } from "./pages/Resumen.tsx";
import { openDialog, useDialog } from "./ui/dialogs.ts";
import { Button, Dot, IconButton, Segmented, Toaster } from "./ui/kit.tsx";

const NAV = [
  { href: "/", label: "Resumen", icon: LineChart, range: true },
  { href: "/posiciones", label: "Posiciones", icon: Layers, range: false },
  { href: "/operaciones", label: "Operaciones", icon: ArrowLeftRight, range: true },
  { href: "/ingresos", label: "Ingresos", icon: Coins, range: true },
  { href: "/informes", label: "Informes", icon: FileText, range: false },
] as const;
const NAV_2 = [
  { href: "/cuentas", label: "Cuentas", icon: Landmark },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
] as const;

function Wordmark() {
  return (
    <div className="flex items-center gap-2 px-4">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <path d="M1.5 6c3-2.4 5.6-2.4 8.5 0s5.5 2.4 8.500 0M1.5 10.500c3-2.4 5.6-2.4 8.5 0s5.5 2.4 8.500 0M1.500 15c3-2.4 5.600-2.4 8.500 0s5.500 2.4 8.500 0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
      <span className="text-[16px] font-semibold tracking-[-0.01em]" style={{ fontStretch: "118%" }}>
        Caudal
      </span>
    </div>
  );
}

function NavLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof LineChart }) {
  const [loc] = useLocation();
  const active = href === "/" ? loc === "/" : loc.startsWith(href) || (href === "/posiciones" && loc.startsWith("/activo"));
  return (
    <Link
      href={href}
      className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors ${active ? "bg-wash-strong font-semibold text-ink" : "text-ink-2 hover:bg-wash hover:text-ink"}`}
    >
      <Icon size={15} strokeWidth={active ? 2.2 : 1.8} />
      {label}
    </Link>
  );
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

  return (
    <div ref={box} className="relative">
      <Button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {picked.length === 1 && <Dot color={seriesColor(picked[0]!.color)} />}
        {label}
        <ChevronDown size={13} className="text-muted" />
      </Button>
      {open && (
        <div role="listbox" aria-multiselectable className="absolute right-0 z-30 mt-1 w-64 rounded-lg bg-raised py-1" style={{ boxShadow: "var(--shadow)" }}>
          <button type="button" role="option" aria-selected={!scope} className="flex h-8 w-full items-center gap-2.5 px-3 text-left hover:bg-wash" onClick={() => setScope(null)}>
            <span className="w-3.5">{!scope && <Check size={14} strokeWidth={2.6} />}</span>
            Todas las cuentas
          </button>
          <div className="my-1 border-t border-line" />
          {accounts.map((a) => {
            const on = !!scope?.includes(a.id);
            return (
              <button key={a.id} type="button" role="option" aria-selected={on} className="flex h-8 w-full items-center gap-2.5 px-3 text-left hover:bg-wash" onClick={() => toggle(a.id)}>
                <span className="w-3.5">{on && <Check size={14} strokeWidth={2.6} />}</span>
                <Dot color={seriesColor(a.color)} />
                <span className="truncate">{a.name}</span>
                {a.archived && <span className="ml-auto text-[12px] text-muted">archivada</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => getComputedStyle(document.documentElement).colorScheme.includes("dark"));
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("caudal.theme", next);
    setDark(!dark);
  };
  return (
    <IconButton label={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"} onClick={flip}>
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </IconButton>
  );
}

function SyncStatus() {
  const syncing = useApp((s) => s.syncing);
  const issues = useApp((s) => s.issues);
  const lastSync = useApp((s) => s.loaded.state.lastSync);
  const example = useApp((s) => isExample(s));
  if (example) return null;
  return (
    <div className="flex items-center gap-1 text-[12px] text-muted">
      <IconButton label="Actualizar precios ahora" disabled={syncing} onClick={() => void sync(true)}>
        <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
      </IconButton>
      <span className="min-w-0 truncate" title={issues.map((i) => `${i.what}: ${i.message}`).join("\n")}>
        {syncing ? "Actualizando precios…" : `Precios: ${ago(lastSync)}`}
      </span>
      {issues.length > 0 && !syncing && (
        <Link href="/ajustes" className="ml-auto text-warn" title={`${issues.length} avisos al actualizar`}>
          <TriangleAlert size={14} />
        </Link>
      )}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const d = useDerived();
  const range = useApp((s) => s.range);
  const demo = useApp((s) => s.demo != null);
  const example = useApp((s) => isExample(s));
  const dialog = useDialog();
  const here = [...NAV, ...NAV_2].find((n) => (n.href === "/" ? loc === "/" : loc.startsWith(n.href)));
  const title = loc.startsWith("/activo") ? "Posiciones" : (here?.label ?? "Caudal");
  const showRange = NAV.some((n) => n.range && (n.href === "/" ? loc === "/" : loc.startsWith(n.href)));
  const hasAccounts = d.state.accounts.length > 0;

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
    <div className="flex h-full">
      <aside className="flex w-[208px] shrink-0 flex-col border-r border-line bg-page">
        {/* Hueco para los botones de ventana de macOS; también sirve para arrastrarla. */}
        <div data-tauri-drag-region className="h-[46px] shrink-0" />
        <Wordmark />
        <nav className="mt-6 grid gap-0.5 px-2">
          {NAV.map((n) => (
            <NavLink key={n.href} {...n} />
          ))}
          <div className="mx-2.5 my-2 border-t border-line" />
          {NAV_2.map((n) => (
            <NavLink key={n.href} {...n} />
          ))}
        </nav>
        <div className="mt-auto grid gap-2 p-3">
          {example && (
            <div className="rounded-md bg-wash-strong px-2.5 py-2 text-[12px] text-ink-2">
              <strong className="text-ink">Cartera de ejemplo.</strong> Datos inventados; lo que hagas aquí no se guarda.
              {demo && (
                <button type="button" className="mt-1 block font-semibold text-ink underline underline-offset-2" onClick={() => setDemo(false)}>
                  Volver a mis datos
                </button>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-1">
            <SyncStatus />
            <span className="ml-auto">
              <ThemeToggle />
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line px-7">
          <h1 data-tauri-drag-region className="wide mr-auto text-[15px] font-semibold">
            {title}
          </h1>
          {hasAccounts && (
            <>
              <AccountFilter />
              {showRange && <Segmented label="Periodo" value={range} options={RANGES} onChange={setRange} />}
              <Button variant="primary" onClick={() => openDialog({ kind: "tx" })} title="Atajo: N">
                <Plus size={15} strokeWidth={2.4} />
                Operación
              </Button>
            </>
          )}
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1240px] px-8 pt-7 pb-16">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function App() {
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);

  if (status === "loading") return <div data-tauri-drag-region className="h-full bg-surface" />;
  if (status === "error") {
    return (
      <div data-tauri-drag-region className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <div className="wide text-[16px] font-semibold">No se pudo abrir la base de datos</div>
        <p className="selectable max-w-lg text-ink-2">{error}</p>
        <p className="max-w-lg text-[12px] text-muted">Tus datos no se han modificado. Cierra la app y vuelve a abrirla; si se repite, restaura una copia de la carpeta «copias».</p>
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
          <Route path="/ingresos" component={Ingresos} />
          <Route path="/informes" component={Informes} />
          <Route path="/cuentas" component={Cuentas} />
          <Route path="/ajustes" component={Ajustes} />
          <Route>
            <Resumen />
          </Route>
        </Switch>
      </Shell>
      <Dialogs />
      <Toaster />
    </Router>
  );
}
