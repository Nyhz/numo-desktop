import { dayNum } from "../dates.ts";
import type { Asset, AssetKind, Point } from "../types.ts";

// Salud de los precios: para cada activo, de qué día es su último precio y si
// eso es lo esperable. No descarga nada; solo mira lo que hay guardado.

export type HealthStatus = "ok" | "late" | "failed" | "manual" | "none";

/** Último intento de descarga que salió mal. */
export type Failure = { at: string; message: string };

export type PriceHealth = {
  status: HealthStatus;
  price: number | null;
  priceDate: string | null;
  /** Días naturales desde el último precio. */
  ageDays: number | null;
  /** Sesiones ya cerradas que deberían tener precio y no lo tienen. */
  missed: number;
  /** Última descarga correcta. */
  fetchedAt: string | null;
  /** Solo si el último intento falló después de la última descarga correcta. */
  failure: Failure | null;
};

/**
 * Sesiones sin precio que se toleran antes de avisar. Los cotizados admiten un
 * festivo; los fondos publican su valor liquidativo con uno a tres días de
 * retraso; las criptomonedas cotizan todos los días.
 */
const TOLERANCE: Record<AssetKind, number> = { crypto: 0, stock: 1, etf: 1, bond: 1, other: 1, fund: 3 };

// El día 0 (1970-01-01) fue jueves.
const isWeekday = (day: number) => {
  const w = (((day + 4) % 7) + 7) % 7;
  return w !== 0 && w !== 6;
};

/** Sesiones estrictamente entre dos fechas: la de hoy aún no tiene cierre y no cuenta. */
export function sessionsBetween(from: string, to: string, everyDay: boolean): number {
  let n = 0;
  for (let d = dayNum(from) + 1; d < dayNum(to); d++) if (everyDay || isWeekday(d)) n++;
  return n;
}

export function parseFailure(raw: string | undefined): Failure | null {
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as Partial<Failure>;
    return typeof f.at === "string" && typeof f.message === "string" ? { at: f.at, message: f.message } : null;
  } catch {
    return null;
  }
}

export function priceHealth(
  asset: Pick<Asset, "kind" | "priceSource">,
  prices: Point[] | undefined,
  fetchedAt: string | null,
  failed: Failure | null,
  today: string,
): PriceHealth {
  const last = prices?.length ? prices[prices.length - 1]! : null;
  const priceDate = last?.[0] ?? null;
  const ageDays = priceDate ? Math.max(0, dayNum(today) - dayNum(priceDate)) : null;
  const missed = priceDate ? sessionsBetween(priceDate, today, asset.kind === "crypto") : 0;
  const failure = failed && (!fetchedAt || failed.at > fetchedAt) ? failed : null;
  const base = { price: last?.[1] ?? null, priceDate, ageDays, missed, fetchedAt: fetchedAt || null, failure };

  if (asset.priceSource === "manual") return { ...base, failure: null, status: priceDate ? "manual" : "none" };
  if (failure) return { ...base, status: "failed" };
  if (!priceDate) return { ...base, status: "none" };
  return { ...base, status: missed > TOLERANCE[asset.kind] ? "late" : "ok" };
}

/** Tipo de cambio del BCE: se publica cada día hábil; se tolera un festivo. */
export function fxHealth(points: Point[] | undefined, today: string): { date: string | null; rate: number | null; late: boolean } {
  const last = points?.length ? points[points.length - 1]! : null;
  if (!last) return { date: null, rate: null, late: true };
  return { date: last[0], rate: last[1], late: sessionsBetween(last[0], today, false) > 1 };
}

/** Un activo necesita atención si su precio no se está actualizando solo y al día. */
export const needsAttention = (h: PriceHealth): boolean => h.status !== "ok";
