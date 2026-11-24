# Caudal

Seguimiento personal de inversiones. App de escritorio (Tauri) para un solo usuario: cuentas, compras, ventas, dividendos, varias divisas, gráficos y extractos para llevar a Hacienda. Los datos viven en un archivo SQLite en tu ordenador.

## Uso

```
pnpm install
pnpm dev            # abre la app en modo desarrollo
pnpm build          # genera Caudal.app en src-tauri/target/release/bundle/macos/
pnpm test           # tests del motor de cálculo (TypeScript)
pnpm test:native    # tests del núcleo nativo (Rust)
pnpm typecheck
pnpm dev:web        # solo la interfaz en un navegador, con la cartera de ejemplo
```

Requisitos: Node 22+, pnpm, Rust y las herramientas de línea de comandos de Xcode.

## Cómo está hecha

Una idea manda sobre todo lo demás: **solo se guarda lo que tú registras** (cuentas, activos, operaciones) y los datos de mercado descargados. Posiciones, lotes, plusvalías, rentabilidades e informes se calculan al vuelo cada vez; no hay tablas derivadas que puedan desincronizarse.

| Carpeta | Qué hay |
|---|---|
| `shared/` | Modelo de datos, validación y el **motor de cálculo** (funciones puras, con tests): libro de operaciones y lotes FIFO, serie diaria y rentabilidad, informe anual, formato CSV. |
| `src/data/` | Almacén de estado, datos de mercado y la frontera con el núcleo nativo. La interfaz describe cambios (`Op`); nunca escribe SQL. |
| `src/charts/`, `src/ui/`, `src/features/`, `src/pages/` | Interfaz (React). Gráficos propios en SVG. |
| `src-tauri/` | Núcleo nativo en Rust. Hace tres cosas: SQLite (lecturas y lotes de escritura en una transacción), HTTPS limitado a Yahoo Finance y al BCE, y guardar archivos. |

Decisiones de cálculo que conviene conocer:

- **Moneda de referencia: EUR.** Cada operación guarda su importe en su divisa y el tipo de cambio de ese día (por defecto, el de referencia del BCE; editable).
- **FIFO global por valor**, no por cuenta: las ventas consumen las compras más antiguas del mismo activo aunque estén en otra entidad.
- **Traspasos** entre fondos: no son una venta; el destino hereda fecha y coste de adquisición.
- **Splits**: las operaciones se registran tal como se ejecutaron; las unidades se ajustan solas.
- **Rentabilidad**: TWR (ponderada por tiempo) para el porcentaje y TIR anualizada (ponderada por dinero).
- Caudal **no calcula impuestos**. El informe anual entrega los datos (ventas emparejadas, rendimientos y retenciones, posiciones y saldos a 31 de diciembre) y avisa de pérdidas con recompra cercana, sin decidir nada.

## Datos y copias

- Base de datos: `~/Library/Application Support/app.caudal.desktop/caudal.db`.
- Copia diaria automática (las 14 últimas) en la carpeta `copias/` de al lado.
- Ajustes → «Guardar una copia…» y «Exportar todas las operaciones» (CSV que la propia app vuelve a importar).
- `CAUDAL_DATA_DIR=/otra/carpeta` usa otra carpeta de datos (pruebas).

## Importar desde Numo

```
node tools/numo-a-csv.mjs            # lee la base de datos de Numo en solo lectura
```

Genera en `importar/` (ignorada por git) `numo-operaciones.csv`, `numo-precios.csv` y `numo-splits.csv`. En Caudal: Operaciones → Importar, y elige los tres archivos a la vez.

## Prueba de humo de la app real

```
CAUDAL_SMOKE=1 CAUDAL_DATA_DIR=$(mktemp -d) pnpm dev
```

Abre la app contra una carpeta temporal, escribe y relee de SQLite, importa un CSV, consulta el BCE, imprime el resultado y se cierra.
