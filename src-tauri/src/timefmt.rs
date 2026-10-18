//! Timestamp helpers. All stored instants are RFC 3339 UTC with millisecond
//! precision, matching JavaScript's `Date.prototype.toISOString()`.

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, NaiveTime, SecondsFormat, TimeZone, Utc};

pub fn now() -> String {
    fmt(Utc::now())
}

pub fn fmt(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn parse(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|t| t.with_timezone(&Utc))
}

/// Resolve a local wall-clock date and time to an instant. During a DST
/// "spring forward" gap the time does not exist, so we move it an hour later;
/// during a "fall back" overlap we take the earlier of the two instants.
pub fn local_instant<Tz: TimeZone>(tz: &Tz, date: NaiveDate, time: NaiveTime) -> DateTime<Utc> {
    let naive = NaiveDateTime::new(date, time);
    match tz.from_local_datetime(&naive).earliest() {
        Some(t) => t.with_timezone(&Utc),
        None => tz
            .from_local_datetime(&(naive + chrono::Duration::hours(1)))
            .earliest()
            .map(|t| t.with_timezone(&Utc))
            .unwrap_or_else(|| Utc.from_utc_datetime(&naive)),
    }
}

pub fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

pub fn parse_hm(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s, "%H:%M").ok()
}

pub fn local_now() -> DateTime<Local> {
    Local::now()
}
