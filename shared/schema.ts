import { z } from "zod";
import { isIsoDate } from "./dates.ts";
import { ACCOUNT_KINDS, ASSET_KINDS, TX_TYPES, cashOnly, needsAsset } from "./types.ts";

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Divisa de tres letras (EUR, USD…)");
const money = z.number().min(0, "No puede ser negativo");
const nullableId = z.string().min(1).nullable();

export const accountInput = z.object({
  name: z.string().trim().min(1, "Ponle un nombre").max(60),
  institution: z.string().trim().max(60).default(""),
  kind: z.enum(ACCOUNT_KINDS),
  currency: currency.default("EUR"),
  trackCash: z.boolean().default(false),
  archived: z.boolean().default(false),
});
export type AccountInput = z.infer<typeof accountInput>;

export const assetInput = z.object({
  name: z.string().trim().min(1, "Ponle un nombre").max(120),
  kind: z.enum(ASSET_KINDS),
  symbol: z.string().trim().max(30).nullable().default(null),
  isin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, "ISIN no válido")
    .nullable()
    .default(null),
  currency,
  priceSource: z.enum(["yahoo", "manual"]).default("manual"),
});
export type AssetInput = z.infer<typeof assetInput>;

export const txInput = z
  .object({
    date: z.string().refine(isIsoDate, "Fecha no válida"),
    type: z.enum(TX_TYPES),
    accountId: z.string().min(1, "Elige una cuenta"),
    assetId: nullableId.default(null),
    quantity: z.number().positive("Debe ser mayor que cero").nullable().default(null),
    price: money.nullable().default(null),
    amount: z.number().positive("Debe ser mayor que cero").nullable().default(null),
    currency,
    fxRate: z.number().positive("El cambio debe ser mayor que cero").default(1),
    fee: money.default(0),
    feeCurrency: currency.optional(),
    taxSource: money.default(0),
    taxHome: money.default(0),
    toAccountId: nullableId.default(null),
    toAssetId: nullableId.default(null),
    toQuantity: z.number().positive().nullable().default(null),
    note: z.string().trim().max(500).default(""),
  })
  .superRefine((t, ctx) => {
    const err = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (needsAsset(t.type) && !t.assetId) err("assetId", "Elige un activo");
    if (t.type === "buy" || t.type === "sell") {
      if (t.quantity == null) err("quantity", "Indica las unidades");
      if (t.price == null) err("price", "Indica el precio");
    } else if (t.type === "transfer") {
      if (t.quantity == null) err("quantity", "Indica las unidades");
      if (!t.toAccountId && !t.toAssetId) err("toAccountId", "Indica el destino del traspaso");
      if (t.toAssetId && t.toAssetId !== t.assetId && t.toQuantity == null)
        err("toQuantity", "Indica las unidades recibidas");
    } else if (t.amount == null) err("amount", "Indica el importe");
    if (t.feeCurrency && t.feeCurrency !== t.currency && t.feeCurrency !== "EUR")
      err("feeCurrency", "La comisión va en la divisa de la operación o en EUR");
    if ((t.taxSource || t.taxHome) && t.amount != null && t.taxSource + t.taxHome > t.amount)
      err("taxSource", "Las retenciones superan el importe bruto");
  })
  .transform((t) => ({
    ...t,
    feeCurrency: t.feeCurrency ?? t.currency,
    fxRate: t.currency === "EUR" ? 1 : t.fxRate,
    // Limpia campos que no aplican al tipo para que el libro no acumule restos.
    assetId: needsAsset(t.type) ? t.assetId : null,
    quantity: t.type === "buy" || t.type === "sell" || t.type === "transfer" ? t.quantity : null,
    price: t.type === "buy" || t.type === "sell" ? t.price : null,
    amount: t.type === "buy" || t.type === "sell" || t.type === "transfer" ? null : t.amount,
    taxSource: t.type === "dividend" || t.type === "interest" ? t.taxSource : 0,
    taxHome: t.type === "dividend" || t.type === "interest" ? t.taxHome : 0,
    fee: t.type === "fee" || cashOnly(t.type) ? 0 : t.fee,
    toAccountId: t.type === "transfer" ? t.toAccountId : null,
    toAssetId: t.type === "transfer" ? t.toAssetId : null,
    toQuantity: t.type === "transfer" ? t.toQuantity : null,
  }));
export type TxInput = z.infer<typeof txInput>;

/** Primer mensaje de error legible de una validación fallida. */
export const firstIssue = (e: z.ZodError): string => e.issues[0]?.message ?? "Datos no válidos";
