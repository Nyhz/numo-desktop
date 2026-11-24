// Formato de números y fechas en español de España.

const cache = new Map<string, Intl.NumberFormat>();
const nf = (key: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat => {
  let f = cache.get(key);
  // `useGrouping: "always"` fuerza el punto de millar también en 1.234 (por defecto es-ES no lo pone).
  if (!f) cache.set(key, (f = new Intl.NumberFormat("es-ES", { useGrouping: "always", ...opts } as Intl.NumberFormatOptions)));
  return f;
};

const safe = (n: number) => (Number.isFinite(n) ? (Object.is(n, -0) || Math.abs(n) < 1e-9 ? 0 : n) : 0);

/** 1.234,56 € */
export const eur = (n: number, digits = 2): string =>
  nf(`eur${digits}`, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(safe(n));

/** +1.234,56 € / −1.234,56 € */
export const eurSigned = (n: number, digits = 2): string =>
  nf(`eurs${digits}`, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: "exceptZero" }).format(safe(n));

export const money = (n: number, currency: string, digits = 2): string => {
  try {
    return nf(`m${currency}${digits}`, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(safe(n));
  } catch {
    return `${num(n, digits, digits)} ${currency}`;
  }
};

/** Decimales para un precio unitario: más cuanto más pequeño (hay criptomonedas que valen millonésimas). */
export const priceDigits = (p: number): number => (Math.abs(p) >= 10 ? 2 : Math.abs(p) >= 0.01 ? 4 : 8);

/** Número con hasta `max` decimales (sin ceros de relleno salvo `min`). */
export const num = (n: number, max = 4, min = 0): string =>
  nf(`n${max}-${min}`, { minimumFractionDigits: min, maximumFractionDigits: max }).format(safe(n));

/** Unidades de un activo: todos los decimales que tengan, hasta 8 (fondos y cripto vienen así). */
export const units = (n: number): string => num(n, 8);

/** Ratio → porcentaje: 0,1234 → 12,3 % */
export const pct = (ratio: number, digits = 1): string =>
  nf(`p${digits}`, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(safe(ratio));

export const pctSigned = (ratio: number, digits = 1): string =>
  nf(`ps${digits}`, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: "exceptZero" }).format(safe(ratio));

/** Para ejes: 950 € · 12 k € · 1,2 M € */
export const eurAxis = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${num(n / 1_000_000, 1)} M €`;
  if (a >= 10_000) return `${num(n / 1000, 0)} k €`;
  return `${num(n, 0)} €`;
};

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** 2024-03-05 → 5 mar 2024 */
export const dateShort = (iso: string): string =>
  `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

/** 2024-03-05 → 05/03/2024 */
export const dateNumeric = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** 2024-03 → mar 24 */
export const monthShort = (ym: string): string => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;
export const monthName = (m: number): string => MONTHS[m]!;
export const monthLong = (ym: string): string => `${MONTHS_LONG[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)}`;

/** Hace cuánto, en lenguaje llano. */
export function ago(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "nunca";
  const mins = Math.round((Date.now() - Date.parse(isoTimestamp)) / 60000);
  if (mins < 2) return "ahora mismo";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ayer" : `hace ${days} días`;
}

/** Color de serie de una cuenta o bloque: ocho tonos fijos; a partir del noveno, gris. */
export const seriesColor = (slot: number): string => `var(--s${slot >= 1 && slot <= 8 ? slot : 0})`;

/** Parte un importe ya formateado en entero y decimales («1.234» + «,56 €»). */
export const splitMoney = (text: string): [string, string] => {
  const cut = text.lastIndexOf(",");
  return cut < 0 ? [text, ""] : [text.slice(0, cut), text.slice(cut)];
};

/** 2024-03-05 → 5 mar 2024, o «5 mar» si es del año en curso. */
export const dateBrief = (iso: string, today: string): string =>
  iso.slice(0, 4) === today.slice(0, 4) ? `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}` : dateShort(iso);
