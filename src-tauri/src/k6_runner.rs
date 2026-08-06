use crate::db::{self, now_iso, new_id};
use rusqlite::Connection;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

static RUNNING_PIDS: std::sync::LazyLock<Mutex<HashMap<String, u32>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Rolling buffer of recent output lines — the "live tail" persisted to the DB.
const LIVE_TAIL_LINES: usize = 120;

type LiveBuffer = Arc<Mutex<VecDeque<String>>>;

fn push_live_line(buf: &LiveBuffer, line: String) {
    if let Ok(mut b) = buf.lock() {
        b.push_back(line);
        while b.len() > LIVE_TAIL_LINES {
            b.pop_front();
        }
    }
}

/// Read raw bytes from a child pipe, splitting chunks on \r and \n so k6's
/// carriage-return progress updates arrive as individual lines.
/// `partial` persists across calls so lines spanning chunk boundaries are kept whole.
fn feed_lines(partial: &mut String, text: &str, buf: &LiveBuffer) {
    for ch in text.chars() {
        if ch == '\r' || ch == '\n' {
            let line = partial.trim().to_string();
            partial.clear();
            if !line.is_empty() {
                push_live_line(buf, line);
            }
        } else {
            partial.push(ch);
        }
    }
}

fn flush_partial(partial: &mut String, buf: &LiveBuffer) {
    let line = partial.trim().to_string();
    partial.clear();
    if !line.is_empty() {
        push_live_line(buf, line);
    }
}

#[derive(Default)]
struct SecondBucket {
    requests: i64,
    errors: i64,
    duration_sum: f64,
    duration_max: f64,
    vus: Option<i64>,
}

/// Parse one chunk of the k6 `--out json=` stream and fold complete lines into
/// per-second buckets. Returns the unparsed tail (partial last line).
fn parse_jsonl_chunk(pending: &mut String, text: &str, buckets: &mut BTreeMap<i64, SecondBucket>, dirty: &mut HashSet<i64>) {
    pending.push_str(text);
    let mut last_nl = None;
    for (i, ch) in pending.char_indices() {
        if ch == '\n' {
            last_nl = Some(i);
        }
    }
    let Some(end) = last_nl else { return };
    let complete = pending[..=end].to_string();
    pending.drain(..=end);

    for line in complete.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("Point") {
            continue;
        }
        let metric = v.get("metric").and_then(|m| m.as_str()).unwrap_or("");
        let data = &v["data"];
        let ts = data
            .get("time")
            .and_then(|t| t.as_str())
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
            .map(|t| t.timestamp());
        let value = data.get("value").and_then(|v| v.as_f64());
        let (Some(ts), Some(value)) = (ts, value) else {
            continue;
        };

        let bucket = buckets.entry(ts).or_default();
        dirty.insert(ts);
        match metric {
            "http_req_duration" => {
                bucket.requests += 1;
                bucket.duration_sum += value;
                if value > bucket.duration_max {
                    bucket.duration_max = value;
                }
            }
            "http_req_failed" => {
                if value >= 1.0 {
                    bucket.errors += 1;
                }
            }
            "vus" => {
                bucket.vus = Some(value as i64);
            }
            _ => {}
        }
    }
}

/// Persist dirty buckets to run_live_metrics (upsert per run+second).
fn persist_buckets(conn: &Connection, run_id: &str, buckets: &BTreeMap<i64, SecondBucket>, dirty: &HashSet<i64>) {
    let mut stmt = match conn.prepare(
        "INSERT INTO run_live_metrics (run_id, ts, requests, errors, avg_ms, max_ms, vus) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(run_id, ts) DO UPDATE SET requests=excluded.requests, errors=excluded.errors, avg_ms=excluded.avg_ms, max_ms=excluded.max_ms, vus=excluded.vus",
    ) {
        Ok(s) => s,
        Err(_) => return,
    };
    for ts in dirty {
        if let Some(b) = buckets.get(ts) {
            let avg = if b.requests > 0 {
                Some(b.duration_sum / b.requests as f64)
            } else {
                None
            };
            let max = if b.requests > 0 { Some(b.duration_max) } else { None };
            let _ = stmt.execute(rusqlite::params![run_id, ts, b.requests, b.errors, avg, max, b.vus]);
        }
    }
}

/// Tail the k6 JSON results file until `done` is set, flushing aggregated
/// per-second metrics to run_live_metrics every ~750ms.
async fn tail_json_metrics(results_path: PathBuf, db_path: PathBuf, run_id: String, done: Arc<AtomicBool>) {
    use std::io::{Read, Seek, SeekFrom};

    let mut offset: u64 = 0;
    let mut pending = String::new();
    let mut buckets: BTreeMap<i64, SecondBucket> = BTreeMap::new();

    loop {
        let text = {
            match std::fs::File::open(&results_path) {
                Ok(mut f) => {
                    let _ = f.seek(SeekFrom::Start(offset));
                    let mut s = String::new();
                    match f.read_to_string(&mut s) {
                        Ok(n) => {
                            offset += n as u64;
                            s
                        }
                        Err(_) => String::new(),
                    }
                }
                Err(_) => String::new(),
            }
        };

        let mut dirty: HashSet<i64> = HashSet::new();
        parse_jsonl_chunk(&mut pending, &text, &mut buckets, &mut dirty);

        if !dirty.is_empty() {
            let rid = run_id.clone();
            let dbp = db_path.clone();
            let bmap = buckets.clone_map_for(&dirty);
            let dset = dirty.clone();
            let _ = tokio::task::spawn_blocking(move || {
                if let Ok(conn) = Connection::open(&dbp) {
                    let _ = conn.busy_timeout(std::time::Duration::from_secs(3));
                    persist_buckets(&conn, &rid, &bmap, &dset);
                }
            })
            .await;
        }

        if done.load(Ordering::Relaxed) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(750)).await;
    }
}

/// Helper: clone only the needed buckets for a spawn_blocking closure.
trait CloneSubset {
    fn clone_map_for(&self, keys: &HashSet<i64>) -> BTreeMap<i64, SecondBucket>;
}
impl CloneSubset for BTreeMap<i64, SecondBucket> {
    fn clone_map_for(&self, keys: &HashSet<i64>) -> BTreeMap<i64, SecondBucket> {
        let mut m = BTreeMap::new();
        for k in keys {
            if let Some(b) = self.get(k) {
                m.insert(
                    *k,
                    SecondBucket {
                        requests: b.requests,
                        errors: b.errors,
                        duration_sum: b.duration_sum,
                        duration_max: b.duration_max,
                        vus: b.vus,
                    },
                );
            }
        }
        m
    }
}

fn resolve_k6_path() -> String {
    // Try common Homebrew locations on macOS (Apple Silicon + Intel)
    let candidates = [
        "/opt/homebrew/bin/k6",
        "/usr/local/bin/k6",
        "/opt/homebrew/opt/k6/bin/k6",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return path.to_string();
        }
    }
    // Fall back to "k6" and hope PATH has it
    "k6".to_string()
}

pub async fn execute_and_store(run_id: &str, script: &str, app_dir: &Path, proxy_url: Option<&str>, proxy_type: Option<&str>, env_vars: Vec<(String, String)>) -> Result<(), String> {
    let scripts_dir = app_dir.join("scripts");
    let runs_dir = app_dir.join("runs");

    let script_path = scripts_dir.join(format!("{}.js", run_id));
    std::fs::write(&script_path, script).map_err(|e| e.to_string())?;

    let now = chrono::Utc::now();
    let run_dir = runs_dir
        .join(now.format("%Y").to_string())
        .join(now.format("%m").to_string())
        .join(format!("run_{}", &run_id[..8]));
    std::fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;

    let results_path = run_dir.join("results.json");
    let summary_path = run_dir.join("summary.json");

    // Resolve k6 full path (macOS Tauri apps may not have Homebrew in PATH)
    let k6_bin = resolve_k6_path();

    let mut cmd = Command::new(&k6_bin);
    cmd.arg("run")
        .arg("--out")
        .arg(format!("json={}", results_path.display()))
        .arg("--summary-export")
        .arg(format!("{}", summary_path.display()))
        .arg(&script_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (k, v) in &env_vars {
        cmd.env(k, v);
    }

    if let Some(url) = proxy_url {
        if !url.is_empty() {
            let ptype = proxy_type.unwrap_or("http");
            if ptype == "socks" || ptype == "socks5" {
                cmd.env("ALL_PROXY", url);
            } else {
                cmd.env("HTTP_PROXY", url);
                cmd.env("HTTPS_PROXY", url);
            }
        }
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn k6 (is it installed?): {}", e))?;
    let pid = child.id().unwrap();

    {
        let mut pids = RUNNING_PIDS.lock().map_err(|e| e.to_string())?;
        pids.insert(run_id.to_string(), pid);
    }

    // Shared buffers: one merged "live" stream for the UI tail, plus separate
    // raw accumulators for stdout/stderr stored when the run finishes.
    let live: LiveBuffer = Arc::new(Mutex::new(VecDeque::new()));
    let stdout_acc: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let stderr_acc: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));

    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();

    let out_live = live.clone();
    let out_acc = stdout_acc.clone();
    let out_task = tokio::spawn(async move {
        let mut partial = String::new();
        if let Some(ref mut pipe) = stdout_pipe {
            let mut chunk = [0u8; 4096];
            loop {
                match pipe.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&chunk[..n]);
                        if let Ok(mut acc) = out_acc.lock() {
                            acc.push_str(&text);
                        }
                        feed_lines(&mut partial, &text, &out_live);
                    }
                }
            }
        }
        flush_partial(&mut partial, &out_live);
    });

    // stderr gets its own task + own partial-line state
    let err_live = live.clone();
    let err_acc = stderr_acc.clone();
    let err_task = tokio::spawn(async move {
        let mut partial = String::new();
        if let Some(ref mut pipe) = stderr_pipe {
            let mut chunk = [0u8; 4096];
            loop {
                match pipe.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&chunk[..n]);
                        if let Ok(mut acc) = err_acc.lock() {
                            acc.push_str(&text);
                        }
                        feed_lines(&mut partial, &text, &err_live);
                    }
                }
            }
        }
        flush_partial(&mut partial, &err_live);
    });

    // Flush the live tail to runs.stdout_log once per second while running.
    let flush_live = live.clone();
    let flush_run_id = run_id.to_string();
    let flush_db_path = app_dir.join("loaddock.db");
    let flusher = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let tail = {
                match flush_live.lock() {
                    Ok(b) => b.iter().cloned().collect::<Vec<_>>().join("\n"),
                    Err(_) => continue,
                }
            };
            if tail.is_empty() {
                continue;
            }
            let rid = flush_run_id.clone();
            let dbp = flush_db_path.clone();
            let _ = tokio::task::spawn_blocking(move || {
                if let Ok(conn) = Connection::open(&dbp) {
                    let _ = conn.busy_timeout(std::time::Duration::from_secs(3));
                    let _ = conn.execute(
                        "UPDATE runs SET stdout_log = ?1 WHERE id = ?2",
                        rusqlite::params![tail, rid],
                    );
                }
            })
            .await;
        }
    });

    // Tail the k6 --out json file for per-second live chart metrics.
    let tail_done = Arc::new(AtomicBool::new(false));
    let tail_task = tokio::spawn(tail_json_metrics(
        results_path.clone(),
        app_dir.join("loaddock.db"),
        run_id.to_string(),
        tail_done.clone(),
    ));

    let status_res = child.wait().await.map_err(|e| e.to_string())?;

    // Readers finish once the pipes hit EOF
    let _ = out_task.await;
    let _ = err_task.await;
    flusher.abort();

    // Let the tailer do one final pass to drain any last points
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    tail_done.store(true, Ordering::Relaxed);
    let _ = tail_task.await;

    {
        let mut pids = RUNNING_PIDS.lock().map_err(|e| e.to_string())?;
        pids.remove(run_id);
    }

    let stdout = stdout_acc.lock().map(|s| s.clone()).unwrap_or_default();
    let stderr = stderr_acc.lock().map(|s| s.clone()).unwrap_or_default();
    let exit_code = status_res.code().unwrap_or(-1);

    let status = if exit_code == 0 {
        "completed"
    } else if exit_code == 137 || exit_code == 143 {
        "stopped"
    } else {
        "failed"
    };

    let summary_json = std::fs::read_to_string(&summary_path).ok();
    let metrics = parse_summary(&summary_json);

    // If k6 ran but produced 0 requests, include diagnostic info in stderr_log
    let stderr_log = if metrics.requests == 0 && stderr.is_empty() {
        format!("k6 exited with code {} but produced 0 requests.\n\n--- stdout ---\n{}\n\n--- stderr ---\n{}\n\nIf k6 is not installed, install it with: brew install k6", exit_code, stdout, stderr)
    } else if !stderr.is_empty() {
        stderr
    } else {
        String::new()
    };

    let db_path = app_dir.join("loaddock.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let finished_at = now_iso();

    // k6 writes console output (progress + summary) to stderr when piped —
    // fall back to the merged live tail so stdout_log isn't empty.
    let stdout_log = if stdout.trim().is_empty() {
        live.lock()
            .map(|b| b.iter().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default()
    } else {
        stdout.clone()
    };

    conn.execute(
        "UPDATE runs SET status = ?1, finished_at = ?2, requests = ?3, failed_requests = ?4, avg_duration = ?5, min_duration = ?6, max_duration = ?7, median_duration = ?8, p90_duration = ?9, p95_duration = ?10, p99_duration = ?11, requests_per_second = ?12, peak_rps = ?13, threshold_passed = ?14, raw_results_path = ?15, stdout_log = ?16, stderr_log = ?17 WHERE id = ?18",
        rusqlite::params![
            status,
            finished_at,
            metrics.requests,
            metrics.failed_requests,
            metrics.avg_duration,
            metrics.min_duration,
            metrics.max_duration,
            metrics.median_duration,
            metrics.p90_duration,
            metrics.p95_duration,
            metrics.p99_duration,
            metrics.requests_per_second,
            metrics.peak_rps,
            metrics.threshold_passed.map(|b| b as i64),
            results_path.to_str(),
            stdout_log,
            stderr_log,
            run_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    if let Some(endpoints) = metrics.endpoints {
        for ep in &endpoints {
            conn.execute(
                "INSERT INTO run_endpoints (id, run_id, endpoint, method, p95, avg, min, max, count, fail_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    new_id(),
                    run_id,
                    ep.endpoint,
                    ep.method,
                    ep.p95,
                    ep.avg,
                    ep.min,
                    ep.max,
                    ep.count,
                    ep.fail_count,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

pub async fn stop_run(run_id: &str) -> Result<(), String> {
    let pid = {
        let pids = RUNNING_PIDS.lock().map_err(|e| e.to_string())?;
        pids.get(run_id).copied()
    };

    if let Some(pid) = pid {
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("kill")
                .arg("-9")
                .arg(pid.to_string())
                .output();
        }
        #[cfg(not(unix))]
        {
            let _ = std::process::Command::new("taskkill")
                .args(&["/F", "/PID", &pid.to_string()])
                .output();
        }
    }

    let app_dir = db::get_app_dir()?;
    let db_path = app_dir.join("loaddock.db");
    if let Ok(conn) = Connection::open(&db_path) {
        let _ = conn.execute(
            "UPDATE runs SET status = 'stopped', finished_at = ?1 WHERE id = ?2",
            rusqlite::params![now_iso(), run_id],
        );
    }

    Ok(())
}

#[derive(Default)]
struct ParsedMetrics {
    requests: i64,
    failed_requests: f64,
    avg_duration: Option<f64>,
    min_duration: Option<f64>,
    max_duration: Option<f64>,
    median_duration: Option<f64>,
    p90_duration: Option<f64>,
    p95_duration: Option<f64>,
    p99_duration: Option<f64>,
    requests_per_second: Option<f64>,
    peak_rps: Option<f64>,
    threshold_passed: Option<bool>,
    endpoints: Option<Vec<ParsedEndpoint>>,
}

#[derive(Default)]
struct ParsedEndpoint {
    endpoint: String,
    method: String,
    p95: Option<f64>,
    avg: Option<f64>,
    min: Option<f64>,
    max: Option<f64>,
    count: i64,
    fail_count: i64,
}

fn parse_summary(summary_json: &Option<String>) -> ParsedMetrics {
    let mut metrics = ParsedMetrics::default();

    if let Some(json) = summary_json {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(json) {
            // k6 summary export format: { metrics: { ... } }
            if let Some(m) = v.get("metrics") {
                if let Some(http_reqs) = m.get("http_reqs") {
                    if let Some(count) = http_reqs.get("count").and_then(|c| c.as_f64()) {
                        metrics.requests = count as i64;
                    }
                    if let Some(rate) = http_reqs.get("rate").and_then(|r| r.as_f64()) {
                        metrics.requests_per_second = Some(rate);
                    }
                }

                if let Some(failed) = m.get("http_req_failed") {
                    // k6 v2.x: "value" field holds the failure rate (0-1)
                    // Older k6: "rate" field
                    let rate = failed.get("value").and_then(|r| r.as_f64())
                        .or_else(|| failed.get("rate").and_then(|r| r.as_f64()));
                    if let Some(rate) = rate {
                        metrics.failed_requests = rate * 100.0;
                    }
                    // k6 v2.x: thresholds object — false = not crossed (passed), true = crossed (failed)
                    if let Some(thresholds) = failed.get("thresholds") {
                        if let Some(obj) = thresholds.as_object() {
                            let all_passed = obj.values().all(|v| !v.as_bool().unwrap_or(true));
                            metrics.threshold_passed = Some(all_passed);
                        }
                    }
                }

                if let Some(dur) = m.get("http_req_duration") {
                    metrics.avg_duration = dur.get("avg").and_then(|v| v.as_f64());
                    metrics.min_duration = dur.get("min").and_then(|v| v.as_f64());
                    metrics.max_duration = dur.get("max").and_then(|v| v.as_f64());
                    metrics.median_duration = dur.get("med").and_then(|v| v.as_f64());

                    // k6 v2.x: p(90), p(95), p(99) are top-level keys
                    metrics.p90_duration = dur.get("p(90)").and_then(|v| v.as_f64());
                    metrics.p95_duration = dur.get("p(95)").and_then(|v| v.as_f64());
                    metrics.p99_duration = dur.get("p(99)").and_then(|v| v.as_f64());

                    // Fallback: older k6 used nested "percentiles" object
                    if metrics.p90_duration.is_none() {
                        if let Some(percentiles) = dur.get("percentiles") {
                            metrics.p90_duration = percentiles.get("90").and_then(|v| v.as_f64());
                            metrics.p95_duration = percentiles.get("95").and_then(|v| v.as_f64());
                            metrics.p99_duration = percentiles.get("99").and_then(|v| v.as_f64());
                        }
                    }

                    // Also check duration thresholds
                    if metrics.threshold_passed.is_none() {
                        if let Some(thresholds) = dur.get("thresholds") {
                            if let Some(obj) = thresholds.as_object() {
                                let all_passed = obj.values().all(|v| !v.as_bool().unwrap_or(true));
                                metrics.threshold_passed = Some(all_passed);
                            }
                        }
                    }
                }

                // If threshold_passed is still not set, default to true if we got requests
                if metrics.threshold_passed.is_none() && metrics.requests > 0 {
                    metrics.threshold_passed = Some(true);
                }
            }
        }
    }

    metrics
}
