import { dayNum } from "../dates.ts";
import type { AppState, Point } from "../types.ts";

/** Serie ordenada por día con búsqueda del último valor conocido. */
export class Series {
  readonly days: number[];
  readonly vals: number[];

  constructor(points: Array<[number, number]>) {
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    this.days = [];
    this.vals = [];
    for (const [d, v] of sorted) {
      if (!Number.isFinite(v)) continue;
      // Si hay dos valores el mismo día gana el último.
      if (this.days.length && this.days[this.days.length - 1] === d) {
        this.vals[this.vals.length - 1] = v;
      } else {
        this.days.push(d);
        this.vals.push(v);
      }
    }
  }

  static fromPoints(points: Point[] | undefined): Series {
    return new Series((points ?? []).map(([date, v]) => [dayNum(date), v]));
  }

  get empty(): boolean {
    return this.days.length === 0;
  }

  /** Índice del último punto con día <= d, o -1. */
  indexAt(d: number): number {
    let lo = 0;
    let hi = this.days.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.days[mid]! <= d) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  /** Último valor conocido en o antes de d; null si no hay ninguno. */
  at(d: number): number | null {
    const i = this.indexAt(d);
    return i < 0 ? null : this.vals[i]!;
  }

  /** Día del último valor conocido en o antes de d. */
  dayAt(d: number): number | null {
    const i = this.indexAt(d);
    return i < 0 ? null : this.days[i]!;
  }

  /** Vector diario [start, start+n) arrastrando el último valor; NaN antes del primero. */
  fill(start: number, n: number): Float64Array {
    const out = new Float64Array(n).fill(Number.NaN);
    let i = this.indexAt(start);
    let cur = i < 0 ? Number.NaN : this.vals[i]!;
    for (let k = 0; k < n; k++) {
      const d = start + k;
      while (i + 1 < this.days.length && this.days[i + 1]! <= d) {
        i++;
        cur = this.vals[i]!;
      }
      out[k] = cur;
    }
    return out;
  }
}

/**
 * Acceso a precios, tipos de cambio y splits con respaldos razonables:
 * un activo sin cotización se valora a su último precio de operación y una
 * divisa sin serie del BCE usa el último cambio registrado en una operación.
 */
export class Market {
  private priceS = new Map<string, Series>();
  private tradeS = new Map<string, Series>();
  private fxS = new Map<string, Series>();
  private splitS = new Map<string, Array<[number, number]>>();
  private assetCcy = new Map<string, string>();
  private manual = new Set<string>();

  constructor(state: AppState) {
    for (const a of state.assets) {
      this.assetCcy.set(a.id, a.currency);
      if (a.priceSource === "manual") this.manual.add(a.id);
      this.splitS.set(
        a.id,
        (state.splits[a.id] ?? []).map(([d, r]) => [dayNum(d), r] as [number, number]),
      );
    }

    const trades = new Map<string, Array<[number, number]>>();
    const fxFallback = new Map<string, Array<[number, number]>>();
    for (const t of state.txs) {
      const day = dayNum(t.date);
      if ((t.type === "buy" || t.type === "sell") && t.assetId && t.price && t.price > 0) {
        const arr = trades.get(t.assetId) ?? [];
        // Precio en unidades actuales (post-split), como las cotizaciones.
        arr.push([day, t.price / this.splitFactor(t.assetId, day)]);
        trades.set(t.assetId, arr);
      }
      if (t.currency !== "EUR" && t.fxRate > 0) {
        const arr = fxFallback.get(t.currency) ?? [];
        arr.push([day, t.fxRate]);
        fxFallback.set(t.currency, arr);
      }
    }

    for (const a of state.assets) {
      const quoted = (state.prices[a.id] ?? []).map(
        ([d, v]) => [dayNum(d), v] as [number, number],
      );
      const tr = trades.get(a.id) ?? [];
      this.tradeS.set(a.id, new Series(tr));
      // En activos de precio manual las operaciones también fijan precio.
      this.priceS.set(a.id, new Series(this.manual.has(a.id) ? [...tr, ...quoted] : quoted));
    }

    const currencies = new Set([...Object.keys(state.fx), ...fxFallback.keys()]);
    for (const c of currencies) {
      const official = state.fx[c];
      this.fxS.set(
        c,
        official?.length ? Series.fromPoints(official) : new Series(fxFallback.get(c) ?? []),
      );
    }
  }

  /** Unidades de `currency` por 1 EUR en el día dado. */
  fx(currency: string, day: number): number {
    if (currency === "EUR") return 1;
    const s = this.fxS.get(currency);
    if (!s || s.empty) return 1;
    return s.at(day) ?? s.vals[0]!;
  }

  hasFx(currency: string): boolean {
    return currency === "EUR" || !!this.fxS.get(currency)?.days.length;
  }

  /** Precio en la divisa del activo, en unidades actuales; null si no se conoce ninguno. */
  price(assetId: string, day: number): number | null {
    return this.priceS.get(assetId)?.at(day) ?? this.tradeS.get(assetId)?.at(day) ?? null;
  }

  /** Día del último precio de mercado conocido (sin contar operaciones). */
  priceDay(assetId: string, day: number): number | null {
    return this.priceS.get(assetId)?.dayAt(day) ?? null;
  }

  priceEur(assetId: string, day: number): number | null {
    const p = this.price(assetId, day);
    if (p == null) return null;
    return p / this.fx(this.assetCcy.get(assetId) ?? "EUR", day);
  }

  /** Vector diario de precio en EUR; 0 donde aún no hay ningún precio. */
  priceEurDaily(assetId: string, start: number, n: number): Float64Array {
    const quoted = this.priceS.get(assetId)?.fill(start, n);
    const trade = this.tradeS.get(assetId)?.fill(start, n);
    const ccy = this.assetCcy.get(assetId) ?? "EUR";
    const fx = ccy === "EUR" ? null : this.fxDaily(ccy, start, n);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let p = quoted ? quoted[i]! : Number.NaN;
      if (Number.isNaN(p)) p = trade ? trade[i]! : Number.NaN;
      out[i] = Number.isNaN(p) ? 0 : fx ? p / fx[i]! : p;
    }
    return out;
  }

  fxDaily(currency: string, start: number, n: number): Float64Array {
    const out = new Float64Array(n).fill(1);
    if (currency === "EUR") return out;
    const s = this.fxS.get(currency);
    if (!s || s.empty) return out;
    const filled = s.fill(start, n);
    const first = s.vals[0]!;
    for (let i = 0; i < n; i++) out[i] = Number.isNaN(filled[i]!) ? first : filled[i]!;
    return out;
  }

  /** Factor por el que multiplicar unidades registradas el día `day` para expresarlas en unidades actuales. */
  splitFactor(assetId: string, day: number): number {
    let f = 1;
    for (const [d, ratio] of this.splitS.get(assetId) ?? []) if (d > day) f *= ratio;
    return f;
  }

  splitsOf(assetId: string): Array<[number, number]> {
    return this.splitS.get(assetId) ?? [];
  }
}
