// LoadDock - main entry point
// Tauri backend for k6 load testing orchestration

mod db;
mod commands;
mod k6_runner;
mod script_gen;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let app_dir = db::get_app_dir()?;
            std::fs::create_dir_all(&app_dir)?;
            std::fs::create_dir_all(app_dir.join("scripts"))?;
            std::fs::create_dir_all(app_dir.join("runs"))?;
            std::fs::create_dir_all(app_dir.join("exports"))?;
            std::fs::create_dir_all(app_dir.join("logs"))?;

            let db_path = app_dir.join("loaddock.db");
            let conn = db::init_db(&db_path)?;
            app.manage(db::DbState(std::sync::Mutex::new(conn)));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::check_k6,
            commands::install_k6,
            commands::check_vpn,
            commands::get_projects,
            commands::create_project,
            commands::update_project,
            commands::delete_project,
            commands::get_tests,
            commands::create_test,
            commands::update_test,
            commands::delete_test,
            commands::get_test,
            commands::generate_script,
            commands::run_test,
            commands::run_quick_test,
            commands::stop_test,
            commands::get_runs,
            commands::get_run,
            commands::get_run_metrics,
            commands::get_live_metrics,
            commands::get_settings,
            commands::update_settings,
            commands::get_dashboard_stats,
            commands::get_recent_runs,
            commands::get_active_runs,
            commands::get_environments,
            commands::create_environment,
            commands::delete_environment,
            commands::get_test_presets,
            commands::update_test_preset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
