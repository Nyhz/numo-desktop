import { describe, expect, it } from "vitest";
import type { Point } from "../types.ts";
import { fxHealth, parseFailure, priceHealth, sessionsBetween } from "./health.ts";

// 2026-11-24 es martes.
const TODAY = "2026-11-24";
const at = (date: string): Point[] => [[date, 10]];
const etf = { kind: "etf", priceSource: "yahoo" } as const;

describe("salud de los precios", () => {
  it("cuenta solo las sesiones ya cerradas entre el último precio y hoy", () => {
    expect(sessionsBetween("2026-11-23", TODAY, false)).toBe(0);
    expect(sessionsBetween("2026-11-20", TODAY, false)).toBe(1); // viernes → martes: falta el lunes
    expect(sessionsBetween("2026-11-20", TODAY, true)).toBe(3); // sábado, domingo y lunes
  });

  it("da por bueno el cierre de ayer y tolera un festivo en los cotizados", () => {
    expect(priceHealth(etf, at("2026-11-23"), null, null, TODAY).status).toBe("ok");
    expect(priceHealth(etf, at("2026-11-20"), null, null, TODAY).status).toBe("ok");
    const late = priceHealth(etf, at("2026-11-19"), null, null, TODAY);
    expect(late.status).toBe("late");
    expect(late.ageDays).toBe(5);
    expect(late.missed).toBe(2);
  });

  it("no avisa en fin de semana por el cierre del viernes", () => {
    expect(priceHealth(etf, at("2026-11-20"), null, null, "2026-11-22").status).toBe("ok");
  });

  it("es más estricta con las criptomonedas y más paciente con los fondos", () => {
    const crypto = { kind: "crypto", priceSource: "yahoo" } as const;
    expect(priceHealth(crypto, at("2026-11-23"), null, null, TODAY).status).toBe("ok");
    expect(priceHealth(crypto, at("2026-11-22"), null, null, TODAY).status).toBe("late");
    const fund = { kind: "fund", priceSource: "ft" } as const;
    expect(priceHealth(fund, at("2026-11-18"), null, null, TODAY).status).toBe("ok"); // faltan jueves, viernes y lunes
    expect(priceHealth(fund, at("2026-11-17"), null, null, TODAY).status).toBe("late");
  });

  it("señala el fallo solo si es posterior a la última descarga correcta", () => {
    const failed = { at: "2026-11-24T08:00:00.000Z", message: "HTTP 429" };
    expect(priceHealth(etf, at("2026-11-23"), "2026-11-23T20:00:00.000Z", failed, TODAY).status).toBe("failed");
    const recovered = priceHealth(etf, at("2026-11-23"), "2026-11-24T09:00:00.000Z", failed, TODAY);
    expect(recovered.status).toBe("ok");
    expect(recovered.failure).toBeNull();
  });

  it("distingue manual, sin precio y sin descargar todavía", () => {
    expect(priceHealth({ kind: "crypto", priceSource: "manual" }, at("2026-07-05"), null, null, TODAY).status).toBe("manual");
    expect(priceHealth({ kind: "other", priceSource: "manual" }, [], null, null, TODAY).status).toBe("none");
    expect(priceHealth(etf, undefined, null, null, TODAY).status).toBe("none");
  });

  it("lee el fallo guardado y descarta lo que no lo sea", () => {
    expect(parseFailure(JSON.stringify({ at: "x", message: "y" }))).toEqual({ at: "x", message: "y" });
    expect(parseFailure("")).toBeNull();
    expect(parseFailure("no es json")).toBeNull();
  });

  it("avisa de un tipo de cambio atrasado", () => {
    expect(fxHealth([["2026-11-23", 1.05]], TODAY).late).toBe(false);
    expect(fxHealth([["2026-11-18", 1.05]], TODAY).late).toBe(true);
    expect(fxHealth(undefined, TODAY).late).toBe(true);
  });
});
