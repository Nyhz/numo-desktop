# Desarrollo de Numo

Notas para quien trabaja en el código. Lo que hace la app y cómo se usa está en el [README](../README.md).

## Poner en marcha

```
pnpm install
pnpm dev            # abre la app en modo desarrollo
pnpm build          # genera Numo App.app en src-tauri/target/release/bundle/macos/
pnpm test           # tests del motor de cálculo y de los lectores de datos de mercado
pnpm test:native    # tests del núcleo nativo (Rust)
pnpm typecheck
pnpm dev:web        # solo la interfaz en un navegador, con la cartera de ejemplo
```

Requisitos para compilar en local: Node 22+, pnpm, Rust y, en macOS, las herramientas de línea de comandos de Xcode.

Cada cambio que se sube a `main` pasa las comprobaciones de `.github/workflows/ci.yml` (tipos, tests del motor y tests del núcleo nativo).

En `pnpm dev:web`: `?splash=full` enseña la animación de arranque completa (el logo que se llena) con la cartera de ejemplo, `?splash=off` la quita y `?update=1.2.3` simula que hay una versión nueva.

## Cómo está hecha

Una idea manda sobre todo lo demás: **solo se guarda lo que tú registras** (cuentas, activos, operaciones, bloques del plan, inmuebles e hipotecas) y los datos de mercado descargados. Posiciones, lotes, plusvalías, rentabilidades, cuadros de amortización e informes se calculan al vuelo cada vez; no hay tablas derivadas que puedan desincronizarse.

| Carpeta | Qué hay |
|---|---|
| `shared/` | Modelo de datos, validación y el **motor de cálculo** (funciones puras, con tests): libro de operaciones y lotes FIFO, serie diaria y rentabilidad, informe anual, plan, hipoteca, formato CSV. |
| `src/data/` | Almacén de estado, datos de mercado y la frontera con el núcleo nativo. La interfaz describe cambios (`Op`); nunca escribe SQL. |
| `src/charts/`, `src/ui/`, `src/features/`, `src/pages/` | Interfaz (React). Gráficos propios en HTML/SVG; tokens visuales en `src/styles.css`. |
| `src-tauri/` | Núcleo nativo en Rust. Hace lo que la interfaz no puede: SQLite (lecturas y lotes de escritura en una transacción), HTTPS limitado a los servidores de datos (Deutsche Börse, BME, Nasdaq, fundinfo, Binance, Indexa Capital, Yahoo Finance, Financial Times y el BCE), leer y escribir los archivos de sincronización, guardar archivos y actualizar la app. |

- **Ojo**: las de las bolsas y fundinfo no son APIs documentadas, sino los servicios que usan sus propias webs; pueden cambiar sin aviso. Por eso existen el respaldo y la pantalla Activos.
- **Modo privado**: es solo visual. `src/ui/privacy.ts` marca `<html data-private>` y el CSS desenfoca lo que lleve la clase `.priv`; una cifra nueva hay que marcarla.
- **Sincronización**: la lógica está en `src/data/sync.ts` (pura, con pruebas de varios equipos simulados); el núcleo nativo solo lee y escribe los archivos, y los cifra si hay contraseña.
- **Token de Indexa y contraseña de la sincronización**: se guardan en la tabla `meta` con el prefijo `secret:`; el núcleo nativo los usa y la interfaz solo sabe si existen.
- **Datos de otra carpeta**: `NUMO_DATA_DIR=/otra/carpeta` usa otra carpeta de datos (pruebas). Hasta la 0.3 la app tenía otro nombre y otra carpeta de datos; la primera vez que se abre copia esa base de datos a la nueva y no toca la antigua.

## El nombre

La app se llama **Numo** en todo lo que enseña: ventana, textos, avisos, informes y documentación. El nombre del producto instalado (`productName` en `src-tauri/tauri.conf.json`) sigue siendo «Numo App», y por eso el paquete de macOS es `Numo App.app` y los instaladores llevan ese nombre. No se cambia a la ligera: en Windows el instalador usa ese nombre para decidir dónde instalar, así que una actualización con otro nombre dejaría dos copias, y al desinstalar la antigua se ofrece borrar los datos, que son compartidos.

## Pruebas de la app real

```
NUMO_SMOKE=1 NUMO_DATA_DIR=$(mktemp -d) <ruta a Numo App.app>/Contents/MacOS/numo-app
```

Abre la app contra una carpeta temporal, escribe y relee de SQLite, importa un CSV, consulta el BCE, imprime el resultado y se cierra. `NUMO_DEBUG=1` muestra cada petición de red.

## Publicar una versión

Con todos los cambios ya subidos a `main`:

```
pnpm publicar            # parche: 0.1.0 → 0.1.1 (arreglos)
pnpm publicar minor      # 0.1.4 → 0.2.0 (funciones nuevas)
pnpm publicar major      # 0.9.2 → 1.0.0 (la versión redonda)
```

También desde la web de GitHub: Actions → «Publicar versión» → Run workflow. El flujo (`.github/workflows/release.yml`) sube el número en `package.json` (el único sitio donde está escrito; la app lo lee de ahí), pasa los tipos y los tests, crea la etiqueta `vX.Y.Z`, compila para los dos sistemas y publica la versión con sus instaladores, sus firmas y el `latest.json` que consultan las apps instaladas para actualizarse. Si una compilación falla, la versión se queda en borrador: se relanza el trabajo fallido desde Actions. Al terminar, `git pull` trae el commit «Versión X.Y.Z».

Las actualizaciones se firman con una clave propia (no es un certificado de Apple ni de Microsoft): la mitad pública está en `src-tauri/tauri.conf.json` y la privada, en el secreto `TAURI_SIGNING_PRIVATE_KEY` del repositorio. Si esa clave se pierde, las apps ya instaladas no aceptarán más actualizaciones y habrá que reinstalarlas a mano.
