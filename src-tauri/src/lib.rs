//! Núcleo nativo de Caudal.
//!
//! Hace solo tres cosas que la interfaz no puede hacer por sí misma:
//! guardar en SQLite, pedir datos de mercado por HTTPS y escribir archivos.
//! Toda la lógica de cartera vive en TypeScript (carpeta `shared/`).

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
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

/// Migraciones en orden. `PRAGMA user_version` recuerda la última aplicada.
/// Nunca se edita una ya publicada: se añade otra al final.
const MIGRATIONS: &[&str] = &[include_str!("../migrations/001_init.sql")];

/// Únicos servidores a los que la app puede conectarse.
const ALLOWED_HOSTS: &[&str] = &[
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "data-api.ecb.europa.eu",
];

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
        let file = dir.join(format!("caudal-{}.db", today_utc()));
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
        eprintln!("[caudal] no se pudo crear la copia diaria: {e}");
    }
}

fn init_db(dir: &Path) -> Result<Db, String> {
    fs::create_dir_all(dir).map_err(err)?;
    let path = dir.join("caudal.db");
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

/// GET por HTTPS limitado a los servidores de datos de mercado.
#[tauri::command]
async fn http_get(url: String) -> CmdResult<String> {
    let parsed = check_url(&url)?;
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(err)?;
    let res = client
        .get(parsed)
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|e| format!("Sin conexión: {e}"))?;
    let status = res.status();
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
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
        .map_err(err)?;
    Ok(Some(path.display().to_string()))
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
        smoke: std::env::var_os("CAUDAL_SMOKE").is_some(),
    }
}

/// Solo para la prueba de humo automática: imprime el resultado y cierra la app.
#[tauri::command]
fn smoke_done(app: AppHandle, ok: bool, report: String) {
    if std::env::var_os("CAUDAL_SMOKE").is_none() {
        return;
    }
    println!("[caudal-smoke] {}\n{report}", if ok { "OK" } else { "FALLO" });
    app.exit(if ok { 0 } else { 1 });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // CAUDAL_DATA_DIR permite probar sin tocar los datos reales.
            let dir = match std::env::var_os("CAUDAL_DATA_DIR") {
                Some(d) => PathBuf::from(d),
                None => app.path().app_data_dir()?,
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
            smoke_done
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Caudal");
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
        assert!(check_url("http://query1.finance.yahoo.com/").is_err());
        assert!(check_url("https://example.com/").is_err());
        assert!(check_url("https://query1.finance.yahoo.com.evil.test/").is_err());
    }

    #[test]
    fn dates_from_day_numbers() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert_eq!(civil_from_days(20_781), (2026, 11, 24));
    }
}
