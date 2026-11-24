import { txsToCsv } from "../../shared/csv.ts";
import { todayIso } from "../../shared/dates.ts";
import { backend, isExample, setDemo, sync, useApp } from "../data/store.ts";
import { saveText } from "../lib/export.ts";
import { ago } from "../lib/format.ts";
import { openDialog } from "../ui/dialogs.ts";
import { Button, Section, toast } from "../ui/kit.tsx";

function Row({ title, children, action }: { title: string; children: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-line py-3.5">
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <div className="mt-0.5 text-[12.5px] text-ink-2">{children}</div>
      </div>
      <div className="flex shrink-0 gap-2">{action}</div>
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
  const issues = useApp((s) => s.issues);
  const auto = state.assets.filter((a) => a.priceSource === "yahoo").length;

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
    <div className="grid max-w-3xl gap-10">
      <Section title="Tus datos">
        <div className="border-t border-line">
          <Row
            title="Copia de seguridad"
            action={
              <Button onClick={backup} disabled={!backend.native}>
                Guardar una copia…
              </Button>
            }
          >
            Todo está en un único archivo en tu ordenador. Caudal guarda además una copia diaria (las 14 últimas) en la carpeta «copias», junto a la base de datos.
            <div className="selectable mt-1 break-all text-muted">{info?.dbPath}</div>
          </Row>
          <Row
            title="Exportar todas las operaciones"
            action={
              <Button onClick={exportAll} disabled={!state.txs.length}>
                Exportar CSV
              </Button>
            }
          >
            Un CSV legible con todo el libro de operaciones. Es el mismo formato que entiende «Importar», así que también sirve para mover tus datos.
          </Row>
          <Row title="Importar" action={<Button onClick={() => openDialog({ kind: "import" })}>Importar CSV…</Button>}>
            Operaciones, precios históricos y splits desde archivos CSV, por ejemplo los que genera el conversor de Numo (<span className="selectable">tools/numo-a-csv.mjs</span>).
          </Row>
        </div>
      </Section>

      <Section title="Precios y tipos de cambio">
        <div className="border-t border-line">
          <Row
            title="Actualización"
            action={
              <Button onClick={() => void sync(true)} disabled={syncing || example}>
                {syncing ? "Actualizando…" : "Actualizar ahora"}
              </Button>
            }
          >
            {example
              ? "La cartera de ejemplo usa precios inventados y no se actualiza."
              : `Se actualizan solos al abrir la app. ${auto} de ${state.assets.length} activos tienen precio automático (Yahoo Finance); los tipos de cambio son los de referencia del BCE. Última actualización: ${ago(real.lastSync)}.`}
          </Row>
          {issues.length > 0 && (
            <div className="border-b border-line py-3.5">
              <div className="mb-1.5 font-medium text-warn">Avisos de la última actualización</div>
              <ul className="selectable grid gap-1 text-[12.5px] text-ink-2">
                {issues.map((i, k) => (
                  <li key={k}>
                    <strong className="font-medium text-ink">{i.what}:</strong> {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      <Section title="Cartera de ejemplo">
        <div className="border-t border-line">
          <Row
            title={demo ? "Estás viendo la cartera de ejemplo" : "Probar con datos inventados"}
            action={backend.native ? <Button onClick={() => setDemo(!demo)}>{demo ? "Volver a mis datos" : "Ver la cartera de ejemplo"}</Button> : null}
          >
            Una cartera ficticia para explorar la app. Mientras está activa no se guarda nada y tus datos no se tocan.
          </Row>
        </div>
      </Section>

      <p className="text-[12px] text-muted">
        Caudal {info?.version}. Sin cuentas de usuario ni servidores: la app solo se conecta a Yahoo Finance y al BCE para pedir cotizaciones, y solo envía símbolos y divisas.
      </p>
    </div>
  );
}
