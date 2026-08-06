use crate::db::{self, DbState, Project, Test, Run, RunEndpoint, LiveMetricPoint, TestPreset, now_iso, new_id};
use crate::k6_runner;
use crate::script_gen;
use chrono::Datelike;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

// --- K6 detection ---

#[derive(Serialize)]
pub struct K6Status {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[tauri::command]
pub async fn check_k6() -> Result<K6Status, String> {
    // Try common Homebrew locations first
    let candidates = [
        "/opt/homebrew/bin/k6",
        "/usr/local/bin/k6",
        "/opt/homebrew/opt/k6/bin/k6",
    ];
    let mut k6_path = "k6".to_string();
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            k6_path = path.to_string();
            break;
        }
    }

    let output = tokio::process::Command::new(&k6_path)
        .arg("version")
        .output()
        .await;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let version = stdout.lines().next().map(|l| l.replace("k6 v", "").trim().to_string());
            Ok(K6Status {
                installed: true,
                version,
                path: which_k6(),
            })
        }
        Err(_) => Ok(K6Status {
            installed: false,
            version: None,
            path: None,
        }),
    }
}

fn which_k6() -> Option<String> {
    std::process::Command::new("which")
        .arg("k6")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
}

#[tauri::command]
pub async fn install_k6() -> Result<String, String> {
    let brew_path = {
        let candidates = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
        let mut p = "brew".to_string();
        for path in &candidates {
            if std::path::Path::new(path).exists() {
                p = path.to_string();
                break;
            }
        }
        p
    };
    let output = tokio::process::Command::new(&brew_path)
        .arg("install")
        .arg("k6")
        .output()
        .await
        .map_err(|e| format!("Failed to run brew: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("brew install k6 failed: {}", stderr))
    }
}

// --- VPN detection ---

#[derive(Serialize)]
pub struct VpnStatus {
    pub active: bool,
    pub interface: Option<String>,
}

#[tauri::command]
pub fn check_vpn() -> Result<VpnStatus, String> {
    let output = std::process::Command::new("scutil")
        .arg("--nc")
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.contains("VPN") && (trimmed.contains("Connected") || trimmed.contains("connected")) {
            return Ok(VpnStatus {
                active: true,
                interface: Some(trimmed.to_string()),
            });
        }
    }

    let ifconfig = std::process::Command::new("ifconfig")
        .output()
        .map_err(|e| e.to_string())?;
    let ifconfig_out = String::from_utf8_lossy(&ifconfig.stdout).to_string();

    for iface in &["utun", "ipsec", "ppp", "tap", "tun"] {
        if ifconfig_out.contains(iface) {
            let lines: Vec<&str> = ifconfig_out.lines().collect();
            for line in lines {
                if line.starts_with(iface) && line.contains("UP") {
                    return Ok(VpnStatus {
                        active: true,
                        interface: Some(line.split(':').next().unwrap_or(iface).to_string()),
                    });
                }
            }
        }
    }

    Ok(VpnStatus {
        active: false,
        interface: None,
    })
}

// --- Projects ---

#[tauri::command]
pub fn get_projects(state: State<DbState>) -> Result<Vec<Project>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, production_url, staging_url, default_runner, default_headers, auth_config, notes, tags, cloudflare_enabled, safe_traffic_limits, proxy_url, proxy_type, created_at, updated_at FROM projects ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                production_url: row.get(2)?,
                staging_url: row.get(3)?,
                default_runner: row.get(4)?,
                default_headers: row.get(5)?,
                auth_config: row.get(6)?,
                notes: row.get(7)?,
                tags: row.get(8)?,
                cloudflare_enabled: row.get::<_, i64>(9)? != 0,
                safe_traffic_limits: row.get(10)?,
                proxy_url: row.get(11)?,
                proxy_type: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(projects)
}

#[derive(Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub production_url: Option<String>,
    pub staging_url: Option<String>,
    pub default_runner: Option<String>,
    pub default_headers: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<String>,
    pub cloudflare_enabled: Option<bool>,
    pub proxy_url: Option<String>,
    pub proxy_type: Option<String>,
}

#[tauri::command]
pub fn create_project(input: CreateProjectInput, state: State<DbState>) -> Result<Project, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    let now = now_iso();
    let proxy_type_val = input.proxy_type.clone().unwrap_or_else(|| "none".to_string());
    conn.execute(
        "INSERT INTO projects (id, name, production_url, staging_url, default_runner, default_headers, notes, tags, cloudflare_enabled, proxy_url, proxy_type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            id,
            input.name,
            input.production_url,
            input.staging_url,
            input.default_runner.unwrap_or_else(|| "local".to_string()),
            input.default_headers,
            input.notes,
            input.tags,
            input.cloudflare_enabled.unwrap_or(false) as i64,
            input.proxy_url,
            proxy_type_val,
            now,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(Project {
        id,
        name: input.name,
        production_url: input.production_url,
        staging_url: input.staging_url,
        default_runner: "local".to_string(),
        default_headers: input.default_headers,
        auth_config: None,
        notes: input.notes,
        tags: input.tags,
        cloudflare_enabled: input.cloudflare_enabled.unwrap_or(false),
        safe_traffic_limits: None,
        proxy_url: input.proxy_url,
        proxy_type: input.proxy_type,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[derive(Deserialize)]
pub struct UpdateProjectInput {
    pub id: String,
    pub name: Option<String>,
    pub production_url: Option<String>,
    pub staging_url: Option<String>,
    pub default_runner: Option<String>,
    pub default_headers: Option<String>,
    pub auth_config: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<String>,
    pub cloudflare_enabled: Option<bool>,
    pub proxy_url: Option<String>,
    pub proxy_type: Option<String>,
}

#[tauri::command]
pub fn update_project(input: UpdateProjectInput, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    conn.execute(
        "UPDATE projects SET name = COALESCE(?1, name), production_url = COALESCE(?2, production_url), staging_url = COALESCE(?3, staging_url), default_runner = COALESCE(?4, default_runner), default_headers = COALESCE(?5, default_headers), auth_config = COALESCE(?6, auth_config), notes = COALESCE(?7, notes), tags = COALESCE(?8, tags), cloudflare_enabled = COALESCE(?9, cloudflare_enabled), proxy_url = COALESCE(?10, proxy_url), proxy_type = COALESCE(?11, proxy_type), updated_at = ?12 WHERE id = ?13",
        params![
            input.name,
            input.production_url,
            input.staging_url,
            input.default_runner,
            input.default_headers,
            input.auth_config,
            input.notes,
            input.tags,
            input.cloudflare_enabled.map(|b| b as i64),
            input.proxy_url,
            input.proxy_type,
            now,
            input.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_project(id: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Tests ---

#[tauri::command]
pub fn get_tests(project_id: String, state: State<DbState>) -> Result<Vec<Test>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, name, description, test_type, config, script, is_custom_script, thresholds, created_at, updated_at FROM tests WHERE project_id = ?1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let tests = stmt
        .query_map(params![project_id], |row| {
            Ok(Test {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                test_type: row.get(4)?,
                config: row.get(5)?,
                script: row.get(6)?,
                is_custom_script: row.get::<_, i64>(7)? != 0,
                thresholds: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(tests)
}

#[tauri::command]
pub fn get_test(id: String, state: State<DbState>) -> Result<Option<Test>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, name, description, test_type, config, script, is_custom_script, thresholds, created_at, updated_at FROM tests WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let result = stmt
        .query_row(params![id], |row| {
            Ok(Test {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                test_type: row.get(4)?,
                config: row.get(5)?,
                script: row.get(6)?,
                is_custom_script: row.get::<_, i64>(7)? != 0,
                thresholds: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .ok();
    Ok(result)
}

#[derive(Deserialize)]
pub struct CreateTestInput {
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub test_type: String,
    pub config: String,
    pub thresholds: Option<String>,
}

#[tauri::command]
pub fn create_test(input: CreateTestInput, state: State<DbState>) -> Result<Test, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    let now = now_iso();
    let script = script_gen::generate_script(&input.config, input.thresholds.as_deref());

    conn.execute(
        "INSERT INTO tests (id, project_id, name, description, test_type, config, script, is_custom_script, thresholds, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10)",
        params![
            id,
            input.project_id,
            input.name,
            input.description,
            input.test_type,
            input.config,
            script,
            input.thresholds,
            now,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(Test {
        id,
        project_id: input.project_id,
        name: input.name,
        description: input.description,
        test_type: input.test_type,
        config: input.config,
        script: Some(script),
        is_custom_script: false,
        thresholds: input.thresholds,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[derive(Deserialize)]
pub struct UpdateTestInput {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub config: Option<String>,
    pub script: Option<String>,
    pub is_custom_script: Option<bool>,
    pub thresholds: Option<String>,
}

#[tauri::command]
pub fn update_test(input: UpdateTestInput, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();

    let is_custom = input.is_custom_script.unwrap_or(false);

    if let Some(ref script) = input.script {
        conn.execute(
            "UPDATE tests SET name = COALESCE(?1, name), description = COALESCE(?2, description), config = COALESCE(?3, config), script = ?4, is_custom_script = ?5, thresholds = COALESCE(?6, thresholds), updated_at = ?7 WHERE id = ?8",
            params![
                input.name,
                input.description,
                input.config,
                script,
                is_custom as i64,
                input.thresholds,
                now,
                input.id,
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        if let Some(ref config) = input.config {
            let script = script_gen::generate_script(config, input.thresholds.as_deref());
            conn.execute(
                "UPDATE tests SET name = COALESCE(?1, name), description = COALESCE(?2, description), config = ?3, script = ?4, is_custom_script = 0, thresholds = COALESCE(?5, thresholds), updated_at = ?6 WHERE id = ?7",
                params![
                    input.name,
                    input.description,
                    config,
                    script,
                    input.thresholds,
                    now,
                    input.id,
                ],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "UPDATE tests SET name = COALESCE(?1, name), description = COALESCE(?2, description), thresholds = COALESCE(?3, thresholds), updated_at = ?4 WHERE id = ?5",
                params![input.name, input.description, input.thresholds, now, input.id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_test(id: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tests WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Script generation ---

#[tauri::command]
pub fn generate_script(config: String, thresholds: Option<String>) -> Result<String, String> {
    Ok(script_gen::generate_script(&config, thresholds.as_deref()))
}

// --- Run execution ---

/// Resolve a project's auth_config + default_headers into:
/// - a header map for script generation (secrets replaced with __ENV.LD_Hn placeholders)
/// - env vars to inject into the k6 process (LD_Hn = actual secret value)
fn resolve_project_headers(
    conn: &Connection,
    project_id: &str,
) -> (serde_json::Map<String, serde_json::Value>, Vec<(String, String)>) {
    let mut headers = serde_json::Map::new();
    let mut env_vars: Vec<(String, String)> = Vec::new();
    let mut env_idx = 0usize;
    let mut next_env = |secret: String| -> String {
        let name = format!("LD_H{}", env_idx);
        env_idx += 1;
        env_vars.push((name.clone(), secret));
        format!("__ENV.{}", name)
    };

    let row = conn
        .query_row(
            "SELECT auth_config, default_headers FROM projects WHERE id = ?1",
            params![project_id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?)),
        )
        .ok();

    let (auth_config, default_headers) = match row {
        Some((a, d)) => (a, d),
        None => return (headers, env_vars),
    };

    if let Some(dh) = default_headers {
        if let Ok(obj) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&dh) {
            for (k, v) in obj {
                if let Some(s) = v.as_str() {
                    headers.insert(k, serde_json::Value::String(s.to_string()));
                }
            }
        }
    }

    if let Some(ac) = auth_config {
        if let Ok(obj) = serde_json::from_str::<serde_json::Value>(&ac) {
            let typ = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match typ {
                "bearer" => {
                    if let Some(token) = obj.get("token").and_then(|t| t.as_str()) {
                        if !token.is_empty() {
                            let env = next_env(format!("Bearer {}", token));
                            headers.insert("Authorization".to_string(), serde_json::Value::String(env));
                        }
                    }
                }
                "basic" => {
                    let user = obj.get("username").and_then(|t| t.as_str()).unwrap_or("");
                    let pass = obj.get("password").and_then(|t| t.as_str()).unwrap_or("");
                    if !user.is_empty() {
                        let raw = format!("{}:{}", user, pass);
                        let b64 = {
                            let b = raw.as_bytes();
                            const TBL: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
                            let mut out = String::new();
                            for chunk in b.chunks(3) {
                                let mut buf = [0u8; 3];
                                buf[..chunk.len()].copy_from_slice(chunk);
                                let n = ((buf[0] as u32) << 16) | ((buf[1] as u32) << 8) | buf[2] as u32;
                                out.push(TBL[(n >> 18) as usize & 63] as char);
                                out.push(TBL[(n >> 12) as usize & 63] as char);
                                out.push(if chunk.len() > 1 { TBL[(n >> 6) as usize & 63] as char } else { '=' });
                                out.push(if chunk.len() > 2 { TBL[n as usize & 63] as char } else { '=' });
                            }
                            out
                        };
                        let env = next_env(format!("Basic {}", b64));
                        headers.insert("Authorization".to_string(), serde_json::Value::String(env));
                    }
                }
                "apikey" => {
                    let header_name = obj.get("header").and_then(|t| t.as_str()).unwrap_or("X-API-Key");
                    if let Some(val) = obj.get("value").and_then(|t| t.as_str()) {
                        if !val.is_empty() {
                            let env = next_env(val.to_string());
                            headers.insert(header_name.to_string(), serde_json::Value::String(env));
                        }
                    }
                }
                "headers" => {
                    if let Some(hs) = obj.get("headers").and_then(|h| h.as_object()) {
                        for (k, v) in hs {
                            if let Some(s) = v.as_str() {
                                if !s.is_empty() {
                                    let env = next_env(s.to_string());
                                    headers.insert(k.clone(), serde_json::Value::String(env));
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    (headers, env_vars)
}

/// Enforce global safety limits from settings. Returns Err if the test
/// configuration exceeds hard caps (max VUs, max duration, max RPS).
fn check_safety_limits(conn: &Connection, vus: i64, duration: &str, rps: Option<i64>) -> Result<(), String> {
    let get = |key: &str, default: i64| -> i64 {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get::<_, String>(0))
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(default)
    };

    let max_vus = get("max_local_vus", 100);
    if vus > max_vus {
        return Err(format!(
            "Test blocked: {} VUs exceeds the local limit of {}. Raise it in Settings → Safety Limits if this is intentional.",
            vus, max_vus
        ));
    }

    let max_minutes = get("max_duration_minutes", 30);
    let dur_sec = parse_duration_sec(duration);
    if dur_sec > max_minutes * 60 {
        return Err(format!(
            "Test blocked: duration {} exceeds the {} minute limit. Raise it in Settings → Safety Limits if this is intentional.",
            duration, max_minutes
        ));
    }

    if let Some(r) = rps {
        let max_rps = get("max_rps", 100);
        if r > max_rps {
            return Err(format!(
                "Test blocked: {} req/s exceeds the limit of {}. Raise it in Settings → Safety Limits if this is intentional.",
                r, max_rps
            ));
        }
    }

    Ok(())
}

/// Parse k6-style duration strings ("30s", "5m", "1h30m") into seconds.
fn parse_duration_sec(d: &str) -> i64 {
    let mut total = 0i64;
    let mut num = String::new();
    for c in d.chars() {
        if c.is_ascii_digit() {
            num.push(c);
        } else {
            let n: i64 = num.parse().unwrap_or(0);
            num.clear();
            match c {
                'h' => total += n * 3600,
                'm' => total += n * 60,
                's' => total += n,
                _ => {}
            }
        }
    }
    if !num.is_empty() {
        total += num.parse().unwrap_or(0); // bare number = seconds
    }
    total
}

#[derive(Deserialize)]
pub struct RunTestInput {
    pub test_id: String,
    pub project_id: String,
    pub script: String,
    pub vus: i64,
    pub duration: String,
    pub proxy_url: Option<String>,
    pub proxy_type: Option<String>,
    pub environment_id: Option<String>,
}

#[derive(Deserialize)]
pub struct QuickTestInput {
    pub project_id: String,
    pub test_type: String,
    pub url: String,
    pub vus: i64,
    pub duration: String,
    pub proxy_url: Option<String>,
    pub proxy_type: Option<String>,
    pub environment_id: Option<String>,
}

#[tauri::command]
pub async fn run_quick_test(input: QuickTestInput, state: State<'_, DbState>) -> Result<String, String> {
    let test_id = new_id();
    let run_id = new_id();
    let now = now_iso();

    let mut config_json = serde_json::json!({
        "url": input.url,
        "method": "GET",
        "vus": input.vus,
        "duration": input.duration,
        "stages": [],
        "requests": [],
    });

    let env_vars;
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        check_safety_limits(&conn, input.vus, &input.duration, None)?;

        let (headers, vars) = resolve_project_headers(&conn, &input.project_id);
        env_vars = vars;
        if !headers.is_empty() {
            config_json["default_headers"] = serde_json::Value::Object(headers);
        }
    }

    let name = format!("Quick {} test", input.test_type);
    let config = config_json.to_string();
    let thresholds = serde_json::json!({
        "http_req_failed": ["rate<0.01"],
        "http_req_duration": ["p(95)<1000"],
    }).to_string();
    let script = script_gen::generate_script(&config, Some(&thresholds));

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        // Create the test
        conn.execute(
            "INSERT INTO tests (id, project_id, name, description, test_type, config, script, is_custom_script, thresholds, created_at, updated_at) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, 0, ?7, ?8, ?9)",
            params![test_id, input.project_id, name, input.test_type, config, script, thresholds, now, now],
        ).map_err(|e| e.to_string())?;

        // Create the run
        conn.execute(
            "INSERT INTO runs (id, test_id, project_id, environment_id, started_at, status, vus, duration) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7)",
            params![run_id, test_id, input.project_id, input.environment_id, now, input.vus, input.duration],
        ).map_err(|e| e.to_string())?;
    }

    let app_dir = db::get_app_dir()?;
    let spawn_run_id = run_id.clone();
    let proxy_url = input.proxy_url.clone();
    let proxy_type = input.proxy_type.clone();
    let script_clone = script.clone();
    tokio::spawn(async move {
        let result = k6_runner::execute_and_store(&spawn_run_id, &script_clone, &app_dir, proxy_url.as_deref(), proxy_type.as_deref(), env_vars).await;
        if let Err(e) = result {
            let db_path = app_dir.join("loaddock.db");
            if let Ok(conn) = Connection::open(&db_path) {
                let _ = conn.execute(
                    "UPDATE runs SET status = 'failed', finished_at = ?1, stderr_log = ?2 WHERE id = ?3",
                    params![now_iso(), e, spawn_run_id],
                );
            }
        }
    });

    Ok(run_id)
}

#[tauri::command]
pub async fn run_test(input: RunTestInput, state: State<'_, DbState>) -> Result<String, String> {
    let id = new_id();
    let now = now_iso();

    // Resolve safety limits + project auth/headers, then determine the script
    let (script, env_vars) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;

        let test_row = conn
            .query_row(
                "SELECT config, thresholds, is_custom_script FROM tests WHERE id = ?1",
                params![&input.test_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, i64>(2)?)),
            )
            .ok();

        // Safety check — pull RPS from stored config so client can't bypass it
        let stored_rps = test_row.as_ref().and_then(|(c, _, _)| {
            serde_json::from_str::<serde_json::Value>(c).ok().and_then(|v| {
                if v.get("mode").and_then(|m| m.as_str()) == Some("rps") {
                    v.get("target_rps").and_then(|r| r.as_i64())
                } else {
                    None
                }
            })
        });
        check_safety_limits(&conn, input.vus, &input.duration, stored_rps)?;

        let (headers, vars) = resolve_project_headers(&conn, &input.project_id);

        // If an environment is selected, override the base URL so relative
        // request paths hit the environment target instead of production.
        // "staging" is a sentinel mapping to the project's staging_url.
        let env_url: Option<String> = input.environment_id.as_ref().and_then(|eid| {
            if eid == "staging" {
                conn.query_row(
                    "SELECT staging_url FROM projects WHERE id = ?1",
                    params![input.project_id],
                    |r| r.get::<_, Option<String>>(0),
                ).ok().flatten()
            } else {
                conn.query_row(
                    "SELECT url FROM environments WHERE id = ?1",
                    params![eid],
                    |r| r.get(0),
                ).ok()
            }
        });

        let script = match test_row {
            // Non-custom test: always regenerate with merged auth/default headers
            Some((config, thresholds, 0)) => {
                let mut cfg: serde_json::Value = serde_json::from_str(&config)
                    .unwrap_or_else(|_| serde_json::json!({"url": "", "requests": [], "stages": []}));
                if let Some(u) = env_url {
                    cfg["url"] = serde_json::Value::String(u);
                }
                if !headers.is_empty() {
                    cfg["default_headers"] = serde_json::Value::Object(headers);
                }
                script_gen::generate_script(&cfg.to_string(), thresholds.as_deref())
            }
            // Custom script: use stored/provided script verbatim — env vars still
            // passed so `${__ENV.X}` placeholders work in hand-written scripts
            Some((_, _, _)) | None => {
                if input.script.trim().is_empty() {
                    return Err("Test not found and script is empty".to_string());
                }
                input.script
            }
        };

        (script, vars)
    };

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO runs (id, test_id, project_id, environment_id, started_at, status, vus, duration) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7)",
            params![id, input.test_id, input.project_id, input.environment_id, now, input.vus, input.duration],
        )
        .map_err(|e| e.to_string())?;
    }

    let run_id = id.clone();
    let app_dir = db::get_app_dir()?;

    let spawn_run_id = run_id.clone();
    let proxy_url = input.proxy_url.clone();
    let proxy_type = input.proxy_type.clone();
    tokio::spawn(async move {
        let result = k6_runner::execute_and_store(&spawn_run_id, &script, &app_dir, proxy_url.as_deref(), proxy_type.as_deref(), env_vars).await;
        if let Err(e) = result {
            // If execute_and_store failed (e.g. k6 not found), update the run to failed
            let db_path = app_dir.join("loaddock.db");
            if let Ok(conn) = Connection::open(&db_path) {
                let _ = conn.execute(
                    "UPDATE runs SET status = 'failed', finished_at = ?1, stderr_log = ?2 WHERE id = ?3",
                    params![now_iso(), e, spawn_run_id],
                );
            }
        }
    });

    Ok(run_id)
}

#[tauri::command]
pub async fn stop_test(run_id: String) -> Result<(), String> {
    k6_runner::stop_run(&run_id).await
}

// --- Runs ---

#[tauri::command]
pub fn get_runs(project_id: Option<String>, state: State<DbState>) -> Result<Vec<Run>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = if project_id.is_some() {
        conn.prepare("SELECT id, test_id, project_id, runner_id, environment_id, started_at, finished_at, status, vus, duration, requests, failed_requests, avg_duration, min_duration, max_duration, median_duration, p90_duration, p95_duration, p99_duration, requests_per_second, peak_rps, threshold_passed, raw_results_path, stdout_log, stderr_log FROM runs WHERE project_id = ?1 ORDER BY started_at DESC")
            .map_err(|e| e.to_string())?
    } else {
        conn.prepare("SELECT id, test_id, project_id, runner_id, environment_id, started_at, finished_at, status, vus, duration, requests, failed_requests, avg_duration, min_duration, max_duration, median_duration, p90_duration, p95_duration, p99_duration, requests_per_second, peak_rps, threshold_passed, raw_results_path, stdout_log, stderr_log FROM runs ORDER BY started_at DESC")
            .map_err(|e| e.to_string())?
    };

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<Run> {
        Ok(Run {
            id: row.get(0)?,
            test_id: row.get(1)?,
            project_id: row.get(2)?,
            runner_id: row.get(3)?,
            environment_id: row.get(4)?,
            started_at: row.get(5)?,
            finished_at: row.get(6)?,
            status: row.get(7)?,
            vus: row.get(8)?,
            duration: row.get(9)?,
            requests: row.get(10)?,
            failed_requests: row.get(11)?,
            avg_duration: row.get(12)?,
            min_duration: row.get(13)?,
            max_duration: row.get(14)?,
            median_duration: row.get(15)?,
            p90_duration: row.get(16)?,
            p95_duration: row.get(17)?,
            p99_duration: row.get(18)?,
            requests_per_second: row.get(19)?,
            peak_rps: row.get(20)?,
            threshold_passed: row.get(21)?,
            raw_results_path: row.get(22)?,
            stdout_log: row.get(23)?,
            stderr_log: row.get(24)?,
        })
    };

    if let Some(pid) = project_id {
        let runs = stmt
            .query_map(params![pid], map_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(runs)
    } else {
        let runs = stmt
            .query_map([], map_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(runs)
    }
}

#[tauri::command]
pub fn get_run(id: String, state: State<DbState>) -> Result<Option<Run>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn
        .prepare("SELECT id, test_id, project_id, runner_id, environment_id, started_at, finished_at, status, vus, duration, requests, failed_requests, avg_duration, min_duration, max_duration, median_duration, p90_duration, p95_duration, p99_duration, requests_per_second, peak_rps, threshold_passed, raw_results_path, stdout_log, stderr_log FROM runs WHERE id = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![id], |row| {
            Ok(Run {
                id: row.get(0)?,
                test_id: row.get(1)?,
                project_id: row.get(2)?,
                runner_id: row.get(3)?,
                environment_id: row.get(4)?,
                started_at: row.get(5)?,
                finished_at: row.get(6)?,
                status: row.get(7)?,
                vus: row.get(8)?,
                duration: row.get(9)?,
                requests: row.get(10)?,
                failed_requests: row.get(11)?,
                avg_duration: row.get(12)?,
                min_duration: row.get(13)?,
                max_duration: row.get(14)?,
                median_duration: row.get(15)?,
                p90_duration: row.get(16)?,
                p95_duration: row.get(17)?,
                p99_duration: row.get(18)?,
                requests_per_second: row.get(19)?,
                peak_rps: row.get(20)?,
                threshold_passed: row.get(21)?,
                raw_results_path: row.get(22)?,
                stdout_log: row.get(23)?,
                stderr_log: row.get(24)?,
            })
        })
        .ok();
    Ok(result)
}

#[tauri::command]
pub fn get_run_metrics(run_id: String, state: State<DbState>) -> Result<Vec<RunEndpoint>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, run_id, endpoint, method, p95, avg, min, max, count, fail_count FROM run_endpoints WHERE run_id = ?1 ORDER BY endpoint")
        .map_err(|e| e.to_string())?;
    let endpoints = stmt
        .query_map(params![run_id], |row| {
            Ok(RunEndpoint {
                id: row.get(0)?,
                run_id: row.get(1)?,
                endpoint: row.get(2)?,
                method: row.get(3)?,
                p95: row.get(4)?,
                avg: row.get(5)?,
                min: row.get(6)?,
                max: row.get(7)?,
                count: row.get(8)?,
                fail_count: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(endpoints)
}

#[tauri::command]
pub fn get_live_metrics(run_id: String, state: State<DbState>) -> Result<Vec<LiveMetricPoint>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT ts, requests, errors, avg_ms, max_ms, vus FROM run_live_metrics WHERE run_id = ?1 ORDER BY ts")
        .map_err(|e| e.to_string())?;
    let points = stmt
        .query_map(params![run_id], |row| {
            Ok(LiveMetricPoint {
                ts: row.get(0)?,
                requests: row.get(1)?,
                errors: row.get(2)?,
                avg_ms: row.get(3)?,
                max_ms: row.get(4)?,
                vus: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(points)
}

// --- Settings ---

#[tauri::command]
pub fn get_settings(state: State<DbState>) -> Result<HashMap<String, String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let settings = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub fn update_settings(settings: HashMap<String, String>, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    for (key, value) in settings {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- Dashboard ---

#[derive(Serialize)]
pub struct DashboardStats {
    pub projects: i64,
    pub tests: i64,
    pub runs_this_month: i64,
    pub active_runs: i64,
}

#[tauri::command]
pub fn get_dashboard_stats(state: State<DbState>) -> Result<DashboardStats, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let projects: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let tests: i64 = conn
        .query_row("SELECT COUNT(*) FROM tests", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let month_start = chrono::Utc::now()
        .date_naive()
        .with_day(1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .to_rfc3339();
    let runs_this_month: i64 = conn
        .query_row("SELECT COUNT(*) FROM runs WHERE started_at >= ?1", params![month_start], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let active_runs: i64 = conn
        .query_row("SELECT COUNT(*) FROM runs WHERE status = 'running'", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(DashboardStats {
        projects,
        tests,
        runs_this_month,
        active_runs,
    })
}

#[derive(Serialize)]
pub struct RecentRun {
    pub id: String,
    pub project_name: String,
    pub test_name: String,
    pub status: String,
    pub p95: Option<f64>,
    pub started_at: String,
    pub threshold_passed: Option<bool>,
}

#[tauri::command]
pub fn get_recent_runs(limit: Option<i64>, state: State<DbState>) -> Result<Vec<RecentRun>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(10);
    let mut stmt = conn
        .prepare("SELECT r.id, p.name, t.name, r.status, r.p95_duration, r.started_at, r.threshold_passed FROM runs r LEFT JOIN projects p ON r.project_id = p.id LEFT JOIN tests t ON r.test_id = t.id ORDER BY r.started_at DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let runs = stmt
        .query_map(params![lim], |row| {
            Ok(RecentRun {
                id: row.get(0)?,
                project_name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                test_name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                status: row.get(3)?,
                p95: row.get(4)?,
                started_at: row.get(5)?,
                threshold_passed: row.get::<_, Option<i64>>(6)?.map(|v| v != 0),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(runs)
}

#[tauri::command]
pub fn get_active_runs(state: State<DbState>) -> Result<Vec<RecentRun>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT r.id, p.name, t.name, r.status, r.p95_duration, r.started_at, r.threshold_passed FROM runs r LEFT JOIN projects p ON r.project_id = p.id LEFT JOIN tests t ON r.test_id = t.id WHERE r.status = 'running' ORDER BY r.started_at DESC")
        .map_err(|e| e.to_string())?;
    let runs = stmt
        .query_map([], |row| {
            Ok(RecentRun {
                id: row.get(0)?,
                project_name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                test_name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                status: row.get(3)?,
                p95: row.get(4)?,
                started_at: row.get(5)?,
                threshold_passed: row.get::<_, Option<i64>>(6)?.map(|v| v != 0),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(runs)
}

// --- Environments ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub url: String,
    pub env_type: String,
}

#[tauri::command]
pub fn get_environments(project_id: String, state: State<DbState>) -> Result<Vec<Environment>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, name, url, env_type FROM environments WHERE project_id = ?1 ORDER BY name")
        .map_err(|e| e.to_string())?;
    let envs = stmt
        .query_map(params![project_id], |row| {
            Ok(Environment {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                url: row.get(3)?,
                env_type: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(envs)
}

#[derive(Deserialize)]
pub struct CreateEnvironmentInput {
    pub project_id: String,
    pub name: String,
    pub url: String,
    pub env_type: Option<String>,
}

#[tauri::command]
pub fn create_environment(input: CreateEnvironmentInput, state: State<DbState>) -> Result<Environment, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    let env_type = input.env_type.unwrap_or_else(|| "custom".to_string());
    conn.execute(
        "INSERT INTO environments (id, project_id, name, url, env_type) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, input.project_id, input.name, input.url, env_type],
    )
    .map_err(|e| e.to_string())?;
    Ok(Environment {
        id,
        project_id: input.project_id,
        name: input.name,
        url: input.url,
        env_type,
    })
}

#[tauri::command]
pub fn delete_environment(id: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM environments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Test presets ---

#[tauri::command]
pub fn get_test_presets(state: State<DbState>) -> Result<Vec<TestPreset>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, vus, duration, is_default, sort_order FROM test_presets ORDER BY sort_order")
        .map_err(|e| e.to_string())?;
    let presets = stmt
        .query_map([], |row| {
            Ok(TestPreset {
                id: row.get(0)?,
                name: row.get(1)?,
                vus: row.get(2)?,
                duration: row.get(3)?,
                is_default: row.get::<_, i64>(4)? != 0,
                sort_order: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(presets)
}

#[tauri::command]
pub fn update_test_preset(id: String, name: String, vus: i64, duration: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE test_presets SET name = ?1, vus = ?2, duration = ?3 WHERE id = ?4",
        params![name, vus, duration, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
