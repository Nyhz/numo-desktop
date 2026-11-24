import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { txsToCsv } from "../../shared/csv.ts";
import { todayIso } from "../../shared/dates.ts";
import { useTheme } from "../App.tsx";
import { backend, isExample, setDemo, sync, useApp } from "../data/store.ts";
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
            : `Se actualizan solos al abrir la app si han pasado más de 6 horas. ${auto} de ${state.assets.length} activos tienen precio automático (Yahoo Finance o Financial Times). Los tipos de cambio son los de referencia del BCE. Última descarga: ${ago(real.lastSync)}. El estado de cada activo está en Activos.`}
        </Row>
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
        Caudal {info?.version}. Sin cuentas de usuario ni servidores: la app solo se conecta a Yahoo Finance, Financial Times y el BCE para pedir cotizaciones, y solo envía símbolos y divisas.
      </p>
    </div>
  );
}
