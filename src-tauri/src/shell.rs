//! Native app shell: menu bar, tray, global shortcut, window behaviour and the
//! background loop that drives the focus timer and reminders.

use crate::commands::AppState;
use crate::{notify, repo, timer};
use chrono::{Duration, Local, Utc};
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

pub const DEFAULT_SHORTCUT: &str = "Control+Alt+Space";

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn show_quick_add<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("quickadd") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("quick-add-open", ());
    }
}

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, label);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };

    let app_menu = SubmenuBuilder::new(app, "Tempo")
        .item(&PredefinedMenuItem::about(app, Some("About Tempo"), Some(AboutMetadata::default()))?)
        .separator()
        .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new_task", "New Task", Some("CmdOrCtrl+N"))?)
        .item(&item("search", "Search", Some("CmdOrCtrl+F"))?)
        .separator()
        .item(&item("export", "Export Backup…", None)?)
        .item(&item("import", "Import Backup…", None)?)
        .separator()
        .close_window()
        .build()?;

    // Undo is ours: the frontend undoes text edits in a field, or the last task action otherwise.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item("undo", "Undo", Some("CmdOrCtrl+Z"))?)
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let task = SubmenuBuilder::new(app, "Task")
        .item(&item("complete", "Complete", Some("CmdOrCtrl+Enter"))?)
        .item(&item("pin", "Pin / Unpin", Some("Shift+CmdOrCtrl+P"))?)
        .item(&item("open", "Show Details", Some("CmdOrCtrl+I"))?)
        .separator()
        .item(&item("timer", "Start / Pause Focus", Some("CmdOrCtrl+T"))?)
        .item(&item("timer_stop", "Stop Focus", Some("Shift+CmdOrCtrl+T"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("view_today", "Today", Some("CmdOrCtrl+1"))?)
        .item(&item("view_upcoming", "Upcoming", Some("CmdOrCtrl+2"))?)
        .item(&item("view_all", "All Tasks", Some("CmdOrCtrl+3"))?)
        .item(&item("view_completed", "Completed", Some("CmdOrCtrl+4"))?)
        .separator()
        .item(&item("toggle_sort", "Toggle Recommended / Manual Order", Some("Alt+CmdOrCtrl+O"))?)
        .item(&item("schedule", "Show Day Schedule", Some("Shift+CmdOrCtrl+D"))?)
        .item(&item("sidebar", "Toggle Sidebar", Some("Ctrl+CmdOrCtrl+S"))?)
        .separator()
        .fullscreen()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&item("show_main", "Tempo", Some("CmdOrCtrl+0"))?)
        .build()?;

    MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &task, &view, &window]).build()
}

pub fn handle_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    show_main(app);
    if id != "show_main" {
        let _ = app.emit_to("main", "menu", id);
    }
}

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("tray_show", "Show Tempo").build(app)?)
        .item(&MenuItemBuilder::with_id("tray_quick_add", "Quick Add…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("tray_quit", "Quit Tempo").build(app)?)
        .build()?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Tempo")
        .menu(&menu)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "tray_show" => show_main(app),
            "tray_quick_add" => show_quick_add(app),
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn register_quick_add_shortcut<R: Runtime>(app: &AppHandle<R>, shortcut: &str) -> Result<(), String> {
    let parsed: Shortcut = shortcut.parse().map_err(|_| format!("“{shortcut}” isn't a valid shortcut."))?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.on_shortcut(parsed, |app, _sc, ev| {
        if ev.state() == ShortcutState::Pressed {
            show_quick_add(app);
        }
    })
    .map_err(|e| format!("Couldn't register {shortcut}: {e}. Another app may be using it."))
}

fn send_notification<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("tempo: notification failed: {e}");
    }
}

fn format_clock(sec: i64) -> String {
    format!("{}:{:02}", sec / 60, sec % 60)
}

/// One-second loop. Everything is recomputed from the database, so sleeping,
/// closing the window or restarting the app can't make the timer drift.
pub fn spawn_background_loop<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let mut tick: u64 = 0;
        let mut last_title = String::new();
        loop {
            let state = app.state::<AppState>();
            let now = Utc::now();
            let mut notes: Vec<(String, String)> = Vec::new();
            let mut title = String::new();
            {
                let conn = state.conn();
                let notifications_on = repo::get_setting(&conn, "notifications").ok().flatten().as_deref() == Some("1");
                match repo::finish_elapsed_session(&conn, now) {
                    Ok(Some(s)) => {
                        let _ = app.emit("focus-ended", &s);
                        let recent = s
                            .ended_at
                            .as_deref()
                            .and_then(crate::timefmt::parse)
                            .is_some_and(|e| now - e <= Duration::minutes(15));
                        if notifications_on && recent {
                            let task_title = s
                                .task_id
                                .as_deref()
                                .and_then(|id| repo::get_task(&conn, id).ok())
                                .map(|t| t.title);
                            notes.push(match s.kind.as_str() {
                                "focus" => ("Focus session complete".into(), task_title.unwrap_or_else(|| "Time for a break.".into())),
                                _ => ("Break's over".into(), "Ready for the next session?".into()),
                            });
                        }
                    }
                    Ok(None) => {}
                    Err(e) => eprintln!("tempo: timer check failed: {e}"),
                }
                if let Ok(Some(s)) = repo::active_session(&conn) {
                    let clock = format_clock(timer::remaining_sec(&s, now));
                    title = if s.paused_at.is_some() { format!("{clock} ⏸") } else { clock };
                }
                if tick % 30 == 0 {
                    match notify::claim_due(&conn, now, &Local) {
                        Ok(rs) => notes.extend(rs.into_iter().map(|r| (r.title, r.body))),
                        Err(e) => eprintln!("tempo: reminder check failed: {e}"),
                    }
                }
                if tick % 3600 == 0 {
                    let _ = notify::prune_log(&conn, now);
                    let _ = repo::purge_deleted(&conn, now - Duration::days(7));
                }
            }
            for (t, b) in notes {
                send_notification(&app, &t, &b);
            }
            if title != last_title {
                if let Some(tray) = app.tray_by_id("main") {
                    let _ = tray.set_title(if title.is_empty() { None } else { Some(title.as_str()) });
                }
                last_title = title;
            }
            tick += 1;
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    });
}
