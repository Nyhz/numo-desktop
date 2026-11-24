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

Requisitos para compilar en local: Node 22+, pnpm, Rust y, en macOS, las herramientas de línea de comandos de Xcode.

## Pantallas

| Pantalla | Qué responde |
|---|---|
| Resumen | Cuánto vale la cartera, cuánto has puesto, cuánto ha ganado y cómo se reparte. |
| Posiciones | Qué tienes, cuánto pesa cada cosa y cuánto gana o pierde. |
| Operaciones | El libro de operaciones y el flujo de efectivo; importar y exportar. |
| Plan | Cuánto te alejas de tu reparto objetivo y dónde poner la próxima aportación. |
| Inmuebles | Cuánto es ya tuyo, cuánto llevas pagado y en qué, y cuánto queda. |
| Informes | Lo que pide Hacienda por ejercicio: ventas emparejadas, rendimientos, posiciones a cierre. |
| Activos | Todo lo que sigues, lo tengas o no en cartera: de qué día es cada precio, de dónde sale y qué no se está actualizando. Aquí se añaden activos nuevos. |
| Cuentas · Ajustes | Cuentas, copias de seguridad, conexiones con servicios de datos y tema. |

**Modo privado.** El ojo de la barra lateral (o la tecla `P`) emborrona importes, saldos y unidades en todas las pantallas, para enseñar la app sin enseñar cuánto hay; porcentajes, precios de mercado y fechas se siguen viendo. Se recuerda entre aperturas. Es solo visual (`src/ui/privacy.ts` y la clase `.priv`): no afecta a los datos ni a lo que se exporta, y lo que se escribe en los formularios no se oculta.

Al abrir, una animación de carga («Marea») acompaña a la actualización de precios y termina convirtiendo una de las ondas del logo en la curva de la cartera. Tiene dos variantes: completa, con el avance activo a activo, cuando hay precios que actualizar; y corta cuando la app se abrió hace poco y están al día. Se salta con un clic y no se muestra si el sistema pide reducir el movimiento. Para verla en `pnpm dev:web`: `?splash=full` enseña la completa con la cartera de ejemplo y `?splash=off` la quita.

## Cómo está hecha

Una idea manda sobre todo lo demás: **solo se guarda lo que tú registras** (cuentas, activos, operaciones, bloques del plan, inmuebles e hipotecas) y los datos de mercado descargados. Posiciones, lotes, plusvalías, rentabilidades, cuadros de amortización e informes se calculan al vuelo cada vez; no hay tablas derivadas que puedan desincronizarse.

| Carpeta | Qué hay |
|---|---|
| `shared/` | Modelo de datos, validación y el **motor de cálculo** (funciones puras, con tests): libro de operaciones y lotes FIFO, serie diaria y rentabilidad, informe anual, plan, hipoteca, formato CSV. |
| `src/data/` | Almacén de estado, datos de mercado y la frontera con el núcleo nativo. La interfaz describe cambios (`Op`); nunca escribe SQL. |
| `src/charts/`, `src/ui/`, `src/features/`, `src/pages/` | Interfaz (React). Gráficos propios en HTML/SVG; tokens visuales en `src/styles.css`. |
| `src-tauri/` | Núcleo nativo en Rust. Hace tres cosas: SQLite (lecturas y lotes de escritura en una transacción), HTTPS limitado a los servidores de datos (Deutsche Börse, BME, Nasdaq, fundinfo, Binance, Indexa Capital, Yahoo Finance, Financial Times y el BCE), y guardar archivos. |

Decisiones de cálculo que conviene conocer:

- **Moneda de referencia: EUR.** Cada operación guarda su importe en su divisa y el tipo de cambio de ese día (por defecto, el de referencia del BCE; editable).
- **FIFO global por valor**, no por cuenta: las ventas consumen las compras más antiguas del mismo activo aunque estén en otra entidad.
- **Traspasos** entre fondos: no son una venta; el destino hereda fecha y coste de adquisición.
- **Splits**: las operaciones se registran tal como se ejecutaron; las unidades se ajustan solas.
- **Rentabilidad**: TWR (ponderada por tiempo) para el porcentaje y TIR anualizada (ponderada por dinero).
- **Precios**: cada activo tiene una fuente, todas gratuitas y sin cupo diario. Los cotizados se piden a su propia bolsa: Deutsche Börse (Xetra, por ISIN), BME (Madrid, por ISIN) y Nasdaq (EE. UU., por ticker); los fondos, a fundinfo (por ISIN); las criptomonedas, a Binance; el plan o la cartera de Indexa Capital, a su API con tu token de solo lectura. Si la fuente de un activo falla, se usa un respaldo (Yahoo Finance para cotizados, Financial Times para fondos) y queda anotado. También se puede elegir Yahoo, Financial Times o precio manual. Se actualizan al abrir la app (si han pasado más de 6 horas) para todos los activos dados de alta, con o sin posición. Al añadir un activo se comprueba que su fuente da precio; cada fallo queda anotado por activo y se ve en Activos. Cambiar un activo de fuente conserva su histórico.
- **Ojo**: las de las bolsas y fundinfo no son APIs documentadas, sino los servicios que usan sus propias webs; pueden cambiar sin aviso. Por eso existen el respaldo y la pantalla Activos.
- **Token de Indexa**: se pone en Ajustes → Conexiones. Se guarda en la base de datos local y lo añade el núcleo nativo a cada petición; la interfaz solo sabe si existe. Va dentro de las copias de seguridad.
- **Plan**: la aportación va entera al bloque más retrasado (al que hoy le faltan más euros), en una sola operación para ahorrar comisiones, aunque lo deje por encima de su objetivo. Nunca propone vender.
- **Hipoteca**: amortización francesa; el cuadro se deriva de las condiciones y de los eventos (revisión del tipo, cuota real).
- Caudal **no calcula impuestos**. El informe anual entrega los datos y avisa de pérdidas con recompra cercana, sin decidir nada.

## Datos y copias

- Base de datos: `~/Library/Application Support/app.caudal.desktop/caudal.db` en macOS; `%APPDATA%\app.caudal.desktop\caudal.db` en Windows.
- Copia diaria automática (las 14 últimas) en la carpeta `copias/` de al lado.
- Ajustes → «Guardar una copia…» y «Exportar todas las operaciones» (CSV que la propia app vuelve a importar).
- `CAUDAL_DATA_DIR=/otra/carpeta` usa otra carpeta de datos (pruebas).

## Varios equipos

Para usar Caudal en más de un ordenador (Mac y Windows, por ejemplo): Ajustes → Sincronización entre equipos → «Elegir carpeta…», y elegir **en cada equipo la misma carpeta** de un servicio de nube (Proton Drive, iCloud, OneDrive, Dropbox…). La app crea dentro una carpeta `numo-app`.

- La base de datos no se comparte: cada equipo tiene la suya. En la carpeta hay un archivo JSON por equipo con sus registros (cuentas, activos, operaciones, plan, inmuebles), cuándo cambió cada uno, cuáles se han borrado y el histórico de precios.
- Al sincronizar se leen los archivos de los demás y, registro a registro, **gana el cambio más reciente** (un borrado es un cambio más). Un equipo recién instalado nunca borra nada en los otros.
- Se sincroniza al abrir la app, al volver a su ventana, poco después de cada cambio y con «Sincronizar ahora». Lo rápido que llegue al otro equipo depende del servicio de nube.
- Antes de aplicar borrados o muchos cambios de golpe se guarda una copia en `copias/`.
- No viajan: las claves de Conexiones (se ponen en cada equipo), los tipos de cambio (cada equipo los descarga) ni los ajustes de apariencia.
- Conviene marcar la carpeta como «disponible sin conexión» en el servicio de nube, para que los archivos estén siempre en disco.

La lógica está en `src/data/sync.ts` (pura, con pruebas de varios equipos simulados); el núcleo nativo solo lee y escribe esos archivos.

## Versiones y descargas

Los instaladores para **macOS** (un `.dmg` que sirve para Apple Silicon e Intel) y **Windows** (`-setup.exe`, 64 bits) están en la página de versiones del repositorio (Releases). Los compila GitHub; no hace falta tener nada instalado.

Para publicar una versión nueva, con todos los cambios ya subidos a `main`:

```
pnpm publicar            # parche: 0.1.0 → 0.1.1 (arreglos)
pnpm publicar minor      # 0.1.4 → 0.2.0 (funciones nuevas)
pnpm publicar major      # 0.9.2 → 1.0.0 (la versión redonda)
```

También desde la web de GitHub: Actions → «Publicar versión» → Run workflow. El flujo (`.github/workflows/release.yml`) sube el número en `package.json` (el único sitio donde está escrito; la app lo lee de ahí), pasa los tipos y los tests, crea la etiqueta `vX.Y.Z`, compila para los dos sistemas y publica la versión con sus instaladores y la lista de cambios. Si una compilación falla, la versión se queda en borrador: se relanza el trabajo fallido desde Actions. Al terminar, `git pull` trae el commit «Versión X.Y.Z».

Cada cambio que se sube a `main` pasa además las comprobaciones de `.github/workflows/ci.yml` (tipos, tests del motor y tests del núcleo nativo).

Los instaladores no están firmados con certificados de pago: la primera vez, macOS pide abrir la app desde Ajustes del Sistema → Privacidad y seguridad → «Abrir igualmente», y Windows muestra «Windows protegió su PC» → «Más información» → «Ejecutar de todas formas». Cada instalación guarda sus datos en su ordenador (en Windows, `%APPDATA%\app.caudal.desktop\caudal.db`); instalar una versión nueva encima los conserva.

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
