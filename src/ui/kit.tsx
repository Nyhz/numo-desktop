import { X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";
import { eurSigned, pctSigned } from "../lib/format.ts";

// ── Botones ────────────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
};

const VARIANT = {
  primary: "bg-ink text-surface hover:opacity-90",
  secondary: "border border-line-strong text-ink hover:bg-wash",
  ghost: "text-ink-2 hover:bg-wash hover:text-ink",
  danger: "border border-line-strong text-down hover:bg-wash",
};

export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-45 ${
        size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3.5 text-[13px]"
      } ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}

export function IconButton({ label, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-wash hover:text-ink disabled:opacity-40 ${className}`}
      {...rest}
    />
  );
}

// ── Selector segmentado ────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
  label: string;
  size?: "md" | "sm";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md bg-wash p-[2px]">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={`rounded-[5px] font-medium whitespace-nowrap transition-colors ${size === "sm" ? "h-6 px-2 text-[12px]" : "h-7 px-2.5 text-[12.5px]"} ${
            v === value ? "bg-raised text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-ink-2 hover:text-ink"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// ── Campos de formulario ───────────────────────────────────────────────────

export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-baseline justify-between gap-2 text-[12px] text-ink-2">
        <span>{label}</span>
        {hint && <span className="text-muted">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-[12px] text-down">{error}</span>}
    </label>
  );
}

// ── Diálogo ────────────────────────────────────────────────────────────────

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
            <IconButton label="Cerrar" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </header>
          <div className="dialog-body min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

// ── Cifras ─────────────────────────────────────────────────────────────────

/** Resultado con signo: flecha + cifra. El color acompaña, nunca es la única señal. */
export function Delta({ value, ratio, className = "" }: { value?: number; ratio?: number | null; className?: string }) {
  // Lo que se imprimiría como cero no lleva flecha ni color.
  const flat = value != null ? Math.abs(value) < 0.005 : Math.abs(ratio ?? 0) < 0.0005;
  const up = (value ?? ratio ?? 0) > 0;
  const tone = flat ? "text-ink-2" : up ? "text-up" : "text-down";
  const arrow = flat ? "" : up ? "▲ " : "▼ ";
  return (
    <span className={`num whitespace-nowrap ${tone} ${className}`}>
      <span className="text-[0.72em]">{arrow}</span>
      {value != null && eurSigned(value)}
      {value != null && ratio != null && " · "}
      {ratio != null && pctSigned(ratio)}
    </span>
  );
}

/** Cifra con su etiqueta. La cifra manda. */
export function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[12px] text-ink-2">{label}</div>
      <div className="mt-0.5 truncate text-[20px] leading-tight font-semibold">{children}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <span className={`narrow inline-flex h-[19px] items-center rounded-[4px] px-1.5 text-[11.5px] font-medium ${tone === "warn" ? "bg-wash-strong text-warn" : "bg-wash text-ink-2"}`}>
      {children}
    </span>
  );
}

export function Dot({ color }: { color: string }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

/** Sección de una página: título a la izquierda, controles a la derecha, sin caja. */
export function Section({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 ${className}`}>
      <header className="mb-3 flex h-7 items-center justify-between gap-3">
        <h2 className="wide text-[13px] font-semibold">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <div className="wide text-[16px] font-semibold">{title}</div>
      {children && <p className="mt-2 text-ink-2">{children}</p>}
      {action && <div className="mt-5 flex gap-2">{action}</div>}
    </div>
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
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-3 rounded-lg bg-ink py-2 pr-2 pl-3.5 text-[13px] text-surface" style={{ boxShadow: "var(--shadow)" }}>
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="rounded-md px-2 py-0.5 font-semibold underline underline-offset-2 hover:opacity-80"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Cerrar aviso" className="rounded p-0.5 opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
