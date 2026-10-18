//! Reminder planning. Tempo stays running in the background and checks every
//! 30 seconds which reminders are due. Each reminder has a key that includes
//! its fire time, recorded in `notification_log` once handled, so:
//!   - a reminder never fires twice, even across restarts;
//!   - changing a deadline produces a new key, so the new time is honoured;
//!   - completed or deleted tasks simply stop producing reminders.
//!
//! After a restart, reminders missed while the app was quit are delivered only
//! if they are recent (see `grace`), so reopening the app never floods you.

use crate::error::Result;
use crate::timefmt;
use chrono::{DateTime, Duration, NaiveTime, TimeZone, Utc};
use rusqlite::{Connection, params};

#[derive(Debug, Clone, PartialEq)]
pub struct ReminderSource {
    pub id: String,
    pub title: String,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub sched_start: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Reminder {
    pub key: String,
    pub task_id: String,
    pub kind: &'static str,
    pub fire_at: DateTime<Utc>,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct ReminderSettings {
    pub lead_min: i64,
    /// Local time for date-only and overdue reminders.
    pub morning: NaiveTime,
}

impl Reminder {
    fn new(task: &ReminderSource, kind: &'static str, fire_at: DateTime<Utc>, body: String) -> Self {
        Reminder {
            key: format!("{kind}:{}:{}", task.id, timefmt::fmt(fire_at)),
            task_id: task.id.clone(),
            kind,
            fire_at,
            title: task.title.clone(),
            body,
        }
    }

    /// How late a reminder may still be delivered.
    pub fn grace(&self) -> Duration {
        match self.kind {
            // Morning summaries are still useful later that day.
            "due_day" | "overdue" => Duration::hours(12),
            _ => Duration::minutes(15),
        }
    }
}

/// Every reminder a set of active tasks could produce, in any time zone.
pub fn plan<Tz: TimeZone>(tasks: &[ReminderSource], cfg: &ReminderSettings, tz: &Tz) -> Vec<Reminder>
where
    Tz::Offset: std::fmt::Display,
{
    let lead = Duration::minutes(cfg.lead_min.max(0));
    let mut out = Vec::new();
    for t in tasks {
        if let Some(start) = t.sched_start.as_deref().and_then(timefmt::parse) {
            let local = start.with_timezone(tz);
            out.push(Reminder::new(t, "sched", start - lead, format!("Starts at {}", local.format("%-I:%M %p"))));
        }
        let Some(date) = t.due_date.as_deref().and_then(timefmt::parse_date) else { continue };
        match t.due_time.as_deref().and_then(timefmt::parse_hm) {
            Some(time) => {
                let due = timefmt::local_instant(tz, date, time);
                out.push(Reminder::new(t, "due", due - lead, format!("Due at {}", time.format("%-I:%M %p"))));
            }
            None => {
                let at = timefmt::local_instant(tz, date, cfg.morning);
                out.push(Reminder::new(t, "due_day", at, "Due today".into()));
            }
        }
        // One gentle nudge the morning after the deadline, never more.
        if let Some(next_day) = date.succ_opt() {
            let at = timefmt::local_instant(tz, next_day, cfg.morning);
            out.push(Reminder::new(t, "overdue", at, format!("Overdue since {}", date.format("%a %b %-d"))));
        }
    }
    out
}

/// Reminders whose time has come and that are still within their grace window.
pub fn due_now(planned: Vec<Reminder>, now: DateTime<Utc>) -> Vec<Reminder> {
    planned
        .into_iter()
        .filter(|r| r.fire_at <= now && now - r.fire_at <= r.grace())
        .collect()
}

pub fn load_sources(conn: &Connection) -> Result<Vec<ReminderSource>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, due_date, due_time, sched_start FROM tasks
         WHERE completed_at IS NULL AND deleted_at IS NULL AND (due_date IS NOT NULL OR sched_start IS NOT NULL)",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ReminderSource {
            id: r.get(0)?,
            title: r.get(1)?,
            due_date: r.get(2)?,
            due_time: r.get(3)?,
            sched_start: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn load_settings(conn: &Connection) -> Result<(bool, ReminderSettings)> {
    let get = |k: &str| crate::repo::get_setting(conn, k);
    let enabled = get("notifications")?.map(|v| v == "1").unwrap_or(false);
    let lead_min = get("reminderLeadMin")?.and_then(|v| v.parse().ok()).unwrap_or(10);
    let morning = get("workdayStart")?
        .and_then(|v| timefmt::parse_hm(&v))
        .unwrap_or_else(|| NaiveTime::from_hms_opt(9, 0, 0).unwrap());
    Ok((enabled, ReminderSettings { lead_min, morning }))
}

/// Claim reminders that are due and not yet handled. Claimed reminders are
/// logged before being returned, so a crash mid-delivery can't cause repeats.
pub fn claim_due<Tz: TimeZone>(conn: &Connection, now: DateTime<Utc>, tz: &Tz) -> Result<Vec<Reminder>>
where
    Tz::Offset: std::fmt::Display,
{
    let (enabled, cfg) = load_settings(conn)?;
    if !enabled {
        return Ok(Vec::new());
    }
    let due = due_now(plan(&load_sources(conn)?, &cfg, tz), now);
    let mut claimed = Vec::new();
    for r in due {
        let inserted = conn.execute(
            "INSERT OR IGNORE INTO notification_log (key, task_id, kind, fire_at, handled_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![r.key, r.task_id, r.kind, timefmt::fmt(r.fire_at), timefmt::fmt(now)],
        )?;
        if inserted == 1 {
            claimed.push(r);
        }
    }
    Ok(claimed)
}

pub fn prune_log(conn: &Connection, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "DELETE FROM notification_log WHERE handled_at < ?1",
        [timefmt::fmt(now - Duration::days(30))],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    fn src(id: &str) -> ReminderSource {
        ReminderSource { id: id.into(), title: format!("Task {id}"), due_date: None, due_time: None, sched_start: None }
    }

    fn cfg() -> ReminderSettings {
        ReminderSettings { lead_min: 10, morning: NaiveTime::from_hms_opt(9, 0, 0).unwrap() }
    }

    fn utc(s: &str) -> DateTime<Utc> {
        timefmt::parse(s).unwrap()
    }

    #[test]
    fn scheduled_task_fires_lead_minutes_early() {
        let mut t = src("a");
        t.sched_start = Some("2026-10-18T16:00:00.000Z".into());
        let plan = plan(&[t], &cfg(), &Utc);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].fire_at, utc("2026-10-18T15:50:00.000Z"));
        assert_eq!(due_now(plan.clone(), utc("2026-10-18T15:49:00.000Z")).len(), 0);
        assert_eq!(due_now(plan.clone(), utc("2026-10-18T15:51:00.000Z")).len(), 1);
        // Missed by more than the grace window (app was quit): skipped.
        assert_eq!(due_now(plan, utc("2026-10-18T17:00:00.000Z")).len(), 0);
    }

    #[test]
    fn due_dates_use_local_wall_clock() {
        let tz = FixedOffset::west_opt(4 * 3600).unwrap(); // UTC−4
        let mut t = src("b");
        t.due_date = Some("2026-10-23".into());
        t.due_time = Some("15:00".into());
        let plan = plan(&[t], &cfg(), &tz);
        let due = plan.iter().find(|r| r.kind == "due").unwrap();
        assert_eq!(due.fire_at, utc("2026-10-23T18:50:00.000Z"));
        let overdue = plan.iter().find(|r| r.kind == "overdue").unwrap();
        assert_eq!(overdue.fire_at, utc("2026-10-24T13:00:00.000Z"));
    }

    #[test]
    fn changing_a_deadline_changes_the_key() {
        let mut t = src("c");
        t.due_date = Some("2026-10-23".into());
        let k1 = plan(&[t.clone()], &cfg(), &Utc)[0].key.clone();
        t.due_date = Some("2026-10-24".into());
        let k2 = plan(&[t], &cfg(), &Utc)[0].key.clone();
        assert_ne!(k1, k2);
    }

    #[test]
    fn reconciliation_never_repeats_and_respects_completion() {
        let conn = crate::db::open_in_memory().unwrap();
        crate::repo::set_setting(&conn, "notifications", "1").unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, sched_start, sched_end, created_at, updated_at)
             VALUES ('t1', 'Write', '2026-10-18T16:00:00.000Z', '2026-10-18T17:00:00.000Z', 'x', 'x')",
            [],
        )
        .unwrap();
        let now = utc("2026-10-18T15:52:00.000Z");
        assert_eq!(claim_due(&conn, now, &Utc).unwrap().len(), 1);
        // Same tick again, or after an app restart: nothing new.
        assert_eq!(claim_due(&conn, now + Duration::seconds(30), &Utc).unwrap().len(), 0);

        // A completed task produces no reminders.
        conn.execute(
            "INSERT INTO tasks (id, title, sched_start, sched_end, completed_at, created_at, updated_at)
             VALUES ('t2', 'Done', '2026-10-18T16:00:00.000Z', '2026-10-18T17:00:00.000Z', 'x', 'x', 'x')",
            [],
        )
        .unwrap();
        assert_eq!(claim_due(&conn, now, &Utc).unwrap().len(), 0);
    }

    #[test]
    fn disabled_notifications_claim_nothing() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, sched_start, sched_end, created_at, updated_at)
             VALUES ('t1', 'Write', '2026-10-18T16:00:00.000Z', '2026-10-18T17:00:00.000Z', 'x', 'x')",
            [],
        )
        .unwrap();
        assert!(claim_due(&conn, utc("2026-10-18T15:52:00.000Z"), &Utc).unwrap().is_empty());
    }
}
