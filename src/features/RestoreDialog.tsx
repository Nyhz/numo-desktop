import { useEffect, useState } from "react";
import type { BackupFile } from "../data/backend.ts";
import { backend, restoreBackup, syncFolder, useApp } from "../data/store.ts";
import { num } from "../lib/format.ts";
import { closeDialog } from "../ui/dialogs.ts";
import { Btn, Dialog, ErrorLine } from "../ui/kit.tsx";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** 27 nov 2026 · 09:14, en la hora de este equipo. */
function when(secs: number): string {
  const d = new Date(secs * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Qué es cada copia, por su nombre: `numo-2026-11-27.db` es la diaria y
 * `numo-2026-11-27-antes-de-sincronizar-1764233640.db`, una hecha antes de algo.
 */
function kindOf(name: string): string {
  const label = name.match(/^numo-\d{4}-\d{2}-\d{2}-(.+)-\d+\.db$/)?.[1];
  if (!label) return "Copia diaria";
  const text = label.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${num(bytes / 1024 / 1024, 1)} MB` : `${num(Math.max(1, Math.round(bytes / 1024)), 0)} kB`);

/**
 * Restaurar una copia: una de las automáticas (las de la carpeta «copias») o una
 * que el usuario guardó. Antes de sustituir nada, Numo guarda una copia de lo
 * que hay, que aparece después en esta misma lista.
 */
export function RestoreDialog() {
  const syncing = useApp((s) => !!syncFolder(s));
  const [list, setList] = useState<BackupFile[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [own, setOwn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend
      .backups()
      .then(setList)
      .catch((e) => {
        setList([]);
        setError(`No se pudieron leer las copias: ${e instanceof Error ? e.message : e}`);
      });
  }, []);

  const choose = async () => {
    setError(null);
    const path = await backend.backupPick().catch(() => null);
    if (!path) return;
    setOwn(path);
    setPicked(path);
  };

  const run = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    const res = await restoreBackup(picked);
    // Si sale bien, la app se vuelve a abrir con los datos de la copia.
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
    }
  };

  const option = (path: string, title: string, detail: string) => (
    <label key={path} className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${picked === path ? "bg-wash2" : "hover:bg-wash"}`}>
      <input type="radio" name="backup" className="accent-[var(--acc)]" checked={picked === path} onChange={() => setPicked(path)} />
      <span className="min-w-0 flex-1">
        <span className="block font-[550]">{title}</span>
        <span className="block truncate text-[12px] text-mute">{detail}</span>
      </span>
    </label>
  );

  return (
    <Dialog
      open
      onClose={closeDialog}
      title="Restaurar una copia"
      width={560}
      footer={
        <>
          <Btn onClick={closeDialog}>Cancelar</Btn>
          <Btn variant="cta" disabled={!picked || busy} onClick={() => void run()}>
            {busy ? "Restaurando…" : "Restaurar"}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-ink2">
          Tus datos de ahora se sustituyen por los de la copia. Antes, Numo guarda una copia de lo que hay (aparecerá aquí como «Antes de restaurar»), así que se puede deshacer. Las claves de Ajustes →
          Conexiones y la sincronización de este equipo se conservan.
        </p>
        {syncing && (
          <p className="text-ink2">
            Este equipo sincroniza: lo restaurado se publica como lo más reciente y tus otros equipos quedarán igual. Lo que se añadió después de la copia se borra también en ellos.
          </p>
        )}
        <div className="grid gap-0.5">
          {list == null ? (
            <div className="px-3 py-2 text-mute">Buscando copias…</div>
          ) : list.length === 0 && !own ? (
            <div className="px-3 py-2 text-mute">Todavía no hay copias automáticas: Numo hace una al día, al abrir la app.</div>
          ) : (
            <>
              {own && option(own, "Copia elegida", own)}
              {list.map((b) => option(b.path, `${kindOf(b.name)} · ${when(b.modified)}`, `${b.name} · ${size(b.bytes)}`))}
            </>
          )}
        </div>
        <div>
          <Btn size="sm" onClick={() => void choose()}>
            Elegir otro archivo…
          </Btn>
          <span className="ml-3 text-[12.5px] text-mute">una copia que guardaste con «Guardar una copia…»</span>
        </div>
        <ErrorLine text={error} />
      </div>
    </Dialog>
  );
}
