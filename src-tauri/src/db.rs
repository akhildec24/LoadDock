use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

pub fn get_app_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    Ok(home.join("Library").join("Application Support").join("LoadDock"))
}

pub fn init_db(path: &PathBuf) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            production_url TEXT,
            staging_url TEXT,
            default_runner TEXT DEFAULT 'local',
            default_headers TEXT,
            auth_config TEXT,
            notes TEXT,
            tags TEXT,
            cloudflare_enabled INTEGER DEFAULT 0,
            safe_traffic_limits TEXT,
            proxy_url TEXT,
            proxy_type TEXT DEFAULT 'none',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS environments (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            env_type TEXT DEFAULT 'custom',
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tests (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            test_type TEXT NOT NULL DEFAULT 'custom',
            config TEXT NOT NULL,
            script TEXT,
            is_custom_script INTEGER DEFAULT 0,
            thresholds TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS test_requests (
            id TEXT PRIMARY KEY,
            test_id TEXT NOT NULL,
            method TEXT NOT NULL DEFAULT 'GET',
            url TEXT NOT NULL,
            headers TEXT,
            query_params TEXT,
            body TEXT,
            cookies TEXT,
            expected_status INTEGER DEFAULT 200,
            think_time REAL DEFAULT 0,
            weight INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS test_stages (
            id TEXT PRIMARY KEY,
            test_id TEXT NOT NULL,
            target_vus INTEGER NOT NULL,
            duration TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            test_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            runner_id TEXT,
            environment_id TEXT,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            vus INTEGER DEFAULT 0,
            duration TEXT,
            requests INTEGER DEFAULT 0,
            failed_requests REAL DEFAULT 0,
            avg_duration REAL,
            min_duration REAL,
            max_duration REAL,
            median_duration REAL,
            p90_duration REAL,
            p95_duration REAL,
            p99_duration REAL,
            requests_per_second REAL,
            peak_rps REAL,
            threshold_passed INTEGER,
            raw_results_path TEXT,
            stdout_log TEXT,
            stderr_log TEXT,
            FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS run_endpoints (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            method TEXT DEFAULT 'GET',
            p95 REAL,
            avg REAL,
            min REAL,
            max REAL,
            count INTEGER DEFAULT 0,
            fail_count INTEGER DEFAULT 0,
            FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS run_live_metrics (
            run_id TEXT NOT NULL,
            ts INTEGER NOT NULL,
            requests INTEGER DEFAULT 0,
            errors INTEGER DEFAULT 0,
            avg_ms REAL,
            max_ms REAL,
            vus INTEGER,
            PRIMARY KEY (run_id, ts),
            FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS runners (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            api_token TEXT,
            public_ip TEXT,
            status TEXT DEFAULT 'unknown',
            k6_version TEXT,
            cpu_cores INTEGER,
            memory_mb INTEGER,
            proxy_url TEXT,
            proxy_type TEXT DEFAULT 'none',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS test_presets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            vus INTEGER NOT NULL,
            duration TEXT NOT NULL,
            is_default INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0
        );

        INSERT OR IGNORE INTO settings (key, value) VALUES
            ('max_local_vus', '100'),
            ('max_remote_vus', '500'),
            ('max_duration_minutes', '30'),
            ('max_rps', '100'),
            ('warning_vus_threshold', '100'),
            ('warning_rps_threshold', '50');

        INSERT OR IGNORE INTO test_presets (id, name, vus, duration, is_default, sort_order) VALUES
            ('preset-quick-smoke', 'Quick Smoke', 1, '30s', 1, 0),
            ('preset-light', 'Light', 5, '1m', 1, 1),
            ('preset-normal', 'Normal', 10, '3m', 1, 2),
            ('preset-busy', 'Busy', 25, '5m', 1, 3),
            ('preset-heavy', 'Heavy', 50, '5m', 1, 4);
        ",
    ).map_err(|e| e.to_string())?;

    // Migrations: add columns that may not exist in older databases
    let migrations = [
        "ALTER TABLE projects ADD COLUMN proxy_url TEXT",
        "ALTER TABLE projects ADD COLUMN proxy_type TEXT DEFAULT 'none'",
        "ALTER TABLE runners ADD COLUMN proxy_url TEXT",
        "ALTER TABLE runners ADD COLUMN proxy_type TEXT DEFAULT 'none'",
        "ALTER TABLE runs ADD COLUMN stderr_log TEXT",
    ];
    for sql in &migrations {
        let _ = conn.execute(sql, []);
    }

    // Fix broken scripts: regenerate any test scripts that have corrupted thresholds
    {
        let mut stmt = conn.prepare("SELECT id, config, thresholds, script FROM tests").map_err(|e| e.to_string())?;
        let tests: Vec<(String, String, Option<String>, Option<String>)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        for (id, config, thresholds, script) in tests {
            let needs_regen = script.as_ref().map(|s| s.contains("']    {") || s.trim().is_empty()).unwrap_or(true);
            if needs_regen {
                let new_script = crate::script_gen::generate_script(&config, thresholds.as_deref());
                let _ = conn.execute(
                    "UPDATE tests SET script = ?1 WHERE id = ?2",
                    rusqlite::params![new_script, id],
                );
            }
        }
    }

    Ok(conn)
}

// --- Data models ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub production_url: Option<String>,
    pub staging_url: Option<String>,
    pub default_runner: String,
    pub default_headers: Option<String>,
    pub auth_config: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<String>,
    pub cloudflare_enabled: bool,
    pub safe_traffic_limits: Option<String>,
    pub proxy_url: Option<String>,
    pub proxy_type: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Test {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub test_type: String,
    pub config: String,
    pub script: Option<String>,
    pub is_custom_script: bool,
    pub thresholds: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub test_id: String,
    pub project_id: String,
    pub runner_id: Option<String>,
    pub environment_id: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: String,
    pub vus: i64,
    pub duration: Option<String>,
    pub requests: i64,
    pub failed_requests: f64,
    pub avg_duration: Option<f64>,
    pub min_duration: Option<f64>,
    pub max_duration: Option<f64>,
    pub median_duration: Option<f64>,
    pub p90_duration: Option<f64>,
    pub p95_duration: Option<f64>,
    pub p99_duration: Option<f64>,
    pub requests_per_second: Option<f64>,
    pub peak_rps: Option<f64>,
    pub threshold_passed: Option<bool>,
    pub raw_results_path: Option<String>,
    pub stdout_log: Option<String>,
    pub stderr_log: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunEndpoint {
    pub id: String,
    pub run_id: String,
    pub endpoint: String,
    pub method: String,
    pub p95: Option<f64>,
    pub avg: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub count: i64,
    pub fail_count: i64,
}

/// One second of live metrics aggregated from the k6 JSON output stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveMetricPoint {
    pub ts: i64,
    pub requests: i64,
    pub errors: i64,
    pub avg_ms: Option<f64>,
    pub max_ms: Option<f64>,
    pub vus: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestPreset {
    pub id: String,
    pub name: String,
    pub vus: i64,
    pub duration: String,
    pub is_default: bool,
    pub sort_order: i64,
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
