// Lanza la publicación de una versión nueva desde el terminal:
//
//   pnpm publicar            (parche)
//   pnpm publicar minor
//   pnpm publicar major
//
// No compila nada aquí: pide a GitHub que ejecute el flujo «Publicar versión»,
// que sube el número, etiqueta, compila para macOS y Windows y deja los
// instaladores en la página de versiones del repositorio.
import { execFileSync } from "node:child_process";

const tipo = process.argv[2] ?? "parche";
if (!["parche", "minor", "major", "actual"].includes(tipo)) {
  console.error(`Tipo desconocido: «${tipo}». Usa parche, minor, major o actual.`);
  process.exit(1);
}
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

// Lo que se publica es lo que hay en GitHub, no lo que hay en este ordenador.
if (run("git", ["status", "--porcelain"])) {
  console.error("Hay cambios sin guardar en git. Haz commit (o descártalos) antes de publicar.");
  process.exit(1);
}
run("git", ["fetch", "origin", "main", "--quiet"]);
if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])) {
  console.error("Tu rama no coincide con origin/main. Sube (git push) o baja (git pull) los cambios antes de publicar.");
  process.exit(1);
}

execFileSync("gh", ["workflow", "run", "release.yml", "--ref", "main", "-f", `tipo=${tipo}`], { stdio: "inherit" });
console.log(`Publicación «${tipo}» en marcha. Síguela con:  gh run watch   ·   Al terminar:  git pull`);
