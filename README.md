# LoadDock

A desktop app for building, running, and analyzing [k6](https://k6.io) load tests — no CLI required. Built with Tauri 2, React, TypeScript, and Rust.

## Features

- **Visual test builder** — configure requests, headers, bodies, thresholds, and VU ramps without writing JavaScript
- **Presets** — Quick Smoke, Light, Normal load test templates (editable in Settings)
- **Live run panel** — real-time progress (VUs, iterations, interrupted), per-second charts (response time, RPS, VUs, errors), and a streaming k6 console log
- **Results** — p50/p90/p95/p99 latency, error rate, requests/sec, per-endpoint breakdown, threshold pass/fail
- **Projects & environments** — organize tests per project, inject auth (Bearer / Basic / API key / custom headers) via env vars — secrets never touch the generated script
- **History** — every run persisted to local SQLite with stdout/stderr logs and raw k6 JSON output

## Requirements

- macOS (Apple Silicon or Intel)
- [k6](https://k6.io/docs/get-started/installation/) — `brew install k6` (the app detects and can install it)
- Node.js 18+ and Rust (for development builds)

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

The bundled `.app` / `.dmg` is written to `src-tauri/target/release/bundle/`.

## Data location

All state lives in `~/Library/Application Support/LoadDock/` — database, generated scripts, run results, and logs. Nothing is sent anywhere; runs execute entirely on your machine.

## Stack

- **Frontend** — React 18, TypeScript, Tailwind CSS, Vite
- **Backend** — Rust, Tauri 2, rusqlite (SQLite), tokio
- **Load engine** — k6 (external binary)
