#!/usr/bin/env node
// Convierte los datos de Numo (la app anterior) al CSV que importa Caudal.
//
//   node tools/numo-a-csv.mjs [ruta/a/finances.db] [carpeta/de/salida]
//
// Abre la base de datos de Numo SOLO para leer y no la modifica. Escribe:
//   numo-operaciones.csv  operaciones en el formato de Caudal (Operaciones → Importar),
//                         más dos columnas finales opcionales: tipo_activo y tipo_cuenta
//   numo-precios.csv      histórico de precios de los activos que Caudal no puede
//                         cotizar con Yahoo (fondos por ISIN, cripto, precios manuales)
//   numo-splits.csv       splits y contra-splits registrados en Numo
//   numo-activos.csv      tipo y origen del precio de cada activo (el CSV de operaciones no lo lleva)
//   numo-cuentas.csv      tipo de cada cuenta
// La carpeta de salida lleva un .gitignore para que los datos reales nunca se suban.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Dónde suele estar la base de datos de Numo: la copia de trabajo y la instancia en servicio.
const DEFAULT_DBS = [
  join(homedir(), "orca/numo-app/data/finances.db"),
  join(homedir(), "devroom/battlefields/finances/data/finances.db"),
];
const DEFAULT_OUT = resolve(HERE, "../importar");

// Cabecera exacta que entiende shared/csv.ts (TX_CSV_HEADER).
const TX_HEADER = [
  "fecha", "tipo", "cuenta", "activo", "isin", "simbolo", "divisa_activo", "cantidad",
  "precio", "importe", "divisa", "cambio", "comision", "divisa_comision",
  "retencion_origen", "retencion_espana", "cuenta_destino", "activo_destino",
  "isin_destino", "cantidad_destino", "nota",
];
// Columnas opcionales al final, con las claves de Caudal: el tipo de activo
// (stock|etf|fund|crypto|bond|other) y el de cuenta (broker|bank|crypto|pension|other).
const TX_COLUMNS = [...TX_HEADER, "tipo_activo", "tipo_cuenta"];
const assetKind = (a) => ASSET_KIND[a.asset_type] ?? "other";
const accountKind = (a) => ACCOUNT_KIND[a.account_type] ?? "other";

const ASSET_KIND = { stock: "stock", etf: "etf", fund: "fund", crypto: "crypto", bond: "bond" };
const ACCOUNT_KIND = { broker: "broker", investment: "broker", crypto: "crypto", savings: "bank", pension: "pension" };

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Quita el polvo de coma flotante sin perder precisión útil. */
const clean = (n, digits = 10) => Number(Number(n).toFixed(digits));
const nz = (n) => (n == null || !Number.isFinite(n) || Math.abs(n) < 1e-12 ? null : n);

/** CSV con `;` y coma decimal, igual que csvEncode de Caudal. */
function csv(rows) {
  const esc = (c) => {
    if (c == null) return "";
    if (typeof c === "number") return Number.isFinite(c) ? String(c).replace(".", ",") : "";
    return /[";\n\r,]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;
  };
  return rows.map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
}

// ── Cómo cotiza Numo cada activo (réplica de providerFor / resolveSymbol) ──

function providerFor(a) {
  if (["ft", "yahoo", "coingecko", "tradingview"].includes(a.price_source)) return a.price_source;
  return a.asset_type === "crypto" ? "coingecko" : "yahoo";
}

function priceSymbol(a, provider) {
  if (provider === "ft") return a.isin ? `${a.isin.trim()}:${(a.currency ?? "EUR").trim().toUpperCase()}` : null;
  if (provider === "tradingview") return a.tradingview_symbol?.trim() || null;
  return a.provider_symbol?.trim() || a.symbol?.trim() || a.ticker?.trim() || null;
}

/**
 * Lee Numo y devuelve todo lo exportable. No escribe nada.
 * @param {DatabaseSync} db base de datos de Numo abierta en solo lectura
 */
export function convert(db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const accounts = new Map(all("SELECT * FROM accounts").map((a) => [a.id, a]));
  const assets = new Map(all("SELECT * FROM assets").map((a) => [a.id, a]));
  const txs = all("SELECT * FROM asset_transactions ORDER BY traded_at, id");
  const moves = all("SELECT * FROM account_cash_movements ORDER BY occurred_at, id");
  const txIds = new Set(txs.map((t) => t.id));

  // Clasificación de precios por activo.
  const pricing = new Map();
  for (const a of assets.values()) {
    const provider = providerFor(a);
    const symbol = priceSymbol(a, provider);
    const counts = symbol
      ? all("SELECT source, COUNT(*) n FROM price_history WHERE symbol = ? GROUP BY source", symbol)
      : [];
    const total = counts.reduce((s, c) => s + c.n, 0);
    const fromYahoo = counts.filter((c) => c.source.startsWith("yahoo")).reduce((s, c) => s + c.n, 0);
    // Solo se da por bueno el símbolo de Yahoo si Numo cotiza de verdad el activo con Yahoo.
    const yahoo = provider === "yahoo" && !!symbol && (fromYahoo > 0 || total === 0);
    pricing.set(a.id, {
      provider,
      symbol,
      yahoo,
      yahooSymbol: yahoo ? symbol : "",
      // CoinGecko cotiza en EUR; el resto, en la divisa del activo.
      priceCurrency: provider === "coingecko" ? "EUR" : (a.currency ?? "EUR").toUpperCase(),
      total,
    });
  }

  const rows = []; // { when, order, cells, numoId, table, type }
  const skipped = []; // { date, type, asset, reason }
  const splits = [];
  const usedAssets = new Set();
  const usedAccounts = new Set();
  let derivedMoves = 0;

  const base = (when, tipo, account) => {
    usedAccounts.add(account.id);
    const cells = Object.fromEntries(TX_COLUMNS.map((h) => [h, null]));
    cells.fecha = isoDay(when);
    cells.tipo = tipo;
    cells.cuenta = account.name;
    cells.tipo_cuenta = accountKind(account);
    return cells;
  };
  const withAsset = (cells, a) => {
    usedAssets.add(a.id);
    cells.activo = a.name;
    cells.isin = a.isin ?? "";
    cells.simbolo = pricing.get(a.id).yahooSymbol;
    cells.divisa_activo = (a.currency ?? "EUR").toUpperCase();
    cells.tipo_activo = assetKind(a);
  };
  /** Caudal guarda el cambio al estilo BCE (divisa por 1 EUR): el inverso del de Numo. */
  const fx = (cells, currency, rateToEur) => {
    cells.divisa = currency.toUpperCase();
    cells.cambio = cells.divisa === "EUR" ? null : rateToEur > 0 ? 1 / rateToEur : null;
  };
  const toNative = (eur, rateToEur) => (rateToEur > 0 ? eur / rateToEur : eur);

  // ── Operaciones sobre activos ──
  for (const t of txs) {
    const account = accounts.get(t.account_id);
    const asset = assets.get(t.asset_id);
    const date = isoDay(t.traded_at);
    if (!account || !asset) {
      skipped.push({ date, type: t.transaction_type, asset: asset?.name ?? "?", reason: "cuenta o activo inexistente" });
      continue;
    }
    switch (t.transaction_type) {
      case "buy":
      case "sell": {
        const c = base(t.traded_at, t.transaction_type === "buy" ? "Compra" : "Venta", account);
        withAsset(c, asset);
        c.cantidad = t.quantity;
        c.precio = t.unit_price;
        fx(c, t.trade_currency, t.fx_rate_to_eur);
        // En Numo las comisiones son siempre en EUR.
        if (nz(t.fees_amount_eur)) {
          c.comision = t.fees_amount_eur;
          c.divisa_comision = "EUR";
        }
        c.nota = [t.linked_transaction_id ? "Permuta" : "", t.notes ?? ""].filter(Boolean).join(" · ");
        rows.push({ when: t.traded_at, order: t.transaction_type === "buy" ? 1 : 2, cells: c, numoId: t.id, table: "tx", type: t.transaction_type });
        break;
      }
      case "dividend": {
        const c = base(t.traded_at, "Dividendo", account);
        withAsset(c, asset);
        const gross = t.dividend_gross ?? t.trade_gross_amount;
        c.importe = gross;
        fx(c, t.trade_currency, t.fx_rate_to_eur);
        // Origen: bruto − neto (en divisa); si falta, la retención en EUR pasada a divisa.
        let origin = t.dividend_net != null && t.dividend_gross != null
          ? clean(t.dividend_gross - t.dividend_net)
          : clean(toNative(t.withholding_tax ?? 0, t.fx_rate_to_eur));
        let home = clean(toNative(t.withholding_tax_destination ?? 0, t.fx_rate_to_eur));
        // Filas antiguas con una sola retención: en valores españoles era la retención en España.
        const spanish = (asset.isin ?? "").toUpperCase().startsWith("ES") || t.source_country === "ES";
        if (spanish && !nz(home) && nz(origin)) {
          home = origin;
          origin = 0;
        }
        c.retencion_origen = nz(origin);
        c.retencion_espana = nz(home);
        c.nota = t.notes ?? "";
        rows.push({ when: t.traded_at, order: 3, cells: c, numoId: t.id, table: "tx", type: "dividend" });
        break;
      }
      case "split": {
        usedAssets.add(asset.id);
        const ratio = t.split_numerator > 0 && t.split_denominator > 0 ? t.split_numerator / t.split_denominator : null;
        if (ratio == null) {
          skipped.push({ date, type: "split", asset: asset.name, reason: "factor de split corrupto" });
        } else {
          splits.push({ asset, date, numerator: t.split_numerator, denominator: t.split_denominator, ratio });
        }
        break;
      }
      case "transfer_out":
        usedAssets.add(asset.id);
        skipped.push({ date, type: "transfer_out", asset: asset.name, reason: "retirada a custodia externa: Caudal no tiene una salida de unidades sin destino ni venta" });
        break;
      default:
        skipped.push({ date, type: t.transaction_type, asset: asset.name, reason: "tipo de operación que Caudal no conoce" });
    }
  }

  // ── Movimientos de efectivo ──
  for (const m of moves) {
    const account = accounts.get(m.account_id);
    const date = isoDay(m.occurred_at);
    if (!account) {
      skipped.push({ date, type: m.movement_type, asset: "", reason: "cuenta inexistente" });
      continue;
    }
    // Contrapartidas automáticas de una compra, venta o dividendo: en Caudal las genera la propia operación.
    if (m.movement_type === "trade" || (m.external_reference && txIds.has(m.external_reference))) {
      derivedMoves++;
      continue;
    }
    if (!m.affects_cash_balance) {
      skipped.push({ date, type: m.movement_type, asset: "", reason: "movimiento informativo que no afecta al saldo" });
      continue;
    }
    const amount = clean(Math.abs(m.native_amount));
    const map = {
      deposit: ["Ingreso", 0, ""],
      "transfer-in": ["Ingreso", 0, "Transferencia entrante"],
      interest: ["Interés", 4, ""],
      fee: ["Comisión", 6, ""],
      withdrawal: ["Retirada", 7, ""],
      "transfer-out": ["Retirada", 7, "Transferencia saliente"],
    }[m.movement_type];
    if (!map) {
      skipped.push({ date, type: m.movement_type, asset: "", reason: "movimiento de efectivo sin equivalente (p. ej. dividendo sin activo)" });
      continue;
    }
    const [tipo, order, label] = map;
    const c = base(m.occurred_at, tipo, account);
    fx(c, m.currency, m.fx_rate_to_eur);
    if (m.movement_type === "interest") {
      // Numo guarda el neto abonado y la retención aparte (en EUR); Caudal quiere el bruto.
      const wht = clean(toNative(m.withholding_tax_eur ?? 0, m.fx_rate_to_eur));
      c.importe = clean(amount + wht);
      c.retencion_espana = nz(wht);
    } else c.importe = amount;
    c.nota = [label, m.description ?? ""].filter(Boolean).join(" · ");
    rows.push({ when: m.occurred_at, order, cells: c, numoId: m.id, table: "cash", type: m.movement_type });
  }

  // ── Saldos iniciales: Caudal no tiene saldo de apertura, se registra como ingreso ──
  let openings = 0;
  for (const a of accounts.values()) {
    if (!nz(a.opening_balance_eur)) continue;
    const firstActivity = rows
      .filter((r) => r.cells.cuenta === a.name)
      .reduce((min, r) => Math.min(min, r.when), a.created_at);
    const c = base(firstActivity, a.opening_balance_eur > 0 ? "Ingreso" : "Retirada", a);
    c.importe = clean(Math.abs(a.opening_balance_eur));
    c.divisa = "EUR";
    c.nota = "Saldo inicial (Numo)";
    rows.push({ when: firstActivity, order: -1, cells: c, numoId: `opening:${a.id}`, table: "opening", type: "opening" });
    openings++;
  }

  rows.sort((x, y) => x.cells.fecha.localeCompare(y.cells.fecha) || x.order - y.order || x.when - y.when || String(x.numoId).localeCompare(String(y.numoId)));

  // ── Precios de lo que Caudal no puede pedir a Yahoo ──
  const priceRows = [];
  const positions = new Map(all("SELECT * FROM asset_positions").map((p) => [p.asset_id, p]));
  for (const id of usedAssets) {
    const a = assets.get(id);
    const p = pricing.get(id);
    if (p.yahoo) continue;
    const pts = new Map();
    if (p.symbol) {
      for (const r of all("SELECT priced_date_utc d, price FROM price_history WHERE symbol = ? ORDER BY priced_date_utc", p.symbol)) {
        if (r.price > 0) pts.set(r.d, r.price);
      }
    }
    const pos = positions.get(id);
    if (pos?.manual_price > 0 && pos.manual_price_as_of) pts.set(isoDay(pos.manual_price_as_of), pos.manual_price);
    for (const [d, price] of [...pts.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
      priceRows.push([a.isin ?? "", "", a.name, p.priceCurrency, d, price]);
    }
  }

  return { accounts, assets, pricing, rows, skipped, splits, priceRows, usedAssets, usedAccounts, derivedMoves, openings, positions };
}

function pickDb(arg) {
  if (arg) return resolve(arg);
  const hasData = (path) => {
    try {
      const db = new DatabaseSync(path, { readOnly: true });
      const n = db.prepare("SELECT (SELECT COUNT(*) FROM asset_transactions) + (SELECT COUNT(*) FROM account_cash_movements) n").get().n;
      db.close();
      return n > 0;
    } catch {
      return false;
    }
  };
  const existing = DEFAULT_DBS.filter(existsSync);
  // La copia de trabajo puede estar vacía; los datos reales viven en la instancia en servicio.
  return existing.find(hasData) ?? existing[0] ?? DEFAULT_DBS[0];
}

function main() {
  const [dbArg, outArg] = process.argv.slice(2);
  const dbPath = pickDb(dbArg);
  const outDir = resolve(outArg ?? DEFAULT_OUT);
  if (!existsSync(dbPath)) {
    console.error(`No encuentro la base de datos de Numo en ${dbPath}\nUso: node tools/numo-a-csv.mjs [ruta/a/finances.db] [carpeta/de/salida]`);
    process.exit(1);
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const r = convert(db);
  db.close();

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, ".gitignore"), "*\n");
  writeFileSync(join(outDir, "numo-operaciones.csv"), csv([TX_COLUMNS, ...r.rows.map((x) => TX_COLUMNS.map((h) => x.cells[h]))]));
  writeFileSync(join(outDir, "numo-precios.csv"), csv([["isin", "simbolo", "activo", "divisa", "fecha", "cierre"], ...r.priceRows]));
  writeFileSync(
    join(outDir, "numo-splits.csv"),
    csv([
      // ratio = unidades nuevas por cada unidad antigua (un contra-split 1:25 es 0,04).
      ["isin", "simbolo", "activo", "fecha", "ratio"],
      ...r.splits.map((s) => [s.asset.isin ?? "", r.pricing.get(s.asset.id).yahooSymbol, s.asset.name, s.date, s.ratio]),
    ]),
  );
  writeFileSync(
    join(outDir, "numo-activos.csv"),
    csv([
      ["activo", "isin", "simbolo", "divisa", "tipo", "precio_en_numo", "precio_en_caudal"],
      ...[...r.usedAssets].map((id) => {
        const a = r.assets.get(id);
        const p = r.pricing.get(id);
        return [a.name, a.isin ?? "", p.yahooSymbol, (a.currency ?? "EUR").toUpperCase(), assetKind(a), p.provider, p.yahoo ? "yahoo" : "manual"];
      }),
    ]),
  );
  writeFileSync(
    join(outDir, "numo-cuentas.csv"),
    csv([
      ["cuenta", "tipo", "divisa", "lleva_efectivo"],
      ...[...r.usedAccounts].map((id) => {
        const a = r.accounts.get(id);
        return [a.name, accountKind(a), (a.currency ?? "EUR").toUpperCase(), a.account_type === "savings" ? "si" : "no"];
      }),
    ]),
  );

  const byType = {};
  for (const x of r.rows) byType[x.cells.tipo] = (byType[x.cells.tipo] ?? 0) + 1;
  console.log(`Numo:   ${dbPath}`);
  console.log(`Salida: ${outDir}`);
  console.log(`\nnumo-operaciones.csv  ${r.rows.length} operaciones`);
  for (const [t, n] of Object.entries(byType).sort()) console.log(`  ${t.padEnd(10)} ${n}`);
  if (r.openings) console.log(`  (incluye ${r.openings} saldo(s) inicial(es) como Ingreso/Retirada)`);
  const manual = new Set(r.priceRows.map((p) => p[2])).size;
  console.log(`numo-precios.csv      ${r.priceRows.length} cierres de ${manual} activos sin cotización de Yahoo`);
  console.log(`numo-splits.csv       ${r.splits.length} split(s)`);
  console.log(`numo-activos.csv      ${r.usedAssets.size} activos  ·  numo-cuentas.csv  ${r.usedAccounts.size} cuentas`);
  if (r.derivedMoves) console.log(`\n${r.derivedMoves} movimientos de efectivo omitidos por ser la contrapartida automática de una operación.`);
  if (r.splits.length) {
    console.log("\nSplits: no van en numo-operaciones.csv (Caudal no tiene esa operación). Las compras anteriores");
    console.log("se exportan con sus unidades originales; Caudal las ajusta con los splits de Yahoo o con numo-splits.csv:");
    for (const s of r.splits) console.log(`  ${s.date}  ${s.numerator}:${s.denominator}  ${s.asset.name}${r.pricing.get(s.asset.id).yahoo ? "" : "  (sin símbolo de Yahoo: hay que cargarlo a mano)"}`);
  }
  if (r.skipped.length) {
    console.log(`\nNo exportado (${r.skipped.length}):`);
    for (const s of r.skipped) console.log(`  ${s.date}  ${s.type}  ${s.asset}  — ${s.reason}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
