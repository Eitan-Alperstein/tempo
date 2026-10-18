pub mod calendar;
pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod notify;
pub mod repo;
pub mod shell;
pub mod timefmt;
pub mod timer;

use commands::AppState;
use std::sync::Mutex;
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            // TEMPO_DB lets development and testing use a scratch database.
            let path = std::env::var_os("TEMPO_DB")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| dir.join("tempo.db"));
            let conn = db::open(&path)?;
            let shortcut = repo::get_setting(&conn, "globalShortcut")
                .ok()
                .flatten()
                .unwrap_or_else(|| shell::DEFAULT_SHORTCUT.to_string());
            app.manage(AppState {
                db: Mutex::new(conn),
                db_path: path.to_string_lossy().into_owned(),
                calendar: calendar::default_provider(),
            });

            let handle = app.handle();
            app.set_menu(shell::build_menu(handle)?)?;
            app.on_menu_event(|app, e| shell::handle_menu(app, e.id().as_ref()));
            shell::build_tray(handle)?;
            if let Err(e) = shell::register_quick_add_shortcut(handle, &shortcut) {
                eprintln!("tempo: {e}");
            }
            shell::spawn_background_loop(handle.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing a window hides it: Tempo keeps running so the timer and
            // reminders keep working. ⌘Q quits.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::list_active_tasks,
            commands::create_task,
            commands::update_task,
            commands::set_pinned,
            commands::reorder_manual,
            commands::reorder_pins,
            commands::complete_task,
            commands::uncomplete_task,
            commands::delete_task,
            commands::restore_task,
            commands::list_completed,
            commands::create_project,
            commands::update_project,
            commands::delete_project,
            commands::reorder_projects,
            commands::add_subtask,
            commands::update_subtask,
            commands::delete_subtask,
            commands::reorder_subtasks,
            commands::set_setting,
            commands::start_session,
            commands::pause_session,
            commands::resume_session,
            commands::stop_session,
            commands::active_session,
            commands::list_sessions,
            commands::export_backup,
            commands::import_backup,
            commands::calendar_status,
            commands::calendar_request_access,
            commands::calendar_events,
            commands::set_global_shortcut,
            commands::show_main_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tempo");

    app.run(|handle, event| {
        // Clicking the Dock icon brings the window back.
        if let RunEvent::Reopen { .. } = event {
            shell::show_main(handle);
        }
    });
}
