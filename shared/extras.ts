import { z } from "zod";
import { isIsoDate } from "./dates.ts";

// Datos que no caben en el CSV de operaciones: el plan (bloques y qué activo va
// en cada uno) y los inmuebles con su hipoteca. Se importan desde un JSON.

const date = z.string().refine(isIsoDate, "Fecha no válida");

export const extrasSchema = z.object({
  objetivos: z
    .array(z.object({ nombre: z.string().min(1), objetivoPct: z.number().min(0).max(100), orden: z.number().optional() }))
    .default([]),
  asignaciones: z
    .array(
      z.object({
        isin: z.string().default(""),
        simbolo: z.string().default(""),
        activo: z.string().default(""),
        objetivo: z.string().nullable().default(null),
        excluido: z.boolean().default(false),
      }),
    )
    .default([]),
  inmuebles: z
    .array(
      z.object({
        nombre: z.string().min(1),
        direccion: z.string().default(""),
        fechaCompra: date,
        precio: z.number().positive(),
        gastos: z.number().min(0).default(0),
        nota: z.string().default(""),
        hipoteca: z
          .object({
            entidad: z.string().default(""),
            principal: z.number().positive(),
            tipo: z.enum(["fixed", "variable", "mixed"]).default("fixed"),
            tin: z.number().min(0),
            plazoMeses: z.number().int().positive(),
            primeraCuota: date,
            eventos: z
              .array(
                z.object({
                  fecha: date,
                  tipo: z.enum(["early_repayment", "rate_change", "payment_override"]),
                  importe: z.number().nullable().default(null),
                  modo: z.enum(["reduce_term", "reduce_installment"]).nullable().default(null),
                  tin: z.number().nullable().default(null),
                  nota: z.string().default(""),
                }),
              )
              .default([]),
          })
          .nullable()
          .default(null),
        valoraciones: z.array(z.object({ fecha: date, valor: z.number().positive(), nota: z.string().default("") })).default([]),
      }),
    )
    .default([]),
});
export type Extras = z.infer<typeof extrasSchema>;

/** ¿Parece un archivo de extras? (JSON con alguna de sus claves). */
export const looksLikeExtras = (text: string): boolean => /^\s*\{/.test(text) && /"(objetivos|asignaciones|inmuebles)"/.test(text);
