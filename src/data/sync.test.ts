import { describe, expect, it } from "vitest";
import type { Account, Asset, Goal, Mortgage, Property, PropertyValuation, Tx } from "../../shared/types.ts";
import { EMPTY_STATE, reduce, type Loaded, type Op, type Stamp } from "./backend.ts";
import { buildSnapshot, mergeSnapshots, parseSnapshot, sealedDevice, snapshotBody, stampOps, SYNC_FORMAT, type Snapshot } from "./sync.ts";

// Dos (o tres) equipos de mentira: cada uno con su estado y sus marcas de tiempo,
// que solo se comunican publicando y leyendo archivos, como en la app.
class Equipo {
  loaded: Loaded = { state: EMPTY_STATE, meta: {} };
  stamps: Stamp[] = [];
  avisos: string[] = [];
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  /** El usuario hace algo en este equipo en el momento `at`. */
  hace(at: string, ...ops: Op[]) {
    this.stamps = stampOps(this.stamps, ops, at, this.loaded.state);
    this.loaded = reduce(this.loaded, ops);
  }
  /** El archivo que deja en la carpeta, tal como lo leería otro equipo. */
  publica(): Snapshot {
    return parseSnapshot(JSON.stringify(buildSnapshot(this.loaded.state, this.stamps, { id: this.name, name: this.name }, "2026-12-01T00:00:00.000Z")))!;
  }
  /** Lee lo de los demás y aplica lo que toque. Devuelve cuántos cambios hubo. */
  trae(...otros: Equipo[]) {
    const merge = mergeSnapshots(this.loaded.state, this.stamps, otros.map((o) => o.publica()));
    this.stamps = stampOps(this.stamps, merge.ops, "2099-01-01T00:00:00.000Z", this.loaded.state);
    this.loaded = reduce(this.loaded, merge.ops);
    this.avisos = merge.skipped;
    return merge;
  }
  get s() {
    return this.loaded.state;
  }
}
const t = (n: number) => `2026-11-${String(n).padStart(2, "0")}T10:00:00.000Z`;

const account = (id: string, name = id): Account => ({ id, name, institution: "", kind: "broker", currency: "EUR", color: 1, trackCash: false, archived: false, createdAt: t(1) });
const asset = (id: string, goalId: string | null = null): Asset => ({ id, name: id, kind: "etf", symbol: null, isin: null, currency: "EUR", priceSource: "manual", goalId, planExcluded: false, createdAt: t(1) });
const goal = (id: string, targetPct = 50): Goal => ({ id, name: id, targetPct, color: 1, sortOrder: 0, createdAt: t(1) });
const tx = (id: string, accountId: string, assetId: string, quantity = 1): Tx => ({ id, date: "2026-11-02", type: "buy", accountId, assetId, quantity, price: 10, amount: 10 * quantity, currency: "EUR", fxRate: 1, fee: 0, feeCurrency: "EUR", taxSource: 0, taxHome: 0, toAccountId: null, toAssetId: null, toQuantity: null, note: "", createdAt: t(2) });
const property = (id: string): Property => ({ id, name: id, address: "", purchaseDate: "2024-01-10", purchasePrice: 200000, purchaseCosts: 0, note: "", createdAt: t(1) });
const mortgage = (id: string, propertyId: string): Mortgage => ({ id, propertyId, lender: "", principal: 100000, rateType: "fixed", ratePct: 3, termMonths: 300, firstPaymentDate: "2024-02-05", createdAt: t(1) });
const valuation = (id: string, propertyId: string): PropertyValuation => ({ id, propertyId, date: "2026-06-01", value: 210000, note: "" });

/** Un equipo con un poco de todo, creado el día 1. */
function conDatos(name: string): Equipo {
  const e = new Equipo(name);
  e.hace(
    t(1),
    { op: "putAccount", row: account("cuenta") },
    { op: "putGoal", row: goal("global") },
    { op: "putAsset", row: asset("etf", "global") },
    { op: "putTx", row: tx("compra", "cuenta", "etf") },
    { op: "putProperty", row: property("piso") },
    { op: "putMortgage", row: mortgage("hipoteca", "piso") },
    { op: "putValuation", row: valuation("tasacion", "piso") },
    { op: "prices", assetId: "etf", points: [["2026-11-02", 10], ["2026-11-03", 11]] },
  );
  return e;
}
const registros = (e: Equipo) => ({ accounts: e.s.accounts, goals: e.s.goals, assets: e.s.assets, txs: e.s.txs, properties: e.s.properties, mortgages: e.s.mortgages, valuations: e.s.valuations });

describe("sincronización entre equipos", () => {
  it("un equipo nuevo se lo trae todo, precios incluidos, y repetir no cambia nada", () => {
    const mac = conDatos("mac");
    const pc = new Equipo("pc");
    const first = pc.trae(mac);
    expect(first).toMatchObject({ pulled: 7, deleted: 0, skipped: [] });
    expect(registros(pc)).toEqual(registros(mac));
    expect(pc.s.prices.etf).toEqual(mac.s.prices.etf);
    expect(pc.trae(mac).ops).toEqual([]);
    expect(mac.trae(pc).ops).toEqual([]);
  });

  it("un cambio viaja en los dos sentidos y, si chocan, gana el más reciente", () => {
    const mac = conDatos("mac");
    const pc = new Equipo("pc");
    pc.trae(mac);
    pc.hace(t(5), { op: "putAccount", row: account("cuenta", "Bróker (desde el PC)") });
    mac.trae(pc);
    expect(mac.s.accounts[0]!.name).toBe("Bróker (desde el PC)");

    // Los dos editan la misma operación sin haberse sincronizado: la del día 8 gana a la del 7.
    mac.hace(t(7), { op: "putTx", row: tx("compra", "cuenta", "etf", 5) });
    pc.hace(t(8), { op: "putTx", row: tx("compra", "cuenta", "etf", 9) });
    mac.trae(pc);
    pc.trae(mac);
    expect(mac.s.txs[0]!.quantity).toBe(9);
    expect(pc.s.txs[0]!.quantity).toBe(9);
    // Y lo que aprende un tercer equipo de cualquiera de los dos es lo mismo.
    const tablet = new Equipo("tablet");
    tablet.trae(mac);
    expect(registros(tablet)).toEqual(registros(pc));
  });

  it("un borrado se propaga, salvo que el otro equipo lo haya editado después", () => {
    const mac = conDatos("mac");
    const pc = new Equipo("pc");
    pc.trae(mac);
    mac.hace(t(10), { op: "delTx", id: "compra" }, { op: "delValuation", id: "tasacion" });
    pc.hace(t(11), { op: "putTx", row: tx("compra", "cuenta", "etf", 3) });
    const merge = pc.trae(mac);
    expect(merge.deleted).toBe(1);
    expect(pc.s.valuations).toEqual([]);
    expect(pc.s.txs.map((x) => x.quantity)).toEqual([3]); // editada después de borrarla: vuelve
    mac.trae(pc);
    expect(mac.s.txs.map((x) => x.quantity)).toEqual([3]);
    // Un equipo que nunca tuvo la valoración se entera igualmente de que está borrada.
    const tablet = new Equipo("tablet");
    tablet.trae(pc);
    expect(tablet.s.valuations).toEqual([]);
    expect(tablet.stamps.find((s) => s.id === "tasacion")).toMatchObject({ deleted: true });
  });

  it("un equipo vacío o recién instalado no borra nada en los demás", () => {
    const mac = conDatos("mac");
    const nuevo = new Equipo("nuevo");
    expect(mac.trae(nuevo).ops).toEqual([]);
    expect(mac.s.txs).toHaveLength(1);
  });

  it("no trae nada que apunte a algo que ya no existe, y lo dice", () => {
    const mac = conDatos("mac");
    const pc = new Equipo("pc");
    pc.trae(mac);
    // En el Mac se borra la cuenta (y con ella su operación); en el PC, después, se añade otra operación a esa cuenta.
    mac.hace(t(10), { op: "delAccount", id: "cuenta" });
    pc.hace(t(11), { op: "putTx", row: tx("otra", "cuenta", "etf") });
    const merge = mac.trae(pc);
    expect(mac.s.accounts).toEqual([]);
    expect(mac.s.txs).toEqual([]);
    expect(merge.skipped).toHaveLength(1);
    expect(merge.skipped[0]).toMatch(/cuenta ya no existe/);
    // El PC, al sincronizar, pierde la cuenta y sus operaciones: los dos acaban igual.
    pc.trae(mac);
    expect(registros(pc)).toEqual(registros(mac));
  });

  it("no borra un activo que aquí tiene operaciones; un bloque borrado deja el activo sin bloque", () => {
    const mac = conDatos("mac");
    const pc = new Equipo("pc");
    pc.trae(mac);
    mac.hace(t(10), { op: "delTx", id: "compra" }, { op: "delAsset", id: "etf" }, { op: "delGoal", id: "global" });
    pc.hace(t(12), { op: "putTx", row: tx("compra", "cuenta", "etf", 2) }); // la compra sigue viva en el PC
    const merge = pc.trae(mac);
    expect(pc.s.assets.map((a) => a.id)).toEqual(["etf"]);
    expect(merge.skipped.join(" ")).toMatch(/se conserva/);
    expect(pc.s.goals).toEqual([]);
    expect(pc.s.assets[0]!.goalId).toBeNull();
  });

  it("si dos equipos crean la hipoteca del mismo inmueble, queda la más reciente", () => {
    const mac = new Equipo("mac");
    mac.hace(t(1), { op: "putProperty", row: property("piso") });
    const pc = new Equipo("pc");
    pc.trae(mac);
    mac.hace(t(3), { op: "putMortgage", row: mortgage("del-mac", "piso") });
    pc.hace(t(4), { op: "putMortgage", row: mortgage("del-pc", "piso") });
    mac.trae(pc);
    expect(mac.s.mortgages.map((m) => m.id)).toEqual(["del-pc"]);
    const merge = pc.trae(mac);
    expect(pc.s.mortgages.map((m) => m.id)).toEqual(["del-pc"]);
    expect(merge.skipped).toEqual([]);
  });

  it("suma los precios que faltan sin tocar los que ya hay", () => {
    const mac = conDatos("mac");
    const pc = new Equipo("pc");
    pc.trae(mac);
    pc.hace(t(4), { op: "prices", assetId: "etf", points: [["2026-11-03", 99], ["2026-11-04", 12]] });
    mac.trae(pc);
    expect(mac.s.prices.etf).toEqual([["2026-11-02", 10], ["2026-11-03", 11], ["2026-11-04", 12]]);
  });

  it("solo acepta archivos de Numo completos y de una versión que entiende", () => {
    const snap = buildSnapshot(conDatos("mac").loaded.state, [], { id: "mac", name: "Mac" }, t(9));
    expect(parseSnapshot(JSON.stringify(snap))).toEqual(snap);
    expect(parseSnapshot("no es json")).toBeNull();
    expect(parseSnapshot('{"otra":"cosa"}')).toBeNull();
    expect(() => parseSnapshot(JSON.stringify({ ...snap, format: SYNC_FORMAT + 1 }))).toThrow(/versión más nueva/);
    // Un registro al que le falta un campo se descarta en vez de romper la base de datos.
    const roto = { ...snap, records: { ...snap.records, accounts: [{ id: "x", _at: t(1), name: "sin el resto" }] } };
    expect(parseSnapshot(JSON.stringify(roto))!.records.accounts).toEqual([]);
    // De un archivo cifrado solo se sabe de qué equipo es; una versión que no sepa descifrar pide actualizar.
    const cifrado = JSON.stringify({ format: SYNC_FORMAT + 1, device: snap.device, records: {}, cipher: { data: "…" } });
    expect(sealedDevice(cifrado)).toBe("Mac");
    expect(sealedDevice("no es json")).toBe("Otro equipo");
    expect(() => parseSnapshot(cifrado)).toThrow(/versión más nueva/);
    // Un equipo sin actualizar puede publicar cuentas del tipo «banco», que ya no existe: sin
    // inversiones se leen como fondo de emergencia (con su saldo) y, con ellas, como bróker.
    const cuenta = snap.records.accounts[0]!;
    const viejo = { ...snap, records: { ...snap.records, accounts: [{ ...cuenta, kind: "bank", trackCash: false }, { ...cuenta, id: "ahorro", name: "Ahorro", kind: "bank", trackCash: false }] } };
    expect(parseSnapshot(JSON.stringify(viejo))!.records.accounts.map((a) => [a.id, a.kind, a.trackCash])).toEqual([
      ["cuenta", "broker", false],
      ["ahorro", "emergency", true],
    ]);
    // La hora de escritura no cuenta para decidir si hay que volver a publicar.
    expect(snapshotBody({ ...snap, writtenAt: t(20) })).toBe(snapshotBody(snap));
  });
});
