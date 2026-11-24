import writeExcelFile from "write-excel-file/universal";
import { csvEncode } from "../../shared/csv.ts";
import type { Ledger, NTx } from "../../shared/engine/ledger.ts";
import type { YearReport } from "../../shared/engine/reports.ts";
import type { Scope } from "../../shared/engine/timeline.ts";
import { ASSET_KIND_LABEL, TX_LABEL, type Account, type Asset } from "../../shared/types.ts";
import { backend } from "../data/store.ts";

/** Celda de una hoja: texto, número, vacío o fecha ISO. */
export type Cell = string | number | null | { date: string };
export type Sheet = { name: string; rows: Cell[][]; widths?: number[] };

const D = (iso: string | null): Cell => (iso ? { date: iso } : null);
const plain = (c: Cell) => (c && typeof c === "object" ? c.date : c);

/** CSV con BOM para que Excel reconozca los acentos. Devuelve la ruta o null si se cancela. */
export const saveCsv = (name: string, rows: Cell[][]): Promise<string | null> =>
  backend.saveFile(name, `﻿${csvEncode(rows.map((r) => r.map(plain)))}`);

export const saveText = (name: string, text: string): Promise<string | null> => backend.saveFile(name, `﻿${text}`);

export async function saveXlsx(name: string, sheets: Sheet[]): Promise<string | null> {
  const data = sheets.map((s) => ({
    sheet: s.name.slice(0, 31),
    columns: (s.widths ?? s.rows[0]?.map(() => 16) ?? []).map((width) => ({ width })),
    stickyRowsCount: 1,
    data: s.rows.map((row, r) =>
      row.map((c) => {
        if (r === 0) return { value: c == null ? "" : String(plain(c)), fontWeight: "bold" as const };
        if (c == null) return null;
        if (typeof c === "object") {
          const [y, m, d] = c.date.split("-").map(Number) as [number, number, number];
          return { value: new Date(Date.UTC(y, m - 1, d)), type: Date, format: "dd/mm/yyyy" };
        }
        if (typeof c === "number") return { value: c, type: Number, format: Number.isInteger(c) ? "#,##0" : "#,##0.00####" };
        return { value: c, type: String };
      }),
    ),
  }));
  // La librería tipa las hojas de forma más estricta que la unión que construimos aquí.
  const blob = await writeExcelFile(data as unknown as Parameters<typeof writeExcelFile>[0]).toBlob();
  return backend.saveFile(name, new Uint8Array(await blob.arrayBuffer()));
}

/** Extracto de operaciones con todos los importes ya convertidos a EUR. */
export function operationsSheet(ntxs: NTx[], accounts: Map<string, Account>, assets: Map<string, Asset>): Sheet {
  const rows: Cell[][] = [
    [
      "Fecha",
      "Tipo",
      "Cuenta",
      "Activo",
      "ISIN",
      "Unidades",
      "Precio",
      "Importe bruto",
      "Divisa",
      "Cambio (divisa por EUR)",
      "Bruto EUR",
      "Comisión EUR",
      "Retención origen EUR",
      "Retención España EUR",
      "Efecto en efectivo EUR",
      "Cuenta destino",
      "Activo destino",
      "Unidades destino",
      "Nota",
    ],
  ];
  for (const n of ntxs) {
    const { tx } = n;
    const trade = tx.type === "buy" || tx.type === "sell";
    rows.push([
      D(tx.date),
      TX_LABEL[tx.type],
      n.account.name,
      n.asset?.name ?? "",
      n.asset?.isin ?? "",
      tx.quantity,
      tx.price,
      trade ? (tx.quantity ?? 0) * (tx.price ?? 0) : tx.amount,
      tx.currency,
      tx.currency === "EUR" ? 1 : tx.fxRate,
      tx.type === "transfer" ? null : n.grossEur,
      n.feeEur || null,
      n.taxSourceEur || null,
      n.taxHomeEur || null,
      tx.type === "transfer" && !n.cashEur ? null : n.cashEur,
      tx.toAccountId ? (accounts.get(tx.toAccountId)?.name ?? "") : "",
      tx.toAssetId ? (assets.get(tx.toAssetId)?.name ?? "") : "",
      tx.toQuantity,
      tx.note,
    ]);
  }
  return { name: "Operaciones", rows, widths: [12, 11, 20, 30, 15, 12, 12, 14, 8, 12, 13, 13, 13, 13, 14, 18, 26, 12, 30] };
}

export function gainsSheet(rep: YearReport): Sheet {
  const rows: Cell[][] = [
    ["Activo", "ISIN", "Tipo", "Cuenta", "Unidades", "Fecha de adquisición", "Valor de adquisición EUR", "Fecha de transmisión", "Valor de transmisión EUR", "Ganancia o pérdida EUR", "Revisar recompra"],
  ];
  for (const g of rep.gains) {
    rows.push([
      g.asset.name,
      g.asset.isin ?? "",
      ASSET_KIND_LABEL[g.asset.kind],
      g.account.name,
      g.qty,
      D(g.acqDate),
      g.acqValueEur,
      D(g.sellDate),
      g.saleValueEur,
      g.gainEur,
      g.review ? "Sí" : "",
    ]);
  }
  rows.push([]);
  rows.push(["Total", "", "", "", null, null, rep.totals.acqValueEur, null, rep.totals.saleValueEur, rep.totals.netGainEur, ""]);
  return { name: "Ganancias y pérdidas", rows, widths: [32, 15, 11, 20, 12, 14, 16, 14, 16, 16, 12] };
}

export function incomeSheet(rep: YearReport): Sheet {
  const rows: Cell[][] = [
    ["Fecha", "Tipo", "Cuenta", "Activo", "ISIN", "País", "Divisa", "Bruto en divisa", "Cambio (divisa por EUR)", "Bruto EUR", "Retención origen EUR", "Retención España EUR", "Comisión EUR", "Neto EUR"],
  ];
  for (const r of rep.income) {
    rows.push([
      D(r.date),
      TX_LABEL[r.type],
      r.account.name,
      r.asset?.name ?? "",
      r.asset?.isin ?? "",
      r.country,
      r.currency,
      r.grossNative,
      r.fxRate,
      r.grossEur,
      r.taxSourceEur || null,
      r.taxHomeEur || null,
      r.feeEur || null,
      r.netEur,
    ]);
  }
  rows.push([]);
  rows.push([
    "Total",
    "",
    "",
    "",
    "",
    "",
    "",
    null,
    null,
    rep.totals.dividendsGrossEur + rep.totals.interestGrossEur,
    rep.totals.taxSourceEur,
    rep.totals.taxHomeEur,
    null,
    rep.totals.incomeNetEur,
  ]);
  return { name: "Dividendos e intereses", rows, widths: [12, 11, 20, 30, 15, 6, 8, 14, 12, 12, 14, 14, 12, 12] };
}

export function holdingsSheet(rep: YearReport): Sheet {
  const rows: Cell[][] = [["Cuenta", "Entidad", "Activo", "ISIN", "País", "Tipo", "Unidades", "Precio", "Divisa", "Cambio (divisa por EUR)", "Valor EUR"]];
  for (const h of rep.holdings) {
    rows.push([h.account.name, h.account.institution, h.asset.name, h.asset.isin ?? "", h.country, ASSET_KIND_LABEL[h.asset.kind], h.qty, h.price, h.currency, h.fxRate, h.valueEur]);
  }
  rows.push([]);
  rows.push(["Total", "", "", "", "", "", null, null, "", null, rep.totals.holdingsEur]);
  return { name: `Posiciones a ${rep.asOf}`, rows, widths: [20, 20, 32, 15, 6, 11, 14, 12, 8, 12, 14] };
}

export function cashSheet(rep: YearReport): Sheet {
  const rows: Cell[][] = [["Cuenta", "Entidad", "Divisa", "Saldo", "Saldo EUR", "Saldo medio 4.º trimestre EUR"]];
  for (const c of rep.cash) rows.push([c.account.name, c.account.institution, c.account.currency, c.balance, c.balanceEur, c.avgQ4Eur]);
  return { name: `Efectivo a ${rep.asOf}`, rows, widths: [20, 20, 8, 14, 14, 22] };
}

export function summarySheet(rep: YearReport, scopeLabel: string): Sheet {
  const t = rep.totals;
  return {
    name: "Resumen",
    widths: [44, 18],
    rows: [
      [`Ejercicio ${rep.year}`, scopeLabel],
      ["Ganancias patrimoniales", t.gainsEur],
      ["Pérdidas patrimoniales", t.lossesEur],
      ["Resultado neto de ventas", t.netGainEur],
      ["Valor de transmisión total", t.saleValueEur],
      ["Valor de adquisición total", t.acqValueEur],
      ["Dividendos brutos", t.dividendsGrossEur],
      ["Intereses brutos", t.interestGrossEur],
      ["Retenciones en origen", t.taxSourceEur],
      ["Retenciones en España", t.taxHomeEur],
      ["Rendimientos netos cobrados", t.incomeNetEur],
      ["Comisiones y gastos", t.feesEur],
      [`Valor de las posiciones a ${rep.asOf}`, t.holdingsEur],
      [`Efectivo a ${rep.asOf}`, t.cashEur],
      [],
      ["Importes en EUR al tipo de cambio de cada operación. Ventas emparejadas por FIFO global por valor."],
    ],
  };
}

/** Operaciones del año en las cuentas elegidas, en orden cronológico. */
export const txsOfYear = (ledger: Ledger, scope: Scope, year: number): NTx[] =>
  ledger.ntxs.filter((n) => n.tx.date.startsWith(`${year}-`) && (!scope || scope.has(n.tx.accountId)));
