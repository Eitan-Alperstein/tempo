//! Tauri commands: thin wrappers that lock the database and call `repo`.

use crate::calendar::{self, CalendarEvent, CalendarProvider, CalendarStatus};
use crate::error::{Error, Result};
use crate::models::*;
use crate::repo;
use chrono::Utc;
use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub db_path: String,
    pub calendar: Box<dyn CalendarProvider>,
}

impl AppState {
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        // A panic while holding the lock leaves the connection itself intact.
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }
}

type S<'a> = State<'a, AppState>;

#[tauri::command]
pub fn bootstrap(state: S) -> Result<Bootstrap> {
    let conn = state.conn();
    Ok(Bootstrap {
        tasks: repo::list_active(&conn)?,
        projects: repo::list_projects(&conn)?,
        settings: repo::get_settings(&conn)?,
        active_session: repo::active_session(&conn)?,
        db_path: state.db_path.clone(),
    })
}

#[tauri::command]
pub fn list_active_tasks(state: S) -> Result<Vec<Task>> {
    repo::list_active(&state.conn())
}

#[tauri::command]
pub fn create_task(state: S, input: TaskInput) -> Result<Task> {
    repo::create_task(&mut state.conn(), &input)
}

#[tauri::command]
pub fn update_task(state: S, input: TaskInput) -> Result<Task> {
    repo::update_task(&state.conn(), &input)
}

#[tauri::command]
pub fn set_pinned(state: S, id: String, pinned: bool) -> Result<Task> {
    repo::set_pinned(&state.conn(), &id, pinned)
}

#[tauri::command]
pub fn reorder_manual(state: S, ids: Vec<String>) -> Result<()> {
    repo::reorder_manual(&mut state.conn(), &ids)
}

#[tauri::command]
pub fn reorder_pins(state: S, ids: Vec<String>) -> Result<()> {
    repo::reorder_pins(&mut state.conn(), &ids)
}

#[tauri::command]
pub fn complete_task(
    state: S,
    id: String,
    complete_subtasks: bool,
    next: Option<NextOccurrence>,
) -> Result<CompleteResult> {
    repo::complete_task(&mut state.conn(), &id, complete_subtasks, next.as_ref())
}

#[tauri::command]
pub fn uncomplete_task(state: S, id: String, remove_next: Option<String>) -> Result<Task> {
    repo::uncomplete_task(&mut state.conn(), &id, remove_next.as_deref())
}

#[tauri::command]
pub fn delete_task(state: S, id: String) -> Result<()> {
    repo::delete_task(&state.conn(), &id)
}

#[tauri::command]
pub fn restore_task(state: S, id: String) -> Result<Task> {
    repo::restore_task(&state.conn(), &id)
}

#[tauri::command]
pub fn list_completed(state: S, query: Option<String>, since: Option<String>, limit: Option<i64>) -> Result<Vec<Task>> {
    repo::list_completed(&state.conn(), query.as_deref(), since.as_deref(), limit.unwrap_or(500))
}

#[tauri::command]
pub fn create_project(state: S, name: String, color: String) -> Result<Project> {
    repo::create_project(&state.conn(), &name, &color)
}

#[tauri::command]
pub fn update_project(state: S, id: String, name: String, color: String) -> Result<Project> {
    repo::update_project(&state.conn(), &id, &name, &color)
}

#[tauri::command]
pub fn delete_project(state: S, id: String, move_to: Option<String>) -> Result<usize> {
    repo::delete_project(&mut state.conn(), &id, move_to.as_deref())
}

#[tauri::command]
pub fn reorder_projects(state: S, ids: Vec<String>) -> Result<()> {
    repo::reorder_projects(&mut state.conn(), &ids)
}

#[tauri::command]
pub fn add_subtask(state: S, task_id: String, title: String) -> Result<Task> {
    repo::add_subtask(&state.conn(), &task_id, &title)
}

#[tauri::command]
pub fn update_subtask(state: S, id: String, title: String, done: bool) -> Result<Task> {
    repo::update_subtask(&state.conn(), &id, &title, done)
}

#[tauri::command]
pub fn delete_subtask(state: S, id: String) -> Result<Task> {
    repo::delete_subtask(&state.conn(), &id)
}

#[tauri::command]
pub fn reorder_subtasks(state: S, task_id: String, ids: Vec<String>) -> Result<Task> {
    repo::reorder_subtasks(&mut state.conn(), &task_id, &ids)
}

#[tauri::command]
pub fn set_setting(state: S, key: String, value: String) -> Result<()> {
    repo::set_setting(&state.conn(), &key, &value)
}

#[tauri::command]
pub fn start_session(state: S, task_id: Option<String>, kind: String, planned_sec: i64) -> Result<FocusSession> {
    repo::start_session(&mut state.conn(), task_id.as_deref(), &kind, planned_sec, Utc::now())
}

#[tauri::command]
pub fn pause_session(state: S) -> Result<Option<FocusSession>> {
    repo::pause_session(&state.conn(), Utc::now())
}

#[tauri::command]
pub fn resume_session(state: S) -> Result<Option<FocusSession>> {
    repo::resume_session(&state.conn(), Utc::now())
}

#[tauri::command]
pub fn stop_session(state: S) -> Result<Option<FocusSession>> {
    repo::stop_session(&state.conn(), false, Utc::now())
}

#[tauri::command]
pub fn active_session(state: S) -> Result<Option<FocusSession>> {
    repo::active_session(&state.conn())
}

#[tauri::command]
pub fn list_sessions(state: S, since: String) -> Result<Vec<FocusSession>> {
    repo::list_sessions(&state.conn(), &since)
}

#[tauri::command]
pub fn export_backup(state: S, path: String) -> Result<()> {
    let data = repo::export_all(&state.conn())?;
    let json = serde_json::to_string_pretty(&data)?;
    // Write to a temporary file first so a failed write never leaves a half-written backup.
    let tmp = format!("{path}.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

#[tauri::command]
pub fn import_backup(state: S, path: String) -> Result<ImportSummary> {
    let text = std::fs::read_to_string(&path)?;
    let data: ExportData =
        serde_json::from_str(&text).map_err(|_| Error::Invalid("This file is not a Tempo backup.".into()))?;
    repo::import_all(&mut state.conn(), &data)
}

#[tauri::command]
pub async fn calendar_status(app: AppHandle) -> Result<CalendarStatus> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().calendar.status())
        .await
        .map_err(|e| Error::Invalid(e.to_string()))
}

#[tauri::command]
pub async fn calendar_request_access(app: AppHandle) -> Result<CalendarStatus> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().calendar.request_access())
        .await
        .map_err(|e| Error::Invalid(e.to_string()))
}

#[tauri::command]
pub async fn calendar_events(app: AppHandle, start: String, end: String) -> Result<Vec<CalendarEvent>> {
    tauri::async_runtime::spawn_blocking(move || {
        calendar::events(app.state::<AppState>().calendar.as_ref(), &start, &end)
    })
    .await
    .map_err(|e| Error::Invalid(e.to_string()))?
    .map_err(Error::Invalid)
}

#[tauri::command]
pub fn set_global_shortcut(app: AppHandle, state: S, shortcut: String) -> Result<()> {
    crate::shell::register_quick_add_shortcut(&app, &shortcut).map_err(Error::Invalid)?;
    repo::set_setting(&state.conn(), "globalShortcut", &shortcut)
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    crate::shell::show_main(&app);
}
