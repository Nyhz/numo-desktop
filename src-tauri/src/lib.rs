//! Núcleo nativo de Numo.
//!
//! Hace solo tres cosas que la interfaz no puede hacer por sí misma:
//! guardar en SQLite, pedir datos de mercado por HTTPS y escribir archivos.
//! Toda la lógica de cartera vive en TypeScript (carpeta `shared/`).

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};

use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::{
    aead::{rand_core::RngCore, Aead, AeadCore, KeyInit, OsRng},
    XChaCha20Poly1305, XNonce,
};

use rusqlite::{
    params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

/// Migraciones en orden. `PRAGMA user_version` recuerda la última aplicada.
/// Nunca se edita una ya publicada: se añade otra al final.
const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/001_init.sql"),
    include_str!("../migrations/002_plan_inmuebles.sql"),
    include_str!("../migrations/003_sync.sql"),
    include_str!("../migrations/004_sin_cuenta_banco.sql"),
];

/// Únicos servidores a los que la app puede conectarse.
const ALLOWED_HOSTS: &[&str] = &[
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "data-api.ecb.europa.eu",
    "markets.ft.com",
    "api.boerse-frankfurt.de",
    "apiweb.bolsasymercados.es",
    "api.nasdaq.com",
    "www.fundinfo.com",
    "data-api.binance.vision",
    "api.indexacapital.com",
];

/// Servidores que piden una clave del usuario. La clave vive en la tabla `meta`
/// con el prefijo `secret:`; la añade este núcleo a cada petición y la interfaz
/// no la carga al arrancar (solo sabe si existe).
const SECRET_PREFIX: &str = "secret:";

const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

const BACKUPS_KEPT: usize = 14;

struct Db {
    conn: Mutex<Connection>,
    path: PathBuf,
}

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null | ValueRef::Blob(_) => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
    }
}

fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 4000;",
    )?;
    Ok(conn)
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current.max(0) as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
        tx.commit()?;
    }
    Ok(())
}

/// Días desde 1970-01-01 → (año, mes, día). Algoritmo civil de Howard Hinnant.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

fn today_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    format!("{y:04}-{m:02}-{d:02}")
}

/// Copia diaria junto a la base de datos, antes de aplicar migraciones.
/// Un fallo aquí no debe impedir abrir la app: solo se avisa por consola.
fn daily_backup(conn: &Connection, db_path: &Path) {
    let Some(dir) = db_path.parent().map(|p| p.join("copias")) else {
        return;
    };
    let run = || -> Result<(), String> {
        fs::create_dir_all(&dir).map_err(err)?;
        let file = dir.join(format!("numo-{}.db", today_utc()));
        if file.exists() {
            return Ok(());
        }
        conn.execute("VACUUM INTO ?1", [file.to_string_lossy().as_ref()])
            .map_err(err)?;
        let mut old: Vec<PathBuf> = fs::read_dir(&dir)
            .map_err(err)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x == "db"))
            .collect();
        old.sort();
        let excess = old.len().saturating_sub(BACKUPS_KEPT);
        for p in old.into_iter().take(excess) {
            let _ = fs::remove_file(p);
        }
        Ok(())
    };
    if let Err(e) = run() {
        eprintln!("[numo] no se pudo crear la copia diaria: {e}");
    }
}

/// La app se llamó de otra manera hasta la 0.3 y guardaba sus datos en otra
/// carpeta. Solo se usan para traerlos aquí una vez; la carpeta antigua no se borra.
const LEGACY_DIR: &str = "app.caudal.desktop";
const LEGACY_DB: &str = "caudal.db";

/// Primera apertura tras el cambio de nombre: si aquí aún no hay base de datos
/// y la versión anterior dejó la suya, se copia entera (VACUUM INTO incluye lo
/// que estuviera pendiente de consolidar). Un fallo no impide abrir la app.
fn adopt_legacy_data(dir: &Path) {
    let target = dir.join("numo.db");
    let Some(old) = dir.parent().map(|p| p.join(LEGACY_DIR).join(LEGACY_DB)) else {
        return;
    };
    if target.exists() || !old.exists() {
        return;
    }
    let run = || -> Result<(), String> {
        fs::create_dir_all(dir).map_err(err)?;
        let conn = open(&old).map_err(err)?;
        conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()]).map_err(err)?;
        Ok(())
    };
    if let Err(e) = run() {
        eprintln!("[numo] no se pudieron traer los datos de la versión anterior: {e}");
        let _ = fs::remove_file(&target);
    }
}

fn init_db(dir: &Path) -> Result<Db, String> {
    fs::create_dir_all(dir).map_err(err)?;
    let path = dir.join("numo.db");
    let existed = path.exists();
    let mut conn = open(&path).map_err(err)?;
    if existed {
        daily_backup(&conn, &path);
    }
    migrate(&mut conn).map_err(err)?;
    Ok(Db {
        conn: Mutex::new(conn),
        path,
    })
}

/// Consulta de lectura. Devuelve cada fila como lista de valores en el orden del SELECT.
#[tauri::command]
fn db_query(db: State<'_, Db>, sql: String, params: Vec<Value>) -> CmdResult<Vec<Vec<Value>>> {
    let conn = db.conn.lock().map_err(err)?;
    let mut stmt = conn.prepare_cached(&sql).map_err(err)?;
    let cols = stmt.column_count();
    let mut rows = stmt
        .query(params_from_iter(params.iter().map(to_sql)))
        .map_err(err)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(err)? {
        let mut cells = Vec::with_capacity(cols);
        for i in 0..cols {
            cells.push(from_sql(row.get_ref(i).map_err(err)?));
        }
        out.push(cells);
    }
    Ok(out)
}

#[derive(Deserialize)]
struct Statement {
    sql: String,
    /// Parámetros de una única ejecución.
    #[serde(default)]
    params: Vec<Value>,
    /// Si viene, la sentencia se ejecuta una vez por cada fila de parámetros.
    #[serde(default)]
    many: Option<Vec<Vec<Value>>>,
}

fn run_batch(conn: &mut Connection, statements: &[Statement]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for s in statements {
        let mut stmt = tx.prepare_cached(&s.sql)?;
        match &s.many {
            Some(rows) => {
                for row in rows {
                    stmt.execute(params_from_iter(row.iter().map(to_sql)))?;
                }
            }
            None => {
                stmt.execute(params_from_iter(s.params.iter().map(to_sql)))?;
            }
        }
    }
    tx.commit()
}

/// Escrituras en una sola transacción: o se aplican todas o ninguna.
#[tauri::command]
fn db_batch(db: State<'_, Db>, statements: Vec<Statement>) -> CmdResult<()> {
    let mut conn = db.conn.lock().map_err(err)?;
    run_batch(&mut conn, &statements).map_err(err)
}

fn check_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(err)?;
    let host = parsed.host_str().unwrap_or_default();
    if parsed.scheme() != "https" || !ALLOWED_HOSTS.contains(&host) {
        return Err(format!("Destino no permitido: {host}"));
    }
    Ok(parsed)
}

/// Hueco mínimo entre peticiones a Yahoo, que bloquea las ráfagas (HTTP 429).
const YAHOO_GAP: Duration = Duration::from_millis(350);
static NEXT_YAHOO_SLOT: Mutex<Option<std::time::Instant>> = Mutex::new(None);

/// Reserva el siguiente hueco libre y devuelve cuánto hay que esperar hasta él.
/// La espera se hace aquí, en nativo: los temporizadores de la interfaz se
/// congelan cuando la ventana no está a la vista.
fn reserve_yahoo_slot() -> Duration {
    let now = std::time::Instant::now();
    let mut next = NEXT_YAHOO_SLOT.lock().unwrap_or_else(|e| e.into_inner());
    let slot = match *next {
        Some(t) if t > now => t,
        _ => now,
    };
    *next = Some(slot + YAHOO_GAP);
    slot - now
}

/// Clave guardada para un servicio (`indexa`), o un error que dice dónde ponerla.
fn secret(conn: &Connection, name: &str, label: &str) -> Result<String, String> {
    let found: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = ?1",
            [format!("{SECRET_PREFIX}{name}")],
            |r| r.get(0),
        )
        .ok();
    match found {
        Some(v) if !v.trim().is_empty() => Ok(v.trim().to_owned()),
        _ => Err(format!("Falta la clave de {label}: ponla en Ajustes → Conexiones")),
    }
}

/// Añade a la petición la clave que pide su servidor, si pide alguna.
fn authorize(conn: &Connection, url: reqwest::Url) -> Result<(reqwest::Url, Option<(&'static str, String)>), String> {
    match url.host_str().unwrap_or_default() {
        "api.indexacapital.com" => {
            let token = secret(conn, "indexa", "Indexa Capital")?;
            Ok((url, Some(("X-AUTH-TOKEN", token))))
        }
        _ => Ok((url, None)),
    }
}

/// GET por HTTPS limitado a los servidores de datos de mercado.
#[tauri::command]
async fn http_get(db: State<'_, Db>, url: String) -> CmdResult<String> {
    let parsed = check_url(&url)?;
    let host = parsed.host_str().unwrap_or_default().to_owned();
    let shown = format!("{host}{}", parsed.path());
    // La clave se lee antes de cualquier espera para no retener la base de datos.
    let (parsed, auth) = {
        let conn = db.conn.lock().map_err(err)?;
        authorize(&conn, parsed)?
    };
    // Las webs de precios bloquean las ráfagas (Yahoo responde 429): las peticiones
    // se espacian. El BCE, Binance e Indexa son APIs públicas y no lo necesitan.
    if !matches!(host.as_str(), "data-api.ecb.europa.eu" | "data-api.binance.vision" | "api.indexacapital.com") {
        tokio::time::sleep(reserve_yahoo_slot()).await;
    }
    let debug = std::env::var_os("NUMO_DEBUG").is_some();
    if debug {
        eprintln!("[numo] GET {shown}");
    }
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(err)?;
    let mut request = client.get(parsed).header("Accept", "*/*");
    if let Some((name, value)) = auth {
        request = request.header(name, value);
    }
    if host == "markets.ft.com" && url.contains("/ajax/") {
        // El histórico de FT solo responde a peticiones marcadas como AJAX.
        request = request.header("X-Requested-With", "XMLHttpRequest");
    }
    let res = request
        .send()
        .await
        .map_err(|e| format!("Sin conexión: {}", e.without_url()))?;
    let status = res.status();
    if debug {
        eprintln!("[numo]   -> {}", status.as_u16());
    }
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    res.text().await.map_err(err)
}

/// Pide al usuario dónde guardar y escribe el archivo. Devuelve la ruta, o nada si cancela.
#[tauri::command]
async fn save_file(app: AppHandle, name: String, bytes: Vec<u8>) -> CmdResult<Option<String>> {
    let Some(target) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
        return Ok(None);
    };
    let path = target.into_path().map_err(err)?;
    fs::write(&path, bytes).map_err(err)?;
    Ok(Some(path.display().to_string()))
}

/// Guarda una copia completa de la base de datos donde elija el usuario.
#[tauri::command]
async fn export_backup(app: AppHandle, name: String) -> CmdResult<Option<String>> {
    let Some(target) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
        return Ok(None);
    };
    let path = target.into_path().map_err(err)?;
    if path.exists() {
        fs::remove_file(&path).map_err(err)?;
    }
    let db = app.state::<Db>();
    let conn = db.conn.lock().map_err(err)?;
    write_shareable_copy(&conn, &path)?;
    Ok(Some(path.display().to_string()))
}

/// Copia completa de la base de datos para sacarla del equipo: sin las claves
/// (`secret:`), que se quedan en este equipo. Se borran con `secure_delete` y se
/// reescribe el archivo, para que no queden en páginas libres. Si algo falla,
/// no se deja una copia a medias.
fn write_shareable_copy(conn: &Connection, path: &Path) -> Result<(), String> {
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
        .map_err(err)?;
    let strip = || -> rusqlite::Result<()> {
        let copy = Connection::open(path)?;
        copy.execute_batch("PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON;")?;
        copy.execute("DELETE FROM meta WHERE key LIKE ?1", [format!("{SECRET_PREFIX}%")])?;
        copy.execute_batch("VACUUM;")
    };
    strip().map_err(|e| {
        let _ = fs::remove_file(path);
        err(e)
    })
}

// ── Sincronización entre equipos ────────────────────────────────────────────
// La app deja un archivo JSON por equipo en una carpeta que elige el usuario
// (normalmente la de un servicio de nube). Aquí solo se leen y escriben esos
// archivos; qué cambios se aplican lo decide la interfaz (src/data/sync.ts).

/// Nombre de la carpeta que la app crea dentro de la que elige el usuario.
const SYNC_FOLDER: &str = "numo-app";
/** Tope por archivo: muy por encima de lo que ocupa una cartera personal. */
const SYNC_MAX_BYTES: u64 = 64 * 1024 * 1024;

/// Solo archivos `nombre.json` sin rutas ni caracteres raros.
fn is_sync_name(name: &str) -> bool {
    name.strip_suffix(".json").is_some_and(|stem| {
        !stem.is_empty() && stem.len() <= 80 && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    })
}

/// La carpeta que se usará dentro de la elegida: ella misma si ya es la de Numo
/// (se llama así o tiene archivos de otro equipo), o una subcarpeta «numo-app».
fn sync_target(picked: &Path) -> PathBuf {
    let named = picked.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(SYNC_FOLDER));
    let has_files = fs::read_dir(picked).is_ok_and(|entries| {
        entries.filter_map(Result::ok).any(|e| is_sync_name(&e.file_name().to_string_lossy()))
    });
    if named || has_files { picked.to_path_buf() } else { picked.join(SYNC_FOLDER) }
}

#[tauri::command]
async fn sync_pick_dir(app: AppHandle) -> CmdResult<Option<String>> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let dir = sync_target(&picked.into_path().map_err(err)?);
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    Ok(Some(dir.display().to_string()))
}

// Cifrado de los archivos compartidos. Con una contraseña (la misma en cada
// equipo; Ajustes → Sincronización) lo que llega a la nube es ilegible sin ella:
// la clave sale de la contraseña con Argon2id y el contenido se cifra con
// XChaCha20-Poly1305, que además detecta cualquier manipulación. La contraseña
// vive en la base de datos local, como las demás claves; nunca en la carpeta.

/// Los archivos cifrados se anuncian como formato 2: una versión de la app que no
/// sepa descifrar avisa de que hay que actualizar, en vez de ignorarlos.
const SEALED_FORMAT: u64 = 2;

/// Claves ya calculadas en esta sesión (contraseña, sal → clave): derivarla cuesta a propósito.
static KEYS: Mutex<Vec<(String, Vec<u8>, [u8; 32])>> = Mutex::new(Vec::new());
/// La sal de lo que escribe este equipo: una por sesión. El nonce sí es nuevo en cada escritura.
static OWN_SALT: OnceLock<[u8; 16]> = OnceLock::new();

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut cache = KEYS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, _, key)) = cache.iter().find(|(p, s, _)| p == password && s == salt) {
        return Ok(*key);
    }
    let mut key = [0u8; 32];
    Argon2::default().hash_password_into(password.as_bytes(), salt, &mut key).map_err(err)?;
    if cache.len() >= 16 {
        cache.remove(0);
    }
    cache.push((password.to_owned(), salt.to_vec(), key));
    Ok(key)
}

/// Envuelve el archivo de un equipo en su versión cifrada. El nombre del equipo va
/// fuera, en claro, para poder decir de quién es un archivo que no se puede abrir.
fn seal(text: &str, password: &str) -> Result<String, String> {
    let salt = OWN_SALT.get_or_init(|| {
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        salt
    });
    let key = derive_key(password, salt)?;
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let data = XChaCha20Poly1305::new(&key.into()).encrypt(&nonce, text.as_bytes()).map_err(|_| "No se pudo cifrar el archivo".to_string())?;
    let device = serde_json::from_str::<Value>(text).ok().and_then(|v| v.get("device").cloned()).unwrap_or(Value::Null);
    Ok(serde_json::json!({
        "format": SEALED_FORMAT,
        "device": device,
        "records": {},
        "cipher": { "alg": "xchacha20poly1305", "kdf": "argon2id", "salt": B64.encode(salt), "nonce": B64.encode(nonce), "data": B64.encode(data) },
    })
    .to_string())
}

enum Unsealed {
    /// No estaba cifrado: el texto tal cual.
    Plain,
    Opened(String),
    /// Cifrado y sin contraseña aquí, o con otra distinta.
    Locked,
}

fn unseal(text: &str, password: Option<&str>) -> Unsealed {
    let Some(cipher) = serde_json::from_str::<Value>(text).ok().and_then(|v| v.get("cipher").cloned()).filter(Value::is_object) else {
        return Unsealed::Plain;
    };
    let part = |name: &str| cipher.get(name).and_then(Value::as_str).and_then(|b| B64.decode(b).ok());
    let (Some(password), Some(salt), Some(nonce), Some(data)) = (password, part("salt"), part("nonce"), part("data")) else {
        return Unsealed::Locked;
    };
    if nonce.len() != 24 {
        return Unsealed::Locked;
    }
    let Ok(key) = derive_key(password, &salt) else {
        return Unsealed::Locked;
    };
    match XChaCha20Poly1305::new(&key.into()).decrypt(XNonce::from_slice(&nonce), data.as_ref()) {
        Ok(plain) => String::from_utf8(plain).map_or(Unsealed::Locked, Unsealed::Opened),
        Err(_) => Unsealed::Locked,
    }
}

/// Contraseña de la sincronización, si se ha puesto una.
fn sync_password(conn: &Connection) -> Option<String> {
    secret(conn, "sync", "").ok()
}

#[derive(Serialize)]
struct SyncFile {
    name: String,
    /// El contenido ya descifrado; si `locked`, el envoltorio tal cual (lleva el nombre del equipo).
    text: String,
    /// Estaba cifrado en la carpeta.
    sealed: bool,
    /// Está cifrado y aquí no hay contraseña, o no es la misma.
    locked: bool,
}

fn read_sync_dir(dir: &str, password: Option<&str>) -> CmdResult<Vec<SyncFile>> {
    let entries = fs::read_dir(dir).map_err(|e| format!("No se puede leer la carpeta compartida ({dir}): {e}"))?;
    let mut out = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_sync_name(&name) || entry.metadata().is_ok_and(|m| !m.is_file() || m.len() > SYNC_MAX_BYTES) {
            continue;
        }
        // Un archivo que aún no ha terminado de bajar de la nube se salta: ya llegará.
        if let Ok(text) = fs::read_to_string(entry.path()) {
            out.push(match unseal(&text, password) {
                Unsealed::Plain => SyncFile { name, text, sealed: false, locked: false },
                Unsealed::Opened(plain) => SyncFile { name, text: plain, sealed: true, locked: false },
                Unsealed::Locked => SyncFile { name, text, sealed: true, locked: true },
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn write_sync_file(dir: &str, name: &str, text: &str, password: Option<&str>) -> CmdResult<()> {
    if !is_sync_name(name) {
        return Err(format!("Nombre de archivo no válido: {name}"));
    }
    let content = match password {
        Some(p) => seal(text, p)?,
        None => text.to_owned(),
    };
    let dir = PathBuf::from(dir);
    fs::create_dir_all(&dir).map_err(err)?;
    fs::write(dir.join(name), content).map_err(|e| format!("No se pudo escribir en la carpeta compartida: {e}"))
}

// Fuera del hilo principal: derivar la clave tarda un instante a propósito.
#[tauri::command(async)]
fn sync_read(db: State<'_, Db>, dir: String) -> CmdResult<Vec<SyncFile>> {
    // La base de datos se suelta antes de cifrar o descifrar.
    let password = {
        let conn = db.conn.lock().map_err(err)?;
        sync_password(&conn)
    };
    read_sync_dir(&dir, password.as_deref())
}

#[tauri::command(async)]
fn sync_write(db: State<'_, Db>, dir: String, name: String, text: String) -> CmdResult<()> {
    // La base de datos se suelta antes de cifrar o descifrar.
    let password = {
        let conn = db.conn.lock().map_err(err)?;
        sync_password(&conn)
    };
    write_sync_file(&dir, &name, &text, password.as_deref())
}

/// Copia de seguridad inmediata (antes de aplicar cambios venidos de otro equipo).
#[tauri::command]
fn backup_now(db: State<'_, Db>, label: String) -> CmdResult<()> {
    let label: String = label.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
    let dir = db.path.parent().map(|p| p.join("copias")).ok_or("Sin carpeta de datos")?;
    fs::create_dir_all(&dir).map_err(err)?;
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(err)?.as_secs();
    // El nombre empieza como las copias diarias para que la limpieza las trate igual.
    let file = dir.join(format!("numo-{}-{label}-{secs}.db", today_utc()));
    let conn = db.conn.lock().map_err(err)?;
    conn.execute("VACUUM INTO ?1", [file.to_string_lossy().as_ref()]).map_err(err)?;
    Ok(())
}

/// Página de versiones del repositorio: de ahí se descargan los instaladores.
const RELEASES_URL: &str = "https://github.com/Nyhz/numo-desktop/releases/latest";

/// Abre la página de descargas en el navegador. La dirección es fija: la
/// interfaz no puede abrir ninguna otra.
#[tauri::command]
fn open_releases(app: AppHandle) -> CmdResult<()> {
    app.opener().open_url(RELEASES_URL, None::<&str>).map_err(err)
}

// ── Actualización de la app ─────────────────────────────────────────────────
// Las versiones se publican en GitHub con un `latest.json` firmado (lo genera el
// flujo de publicación). La app lo consulta, descarga el instalador, comprueba
// la firma con la clave pública de tauri.conf.json y se reinicia ya actualizada.

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    notes: String,
}

/// Mira si hay publicada una versión más nueva. No descarga nada.
#[tauri::command]
async fn check_update(app: AppHandle) -> CmdResult<Option<UpdateInfo>> {
    let update = app
        .updater()
        .map_err(err)?
        .check()
        .await
        .map_err(|e| format!("No se pudo consultar la última versión: {e}"))?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: u.body.clone().unwrap_or_default(),
    }))
}

/// Descarga la versión nueva, la instala y reinicia la app. `on_progress` recibe
/// el porcentaje descargado.
#[tauri::command]
async fn install_update(app: AppHandle, on_progress: tauri::ipc::Channel<u8>) -> CmdResult<()> {
    let update = app
        .updater()
        .map_err(err)?
        .check()
        .await
        .map_err(|e| format!("No se pudo consultar la última versión: {e}"))?
        .ok_or("Ya tienes la última versión")?;
    let mut got: u64 = 0;
    let mut last: u8 = 0;
    update
        .download_and_install(
            |chunk, total| {
                got += chunk as u64;
                let pct = total.map_or(0, |t| (got.saturating_mul(100) / t.max(1)).min(100) as u8);
                if pct != last {
                    last = pct;
                    let _ = on_progress.send(pct);
                }
            },
            || {},
        )
        .await
        .map_err(|e| format!("No se pudo instalar la versión nueva: {e}"))?;
    app.restart();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    db_path: String,
    smoke: bool,
}

#[tauri::command]
fn app_info(app: AppHandle, db: State<'_, Db>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        db_path: db.path.display().to_string(),
        smoke: std::env::var_os("NUMO_SMOKE").is_some(),
    }
}

/// Solo para la prueba de humo: imprime el resultado y cierra la app.
#[tauri::command]
fn smoke_done(app: AppHandle, ok: bool, report: String) {
    if std::env::var_os("NUMO_SMOKE").is_none() {
        return;
    }
    println!("[numo-smoke] {}\n{report}", if ok { "OK" } else { "FALLO" });
    app.exit(if ok { 0 } else { 1 });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // NUMO_DATA_DIR permite probar sin tocar los datos reales.
            let dir = match std::env::var_os("NUMO_DATA_DIR") {
                Some(d) => PathBuf::from(d),
                None => {
                    let dir = app.path().app_data_dir()?;
                    adopt_legacy_data(&dir);
                    dir
                }
            };
            app.manage(init_db(&dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_query,
            db_batch,
            http_get,
            save_file,
            export_backup,
            app_info,
            sync_pick_dir,
            sync_read,
            sync_write,
            backup_now,
            open_releases,
            check_update,
            install_update,
            smoke_done
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Numo");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn memory_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut conn).unwrap();
        conn
    }

    fn stmt(sql: &str, params: Vec<Value>) -> Statement {
        Statement {
            sql: sql.into(),
            params,
            many: None,
        }
    }

    const NEW_ACCOUNT: &str = "INSERT INTO accounts (id, name, kind, currency, color, created_at) VALUES (?1, ?2, 'broker', 'EUR', 1, '2024-01-01')";

    #[test]
    fn migrations_are_idempotent() {
        let mut conn = memory_db();
        migrate(&mut conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
    }

    #[test]
    fn deleting_a_property_removes_its_mortgage_and_events() {
        let conn = memory_db();
        conn.execute_batch(
            "INSERT INTO properties (id, name, purchase_date, purchase_price, created_at) VALUES ('p', 'Casa', '2024-01-01', 100, 'x');
             INSERT INTO mortgages (id, property_id, principal, rate_type, rate_pct, term_months, first_payment_date, created_at) VALUES ('m', 'p', 80, 'fixed', 3, 360, '2024-02-01', 'x');
             INSERT INTO mortgage_events (id, mortgage_id, date, type, amount, created_at) VALUES ('e', 'm', '2025-01-01', 'early_repayment', 10, 'x');
             INSERT INTO property_valuations (id, property_id, date, value) VALUES ('v', 'p', '2025-01-01', 120);
             INSERT INTO goals (id, name, target_pct, color, created_at) VALUES ('g', 'Global', 50, 1, 'x');
             INSERT INTO assets (id, name, kind, currency, price_source, created_at, goal_id) VALUES ('a', 'ETF', 'etf', 'EUR', 'manual', 'x', 'g');
             DELETE FROM properties WHERE id = 'p';
             DELETE FROM goals WHERE id = 'g';",
        )
        .unwrap();
        let count = |t: &str| -> i64 { conn.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0)).unwrap() };
        assert_eq!(count("mortgages") + count("mortgage_events") + count("property_valuations"), 0);
        let goal: Option<String> = conn.query_row("SELECT goal_id FROM assets WHERE id = 'a'", [], |r| r.get(0)).unwrap();
        assert_eq!(goal, None, "al borrar un bloque el activo queda sin asignar, no se borra");
    }

    #[test]
    fn bank_accounts_become_emergency_funds_or_brokers() {
        let conn = memory_db();
        conn.execute_batch(
            "INSERT INTO accounts (id, name, kind, currency, color, track_cash, created_at) VALUES
               ('ahorro', 'Cuenta remunerada', 'bank', 'EUR', 1, 0, 'x'),
               ('fondos', 'Banco con fondos', 'bank', 'EUR', 2, 0, 'x'),
               ('broker', 'Bróker', 'broker', 'EUR', 3, 0, 'x');
             INSERT INTO assets (id, name, kind, currency, price_source, created_at) VALUES ('a', 'Fondo', 'fund', 'EUR', 'manual', 'x');
             INSERT INTO txs (id, date, type, account_id, amount, currency, fee_currency, created_at) VALUES ('t1', '2024-01-01', 'deposit', 'ahorro', 100, 'EUR', 'EUR', 'x');
             INSERT INTO txs (id, date, type, account_id, asset_id, quantity, price, currency, fee_currency, created_at) VALUES ('t2', '2024-01-01', 'buy', 'fondos', 'a', 1, 10, 'EUR', 'EUR', 'x');",
        )
        .unwrap();
        // La migración ya se aplicó sobre la base vacía; aquí se repite sobre datos de antes.
        conn.execute_batch(MIGRATIONS[3]).unwrap();
        let kind = |id: &str| -> (String, i64) { conn.query_row("SELECT kind, track_cash FROM accounts WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap() };
        assert_eq!(kind("ahorro"), ("emergency".to_owned(), 1), "sin inversiones: fondo de emergencia, con su saldo");
        assert_eq!(kind("fondos"), ("broker".to_owned(), 0), "con inversiones: bróker");
        assert_eq!(kind("broker"), ("broker".to_owned(), 0));
    }

    #[test]
    fn batch_is_all_or_nothing() {
        let mut conn = memory_db();
        let bad = vec![
            stmt(NEW_ACCOUNT, vec![json!("a1"), json!("Uno")]),
            // Viola la clave foránea: la cuenta «nope» no existe.
            stmt(
                "INSERT INTO txs (id, date, type, account_id, currency, fee_currency, created_at) VALUES ('t1', '2024-01-01', 'deposit', 'nope', 'EUR', 'EUR', 'x')",
                vec![],
            ),
        ];
        assert!(run_batch(&mut conn, &bad).is_err());
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "la cuenta no debe quedar guardada si falla el lote");
    }

    #[test]
    fn many_runs_once_per_row_and_upserts() {
        let mut conn = memory_db();
        run_batch(
            &mut conn,
            &[Statement {
                sql: "INSERT INTO fx (currency, date, rate) VALUES (?1, ?2, ?3) ON CONFLICT(currency, date) DO UPDATE SET rate = excluded.rate".into(),
                params: vec![],
                many: Some(vec![
                    vec![json!("USD"), json!("2024-01-02"), json!(1.09)],
                    vec![json!("USD"), json!("2024-01-03"), json!(1)],
                    vec![json!("USD"), json!("2024-01-02"), json!(1.1)],
                ]),
            }],
        )
        .unwrap();
        let (n, rate): (i64, f64) = conn
            .query_row(
                "SELECT COUNT(*), MAX(rate) FROM fx WHERE currency = 'USD'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(n, 2);
        assert_eq!(rate, 1.1);
    }

    #[test]
    fn values_round_trip() {
        assert_eq!(to_sql(&json!(true)), SqlValue::Integer(1));
        assert_eq!(to_sql(&json!(1.5)), SqlValue::Real(1.5));
        assert_eq!(to_sql(&json!(null)), SqlValue::Null);
        assert_eq!(from_sql(ValueRef::Real(2.5)), json!(2.5));
        assert_eq!(from_sql(ValueRef::Text(b"hola")), json!("hola"));
    }

    #[test]
    fn only_market_hosts_are_reachable() {
        assert!(check_url("https://query1.finance.yahoo.com/v8/finance/chart/AAPL").is_ok());
        assert!(check_url("https://data-api.ecb.europa.eu/service/data/EXR").is_ok());
        assert!(check_url("https://markets.ft.com/data/funds/tearsheet/summary?s=X").is_ok());
        assert!(check_url("https://api.boerse-frankfurt.de/v1/tradingview/history?symbol=XETR:X").is_ok());
        assert!(check_url("https://apiweb.bolsasymercados.es/Market/v1/EQ/LastHistoricalSharesPrices?isin=X").is_ok());
        assert!(check_url("https://api.nasdaq.com/api/quote/GOOG/historical").is_ok());
        assert!(check_url("https://www.fundinfo.com/en/ES-priv/LandingPage/Data?query=X").is_ok());
        assert!(check_url("https://eodhd.com/api/eod/VWCE.XETRA").is_err());
        assert!(check_url("https://data-api.binance.vision/api/v3/klines").is_ok());
        assert!(check_url("https://api.indexacapital.com/users/me").is_ok());
        assert!(check_url("https://api.binance.com/api/v3/klines").is_err());
        assert!(check_url("http://query1.finance.yahoo.com/").is_err());
        assert!(check_url("https://example.com/").is_err());
        assert!(check_url("https://query1.finance.yahoo.com.evil.test/").is_err());
    }

    #[test]
    fn keys_are_added_natively_and_only_for_their_host() {
        let conn = memory_db();
        let url = |u: &str| check_url(u).unwrap();
        // Sin clave guardada, el error dice dónde ponerla.
        assert!(authorize(&conn, url("https://api.indexacapital.com/users/me")).unwrap_err().contains("Ajustes"));
        conn.execute("INSERT INTO meta (key, value) VALUES ('secret:indexa', ' tok ')", []).unwrap();
        // Indexa: va en una cabecera.
        let (u, h) = authorize(&conn, url("https://api.indexacapital.com/users/me")).unwrap();
        assert_eq!(u.query(), None);
        assert_eq!(h, Some(("X-AUTH-TOKEN", "tok".to_owned())));
        // Los demás servidores no reciben nada.
        let (u, h) = authorize(&conn, url("https://data-api.binance.vision/api/v3/klines?symbol=ETHEUR")).unwrap();
        assert_eq!(u.query(), Some("symbol=ETHEUR"));
        assert!(h.is_none());
    }

    #[test]
    fn an_exported_copy_leaves_the_keys_behind() {
        let conn = memory_db();
        conn.execute_batch(
            "INSERT INTO meta (key, value) VALUES ('secret:indexa', 'token-de-indexa-123'), ('secret:sync', 'contraseña-larga-456'), ('lastSync', '2026-01-01');",
        )
        .unwrap();
        let file = std::env::temp_dir().join(format!("numo-export-test-{}.db", std::process::id()));
        let _ = fs::remove_file(&file);
        write_shareable_copy(&conn, &file).unwrap();

        let copy = Connection::open(&file).unwrap();
        let keys: Vec<String> = copy.prepare("SELECT key FROM meta ORDER BY key").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(keys, vec!["lastSync"]);
        drop(copy);
        // Ni rastro en el archivo.
        let bytes = fs::read(&file).unwrap();
        let has = |needle: &[u8]| bytes.windows(needle.len()).any(|w| w == needle);
        assert!(!has(b"token-de-indexa-123") && !has("contraseña-larga-456".as_bytes()));
        // Y lo que hay en el equipo sigue igual.
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM meta WHERE key LIKE 'secret:%'", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 2);
        let _ = fs::remove_file(&file);
    }

    #[test]
    fn sync_files_are_plain_json_names_inside_the_shared_folder() {
        assert!(is_sync_name("a1b2c3d4-e5f6.json"));
        assert!(!is_sync_name("../fuera.json"));
        assert!(!is_sync_name("sub/dentro.json"));
        assert!(!is_sync_name(".json"));
        assert!(!is_sync_name("notas.txt"));

        let base = std::env::temp_dir().join(format!("numo-sync-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        // Una carpeta cualquiera: se usa una subcarpeta «numo-app».
        assert_eq!(sync_target(&base), base.join("numo-app"));
        // La propia carpeta de la app, o una que ya tiene archivos de otro equipo: se usa tal cual.
        let own = base.join("Numo-App");
        fs::create_dir_all(&own).unwrap();
        assert_eq!(sync_target(&own), own);
        let dir = base.to_string_lossy().into_owned();
        write_sync_file(&dir, "equipo-1.json", "{}", None).unwrap();
        assert_eq!(sync_target(&base), base);
        assert!(write_sync_file(&dir, "../x.json", "{}", None).is_err());
        fs::write(base.join("ajeno.txt"), "no es de Numo").unwrap();
        let files = read_sync_dir(&dir, None).unwrap();
        assert_eq!(files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["equipo-1.json"]);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn sync_files_are_unreadable_without_the_password() {
        let base = std::env::temp_dir().join(format!("numo-seal-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let dir = base.to_string_lossy().into_owned();
        let snapshot = r#"{"format":1,"device":{"id":"mac","name":"Mac"},"records":{"accounts":[{"id":"a1","name":"Bróker secreto"}]}}"#;
        write_sync_file(&dir, "mac.json", snapshot, Some("correcta caballo batería")).unwrap();
        write_sync_file(&dir, "pc.json", snapshot, None).unwrap();

        // En la carpeta no queda nada legible, salvo de qué equipo es.
        let on_disk = fs::read_to_string(base.join("mac.json")).unwrap();
        assert!(!on_disk.contains("Bróker secreto"));
        let envelope: Value = serde_json::from_str(&on_disk).unwrap();
        assert_eq!(envelope["format"], json!(SEALED_FORMAT));
        assert_eq!(envelope["device"]["name"], json!("Mac"));

        // Con la contraseña se lee igual que uno sin cifrar; cada escritura cifra distinto.
        let files = read_sync_dir(&dir, Some("correcta caballo batería")).unwrap();
        assert_eq!(files.iter().map(|f| (f.name.as_str(), f.sealed, f.locked, f.text == snapshot)).collect::<Vec<_>>(), vec![("mac.json", true, false, true), ("pc.json", false, false, true)]);
        write_sync_file(&dir, "mac.json", snapshot, Some("correcta caballo batería")).unwrap();
        assert_ne!(on_disk, fs::read_to_string(base.join("mac.json")).unwrap());

        // Sin contraseña, o con otra, el cifrado queda cerrado (y el que no lo está se sigue leyendo).
        for wrong in [None, Some("otra distinta")] {
            let files = read_sync_dir(&dir, wrong).unwrap();
            assert!(files[0].locked && files[0].sealed && !files[0].text.contains("Bróker secreto"));
            assert!(!files[1].locked);
        }
        // Un archivo manipulado no se abre aunque la contraseña sea la buena.
        let mut tampered: Value = serde_json::from_str(&fs::read_to_string(base.join("mac.json")).unwrap()).unwrap();
        let data = tampered["cipher"]["data"].as_str().unwrap().to_owned();
        tampered["cipher"]["data"] = json!(format!("{}{}", if data.starts_with('A') { "B" } else { "A" }, &data[1..]));
        fs::write(base.join("mac.json"), tampered.to_string()).unwrap();
        assert!(read_sync_dir(&dir, Some("correcta caballo batería")).unwrap()[0].locked);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn data_from_the_old_name_is_adopted_once() {
        let base = std::env::temp_dir().join(format!("numo-legacy-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let old_dir = base.join(LEGACY_DIR);
        fs::create_dir_all(&old_dir).unwrap();
        {
            let mut old = open(&old_dir.join(LEGACY_DB)).unwrap();
            migrate(&mut old).unwrap();
            old.execute(NEW_ACCOUNT, ["a1", "Bróker"]).unwrap();
        }
        let new_dir = base.join("app.numo.desktop");
        adopt_legacy_data(&new_dir);
        let count = |dir: &Path| -> i64 { open(&dir.join("numo.db")).unwrap().query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0)).unwrap() };
        assert_eq!(count(&new_dir), 1, "la base de datos antigua se copia a la carpeta nueva");
        // Con datos ya aquí no se vuelve a copiar: lo nuevo manda.
        open(&new_dir.join("numo.db")).unwrap().execute("DELETE FROM accounts", []).unwrap();
        adopt_legacy_data(&new_dir);
        assert_eq!(count(&new_dir), 0);
        assert!(old_dir.join(LEGACY_DB).exists(), "la carpeta antigua no se toca");
        // Sin versión anterior no pasa nada.
        adopt_legacy_data(&base.join("otra").join("app.numo.desktop"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn yahoo_requests_are_spaced() {
        let first = reserve_yahoo_slot();
        let second = reserve_yahoo_slot();
        let third = reserve_yahoo_slot();
        assert!(first < Duration::from_millis(50));
        assert!(second > Duration::from_millis(250) && second <= YAHOO_GAP);
        assert!(third > second);
    }

    #[test]
    fn dates_from_day_numbers() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert_eq!(civil_from_days(20_781), (2026, 11, 24));
    }
}
