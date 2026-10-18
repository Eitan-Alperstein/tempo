//! All database reads and writes. Every function takes a plain `Connection` so
//! it can be exercised directly in tests without a running app.

use crate::error::{Error, Result};
use crate::models::*;
use crate::{timefmt, timer};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, Row, params};
use std::collections::HashMap;

const TASK_COLS: &str = "id, title, notes, estimate_min, due_date, due_time, sched_start, sched_end, \
     project_id, importance, pinned, pin_order, manual_order, recurrence, completed_at, created_at, updated_at";

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn row_to_task(r: &Row) -> rusqlite::Result<Task> {
    let recurrence: Option<String> = r.get(13)?;
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        notes: r.get(2)?,
        estimate_min: r.get(3)?,
        due_date: r.get(4)?,
        due_time: r.get(5)?,
        sched_start: r.get(6)?,
        sched_end: r.get(7)?,
        project_id: r.get(8)?,
        importance: r.get(9)?,
        pinned: r.get(10)?,
        pin_order: r.get(11)?,
        manual_order: r.get(12)?,
        recurrence: recurrence.and_then(|s| serde_json::from_str(&s).ok()),
        completed_at: r.get(14)?,
        created_at: r.get(15)?,
        updated_at: r.get(16)?,
        subtasks: Vec::new(),
        focus_sec: 0,
    })
}

fn row_to_subtask(r: &Row) -> rusqlite::Result<Subtask> {
    Ok(Subtask {
        id: r.get(0)?,
        task_id: r.get(1)?,
        title: r.get(2)?,
        done: r.get(3)?,
        sort: r.get(4)?,
        created_at: r.get(5)?,
    })
}

fn row_to_session(r: &Row) -> rusqlite::Result<FocusSession> {
    Ok(FocusSession {
        id: r.get(0)?,
        task_id: r.get(1)?,
        kind: r.get(2)?,
        planned_sec: r.get(3)?,
        started_at: r.get(4)?,
        paused_at: r.get(5)?,
        paused_total_sec: r.get(6)?,
        ended_at: r.get(7)?,
        completed: r.get(8)?,
    })
}

const SESSION_COLS: &str =
    "id, task_id, kind, planned_sec, started_at, paused_at, paused_total_sec, ended_at, completed";

// SQL expression for the focused seconds of a finished session.
const FOCUS_SEC_SQL: &str = "MAX(0, CAST(ROUND((julianday(ended_at) - julianday(started_at)) * 86400) AS INTEGER) - paused_total_sec)";

fn fill_details(conn: &Connection, tasks: &mut [Task]) -> Result<()> {
    let mut sub_stmt = conn.prepare_cached(
        "SELECT id, task_id, title, done, sort, created_at FROM subtasks WHERE task_id = ?1 ORDER BY sort, created_at",
    )?;
    let focus_sql = format!(
        "SELECT COALESCE(SUM({FOCUS_SEC_SQL}), 0) FROM focus_sessions WHERE task_id = ?1 AND kind = 'focus' AND ended_at IS NOT NULL"
    );
    let mut focus_stmt = conn.prepare_cached(&focus_sql)?;
    for t in tasks.iter_mut() {
        t.subtasks = sub_stmt
            .query_map([&t.id], row_to_subtask)?
            .collect::<rusqlite::Result<_>>()?;
        t.focus_sec = focus_stmt.query_row([&t.id], |r| r.get(0))?;
    }
    Ok(())
}

fn query_tasks(conn: &Connection, where_sql: &str, p: impl rusqlite::Params) -> Result<Vec<Task>> {
    let sql = format!("SELECT {TASK_COLS} FROM tasks WHERE {where_sql}");
    let mut stmt = conn.prepare(&sql)?;
    let mut tasks: Vec<Task> = stmt.query_map(p, row_to_task)?.collect::<rusqlite::Result<_>>()?;
    fill_details(conn, &mut tasks)?;
    Ok(tasks)
}

// ---------- tasks ----------

pub fn get_task(conn: &Connection, id: &str) -> Result<Task> {
    query_tasks(conn, "id = ?1 AND deleted_at IS NULL", [id])?
        .pop()
        .ok_or_else(|| Error::NotFound("Task".into()))
}

pub fn list_active(conn: &Connection) -> Result<Vec<Task>> {
    query_tasks(
        conn,
        "completed_at IS NULL AND deleted_at IS NULL ORDER BY manual_order, created_at",
        [],
    )
}

/// Completed tasks, newest first. `query` matches title, notes, project name and subtasks.
pub fn list_completed(
    conn: &Connection,
    query: Option<&str>,
    since: Option<&str>,
    limit: i64,
) -> Result<Vec<Task>> {
    let pattern = query
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(|q| format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")));
    query_tasks(
        conn,
        "completed_at IS NOT NULL AND deleted_at IS NULL
         AND (?1 IS NULL OR completed_at >= ?1)
         AND (?2 IS NULL
              OR title LIKE ?2 ESCAPE '\\' OR notes LIKE ?2 ESCAPE '\\'
              OR project_id IN (SELECT id FROM projects WHERE name LIKE ?2 ESCAPE '\\')
              OR id IN (SELECT task_id FROM subtasks WHERE title LIKE ?2 ESCAPE '\\'))
         ORDER BY completed_at DESC LIMIT ?3",
        params![since, pattern, limit],
    )
}

fn validate(input: &TaskInput) -> Result<()> {
    if input.title.trim().is_empty() {
        return Err(Error::Invalid("A task needs a title.".into()));
    }
    if let Some(i) = input.importance {
        if !(1..=5).contains(&i) {
            return Err(Error::Invalid("Importance must be between 1 and 5.".into()));
        }
    }
    if matches!(input.estimate_min, Some(m) if m <= 0) {
        return Err(Error::Invalid("Estimate must be a positive number of minutes.".into()));
    }
    if let Some(d) = &input.due_date {
        timefmt::parse_date(d).ok_or_else(|| Error::Invalid(format!("Invalid due date: {d}")))?;
    }
    if let Some(t) = &input.due_time {
        if input.due_date.is_none() {
            return Err(Error::Invalid("A due time needs a due date.".into()));
        }
        timefmt::parse_hm(t).ok_or_else(|| Error::Invalid(format!("Invalid due time: {t}")))?;
    }
    match (&input.sched_start, &input.sched_end) {
        (None, None) => {}
        (Some(s), Some(e)) => {
            let (s, e) = (timefmt::parse(s), timefmt::parse(e));
            match (s, e) {
                (Some(s), Some(e)) if e > s => {}
                (Some(_), Some(_)) => return Err(Error::Invalid("A time block must end after it starts.".into())),
                _ => return Err(Error::Invalid("Invalid scheduled time.".into())),
            }
        }
        _ => return Err(Error::Invalid("A time block needs both a start and an end.".into())),
    }
    Ok(())
}

fn recurrence_json(v: &Option<serde_json::Value>) -> Option<String> {
    v.as_ref().filter(|v| !v.is_null()).map(|v| v.to_string())
}

fn clean_opt(s: &Option<String>) -> Option<String> {
    s.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn create_task(conn: &mut Connection, input: &TaskInput) -> Result<Task> {
    validate(input)?;
    let id = new_id();
    let now = timefmt::now();
    let tx = conn.transaction()?;
    // New tasks go to the top of the manual order.
    let manual_order: i64 = tx.query_row(
        "SELECT COALESCE(MIN(manual_order), 0) - 1 FROM tasks WHERE completed_at IS NULL AND deleted_at IS NULL",
        [],
        |r| r.get(0),
    )?;
    let pin_order: i64 = if input.pinned { next_pin_order(&tx)? } else { 0 };
    tx.execute(
        "INSERT INTO tasks (id, title, notes, estimate_min, due_date, due_time, sched_start, sched_end,
            project_id, importance, pinned, pin_order, manual_order, recurrence, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
        params![
            id,
            input.title.trim(),
            input.notes,
            input.estimate_min,
            input.due_date,
            input.due_time,
            input.sched_start,
            input.sched_end,
            clean_opt(&input.project_id),
            input.importance.unwrap_or(3),
            input.pinned,
            pin_order,
            manual_order,
            recurrence_json(&input.recurrence),
            now,
        ],
    )?;
    for (i, title) in input.subtasks.iter().filter(|t| !t.trim().is_empty()).enumerate() {
        tx.execute(
            "INSERT INTO subtasks (id, task_id, title, sort, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![new_id(), id, title.trim(), i as i64, now],
        )?;
    }
    tx.commit()?;
    get_task(conn, &id)
}

pub fn update_task(conn: &Connection, input: &TaskInput) -> Result<Task> {
    validate(input)?;
    let id = input.id.as_deref().ok_or_else(|| Error::Invalid("Missing task id.".into()))?;
    let n = conn.execute(
        "UPDATE tasks SET title = ?2, notes = ?3, estimate_min = ?4, due_date = ?5, due_time = ?6,
            sched_start = ?7, sched_end = ?8, project_id = ?9, importance = ?10, recurrence = ?11, updated_at = ?12
         WHERE id = ?1 AND deleted_at IS NULL",
        params![
            id,
            input.title.trim(),
            input.notes,
            input.estimate_min,
            input.due_date,
            input.due_time,
            input.sched_start,
            input.sched_end,
            clean_opt(&input.project_id),
            input.importance.unwrap_or(3),
            recurrence_json(&input.recurrence),
            timefmt::now(),
        ],
    )?;
    if n == 0 {
        return Err(Error::NotFound("Task".into()));
    }
    get_task(conn, id)
}

fn next_pin_order(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(pin_order), 0) + 1 FROM tasks WHERE pinned = 1",
        [],
        |r| r.get(0),
    )?)
}

pub fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> Result<Task> {
    let order = if pinned { next_pin_order(conn)? } else { 0 };
    conn.execute(
        "UPDATE tasks SET pinned = ?2, pin_order = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, pinned, order, timefmt::now()],
    )?;
    get_task(conn, id)
}

fn write_order(conn: &mut Connection, column: &str, ids: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(&format!("UPDATE tasks SET {column} = ?2 WHERE id = ?1"))?;
        for (i, id) in ids.iter().enumerate() {
            stmt.execute(params![id, i as i64])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Persist the manual order. `ids` is the full active list in the desired order.
pub fn reorder_manual(conn: &mut Connection, ids: &[String]) -> Result<()> {
    write_order(conn, "manual_order", ids)
}

pub fn reorder_pins(conn: &mut Connection, ids: &[String]) -> Result<()> {
    write_order(conn, "pin_order", ids)
}

pub fn complete_task(
    conn: &mut Connection,
    id: &str,
    complete_subtasks: bool,
    next: Option<&NextOccurrence>,
) -> Result<CompleteResult> {
    let original = get_task(conn, id)?;
    if original.completed_at.is_some() {
        return Err(Error::Invalid("That task is already complete.".into()));
    }
    let now = timefmt::now();
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE tasks SET completed_at = ?2, pinned = 0, updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    if complete_subtasks {
        tx.execute("UPDATE subtasks SET done = 1 WHERE task_id = ?1", [id])?;
    }
    let mut next_id = None;
    if let Some(n) = next {
        // The next instance of a recurring task keeps everything but the dates,
        // and starts with a fresh checklist.
        let nid = new_id();
        tx.execute(
            &format!(
                "INSERT INTO tasks (id, title, notes, estimate_min, due_date, due_time, sched_start, sched_end,
                    project_id, importance, pinned, pin_order, manual_order, recurrence, created_at, updated_at)
                 SELECT ?2, title, notes, estimate_min, ?3, ?4, ?5, ?6, project_id, importance,
                    {pinned}, pin_order, manual_order, recurrence, ?7, ?7 FROM tasks WHERE id = ?1",
                pinned = if original.pinned { 1 } else { 0 }
            ),
            params![id, nid, n.due_date, n.due_time, n.sched_start, n.sched_end, now],
        )?;
        for s in &original.subtasks {
            tx.execute(
                "INSERT INTO subtasks (id, task_id, title, done, sort, created_at) VALUES (?1, ?2, ?3, 0, ?4, ?5)",
                params![new_id(), nid, s.title, s.sort, now],
            )?;
        }
        next_id = Some(nid);
    }
    tx.commit()?;
    Ok(CompleteResult {
        task: get_task(conn, id)?,
        next: next_id.map(|n| get_task(conn, &n)).transpose()?,
    })
}

/// Undo a completion. If completing created a next recurring instance, it is removed.
pub fn uncomplete_task(conn: &mut Connection, id: &str, remove_next: Option<&str>) -> Result<Task> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE tasks SET completed_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![id, timefmt::now()],
    )?;
    if let Some(next) = remove_next {
        tx.execute(
            "DELETE FROM tasks WHERE id = ?1 AND completed_at IS NULL",
            [next],
        )?;
    }
    tx.commit()?;
    get_task(conn, id)
}

/// Soft delete, so the action can be undone. Purged after a week.
pub fn delete_task(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET deleted_at = ?2 WHERE id = ?1",
        params![id, timefmt::now()],
    )?;
    Ok(())
}

pub fn restore_task(conn: &Connection, id: &str) -> Result<Task> {
    conn.execute("UPDATE tasks SET deleted_at = NULL WHERE id = ?1", [id])?;
    get_task(conn, id)
}

pub fn purge_deleted(conn: &Connection, older_than: DateTime<Utc>) -> Result<usize> {
    Ok(conn.execute(
        "DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        [timefmt::fmt(older_than)],
    )?)
}

// ---------- projects ----------

fn row_to_project(r: &Row) -> rusqlite::Result<Project> {
    Ok(Project { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, sort: r.get(3)?, created_at: r.get(4)? })
}

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt =
        conn.prepare("SELECT id, name, color, sort, created_at FROM projects ORDER BY sort, name")?;
    Ok(stmt.query_map([], row_to_project)?.collect::<rusqlite::Result<_>>()?)
}

pub fn create_project(conn: &Connection, name: &str, color: &str) -> Result<Project> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("A project needs a name.".into()));
    }
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE name = ?1 COLLATE NOCASE)",
        [name],
        |r| r.get(0),
    )?;
    if exists {
        return Err(Error::Invalid(format!("A project named “{name}” already exists.")));
    }
    let p = Project {
        id: new_id(),
        name: name.to_string(),
        color: color.to_string(),
        sort: conn.query_row("SELECT COALESCE(MAX(sort), -1) + 1 FROM projects", [], |r| r.get(0))?,
        created_at: timefmt::now(),
    };
    conn.execute(
        "INSERT INTO projects (id, name, color, sort, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![p.id, p.name, p.color, p.sort, p.created_at],
    )?;
    Ok(p)
}

pub fn update_project(conn: &Connection, id: &str, name: &str, color: &str) -> Result<Project> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("A project needs a name.".into()));
    }
    conn.execute(
        "UPDATE projects SET name = ?2, color = ?3 WHERE id = ?1",
        params![id, name, color],
    )?;
    conn.query_row("SELECT id, name, color, sort, created_at FROM projects WHERE id = ?1", [id], row_to_project)
        .optional()?
        .ok_or_else(|| Error::NotFound("Project".into()))
}

/// Deleting a project never deletes tasks: they (and their history) are
/// moved to `move_to`, or left without a project.
pub fn delete_project(conn: &mut Connection, id: &str, move_to: Option<&str>) -> Result<usize> {
    let tx = conn.transaction()?;
    let moved = tx.execute(
        "UPDATE tasks SET project_id = ?2, updated_at = ?3 WHERE project_id = ?1",
        params![id, move_to, timefmt::now()],
    )?;
    tx.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(moved)
}

pub fn reorder_projects(conn: &mut Connection, ids: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute("UPDATE projects SET sort = ?2 WHERE id = ?1", params![id, i as i64])?;
    }
    tx.commit()?;
    Ok(())
}

// ---------- subtasks (each returns the parent so the UI can replace it) ----------

fn touch(conn: &Connection, task_id: &str) -> Result<()> {
    conn.execute("UPDATE tasks SET updated_at = ?2 WHERE id = ?1", params![task_id, timefmt::now()])?;
    Ok(())
}

pub fn add_subtask(conn: &Connection, task_id: &str, title: &str) -> Result<Task> {
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Invalid("A subtask needs a title.".into()));
    }
    let sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort), -1) + 1 FROM subtasks WHERE task_id = ?1",
        [task_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO subtasks (id, task_id, title, sort, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![new_id(), task_id, title, sort, timefmt::now()],
    )?;
    touch(conn, task_id)?;
    get_task(conn, task_id)
}

fn subtask_parent(conn: &Connection, id: &str) -> Result<String> {
    conn.query_row("SELECT task_id FROM subtasks WHERE id = ?1", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error::NotFound("Subtask".into()))
}

pub fn update_subtask(conn: &Connection, id: &str, title: &str, done: bool) -> Result<Task> {
    let task_id = subtask_parent(conn, id)?;
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Invalid("A subtask needs a title.".into()));
    }
    conn.execute("UPDATE subtasks SET title = ?2, done = ?3 WHERE id = ?1", params![id, title, done])?;
    touch(conn, &task_id)?;
    get_task(conn, &task_id)
}

pub fn delete_subtask(conn: &Connection, id: &str) -> Result<Task> {
    let task_id = subtask_parent(conn, id)?;
    conn.execute("DELETE FROM subtasks WHERE id = ?1", [id])?;
    touch(conn, &task_id)?;
    get_task(conn, &task_id)
}

pub fn reorder_subtasks(conn: &mut Connection, task_id: &str, ids: &[String]) -> Result<Task> {
    let tx = conn.transaction()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE subtasks SET sort = ?3 WHERE id = ?1 AND task_id = ?2",
            params![id, task_id, i as i64],
        )?;
    }
    tx.commit()?;
    touch(conn, task_id)?;
    get_task(conn, task_id)
}

// ---------- settings ----------

pub fn get_settings(conn: &Connection) -> Result<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

// ---------- focus sessions ----------

pub fn active_session(conn: &Connection) -> Result<Option<FocusSession>> {
    Ok(conn
        .query_row(
            &format!("SELECT {SESSION_COLS} FROM focus_sessions WHERE ended_at IS NULL"),
            [],
            row_to_session,
        )
        .optional()?)
}

fn get_session(conn: &Connection, id: &str) -> Result<FocusSession> {
    conn.query_row(
        &format!("SELECT {SESSION_COLS} FROM focus_sessions WHERE id = ?1"),
        [id],
        row_to_session,
    )
    .optional()?
    .ok_or_else(|| Error::NotFound("Focus session".into()))
}

/// Start a session. Any session already in progress is stopped first.
pub fn start_session(
    conn: &mut Connection,
    task_id: Option<&str>,
    kind: &str,
    planned_sec: i64,
    now: DateTime<Utc>,
) -> Result<FocusSession> {
    if !matches!(kind, "focus" | "short_break" | "long_break") {
        return Err(Error::Invalid(format!("Unknown session kind: {kind}")));
    }
    if planned_sec <= 0 {
        return Err(Error::Invalid("A session needs a positive length.".into()));
    }
    if active_session(conn)?.is_some() {
        stop_session(conn, false, now)?;
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO focus_sessions (id, task_id, kind, planned_sec, started_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, task_id, kind, planned_sec, timefmt::fmt(now)],
    )?;
    get_session(conn, &id)
}

pub fn pause_session(conn: &Connection, now: DateTime<Utc>) -> Result<Option<FocusSession>> {
    let Some(s) = active_session(conn)? else { return Ok(None) };
    if s.paused_at.is_none() {
        conn.execute(
            "UPDATE focus_sessions SET paused_at = ?2 WHERE id = ?1",
            params![s.id, timefmt::fmt(now)],
        )?;
    }
    Ok(Some(get_session(conn, &s.id)?))
}

pub fn resume_session(conn: &Connection, now: DateTime<Utc>) -> Result<Option<FocusSession>> {
    let Some(s) = active_session(conn)? else { return Ok(None) };
    if let Some(p) = s.paused_at.as_deref().and_then(timefmt::parse) {
        let paused = (now - p).num_seconds().max(0);
        conn.execute(
            "UPDATE focus_sessions SET paused_at = NULL, paused_total_sec = paused_total_sec + ?2 WHERE id = ?1",
            params![s.id, paused],
        )?;
    }
    Ok(Some(get_session(conn, &s.id)?))
}

/// End the active session now. A session that already ran past its planned
/// length ends at its planned end, so a forgotten timer does not inflate
/// tracked time.
pub fn stop_session(conn: &Connection, completed: bool, now: DateTime<Utc>) -> Result<Option<FocusSession>> {
    let Some(s) = active_session(conn)? else { return Ok(None) };
    let mut end = now;
    if let Some(p) = s.paused_at.as_deref().and_then(timefmt::parse) {
        // Time spent paused up to now does not count.
        let extra = (now - p).num_seconds().max(0);
        conn.execute(
            "UPDATE focus_sessions SET paused_at = NULL, paused_total_sec = paused_total_sec + ?2 WHERE id = ?1",
            params![s.id, extra],
        )?;
    }
    let s = get_session(conn, &s.id)?;
    if let Some(pe) = timer::planned_end(&s) {
        end = end.min(pe);
    }
    let completed = completed || timer::remaining_sec(&s, now) == 0;
    conn.execute(
        "UPDATE focus_sessions SET ended_at = ?2, completed = ?3 WHERE id = ?1",
        params![s.id, timefmt::fmt(end), completed],
    )?;
    Ok(Some(get_session(conn, &s.id)?))
}

/// Called by the background loop: completes the running session if its time is up.
pub fn finish_elapsed_session(conn: &Connection, now: DateTime<Utc>) -> Result<Option<FocusSession>> {
    match active_session(conn)? {
        Some(s) if timer::is_running(&s) && timer::remaining_sec(&s, now) == 0 => stop_session(conn, true, now),
        _ => Ok(None),
    }
}

pub fn list_sessions(conn: &Connection, since: &str) -> Result<Vec<FocusSession>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLS} FROM focus_sessions WHERE started_at >= ?1 ORDER BY started_at"
    ))?;
    Ok(stmt.query_map([since], row_to_session)?.collect::<rusqlite::Result<_>>()?)
}

// ---------- export / import ----------

pub fn export_all(conn: &Connection) -> Result<ExportData> {
    let mut stmt = conn.prepare(&format!("SELECT {SESSION_COLS} FROM focus_sessions ORDER BY started_at"))?;
    let sessions = stmt.query_map([], row_to_session)?.collect::<rusqlite::Result<_>>()?;
    Ok(ExportData {
        app: "tempo".into(),
        format_version: 1,
        exported_at: timefmt::now(),
        projects: list_projects(conn)?,
        tasks: query_tasks(conn, "deleted_at IS NULL ORDER BY created_at", [])?,
        focus_sessions: sessions,
        settings: get_settings(conn)?,
    })
}

/// Merge an export into the database. Records with matching ids are replaced;
/// nothing else is removed.
pub fn import_all(conn: &mut Connection, data: &ExportData) -> Result<ImportSummary> {
    if data.app != "tempo" || data.format_version != 1 {
        return Err(Error::Invalid("This file is not a Tempo backup.".into()));
    }
    let tx = conn.transaction()?;
    for p in &data.projects {
        tx.execute(
            "INSERT INTO projects (id, name, color, sort, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, sort = excluded.sort",
            params![p.id, p.name, p.color, p.sort, p.created_at],
        )?;
    }
    for t in &data.tasks {
        tx.execute(
            "INSERT INTO tasks (id, title, notes, estimate_min, due_date, due_time, sched_start, sched_end,
                project_id, importance, pinned, pin_order, manual_order, recurrence, completed_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, notes = excluded.notes,
                estimate_min = excluded.estimate_min, due_date = excluded.due_date, due_time = excluded.due_time,
                sched_start = excluded.sched_start, sched_end = excluded.sched_end, project_id = excluded.project_id,
                importance = excluded.importance, pinned = excluded.pinned, pin_order = excluded.pin_order,
                manual_order = excluded.manual_order, recurrence = excluded.recurrence,
                completed_at = excluded.completed_at, deleted_at = NULL, updated_at = excluded.updated_at",
            params![
                t.id, t.title, t.notes, t.estimate_min, t.due_date, t.due_time, t.sched_start, t.sched_end,
                t.project_id, t.importance, t.pinned, t.pin_order, t.manual_order,
                recurrence_json(&t.recurrence), t.completed_at, t.created_at, t.updated_at
            ],
        )?;
        tx.execute("DELETE FROM subtasks WHERE task_id = ?1", [&t.id])?;
        for s in &t.subtasks {
            tx.execute(
                "INSERT INTO subtasks (id, task_id, title, done, sort, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, title = excluded.title,
                    done = excluded.done, sort = excluded.sort",
                params![s.id, t.id, s.title, s.done, s.sort, s.created_at],
            )?;
        }
    }
    let mut sessions = 0;
    for s in &data.focus_sessions {
        // Never import a second "active" session.
        let ended = s.ended_at.clone().or_else(|| Some(s.started_at.clone()));
        sessions += tx.execute(
            "INSERT OR IGNORE INTO focus_sessions (id, task_id, kind, planned_sec, started_at, paused_at,
                paused_total_sec, ended_at, completed) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)",
            params![s.id, s.task_id, s.kind, s.planned_sec, s.started_at, s.paused_total_sec, ended, s.completed],
        )?;
    }
    tx.commit()?;
    Ok(ImportSummary { projects: data.projects.len(), tasks: data.tasks.len(), focus_sessions: sessions })
}
