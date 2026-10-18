//! Read-only access to the macOS calendar, isolated behind `CalendarProvider`.
//! Tempo never creates, edits or deletes calendar events.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    /// RFC 3339 UTC instants.
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub calendar: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum CalendarStatus {
    NotDetermined,
    Granted,
    Denied,
    Restricted,
    Unavailable { reason: String },
}

pub trait CalendarProvider: Send + Sync {
    fn status(&self) -> CalendarStatus;
    /// Shows the system permission prompt if the user hasn't decided yet.
    fn request_access(&self) -> CalendarStatus;
    fn fetch(&self, start: &str, end: &str) -> Result<Vec<CalendarEvent>, String>;
}

/// Events in a range, or a readable error. Never returns events unless access
/// has actually been granted.
pub fn events(p: &dyn CalendarProvider, start: &str, end: &str) -> Result<Vec<CalendarEvent>, String> {
    match p.status() {
        CalendarStatus::Granted => p.fetch(start, end),
        CalendarStatus::NotDetermined => Err("Calendar access hasn't been granted yet.".into()),
        CalendarStatus::Denied => Err(
            "Calendar access was denied. You can allow it in System Settings → Privacy & Security → Calendars.".into(),
        ),
        CalendarStatus::Restricted => Err("Calendar access is restricted on this Mac.".into()),
        CalendarStatus::Unavailable { reason } => Err(reason),
    }
}

pub struct Unavailable(pub String);

impl CalendarProvider for Unavailable {
    fn status(&self) -> CalendarStatus {
        CalendarStatus::Unavailable { reason: self.0.clone() }
    }
    fn request_access(&self) -> CalendarStatus {
        self.status()
    }
    fn fetch(&self, _: &str, _: &str) -> Result<Vec<CalendarEvent>, String> {
        Err(self.0.clone())
    }
}

pub fn default_provider() -> Box<dyn CalendarProvider> {
    #[cfg(target_os = "macos")]
    {
        // macOS terminates a process that asks for calendar access without a
        // usage description, which only the bundled .app has.
        let bundled = std::env::current_exe()
            .map(|p| p.to_string_lossy().contains(".app/Contents/MacOS/"))
            .unwrap_or(false);
        if bundled {
            return Box::new(eventkit::EventKit);
        }
        Box::new(Unavailable(
            "Calendar access needs the built Tempo app. It isn't available in development mode.".into(),
        ))
    }
    #[cfg(not(target_os = "macos"))]
    Box::new(Unavailable("Calendar integration is only available on macOS.".into()))
}

#[cfg(target_os = "macos")]
mod eventkit {
    use super::*;
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStore};
    use objc2_foundation::{NSDate, NSError};
    use std::sync::mpsc;
    use std::time::Duration;

    pub struct EventKit;

    fn to_date(s: &str) -> Option<objc2::rc::Retained<NSDate>> {
        let t = crate::timefmt::parse(s)?;
        Some(NSDate::dateWithTimeIntervalSince1970(t.timestamp_millis() as f64 / 1000.0))
    }

    fn from_date(d: &NSDate) -> String {
        let ms = (d.timeIntervalSince1970() * 1000.0).round() as i64;
        chrono::DateTime::from_timestamp_millis(ms).map(crate::timefmt::fmt).unwrap_or_default()
    }

    impl CalendarProvider for EventKit {
        fn status(&self) -> CalendarStatus {
            let s = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
            match s {
                EKAuthorizationStatus::FullAccess => CalendarStatus::Granted,
                EKAuthorizationStatus::NotDetermined => CalendarStatus::NotDetermined,
                EKAuthorizationStatus::Restricted => CalendarStatus::Restricted,
                // Write-only access can't read events, which is all Tempo needs.
                _ => CalendarStatus::Denied,
            }
        }

        fn request_access(&self) -> CalendarStatus {
            if self.status() != CalendarStatus::NotDetermined {
                return self.status();
            }
            let (tx, rx) = mpsc::channel::<bool>();
            let store = unsafe { EKEventStore::new() };
            let block = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
                let _ = tx.send(granted.as_bool());
            });
            unsafe { store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&block)) };
            // The prompt waits on the user; give them time to read it.
            let _ = rx.recv_timeout(Duration::from_secs(300));
            self.status()
        }

        fn fetch(&self, start: &str, end: &str) -> Result<Vec<CalendarEvent>, String> {
            let (Some(s), Some(e)) = (to_date(start), to_date(end)) else {
                return Err("Invalid date range.".into());
            };
            let store = unsafe { EKEventStore::new() };
            let events = unsafe {
                let pred = store.predicateForEventsWithStartDate_endDate_calendars(&s, &e, None);
                store.eventsMatchingPredicate(&pred)
            };
            let mut out = Vec::new();
            for ev in events.iter() {
                unsafe {
                    let start = from_date(&ev.startDate());
                    out.push(CalendarEvent {
                        id: format!("{}@{}", ev.calendarItemIdentifier(), start),
                        title: ev.title().to_string(),
                        start,
                        end: from_date(&ev.endDate()),
                        all_day: ev.isAllDay(),
                        calendar: ev.calendar().map(|c| c.title().to_string()).unwrap_or_default(),
                    });
                }
            }
            out.sort_by(|a, b| a.start.cmp(&b.start));
            Ok(out)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake(CalendarStatus);
    impl CalendarProvider for Fake {
        fn status(&self) -> CalendarStatus {
            self.0.clone()
        }
        fn request_access(&self) -> CalendarStatus {
            self.0.clone()
        }
        fn fetch(&self, _: &str, _: &str) -> Result<Vec<CalendarEvent>, String> {
            Ok(vec![CalendarEvent {
                id: "1".into(),
                title: "Standup".into(),
                start: "2026-10-18T14:00:00.000Z".into(),
                end: "2026-10-18T14:15:00.000Z".into(),
                all_day: false,
                calendar: "Work".into(),
            }])
        }
    }

    #[test]
    fn denied_access_returns_a_helpful_error_and_no_events() {
        let err = events(&Fake(CalendarStatus::Denied), "a", "b").unwrap_err();
        assert!(err.contains("System Settings"));
        assert!(events(&Fake(CalendarStatus::NotDetermined), "a", "b").is_err());
        assert!(events(&Fake(CalendarStatus::Restricted), "a", "b").is_err());
    }

    #[test]
    fn granted_access_returns_events() {
        assert_eq!(events(&Fake(CalendarStatus::Granted), "a", "b").unwrap().len(), 1);
    }

    #[test]
    fn unavailable_provider_explains_why() {
        let p = Unavailable("No calendar here".into());
        assert_eq!(p.request_access(), CalendarStatus::Unavailable { reason: "No calendar here".into() });
        assert_eq!(events(&p, "a", "b").unwrap_err(), "No calendar here");
    }
}
