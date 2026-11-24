// Fechas como YYYY-MM-DD y como número de día (días desde 1970-01-01 UTC).
// Trabajar con números de día evita por completo los husos horarios.

const MS = 86_400_000;

export const dayNum = (iso: string): number =>
  Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / MS);

export const isoOf = (day: number): string => new Date(day * MS).toISOString().slice(0, 10);

/** Fecha local de hoy. */
export const todayIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const addDays = (iso: string, n: number): string => isoOf(dayNum(iso) + n);

/** Suma meses conservando el día cuando existe (31 ene + 1 mes = 28/29 feb). */
export const addMonths = (iso: string, n: number): string => {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1 + n;
  const d = +iso.slice(8, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
};

export const isIsoDate = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(dayNum(s)) === s;

export const yearOf = (iso: string): number => +iso.slice(0, 4);
