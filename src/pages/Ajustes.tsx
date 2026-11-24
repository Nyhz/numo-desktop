import { Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { txsToCsv } from "../../shared/csv.ts";
import { todayIso } from "../../shared/dates.ts";
import { useTheme } from "../App.tsx";
import { backend, chooseSyncFolder, connectionStatus, deviceOf, isExample, renameDevice, saveSecret, setDemo, stopSync, sync, syncDevices, syncFolder, useApp, type Service } from "../data/store.ts";
import { saveText } from "../lib/export.ts";
import { ago } from "../lib/format.ts";
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
        Para usar Caudal en varios equipos, elige en cada uno la misma carpeta de un servicio de nube (Proton Drive, iCloud, OneDrive, Dropbox…). La app crea dentro una carpeta
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
      <div className="border-t border-line px-5 py-3 text-[12px] text-pretty text-mute">
        Se sincroniza al abrir la app, al volver a su ventana y poco después de cada cambio. Si el mismo registro se cambia en dos equipos, gana el cambio más reciente. Marca la carpeta
        como «disponible sin conexión» en tu servicio de nube. Las claves de Conexiones no viajan: se ponen en cada equipo.
      </div>
    </>
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
  const auto = state.assets.filter((a) => a.priceSource !== "manual").length;

  const backup = async () => {
    try {
      const path = await backend.exportBackup(`caudal-copia-${todayIso()}.db`);
      if (path) toast("Copia guardada");
    } catch (e) {
      toast(`No se pudo guardar la copia: ${e instanceof Error ? e.message : e}`, { tone: "error" });
    }
  };
  const exportAll = async () => {
    const path = await saveText(`caudal-operaciones-${todayIso()}.csv`, txsToCsv(state));
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
          Todo está en un único archivo en tu ordenador. Caudal guarda además una copia diaria (las 14 últimas) en la carpeta «copias», junto a la base de datos.
          <div className="selectable mt-1 text-[12px] break-all text-mute">{info?.dbPath}</div>
        </Row>
        <Row
          title="Exportar todas las operaciones"
          action={
            <Btn onClick={exportAll} disabled={!state.txs.length}>
              Exportar CSV
            </Btn>
          }
        >
          Un CSV legible con todo el libro de operaciones. Es el mismo formato que entiende «Importar», así que también sirve para mover tus datos.
        </Row>
        <Row title="Importar" action={<Btn onClick={() => openDialog({ kind: "import" })}>Importar…</Btn>}>
          Operaciones, precios históricos, splits, plan e inmuebles desde archivos CSV o JSON, por ejemplo los que genera el conversor de Numo (tools/numo-a-csv.mjs).
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
            : `Se actualizan solos al abrir la app si han pasado más de 6 horas. ${auto} de ${state.assets.length} activos tienen precio automático. Los tipos de cambio son los de referencia del BCE. Última descarga: ${ago(real.lastSync)}. El estado de cada activo está en Activos.`}
        </Row>
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
      </Group>

      <Group title="Cartera de ejemplo">
        <Row title={demo ? "Estás viendo la cartera de ejemplo" : "Probar con datos inventados"} action={backend.native ? <Btn onClick={() => setDemo(!demo)}>{demo ? "Volver a mis datos" : "Ver la cartera de ejemplo"}</Btn> : undefined}>
          Una cartera ficticia para explorar la app. Mientras está activa no se guarda nada y tus datos no se tocan.
        </Row>
      </Group>

      <p className="m-0 px-1 text-[12px] text-pretty text-mute">
        Caudal {info?.version}. Sin cuentas de usuario ni servidores propios: la app solo se conecta a las fuentes de precios (Deutsche Börse, BME, Nasdaq, fundinfo y Binance, con Yahoo Finance y Financial Times de respaldo), al BCE y, si pones tu token, a Indexa Capital. A las fuentes de precios solo envía símbolos y divisas.
      </p>
    </div>
  );
}
