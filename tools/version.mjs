// Calcula (y escribe) la siguiente versión de Numo App.
//
//   node tools/version.mjs parche   0.1.0 → 0.1.1   (arreglos)
//   node tools/version.mjs minor    0.1.4 → 0.2.0   (funciones nuevas)
//   node tools/version.mjs major    0.9.2 → 1.0.0   (la versión redonda)
//   node tools/version.mjs actual   no cambia nada: publica la que ya está escrita
//
// La versión vive en un solo sitio, package.json; la app la lee de ahí
// (src-tauri/tauri.conf.json apunta a ese archivo). Imprime `version=` y `tag=`
// para que el flujo de publicación los recoja.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../package.json", import.meta.url);
const tipo = process.argv[2] ?? "parche";
const text = readFileSync(file, "utf8");
const current = JSON.parse(text).version;
const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)?.slice(1).map(Number);
if (!parts) throw new Error(`La versión de package.json no tiene la forma X.Y.Z: ${current}`);
const [major, minor, patch] = parts;

const next = { parche: `${major}.${minor}.${patch + 1}`, minor: `${major}.${minor + 1}.0`, major: `${major + 1}.0.0`, actual: current }[tipo];
if (!next) throw new Error(`Tipo desconocido: «${tipo}». Usa parche, minor, major o actual.`);

// Se sustituye solo esa línea para no tocar el formato del archivo.
if (next !== current) writeFileSync(file, text.replace(`"version": "${current}"`, `"version": "${next}"`));
console.log(`version=${next}\ntag=v${next}`);
