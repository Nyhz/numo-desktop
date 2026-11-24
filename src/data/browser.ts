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
  load: async () => ({ state: (window as unknown as { __CAUDAL_STATE__?: AppState }).__CAUDAL_STATE__ ?? makeDemo(todayIso()), meta: {} }),
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
  info: async () => ({ version: "vista previa", dbPath: "(sin base de datos)", smoke: false, import: false }),
  importSource: async () => [],
  // La vista previa no sincroniza: no tiene base de datos ni acceso a carpetas.
  stamps: async () => [],
  syncPick: async () => null,
  syncRead: async () => [],
  syncWrite: async () => {},
  backupNow: async () => {},
};
