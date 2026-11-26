import { invoke } from "@tauri-apps/api/core";
import { parseTxCsv, planImport, txsToCsv } from "../../shared/csv.ts";
import { todayIso } from "../../shared/dates.ts";
import { makeDemo } from "./demo.ts";
import { ecbRates } from "./market.ts";
import { backend, derive, getApp, importPlan, removeAccount, removeTx, saveAccount, saveAsset, saveTx, setLoaded, setPrice, setSyncPassword, syncDevices } from "./store.ts";
import { buildSnapshot, parseSnapshot } from "./sync.ts";

/**
 * Prueba de humo de la app real (NUMO_SMOKE=1 con NUMO_DATA_DIR apuntando a
 * una carpeta temporal): escribe en SQLite a través del núcleo nativo, vuelve a
 * leer del disco y comprueba que lo guardado es lo que se ve. Después cierra la app.
 */
export async function runSmoke(): Promise<void> {
  const log: string[] = [];
  const check = (name: string, cond: boolean, detail = "") => {
    log.push(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!cond) throw new Error(name);
  };
  let ok = true;
  try {
    const fresh = await backend.load();
    check("base de datos nueva y vacía", fresh.state.accounts.length === 0 && fresh.state.txs.length === 0);

    const acct = await saveAccount({ name: "Prueba", institution: "", kind: "broker", currency: "EUR", trackCash: true, archived: false });
    const fund = await saveAccount({ name: "Colchón", institution: "", kind: "emergency", currency: "EUR", trackCash: false, archived: false });
    check("crear cuentas", acct.ok && fund.ok);
    check("solo el fondo de emergencia lleva efectivo", acct.ok && !acct.value.trackCash && fund.ok && fund.value.trackCash);
    const asset = await saveAsset({ name: "Activo de prueba", kind: "stock", symbol: null, isin: null, currency: "USD", priceSource: "manual" });
    check("crear activo", asset.ok);
    if (!acct.ok || !fund.ok || !asset.ok) return;

    const dep = await saveTx({ date: "2024-01-02", type: "deposit", accountId: fund.value.id, amount: 5000, currency: "EUR" });
    const brokerDep = await saveTx({ date: "2024-01-02", type: "deposit", accountId: acct.value.id, amount: 5000, currency: "EUR" });
    check("rechazar un ingreso en un bróker", !brokerDep.ok);
    const buy = await saveTx({ date: "2024-01-03", type: "buy", accountId: acct.value.id, assetId: asset.value.id, quantity: 10, price: 110, currency: "USD", fxRate: 1.1, fee: 1.5, feeCurrency: "EUR" });
    const bad = await saveTx({ date: "2024-01-03", type: "buy", accountId: acct.value.id, assetId: asset.value.id, quantity: 1, currency: "USD" });
    check("guardar ingreso y compra", dep.ok && buy.ok);
    check("rechazar una compra sin precio", !bad.ok);
    check("guardar precio manual", (await setPrice(asset.value.id, "2024-06-03", 121)).ok);

    // Lo importante: releer del disco, no de la memoria.
    const disk = await backend.load();
    check("releer del disco", disk.state.accounts.length === 2 && disk.state.assets.length === 1 && disk.state.txs.length === 2, `${disk.state.txs.length} operaciones`);
    const saved = disk.state.txs.find((t) => t.type === "buy");
    check("los campos sobreviven al viaje", saved?.quantity === 10 && saved.price === 110 && saved.fxRate === 1.1 && saved.fee === 1.5 && saved.feeCurrency === "EUR" && saved.assetId === asset.value.id);
    check("los booleanos vuelven como booleanos", disk.state.accounts.find((a) => a.kind === "emergency")?.trackCash === true && disk.state.accounts[0]!.archived === false);
    check("el precio manual está guardado", disk.state.prices[asset.value.id]?.[0]?.[1] === 121);

    const d = derive(disk.state, null);
    check("coste FIFO en EUR", d.positions[0]?.costEur === 1001.5, String(d.positions[0]?.costEur));
    check("la compra del bróker no toca el fondo", d.timeline.cash.get(fund.value.id)?.at(-1) === 5000 && !d.timeline.cash.has(acct.value.id));

    // Lote todo-o-nada: una operación que apunta a una cuenta inexistente no deja nada a medias.
    let rejected = false;
    try {
      await backend.apply([
        { op: "meta", key: "smoke", value: "1" },
        { op: "putTx", row: { ...saved!, id: "huérfana", accountId: "no-existe" } },
      ]);
    } catch {
      rejected = true;
    }
    const after = await backend.load();
    check("un lote con un error no guarda nada", rejected && after.meta.smoke === undefined && after.state.txs.length === 2);

    // Importación de 100+ operaciones de una vez, y vuelta a exportar.
    const demo = makeDemo(todayIso());
    const parsed = parseTxCsv(txsToCsv(demo));
    check("el CSV de ejemplo se analiza sin errores", parsed.errors.length === 0, `${parsed.rows.length} filas`);
    const imported = await importPlan(planImport(parsed.rows, getApp().loaded.state));
    check("importar el CSV", imported.ok, imported.ok ? `${imported.value} operaciones` : imported.error);
    const big = await backend.load();
    check("todo lo importado está en disco", big.state.txs.length === 2 + demo.txs.length && big.state.accounts.length === 2 + demo.accounts.length);

    const removed = await removeTx(buy.ok ? buy.value.id : "");
    check("borrar una operación", removed.ok && (await backend.load()).state.txs.length === 1 + demo.txs.length);

    // Sincronización entre equipos, contra una carpeta de verdad y con otro equipo de mentira.
    const stamps = await backend.stamps();
    check("cada registro guarda cuándo cambió", stamps.some((x) => x.entity === "accounts" && x.id === acct.value.id && !x.deleted) && stamps.some((x) => x.entity === "txs" && x.id === (buy.ok ? buy.value.id : "") && x.deleted));
    const info = await backend.info();
    const dir = `${info.dbPath.replace(/[\\/][^\\/]*$/, "")}/sincro-prueba`;
    const mine = { id: "equipo-prueba", name: "Este" };
    await backend.apply([
      { op: "meta", key: "sync:dir", value: dir },
      { op: "meta", key: "sync:device", value: JSON.stringify(mine) },
    ]);
    setLoaded(await backend.load());
    const before = getApp().loaded.state;
    // El otro equipo publica una cuenta nueva, renombra la nuestra más tarde y ha borrado el ingreso.
    const other = buildSnapshot({ ...before, accounts: [{ ...before.accounts.find((a) => a.id === acct.value.id)!, name: "Renombrada en otro equipo" }, { ...before.accounts[0]!, id: "cuenta-del-otro", name: "Cuenta del otro equipo" }], assets: [], txs: [], goals: [], properties: [], mortgages: [], mortgageEvents: [], valuations: [] }, [], { id: "otro-equipo", name: "Otro" }, "2099-01-01T00:00:00.000Z");
    other.records.accounts.forEach((r) => (r._at = "2099-01-01T00:00:00.000Z"));
    other.tombstones.push({ entity: "txs", id: dep.ok ? dep.value.id : "", at: "2099-01-01T00:00:00.000Z" });
    await backend.syncWrite(dir, "otro-equipo.json", JSON.stringify(other));
    const synced = await syncDevices();
    check("sincronizar con otro equipo", synced.ok && synced.value?.pulled === 2 && synced.value.deleted === 1, synced.ok ? JSON.stringify(synced.value) : synced.error);
    const merged = await backend.load();
    check(
      "lo sincronizado está en disco",
      merged.state.accounts.some((a) => a.id === "cuenta-del-otro") && merged.state.accounts.find((a) => a.id === acct.value.id)?.name === "Renombrada en otro equipo" && !merged.state.txs.some((x) => dep.ok && x.id === dep.value.id),
    );
    const files = await backend.syncRead(dir);
    const own = files.find((f) => f.name === "equipo-prueba.json");
    check("este equipo publica su archivo", files.length === 2 && !!own && parseSnapshot(own.text)?.records.accounts.length === merged.state.accounts.length);
    check("repetir la sincronización no cambia nada", (await syncDevices()).ok && (await backend.syncRead(dir)).find((f) => f.name === "equipo-prueba.json")?.text === own?.text);
    // Borrar una cuenta deja anotadas como borradas también sus operaciones.
    const victim = merged.state.txs.find((x) => x.accountId !== acct.value.id)!;
    await removeAccount(victim.accountId);
    const marks = await backend.stamps();
    check("un borrado en cascada queda anotado", marks.some((x) => x.entity === "txs" && x.id === victim.id && x.deleted) && marks.some((x) => x.entity === "accounts" && x.id === victim.accountId && x.deleted));

    // Cifrado: con contraseña, el archivo de este equipo queda cifrado en la carpeta y se sigue leyendo.
    const sealedSync = await setSyncPassword("contraseña de prueba");
    const sealedOwn = (await backend.syncRead(dir)).find((f) => f.name === "equipo-prueba.json");
    check("con contraseña, el archivo propio se cifra y se sigue leyendo", sealedSync.ok && !!sealedOwn?.sealed && !sealedOwn.locked && !!parseSnapshot(sealedOwn.text), sealedSync.ok ? "" : sealedSync.error);
    // Con otra contraseña ya no se abre. Un tercer equipo publica con esa otra.
    await backend.apply([{ op: "meta", key: "secret:sync", value: "otra distinta" }]);
    const closed = (await backend.syncRead(dir)).find((f) => f.name === "equipo-prueba.json");
    check("con otra contraseña el archivo no se abre", !!closed?.locked && !closed.text.includes("Renombrada"));
    await backend.syncWrite(dir, "tercero.json", JSON.stringify({ ...other, device: { id: "tercero", name: "Tercero" } }));
    // Sin contraseña aquí, no se publica en claro junto a un archivo cifrado: se pide la contraseña.
    const refused = await setSyncPassword("");
    const kept = (await backend.syncRead(dir)).find((f) => f.name === "equipo-prueba.json");
    check("sin contraseña no se publica junto a archivos cifrados", !refused.ok && /Tercero/.test(refused.error) && !!kept?.sealed, refused.ok ? "sincronizó" : refused.error);

    // Red: tipos de cambio del BCE a través del núcleo nativo.
    try {
      const usd = (await ecbRates(backend.httpGet, ["USD"], "2024-01-02")).get("USD") ?? [];
      check("tipos de cambio del BCE", usd.length > 100 && usd[0]![0] === "2024-01-02", `${usd.length} días`);
    } catch (e) {
      log.push(`aviso tipos de cambio del BCE no disponibles: ${e instanceof Error ? e.message : e}`);
    }
    let blocked = false;
    try {
      await backend.httpGet("https://example.com/");
    } catch {
      blocked = true;
    }
    check("la red está limitada a los servidores de mercado", blocked);
  } catch (e) {
    ok = false;
    log.push(`excepción: ${e instanceof Error ? e.message : String(e)}`);
  }
  await invoke("smoke_done", { ok, report: log.join("\n") });
}
