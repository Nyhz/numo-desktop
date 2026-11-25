import { Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { txsToCsv } from "../../shared/csv.ts";
import { todayIso } from "../../shared/dates.ts";
import { fxHealth } from "../../shared/engine/health.ts";
import { ACCENTS, useAccent, useTheme } from "../App.tsx";
import { backend, checkUpdate, chooseSyncFolder, connectionStatus, deviceOf, isExample, installUpdate, renameDevice, saveSecret, setDemo, setSyncPassword, stopSync, sync, syncDevices, syncFolder, syncSealed, useApp, type Service } from "../data/store.ts";
import { saveText } from "../lib/export.ts";
import { ago, dateBrief, num } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Btn, toast } from "../ui/kit.tsx";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <div className="wide px-5 py-4 font-semibold">{title}</div>
      {children}
    </section>
  );
}

function Row({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-6 border-t border-line px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="font-[550]">{title}</div>
        <div className="mt-[3px] text-[12.5px] text-pretty text-ink2">{children}</div>
      </div>
      {action}
    </div>
  );
}

/** Clave de un servicio de datos: se comprueba al guardarla y no vuelve a mostrarse. */
function Connection({ service, title, children, placeholder }: { service: Service; title: string; children: ReactNode; placeholder: string }) {
  const connected = useApp((s) => !!s.loaded.meta[`connected:${service}`]);
  const example = useApp((s) => isExample(s));
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);

  // Al abrir Ajustes se pregunta al servicio si la clave guardada sigue valiendo.
  useEffect(() => {
    if (!connected || example) return;
    let alive = true;
    void connectionStatus(service).then((r) => alive && setStatus(r.ok ? { text: r.value } : { text: r.error, bad: true }));
    return () => {
      alive = false;
    };
  }, [connected, example, service]);

  const save = async (next: string) => {
    setBusy(true);
    const res = await saveSecret(service, next);
    setBusy(false);
    setValue("");
    if (!res.ok) return setStatus({ text: res.error, bad: true });
    setStatus(next ? { text: res.value } : null);
    toast(next ? `${title}: conectado` : `${title}: clave quitada`);
  };

  return (
    <Row
      title={title}
      action={
        connected ? (
          <Btn onClick={() => void save("")} disabled={busy}>
            Quitar clave
          </Btn>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) void save(value);
            }}
          >
            <input className="field w-64" type="password" autoComplete="off" placeholder={placeholder} value={value} disabled={example || busy} onChange={(e) => setValue(e.target.value)} />
            <Btn type="submit" disabled={example || busy || !value.trim()}>
              {busy ? "Comprobando…" : "Conectar"}
            </Btn>
          </form>
        )
      }
    >
      {children}
      {status && <span className={`mt-1 block font-medium ${status.bad ? "text-down" : "text-ink"}`}>{status.text}</span>}
    </Row>
  );
}

/** Sincronización con los otros equipos del usuario a través de una carpeta compartida. */
function Devices() {
  const example = useApp((s) => isExample(s));
  const dir = useApp((s) => syncFolder(s));
  const deviceJson = useApp((s) => s.loaded.meta["sync:device"] ?? "");
  const last = useApp((s) => s.loaded.meta["sync:last"] ?? null);
  const devices = useApp((s) => s.devices);
  const device = deviceOf();
  const [name, setName] = useState(device?.name ?? "");
  useEffect(() => setName(deviceOf()?.name ?? ""), [deviceJson]);
  const sealed = useApp((s) => syncSealed(s));
  const [password, setPassword] = useState("");
  const seal = async (next: string) => {
    const res = await setSyncPassword(next);
    if (res.ok || !/al menos 8/.test(res.error)) setPassword("");
    if (!res.ok) return toast(res.error, { tone: "error" });
    toast(next ? "Cifrado activo: pon la misma contraseña en tus otros equipos" : "Cifrado quitado: los archivos vuelven a ir sin cifrar");
  };

  const choose = async () => {
    const res = await chooseSyncFolder();
    if (!res.ok) return toast(res.error, { tone: "error" });
    if (res.value) toast(res.value.pulled ? `Sincronizado: ${res.value.pulled} registros traídos de tus otros equipos` : "Carpeta lista: este equipo ya publica sus cambios");
  };
  const now = async () => {
    const res = await syncDevices();
    if (!res.ok) return toast(res.error, { tone: "error" });
    const { pulled = 0, deleted = 0 } = res.value ?? {};
    toast(pulled || deleted ? `Sincronizado: ${pulled} traídos${deleted ? ` · ${deleted} borrados` : ""}` : "Todo estaba al día");
  };
  const stop = async () => {
    const res = await stopSync();
    toast(res.ok ? "Este equipo ha dejado de sincronizar" : res.error, res.ok ? {} : { tone: "error" });
  };

  if (!dir) {
    return (
      <Row
        title="Carpeta compartida"
        action={
          <Btn onClick={() => void choose()} disabled={example}>
            Elegir carpeta…
          </Btn>
        }
      >
        Para usar Numo en varios equipos, elige en cada uno la misma carpeta de un servicio de nube (Proton Drive, iCloud, OneDrive, Dropbox…). La app crea dentro una carpeta
        «numo-app», donde cada equipo deja sus cambios y lee los de los demás; la base de datos no se comparte.
      </Row>
    );
  }
  return (
    <>
      <Row
        title="Carpeta compartida"
        action={
          <div className="flex gap-2">
            <Btn onClick={() => void now()} disabled={devices.busy}>
              {devices.busy ? "Sincronizando…" : "Sincronizar ahora"}
            </Btn>
            <Btn onClick={() => void stop()} disabled={devices.busy}>
              Dejar de sincronizar
            </Btn>
          </div>
        }
      >
        <span className="selectable block break-all">{dir}</span>
        <span className="mt-1 block">
          Última sincronización: {ago(last)}.{" "}
          {devices.peers.length
            ? `Otros equipos: ${devices.peers.map((p) => `${p.name} (publicó ${ago(p.writtenAt)})`).join(", ")}.`
            : "Todavía no hay ningún otro equipo en esta carpeta: elige la misma en el siguiente."}
        </span>
        {devices.error && <span className="mt-1 block font-medium text-down">{devices.error}</span>}
        {devices.notes.map((n, i) => (
          <span key={i} className="mt-1 block text-acc">
            {n}
          </span>
        ))}
      </Row>
      <Row
        title="Nombre de este equipo"
        action={
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void renameDevice(name).then((r) => toast(r.ok ? "Nombre guardado" : r.error, r.ok ? {} : { tone: "error" }));
            }}
          >
            <input className="field w-52" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre de este equipo" />
            <Btn type="submit" disabled={!name.trim() || name.trim() === device?.name}>
              Guardar
            </Btn>
          </form>
        }
      >
        Así lo verán tus otros equipos.
      </Row>
      <Row
        title={sealed ? "Cifrado · activo" : "Cifrado"}
        action={
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void seal(password);
            }}
          >
            <input className="field w-52" type="password" autoComplete="new-password" placeholder={sealed ? "Nueva contraseña" : "Contraseña"} value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Contraseña de la sincronización" />
            <Btn type="submit" disabled={!password || devices.busy}>
              {sealed ? "Cambiar" : "Cifrar"}
            </Btn>
            {sealed && (
              <Btn onClick={() => void seal("")} disabled={devices.busy}>
                Quitar
              </Btn>
            )}
          </form>
        }
      >
        {sealed
          ? "Lo que este equipo deja en la carpeta no se puede leer sin la contraseña, que tiene que ser la misma en todos tus equipos."
          : "Los archivos de la carpeta van sin cifrar: quien pueda leer tu nube puede leer tu cartera. Pon una contraseña y repítela en cada equipo."}{" "}
        Si la olvidas no pierdes nada: pones otra en todos y se vuelve a publicar.
      </Row>
      <div className="border-t border-line px-5 py-3 text-[12px] text-pretty text-mute">
        Se sincroniza al abrir la app, al volver a su ventana y poco después de cada cambio. Si el mismo registro se cambia en dos equipos, gana el cambio más reciente. Marca la carpeta
        como «disponible sin conexión» en tu servicio de nube. Las claves de Conexiones no viajan: se ponen en cada equipo. La contraseña del cifrado se guarda en este equipo, dentro de la base de datos
        y de sus copias.
      </div>
    </>
  );
}

/** Qué versión es esta, si hay una más nueva y los botones para buscarla e instalarla. */
function Version() {
  const version = useApp((s) => s.info?.version ?? "");
  const update = useApp((s) => s.update);
  const busy = update.status === "installing";
  const found = update.version && (update.status === "available" || busy || update.status === "error");
  return (
    <Row
      title={`Numo ${version}`}
      action={
        <div className="flex gap-2">
          {found && (
            <Btn variant="cta" onClick={() => void installUpdate()} disabled={busy}>
              {busy ? `Descargando… ${update.progress} %` : `Actualizar a la ${update.version}`}
            </Btn>
          )}
          <Btn onClick={() => void checkUpdate(true)} disabled={!backend.native || busy || update.status === "checking"}>
            {update.status === "checking" ? "Buscando…" : "Buscar actualizaciones"}
          </Btn>
        </div>
      }
    >
      {found ? (
        <span className="font-medium text-ink">Hay una versión nueva: la {update.version}. Se descarga, se instala y la app se reinicia sola; tus datos se conservan.</span>
      ) : update.status === "current" ? (
        `Tienes la última versión. Comprobado ${ago(update.checkedAt)}.`
      ) : (
        "La app busca versiones nuevas al abrirse y te avisa con un aviso arriba; instalarlas es siempre decisión tuya."
      )}
      {update.status === "error" && <span className="mt-1 block font-medium text-down">{update.error}</span>}
      <button type="button" className="mt-1 block text-mute underline decoration-line2 underline-offset-2 hover:text-ink" onClick={() => void backend.openReleases()}>
        Ver las versiones y sus novedades
      </button>
    </Row>
  );
}

export function Ajustes() {
  const info = useApp((s) => s.info);
  const state = useApp((s) => (s.demo ?? s.loaded).state);
  const real = useApp((s) => s.loaded.state);
  const demo = useApp((s) => s.demo != null);
  const example = useApp((s) => isExample(s));
  const syncing = useApp((s) => s.syncing);
  const [light, flipTheme] = useTheme();
  const [accent, setAccent] = useAccent();
  const auto = state.assets.filter((a) => a.priceSource !== "manual").length;
  const today = todayIso();
  const currencies = [...new Set([...state.assets, ...state.accounts].map((a) => a.currency))]
    .filter((c) => c !== "EUR")
    .sort()
    .map((c) => ({ currency: c, ...fxHealth(state.fx[c], today) }));

  const backup = async () => {
    try {
      const path = await backend.exportBackup(`numo-copia-${todayIso()}.db`);
      if (path) toast("Copia guardada");
    } catch (e) {
      toast(`No se pudo guardar la copia: ${e instanceof Error ? e.message : e}`, { tone: "error" });
    }
  };
  const exportAll = async () => {
    const path = await saveText(`numo-operaciones-${todayIso()}.csv`, txsToCsv(state));
    if (path) toast(`${state.txs.length} operaciones exportadas`);
  };

  return (
    <div className="screen flex max-w-[780px] flex-col gap-5">
      <Group title="Tus datos">
        <Row
          title="Copia de seguridad"
          action={
            <Btn onClick={backup} disabled={!backend.native}>
              Guardar una copia…
            </Btn>
          }
        >
          Tus datos viven en un único archivo en este ordenador (no es una copia: es la base de datos de la app). Numo guarda además una copia diaria, las 14 últimas, en la carpeta «copias» que hay a su lado. La copia que guardas tú no lleva tus claves (la de Indexa Capital ni la contraseña de sincronización): si la restauras, se vuelven a poner en Ajustes.
          <div className="selectable mt-1 text-[12px] break-all text-mute">Base de datos: {info?.dbPath}</div>
        </Row>
        <Row
          title="Exportar todas las operaciones"
          action={
            <Btn onClick={exportAll} disabled={!state.txs.length}>
              Exportar CSV
            </Btn>
          }
        >
          Un CSV legible con todo el libro de operaciones, para abrirlo en una hoja de cálculo o guardarlo aparte.
        </Row>
      </Group>

      <Group title="Precios y tipos de cambio">
        <Row
          title="Actualización"
          action={
            <Btn onClick={() => void sync(true)} disabled={syncing || example}>
              {syncing ? "Actualizando…" : "Actualizar ahora"}
            </Btn>
          }
        >
          {example
            ? "La cartera de ejemplo usa precios inventados y no se actualiza."
            : `Se actualizan solos al abrir la app si han pasado más de 6 horas. ${auto} de ${state.assets.length} activos tienen precio automático. Última descarga: ${ago(real.lastSync)}. El estado de cada activo está en Activos.`}
        </Row>
        {currencies.length > 0 && (
          <Row title="Tipos de cambio">
            Los de referencia del BCE, un valor por día hábil. Con ellos se pasa a euros, día a día, lo que tienes en otra divisa; el cambio de cada operación es el que tú guardas con ella.
            <span className="mt-1.5 block">
              {currencies.map((c, i) => (
                <span key={c.currency} className="whitespace-nowrap">
                  {i > 0 && " · "}
                  <span className="font-medium text-ink">{c.currency}</span> {c.rate == null ? "sin datos" : num(c.rate, 4, 4)}
                  {c.date && ` (${dateBrief(c.date, today)})`}
                  {c.late && <span className="font-medium text-acc"> atrasado</span>}
                </span>
              ))}
            </span>
          </Row>
        )}
      </Group>

      <Group title="Conexiones">
        <Connection service="indexa" title="Indexa Capital" placeholder="Token de solo lectura">
          Valor de tu plan o de tus fondos, directamente de la gestora. De su respuesta solo se guarda el precio y la fecha.
        </Connection>
        <div className="border-t border-line px-5 py-3 text-[12px] text-pretty text-mute">
          El token se guarda en tu base de datos, en este ordenador, y solo viaja a Indexa. Va incluido en las copias de seguridad: no compartas una copia sin quitarlo antes.
        </div>
      </Group>

      <Group title="Sincronización entre equipos">
        <Devices />
      </Group>

      <Group title="Versión">
        <Version />
      </Group>

      <Group title="Apariencia">
        <Row
          title="Tema"
          action={
            <Btn onClick={flipTheme} className="!gap-[7px]">
              {light ? <Moon size={14} /> : <Sun size={14} />}
              {light ? "Cambiar a oscuro" : "Cambiar a claro"}
            </Btn>
          }
        >
          Claro u oscuro; también desde el pie del menú lateral.
        </Row>
        <Row
          title="Color de acento"
          action={
            <div role="radiogroup" aria-label="Color de acento" className="flex gap-1.5">
              {ACCENTS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={accent === id}
                  aria-label={label}
                  title={label}
                  data-accent={id}
                  onClick={() => setAccent(id)}
                  className={`grid size-7 place-items-center rounded-full transition-transform active:scale-90 ${accent === id ? "shadow-[0_0_0_2px_var(--card),0_0_0_3.5px_var(--ink)]" : "hover:scale-110"}`}
                  style={{ background: id === "ambar" ? "#e3b15b" : "var(--accent)" }}
                />
              ))}
            </div>
          }
        >
          El color de los botones principales, las líneas de los gráficos y lo que está seleccionado. No hay verde ni rojo: aquí significan ganancia y pérdida.
        </Row>
      </Group>

      <Group title="Atajos de teclado">
        <div className="grid gap-x-8 gap-y-2 border-t border-line px-5 py-4 text-[12.5px] text-ink2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {(
            [
              ["N", "Registrar una operación"],
              ["P", "Poner o quitar el modo privado"],
              ["Esc", "Cerrar un diálogo o una lista"],
            ] as const
          ).map(([key, what]) => (
            <span key={key} className="flex items-center gap-2.5">
              <kbd className="grid h-6 min-w-6 place-items-center rounded-md border border-line2 bg-wash px-1.5 font-sans text-[11.5px] font-semibold text-ink">{key}</kbd>
              {what}
            </span>
          ))}
        </div>
      </Group>

      <Group title="Cartera de ejemplo">
        <Row title={demo ? "Estás viendo la cartera de ejemplo" : "Probar con datos inventados"} action={backend.native ? <Btn onClick={() => setDemo(!demo)}>{demo ? "Volver a mis datos" : "Ver la cartera de ejemplo"}</Btn> : undefined}>
          Una cartera ficticia para explorar la app. Mientras está activa no se guarda nada y tus datos no se tocan.
        </Row>
      </Group>

      <p className="m-0 px-1 text-[12px] text-pretty text-mute">
        Numo {info?.version}. Sin cuentas de usuario ni servidores propios: la app solo se conecta a las fuentes de precios (Deutsche Börse, BME, Nasdaq, fundinfo y Binance, con Yahoo Finance y Financial Times de respaldo), al BCE, a GitHub para saber si hay una versión nueva y, si pones tu token, a Indexa Capital. A las fuentes de precios solo envía símbolos y divisas.
      </p>
    </div>
  );
}
