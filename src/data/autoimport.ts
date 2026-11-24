import { invoke } from "@tauri-apps/api/core";
import { detectCsv, matchSeries, parseSeriesCsv, parseTxCsv, planImport } from "../../shared/csv.ts";
import { looksLikeExtras } from "../../shared/extras.ts";
import { backend, getApp, importExtras, importPlan, importSeries, sync } from "./store.ts";

/**
 * Carga inicial sin interfaz (CAUDAL_IMPORT_DIR=carpeta): importa los archivos
 * de la carpeta con el mismo código que el diálogo «Importar», actualiza
 * precios, imprime un resumen y cierra la app.
 *
 * Solo actúa sobre una base de datos vacía: nunca mezcla con datos existentes.
 */
export async function runAutoImport(): Promise<void> {
  const log: string[] = [];
  let ok = true;
  try {
    const before = getApp().loaded.state;
    if (before.accounts.length || before.txs.length) throw new Error("la base de datos ya tiene datos; la carga inicial solo se hace sobre una vacía");
    const files = await backend.importSource();
    const state = () => getApp().loaded.state;
    const kindOf = (f: { name: string; text: string }) => (looksLikeExtras(f.text) ? "extras" : detectCsv(f.text));

    // Orden: operaciones (crean cuentas y activos), después precios y splits, y al final el plan y los inmuebles.
    const order = ["operations", "prices", "splits", "extras"];
    const known = files.map((f) => ({ ...f, kind: kindOf(f) })).filter((f) => order.includes(f.kind));
    known.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    for (const f of files) if (!known.some((k) => k.name === f.name)) log.push(`omitido  ${f.name} (no es un archivo importable)`);

    for (const f of known) {
      if (f.kind === "operations") {
        const parsed = parseTxCsv(f.text);
        if (parsed.errors.length) throw new Error(`${f.name}: línea ${parsed.errors[0]!.line}: ${parsed.errors[0]!.message}`);
        const plan = planImport(parsed.rows, state());
        const res = await importPlan(plan);
        if (!res.ok) throw new Error(`${f.name}: ${res.error}`);
        log.push(`ok  ${f.name}: ${res.value} operaciones, ${plan.newAccounts.length} cuentas, ${plan.newAssets.length} activos`);
      } else if (f.kind === "prices" || f.kind === "splits") {
        const parsed = parseSeriesCsv(f.text, f.kind === "prices" ? "cierre" : "ratio");
        const { byAsset, unknown } = matchSeries(parsed.rows, state());
        const res = await importSeries(f.kind, byAsset);
        if (!res.ok) throw new Error(`${f.name}: ${res.error}`);
        log.push(`ok  ${f.name}: ${res.value} filas en ${byAsset.size} activos${unknown.length ? `, ${unknown.length} activos sin emparejar` : ""}${parsed.errors.length ? `, ${parsed.errors.length} líneas ilegibles` : ""}`);
      } else {
        const res = await importExtras(JSON.parse(f.text));
        if (!res.ok) throw new Error(`${f.name}: ${res.error}`);
        log.push(`ok  ${f.name}: ${res.value.goals} bloques, ${res.value.assigned} activos asignados, ${res.value.properties} inmuebles${res.value.unmatched.length ? `, ${res.value.unmatched.length} asignaciones sin emparejar` : ""}`);
      }
    }

    await sync(true);
    const issues = getApp().issues;
    log.push(issues.length ? `aviso  precios: ${issues.map((i) => i.message).join(" | ")}` : "ok  precios y tipos de cambio actualizados");

    const disk = (await backend.load()).state;
    log.push(
      `en disco: ${disk.accounts.length} cuentas, ${disk.assets.length} activos, ${disk.txs.length} operaciones, ${Object.values(disk.prices).reduce((s, p) => s + p.length, 0)} precios, ${disk.goals.length} bloques, ${disk.properties.length} inmuebles, ${disk.mortgages.length} hipotecas`,
    );
  } catch (e) {
    ok = false;
    log.push(`error  ${e instanceof Error ? e.message : String(e)}`);
  }
  await invoke("smoke_done", { ok, report: log.join("\n") });
}
