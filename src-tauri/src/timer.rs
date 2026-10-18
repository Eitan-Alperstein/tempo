//! Focus-session arithmetic. Remaining time is always derived from stored
//! timestamps, never from a ticking counter, so it stays correct across sleep,
//! window closes and restarts.

use crate::models::FocusSession;
use crate::timefmt;
use chrono::{DateTime, Duration, Utc};

/// Seconds of focused (unpaused) time elapsed at `now`.
pub fn elapsed_sec(s: &FocusSession, now: DateTime<Utc>) -> i64 {
    let Some(start) = timefmt::parse(&s.started_at) else { return 0 };
    let end = s.ended_at.as_deref().and_then(timefmt::parse).unwrap_or(now);
    // While paused, time stops at the moment of pausing.
    let end = match s.paused_at.as_deref().and_then(timefmt::parse) {
        Some(p) if s.ended_at.is_none() => p.min(end),
        _ => end,
    };
    ((end - start).num_seconds() - s.paused_total_sec).max(0)
}

pub fn remaining_sec(s: &FocusSession, now: DateTime<Utc>) -> i64 {
    (s.planned_sec - elapsed_sec(s, now)).max(0)
}

/// The instant a running session reaches its planned length.
pub fn planned_end(s: &FocusSession) -> Option<DateTime<Utc>> {
    let start = timefmt::parse(&s.started_at)?;
    Some(start + Duration::seconds(s.planned_sec + s.paused_total_sec))
}

pub fn is_running(s: &FocusSession) -> bool {
    s.ended_at.is_none() && s.paused_at.is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(start: &str, planned: i64) -> FocusSession {
        FocusSession {
            id: "s".into(),
            task_id: None,
            kind: "focus".into(),
            planned_sec: planned,
            started_at: start.into(),
            paused_at: None,
            paused_total_sec: 0,
            ended_at: None,
            completed: false,
        }
    }

    fn t(s: &str) -> DateTime<Utc> {
        timefmt::parse(s).unwrap()
    }

    #[test]
    fn remaining_counts_down_from_timestamps() {
        let s = session("2026-10-18T10:00:00.000Z", 1500);
        assert_eq!(remaining_sec(&s, t("2026-10-18T10:00:00.000Z")), 1500);
        assert_eq!(remaining_sec(&s, t("2026-10-18T10:10:00.000Z")), 900);
        // A long sleep or restart: never negative.
        assert_eq!(remaining_sec(&s, t("2026-10-18T14:00:00.000Z")), 0);
    }

    #[test]
    fn paused_time_is_excluded() {
        let mut s = session("2026-10-18T10:00:00.000Z", 1500);
        s.paused_at = Some("2026-10-18T10:05:00.000Z".into());
        // Paused for an hour: still 20 minutes left.
        assert_eq!(remaining_sec(&s, t("2026-10-18T11:05:00.000Z")), 1200);
        // Resumed at 11:05 → 3600s of pause recorded.
        s.paused_at = None;
        s.paused_total_sec = 3600;
        assert_eq!(remaining_sec(&s, t("2026-10-18T11:15:00.000Z")), 600);
        assert_eq!(planned_end(&s), Some(t("2026-10-18T11:25:00.000Z")));
    }

    #[test]
    fn ended_sessions_are_frozen() {
        let mut s = session("2026-10-18T10:00:00.000Z", 1500);
        s.ended_at = Some("2026-10-18T10:12:00.000Z".into());
        assert_eq!(elapsed_sec(&s, t("2026-10-19T10:00:00.000Z")), 720);
    }
}
