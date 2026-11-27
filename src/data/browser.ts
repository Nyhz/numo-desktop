import { todayIso } from "../../shared/dates.ts";
import type { AppState } from "../../shared/types.ts";
import type { Backend } from "./backend.ts";
import { makeDemo } from "./demo.ts";

/**
 * Backend para abrir la interfaz en un navegador normal (`pnpm dev:web`).
 * Solo existe para diseñar y revisar pantallas: enseña la cartera de ejemplo,
 * no guarda nada y no tiene acceso a datos de mercado.
 */
export const browserBackend: Backend = {
  native: false,
  // Las pruebas automáticas pueden inyectar un estado concreto antes de cargar la página.
  load: async () => ({ state: (window as unknown as { __NUMO_STATE__?: AppState }).__NUMO_STATE__ ?? makeDemo(todayIso()), meta: {} }),
  apply: async () => {},
  httpGet: async () => {
    throw new Error("La vista previa del navegador no tiene acceso a datos de mercado");
  },
  async saveFile(name, data) {
    const blob = new Blob([data as BlobPart]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return name;
  },
  exportBackup: async () => null,
  info: async () => ({ version: "vista previa", dbPath: "(sin base de datos)", smoke: false }),
  // La vista previa no sincroniza: no tiene base de datos ni acceso a carpetas.
  stamps: async () => [],
  syncPick: async () => null,
  syncRead: async () => [],
  syncWrite: async () => {},
  backupNow: async () => {},
  backups: async () => [],
  backupPick: async () => null,
  restoreBackup: async () => {
    throw new Error("La vista previa del navegador no tiene copias que restaurar");
  },
  openReleases: async () => {},
  // Las pruebas de pantalla pueden simular una versión nueva con ?update=1.2.3.
  checkUpdate: async () => {
    const version = new URLSearchParams(location.search).get("update");
    return version ? { version, notes: "" } : null;
  },
  installUpdate: async (onProgress) => {
    for (let pct = 0; pct <= 100; pct += 20) {
      onProgress(pct);
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("La vista previa del navegador no instala nada");
  },
};
