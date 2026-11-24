# Caudal

Seguimiento personal de inversiones. App de escritorio (Tauri) para un solo usuario: cuentas, compras, ventas, dividendos, varias divisas, plan de inversión, inmuebles con su hipoteca, gráficos y extractos para llevar a Hacienda. Los datos viven en un archivo SQLite en tu ordenador.

## Uso

```
pnpm install
pnpm dev            # abre la app en modo desarrollo
pnpm build          # genera Caudal.app en src-tauri/target/release/bundle/macos/
pnpm test           # tests del motor de cálculo y de los lectores de datos de mercado
pnpm test:native    # tests del núcleo nativo (Rust)
pnpm typecheck
pnpm dev:web        # solo la interfaz en un navegador, con la cartera de ejemplo
```

Requisitos: Node 22+, pnpm, Rust y las herramientas de línea de comandos de Xcode.

## Pantallas

| Pantalla | Qué responde |
|---|---|
| Resumen | Cuánto vale la cartera, cuánto has puesto, cuánto ha ganado y cómo se reparte. |
| Posiciones | Qué tienes, cuánto pesa cada cosa y cuánto gana o pierde. |
| Operaciones | El libro de operaciones y el flujo de efectivo; importar y exportar. |
| Plan | Cuánto te alejas de tu reparto objetivo y dónde poner la próxima aportación. |
| Inmuebles | Cuánto es ya tuyo, cuánto llevas pagado, cuánto queda y qué pasa si amortizas. |
| Informes | Lo que pide Hacienda por ejercicio: ventas emparejadas, rendimientos, posiciones a cierre. |
| Activos | Todo lo que sigues, lo tengas o no en cartera: de qué día es cada precio, de dónde sale y qué no se está actualizando. Aquí se añaden activos nuevos. |
| Cuentas · Ajustes | Cuentas, copias de seguridad, conexiones con servicios de datos y tema. |

## Cómo está hecha

Una idea manda sobre todo lo demás: **solo se guarda lo que tú registras** (cuentas, activos, operaciones, bloques del plan, inmuebles e hipotecas) y los datos de mercado descargados. Posiciones, lotes, plusvalías, rentabilidades, cuadros de amortización e informes se calculan al vuelo cada vez; no hay tablas derivadas que puedan desincronizarse.

| Carpeta | Qué hay |
|---|---|
| `shared/` | Modelo de datos, validación y el **motor de cálculo** (funciones puras, con tests): libro de operaciones y lotes FIFO, serie diaria y rentabilidad, informe anual, plan, hipoteca, formato CSV. |
| `src/data/` | Almacén de estado, datos de mercado y la frontera con el núcleo nativo. La interfaz describe cambios (`Op`); nunca escribe SQL. |
| `src/charts/`, `src/ui/`, `src/features/`, `src/pages/` | Interfaz (React). Gráficos propios en HTML/SVG; tokens visuales en `src/styles.css`. |
| `src-tauri/` | Núcleo nativo en Rust. Hace tres cosas: SQLite (lecturas y lotes de escritura en una transacción), HTTPS limitado a los servidores de datos (Yahoo Finance, EODHD, Binance, Indexa Capital, Financial Times y el BCE), y guardar archivos. |

Decisiones de cálculo que conviene conocer:

- **Moneda de referencia: EUR.** Cada operación guarda su importe en su divisa y el tipo de cambio de ese día (por defecto, el de referencia del BCE; editable).
- **FIFO global por valor**, no por cuenta: las ventas consumen las compras más antiguas del mismo activo aunque estén en otra entidad.
- **Traspasos** entre fondos: no son una venta; el destino hereda fecha y coste de adquisición.
- **Splits**: las operaciones se registran tal como se ejecutaron; las unidades se ajustan solas.
- **Rentabilidad**: TWR (ponderada por tiempo) para el porcentaje y TIR anualizada (ponderada por dinero).
- **Precios**: cada activo tiene una fuente. Yahoo Finance (por símbolo), EODHD (acciones, ETF y fondos, con clave), Binance (criptomonedas en euros, velas diarias públicas), Indexa Capital (el valor de tu plan o cartera, con tu token de solo lectura), Financial Times (fondos por ISIN) o manual. Se actualizan al abrir la app (si han pasado más de 6 horas; 12 en EODHD, que tiene cupo diario) para todos los activos dados de alta, con o sin posición. Al añadir un activo se comprueba que su fuente da precio; cada fallo de descarga queda anotado por activo y se ve en Activos. Cambiar un activo de fuente conserva su histórico.
- **Claves**: las de EODHD e Indexa se ponen en Ajustes → Conexiones. Se guardan en la base de datos local y las añade el núcleo nativo a cada petición; la interfaz solo sabe si existen. Van dentro de las copias de seguridad.
- **Plan**: el reparto de una aportación va primero a lo más retrasado respecto a su objetivo y nunca propone vender.
- **Hipoteca**: amortización francesa; el cuadro se deriva de las condiciones y de los eventos (amortización anticipada, revisión del tipo, cuota real).
- Caudal **no calcula impuestos**. El informe anual entrega los datos y avisa de pérdidas con recompra cercana, sin decidir nada.

## Datos y copias

- Base de datos: `~/Library/Application Support/app.caudal.desktop/caudal.db`.
- Copia diaria automática (las 14 últimas) en la carpeta `copias/` de al lado.
- Ajustes → «Guardar una copia…» y «Exportar todas las operaciones» (CSV que la propia app vuelve a importar).
- `CAUDAL_DATA_DIR=/otra/carpeta` usa otra carpeta de datos (pruebas).

## Importar desde Numo

```
node tools/numo-a-csv.mjs            # lee la base de datos de Numo en solo lectura
```

Genera en `importar/` (ignorada por git) las operaciones, el histórico de precios, los splits y un `numo-extra.json` con el plan y los inmuebles. Para cargarlos hay dos caminos:

- En la app: Operaciones → Importar, y elegir los archivos a la vez.
- Sin interfaz, sobre una base de datos vacía: `CAUDAL_IMPORT_DIR=$PWD/importar <ruta a Caudal.app>/Contents/MacOS/caudal`.

## Pruebas de la app real

```
CAUDAL_SMOKE=1 CAUDAL_DATA_DIR=$(mktemp -d) <ruta a Caudal.app>/Contents/MacOS/caudal
```

Abre la app contra una carpeta temporal, escribe y relee de SQLite, importa un CSV, consulta el BCE, imprime el resultado y se cierra. `CAUDAL_DEBUG=1` muestra cada petición de red.
