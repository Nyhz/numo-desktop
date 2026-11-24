import { X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { eur, eurSigned, pctSigned } from "../lib/format.ts";

// ── Botones ────────────────────────────────────────────────────────────────

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** cta = acento (acción principal) · ink = sólido neutro · outline · ghost · danger */
  variant?: "cta" | "ink" | "outline" | "ghost" | "danger";
  size?: "md" | "sm";
};

const VARIANT: Record<NonNullable<BtnProps["variant"]>, string> = {
  cta: "bg-acc text-on-acc font-[650] hover:-translate-y-px shadow-[inset_0_1px_0_var(--cta-shine),0_6px_16px_-8px_var(--acc)]",
  ink: "bg-ink text-bg font-semibold hover:opacity-90",
  outline: "border border-line2 font-medium hover:bg-wash",
  ghost: "text-mute hover:text-ink",
  danger: "border border-line2 font-medium text-down hover:bg-wash",
};

export function Btn({ variant = "outline", size = "md", className = "", type = "button", ...rest }: BtnProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full whitespace-nowrap transition-[transform,background,color,opacity] duration-150 active:scale-[.97] disabled:pointer-events-none disabled:opacity-40 ${
        size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3.5 py-[7px] text-[12.5px]"
      } ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}

export function IconBtn({ label, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-grid size-[30px] shrink-0 place-items-center rounded-full text-mute transition-colors hover:bg-wash hover:text-ink disabled:opacity-40 ${className}`}
      {...rest}
    />
  );
}

// ── Píldoras ───────────────────────────────────────────────────────────────

/** Grupo de píldoras para elegir una opción entre varias. */
export function Pills<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  bare = false,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
  label: string;
  size?: "md" | "sm";
  /** Sin fondo de grupo (selector de periodo bajo el gráfico). */
  bare?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex gap-0.5 rounded-full ${bare ? "" : "bg-wash p-[3px]"}`}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={`rounded-full font-medium whitespace-nowrap transition-[background,color] duration-200 active:scale-[.96] ${
            size === "sm" ? "px-[11px] py-[3px] text-[12px]" : bare ? "px-3.5 py-1.5 text-[12.5px]" : "px-[13px] py-[5px] text-[12.5px]"
          } ${v === value ? "bg-raised text-ink shadow-[var(--shadow-active)]" : "text-mute hover:text-ink"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Coloca su contenido en la cabecera de la app, junto a la miga (subvistas de la pantalla). */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTarget(document.getElementById("header-slot")), []);
  return target ? createPortal(children, target) : null;
}

// ── Tarjetas y secciones ───────────────────────────────────────────────────

export function Card({
  title,
  note,
  aside,
  children,
  className = "",
  pad = true,
  style,
}: {
  title?: ReactNode;
  /** Explicación breve junto al título. */
  note?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Sin relleno interior cuando el contenido son filas a sangre. */
  pad?: boolean;
  style?: CSSProperties;
}) {
  return (
    <section className={`card min-w-0 ${pad ? "px-5 py-[18px]" : ""} ${className}`} style={style}>
      {(title || aside) && (
        <div className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 ${pad ? "mb-3.5" : "px-5 pt-4 pb-2"}`}>
          {title && <span className="wide font-semibold">{title}</span>}
          {note && <span className="text-[12px] text-mute">{note}</span>}
          {aside && <span className="ml-auto flex min-w-0 items-center gap-3 text-[12.5px] text-ink2">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Tira de cifras clave: una tarjeta con celdas separadas por líneas finas. */
export function Kpis({ children }: { children: ReactNode }) {
  return <section className="card flex flex-wrap overflow-hidden">{children}</section>;
}

export function Kpi({ label, children, note, tone, priv = false }: { label: string; children: ReactNode; note?: ReactNode; tone?: number | null; /** La cifra es un importe o unas unidades del usuario: el modo privado la emborrona. */ priv?: boolean }) {
  const color = tone == null || Math.abs(tone) < 0.005 ? undefined : tone > 0 ? "var(--up)" : "var(--down)";
  return (
    <div className="min-w-0 flex-[1_1_180px] px-5 py-4 shadow-[0_0_0_.5px_var(--line)]">
      <div className="text-[12px] text-mute">{label}</div>
      <div className={`mt-1 truncate text-[20px] font-[550] ${priv ? "priv" : ""}`} style={{ fontStretch: "106%", color }}>
        {children}
      </div>
      {note && <div className="mt-0.5 text-[11.5px] text-pretty text-mute">{note}</div>}
    </div>
  );
}

// ── Cifras ─────────────────────────────────────────────────────────────────

/**
 * Dato del usuario que el modo privado emborrona: importes, saldos y unidades
 * (ver src/ui/privacy.ts). Donde ya hay un elemento basta con ponerle la clase `priv`.
 */
export const Priv = ({ children }: { children: ReactNode }) => <span className="priv">{children}</span>;

/** Importe con los decimales y el «€» atenuados: manda la parte entera. */
export function Money({ value, signed = false, digits = 2, dim = "mute" }: { value: number; signed?: boolean; digits?: number; dim?: "mute" | "soft" }) {
  const text = signed ? eurSigned(value, digits) : eur(value, digits);
  const cut = digits > 0 ? text.lastIndexOf(",") : -1;
  if (cut < 0) return <Priv>{text}</Priv>;
  return (
    <Priv>
      {text.slice(0, cut)}
      <span className={dim === "mute" ? "font-normal text-mute" : "font-normal opacity-60"}>{text.slice(cut)}</span>
    </Priv>
  );
}

export const toneOf = (v: number | null | undefined, eps = 0.005): string => (v == null || Math.abs(v) < eps ? "var(--ink2)" : v > 0 ? "var(--up)" : "var(--down)");

/** Resultado con signo. El signo escrito es la señal; el color la refuerza. */
export function Delta({ value, ratio, className = "" }: { value?: number; ratio?: number | null; className?: string }) {
  const tone = value != null ? toneOf(value) : toneOf(ratio, 0.0005);
  return (
    <span className={`whitespace-nowrap ${className}`} style={{ color: tone }}>
      {value != null && <Priv>{eurSigned(value)}</Priv>}
      {value != null && ratio != null && " "}
      {ratio != null && <span className={value != null ? "text-[0.92em] opacity-80" : ""}>{pctSigned(ratio)}</span>}
    </span>
  );
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <span className={`narrow inline-flex h-[19px] items-center rounded-full px-2 text-[11.5px] font-medium ${tone === "warn" ? "bg-wash2 text-acc" : "bg-wash text-ink2"}`}>
      {children}
    </span>
  );
}

export function Dot({ color, size = 6 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ background: color, width: size, height: size }} />;
}

export function Swatch({ color }: { color: string }) {
  return <span className="inline-block size-2 shrink-0 rounded-[2px]" style={{ background: color }} />;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="screen mx-auto flex max-w-md flex-col items-center py-24 text-center">
      <div className="wide text-[18px] font-semibold">{title}</div>
      {children && <p className="mt-2 text-pretty text-ink2">{children}</p>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

// ── Formularios y diálogos ─────────────────────────────────────────────────

export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px] whitespace-nowrap text-ink2">
        <span>{label}</span>
        {hint && <span className="min-w-0 truncate text-mute">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-[12px] text-down">{error}</span>}
    </label>
  );
}

export const ErrorLine = ({ text }: { text: string | null }) =>
  text ? (
    <div role="alert" className="rounded-[10px] bg-wash2 px-3 py-2 text-[13px] text-down">
      {text}
    </div>
  ) : null;

/** Diálogo modal nativo: atrapa el foco y se cierra con Esc sin código extra. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // El navegador enfoca el primer control (el botón de cerrar); aquí interesa el primer campo.
      (el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>(".dialog-body input, .dialog-body select"))?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      style={{ width }}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="flex max-h-[calc(100vh-64px)] flex-col">
          <header className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 className="wide text-[15px] font-semibold">{title}</h2>
            <IconBtn label="Cerrar" onClick={onClose}>
              <X size={16} />
            </IconBtn>
          </header>
          <div className="dialog-body min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

// ── Avisos ─────────────────────────────────────────────────────────────────

type Toast = { id: number; text: string; tone: "ok" | "error"; action?: { label: string; run: () => void } };
let toasts: Toast[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function toast(text: string, opts: { tone?: "ok" | "error"; action?: Toast["action"] } = {}): void {
  const t: Toast = { id: nextId++, text, tone: opts.tone ?? "ok", action: opts.action };
  toasts = [...toasts.slice(-2), t];
  emit();
  setTimeout(() => dismiss(t.id), opts.action ? 8000 : t.tone === "error" ? 7000 : 3200);
}
const dismiss = (id: number) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

export function Toaster() {
  const list = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => toasts,
  );
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className="screen pointer-events-auto flex items-center gap-3 rounded-full border border-line2 bg-raised py-2 pr-2 pl-4 text-[13px]"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          {t.tone === "error" && <span className="size-1.5 rounded-full bg-down" />}
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="rounded-full px-2 py-0.5 font-semibold text-acc hover:opacity-80"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Cerrar aviso" className="rounded-full p-1 text-mute hover:text-ink" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
