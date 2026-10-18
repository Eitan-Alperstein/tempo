//! SQLite connection setup and schema migrations.
//!
//! Migrations are append-only. Each entry runs once, inside a transaction, and
//! bumps `PRAGMA user_version`. Before upgrading an existing database we copy
//! the file next to itself so a bad migration can never cost the user data.

use rusqlite::Connection;
use std::path::Path;

pub struct Migration {
    pub version: i64,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    sql: r#"
CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#8e8e93',
    sort        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

-- due_date/due_time are local wall-clock values ("2026-10-23", "15:00"):
-- a deadline of "Friday 3pm" stays Friday 3pm across time-zone changes.
-- sched_start/sched_end are absolute UTC instants, like calendar events.
CREATE TABLE tasks (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    notes         TEXT NOT NULL DEFAULT '',
    estimate_min  INTEGER CHECK (estimate_min IS NULL OR estimate_min > 0),
    due_date      TEXT,
    due_time      TEXT,
    sched_start   TEXT,
    sched_end     TEXT,
    project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
    importance    INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
    pinned        INTEGER NOT NULL DEFAULT 0,
    pin_order     INTEGER NOT NULL DEFAULT 0,
    manual_order  INTEGER NOT NULL DEFAULT 0,
    recurrence    TEXT,
    completed_at  TEXT,
    deleted_at    TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    CHECK ((sched_start IS NULL) = (sched_end IS NULL)),
    CHECK (due_time IS NULL OR due_date IS NOT NULL)
);
CREATE INDEX idx_tasks_state     ON tasks(completed_at, deleted_at);
CREATE INDEX idx_tasks_due       ON tasks(due_date);
CREATE INDEX idx_tasks_project   ON tasks(project_id);

CREATE TABLE subtasks (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    done        INTEGER NOT NULL DEFAULT 0,
    sort        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_subtasks_task ON subtasks(task_id, sort);

CREATE TABLE focus_sessions (
    id                TEXT PRIMARY KEY,
    task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    kind              TEXT NOT NULL CHECK (kind IN ('focus', 'short_break', 'long_break')),
    planned_sec       INTEGER NOT NULL CHECK (planned_sec > 0),
    started_at        TEXT NOT NULL,
    paused_at         TEXT,
    paused_total_sec  INTEGER NOT NULL DEFAULT 0,
    ended_at          TEXT,
    completed         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_task    ON focus_sessions(task_id);
CREATE INDEX idx_sessions_started ON focus_sessions(started_at);
-- At most one running or paused session at a time.
CREATE UNIQUE INDEX idx_sessions_one_active ON focus_sessions(ended_at IS NULL) WHERE ended_at IS NULL;

CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

-- One row per reminder we have handled, so a reminder never fires twice.
CREATE TABLE notification_log (
    key        TEXT PRIMARY KEY,
    task_id    TEXT,
    kind       TEXT NOT NULL,
    fire_at    TEXT NOT NULL,
    handled_at TEXT NOT NULL
);
"#,
}];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if path.exists() {
        let probe = Connection::open(path)?;
        let current: i64 = probe.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        drop(probe);
        let latest = MIGRATIONS.last().map(|m| m.version).unwrap_or(0);
        if current > 0 && current < latest {
            let backup = path.with_extension(format!("db.bak-v{current}"));
            // A failed backup must not block startup, but it should be visible.
            if let Err(e) = std::fs::copy(path, &backup) {
                eprintln!("tempo: could not back up database before migrating: {e}");
            }
        }
    }
    let mut conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&mut conn, MIGRATIONS)?;
    Ok(conn)
}

pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&mut conn, MIGRATIONS)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

pub fn migrate(conn: &mut Connection, migrations: &[Migration]) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for m in migrations.iter().filter(|m| m.version > current) {
        let tx = conn.transaction()?;
        tx.execute_batch(m.sql)?;
        tx.pragma_update(None, "user_version", m.version)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn schema_version(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("PRAGMA user_version", [], |r| r.get(0))
}
