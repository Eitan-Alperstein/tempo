//! Integration tests against a real SQLite file: closing and reopening the
//! connection is how we check "survives a restart".

use chrono::{Duration, Utc};
use tempo_lib::models::*;
use tempo_lib::{db, repo, timefmt};

fn input(title: &str) -> TaskInput {
    TaskInput { title: title.into(), ..Default::default() }
}

fn temp_db() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tempo.db");
    (dir, path)
}

#[test]
fn tasks_persist_across_restart() {
    let (_dir, path) = temp_db();
    let id = {
        let mut conn = db::open(&path).unwrap();
        let mut i = input("  Study physics  ");
        i.estimate_min = Some(45);
        i.due_date = Some("2026-10-19".into());
        i.subtasks = vec!["Read ch. 4".into(), "Problems 1–10".into()];
        let t = repo::create_task(&mut conn, &i).unwrap();
        assert_eq!(t.title, "Study physics");
        t.id
    };
    let conn = db::open(&path).unwrap();
    let t = repo::get_task(&conn, &id).unwrap();
    assert_eq!(t.estimate_min, Some(45));
    assert_eq!(t.due_date.as_deref(), Some("2026-10-19"));
    assert_eq!(t.subtasks.len(), 2);
    assert_eq!(t.subtasks[0].title, "Read ch. 4");
}

#[test]
fn title_alone_is_enough_and_bad_input_is_rejected() {
    let mut conn = db::open_in_memory().unwrap();
    let t = repo::create_task(&mut conn, &input("Just a title")).unwrap();
    assert_eq!(t.importance, 3);
    assert!(t.estimate_min.is_none() && t.due_date.is_none() && t.sched_start.is_none());

    assert!(repo::create_task(&mut conn, &input("   ")).is_err());
    let mut bad = input("x");
    bad.importance = Some(9);
    assert!(repo::create_task(&mut conn, &bad).is_err());
    let mut bad = input("x");
    bad.due_time = Some("15:00".into());
    assert!(repo::create_task(&mut conn, &bad).is_err(), "time without a date");
    let mut bad = input("x");
    bad.sched_start = Some("2026-10-18T16:00:00.000Z".into());
    bad.sched_end = Some("2026-10-18T15:00:00.000Z".into());
    assert!(repo::create_task(&mut conn, &bad).is_err(), "block ending before it starts");
}

#[test]
fn edit_complete_uncomplete_delete_restore() {
    let mut conn = db::open_in_memory().unwrap();
    let t = repo::create_task(&mut conn, &input("Essay")).unwrap();

    let mut edit = input("History essay");
    edit.id = Some(t.id.clone());
    edit.importance = Some(5);
    edit.notes = "Use primary sources".into();
    let t = repo::update_task(&conn, &edit).unwrap();
    assert_eq!((t.title.as_str(), t.importance), ("History essay", 5));

    let r = repo::complete_task(&mut conn, &t.id, false, None).unwrap();
    assert!(r.task.completed_at.is_some());
    assert!(repo::list_active(&conn).unwrap().is_empty());
    assert_eq!(repo::list_completed(&conn, None, None, 10).unwrap().len(), 1);
    assert!(repo::complete_task(&mut conn, &t.id, false, None).is_err(), "can't complete twice");

    repo::uncomplete_task(&mut conn, &t.id, None).unwrap();
    assert_eq!(repo::list_active(&conn).unwrap().len(), 1);

    repo::delete_task(&conn, &t.id).unwrap();
    assert!(repo::list_active(&conn).unwrap().is_empty());
    repo::restore_task(&conn, &t.id).unwrap();
    assert_eq!(repo::list_active(&conn).unwrap().len(), 1);

    // Deleted tasks are purged only after the grace period.
    repo::delete_task(&conn, &t.id).unwrap();
    assert_eq!(repo::purge_deleted(&conn, Utc::now() - Duration::days(7)).unwrap(), 0);
    assert_eq!(repo::purge_deleted(&conn, Utc::now() + Duration::seconds(1)).unwrap(), 1);
}

#[test]
fn manual_and_pin_order_survive_restart() {
    let (_dir, path) = temp_db();
    let ids: Vec<String> = {
        let mut conn = db::open(&path).unwrap();
        let a = repo::create_task(&mut conn, &input("A")).unwrap().id;
        let b = repo::create_task(&mut conn, &input("B")).unwrap().id;
        let c = repo::create_task(&mut conn, &input("C")).unwrap().id;
        // Newest first by default.
        let titles: Vec<_> = repo::list_active(&conn).unwrap().into_iter().map(|t| t.title).collect();
        assert_eq!(titles, ["C", "B", "A"]);
        let order = vec![b.clone(), a.clone(), c.clone()];
        repo::reorder_manual(&mut conn, &order).unwrap();
        repo::set_pinned(&conn, &c, true).unwrap();
        repo::set_pinned(&conn, &a, true).unwrap();
        repo::reorder_pins(&mut conn, &[a.clone(), c.clone()]).unwrap();
        order
    };
    let conn = db::open(&path).unwrap();
    let active = repo::list_active(&conn).unwrap();
    let got: Vec<_> = active.iter().map(|t| t.id.clone()).collect();
    assert_eq!(got, ids);
    let mut pinned: Vec<_> = active.iter().filter(|t| t.pinned).collect();
    pinned.sort_by_key(|t| t.pin_order);
    assert_eq!(pinned.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["A", "C"]);
}

#[test]
fn completing_a_parent_keeps_its_checklist() {
    let mut conn = db::open_in_memory().unwrap();
    let mut i = input("Pack");
    i.subtasks = vec!["Charger".into(), "Passport".into(), "Shoes".into()];
    let t = repo::create_task(&mut conn, &i).unwrap();
    let t = repo::update_subtask(&conn, &t.subtasks[0].id, "Charger", true).unwrap();
    assert_eq!(t.subtasks.iter().filter(|s| s.done).count(), 1);

    // Leave unfinished subtasks as they are.
    let r = repo::complete_task(&mut conn, &t.id, false, None).unwrap();
    assert_eq!(r.task.subtasks.len(), 3);
    assert_eq!(r.task.subtasks.iter().filter(|s| s.done).count(), 1);

    // Or complete them all.
    let mut i = input("Clean");
    i.subtasks = vec!["Desk".into(), "Floor".into()];
    let t = repo::create_task(&mut conn, &i).unwrap();
    let r = repo::complete_task(&mut conn, &t.id, true, None).unwrap();
    assert!(r.task.subtasks.iter().all(|s| s.done));
}

#[test]
fn subtasks_reorder_edit_delete() {
    let mut conn = db::open_in_memory().unwrap();
    let t = repo::create_task(&mut conn, &input("Trip")).unwrap();
    let t = repo::add_subtask(&conn, &t.id, "One").unwrap();
    let t = repo::add_subtask(&conn, &t.id, "Two").unwrap();
    let t = repo::add_subtask(&conn, &t.id, "Three").unwrap();
    let ids: Vec<String> = t.subtasks.iter().rev().map(|s| s.id.clone()).collect();
    let t = repo::reorder_subtasks(&mut conn, &t.id, &ids).unwrap();
    assert_eq!(t.subtasks.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(), ["Three", "Two", "One"]);
    let t = repo::update_subtask(&conn, &t.subtasks[1].id, "Deux", false).unwrap();
    assert_eq!(t.subtasks[1].title, "Deux");
    let t = repo::delete_subtask(&conn, &t.subtasks[0].id).unwrap();
    assert_eq!(t.subtasks.len(), 2);
}

#[test]
fn recurring_completion_creates_next_instance_and_undo_removes_it() {
    let mut conn = db::open_in_memory().unwrap();
    let mut i = input("Practice guitar");
    i.due_date = Some("2026-10-18".into());
    i.recurrence = Some(serde_json::json!({"freq": "daily", "from": "due"}));
    i.subtasks = vec!["Scales".into()];
    let t = repo::create_task(&mut conn, &i).unwrap();
    let t = repo::update_subtask(&conn, &t.subtasks[0].id, "Scales", true).unwrap();
    let next = NextOccurrence { due_date: Some("2026-10-19".into()), ..Default::default() };
    let r = repo::complete_task(&mut conn, &t.id, false, Some(&next)).unwrap();
    let n = r.next.unwrap();
    assert_eq!(n.due_date.as_deref(), Some("2026-10-19"));
    assert_eq!(n.recurrence, t.recurrence);
    assert!(!n.subtasks[0].done, "next instance starts with a fresh checklist");
    assert_eq!(repo::list_active(&conn).unwrap().len(), 1);

    repo::uncomplete_task(&mut conn, &t.id, Some(&n.id)).unwrap();
    let active = repo::list_active(&conn).unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].id, t.id);
}

#[test]
fn deleting_a_project_never_deletes_tasks() {
    let mut conn = db::open_in_memory().unwrap();
    let school = repo::create_project(&conn, "School", "#0a84ff").unwrap();
    let personal = repo::create_project(&conn, "Personal", "#30d158").unwrap();
    assert!(repo::create_project(&conn, "school", "#000").is_err(), "duplicate names");
    let mut i = input("Calculus");
    i.project_id = Some(school.id.clone());
    let t = repo::create_task(&mut conn, &i).unwrap();
    let mut i = input("Old essay");
    i.project_id = Some(school.id.clone());
    let done = repo::create_task(&mut conn, &i).unwrap();
    repo::complete_task(&mut conn, &done.id, false, None).unwrap();

    assert_eq!(repo::delete_project(&mut conn, &school.id, Some(&personal.id)).unwrap(), 2);
    assert_eq!(repo::get_task(&conn, &t.id).unwrap().project_id.as_deref(), Some(personal.id.as_str()));
    assert_eq!(repo::get_task(&conn, &done.id).unwrap().project_id.as_deref(), Some(personal.id.as_str()));

    repo::delete_project(&mut conn, &personal.id, None).unwrap();
    assert!(repo::get_task(&conn, &t.id).unwrap().project_id.is_none());
    assert_eq!(repo::list_completed(&conn, None, None, 10).unwrap().len(), 1);
}

#[test]
fn completed_search_matches_title_notes_project_and_subtasks() {
    let mut conn = db::open_in_memory().unwrap();
    let p = repo::create_project(&conn, "Newspaper", "#ff9f0a").unwrap();
    let mut a = input("Ad proposal");
    a.project_id = Some(p.id.clone());
    let mut b = input("Lab report");
    b.notes = "titration results".into();
    let mut c = input("Errands");
    c.subtasks = vec!["Buy 100% cotton shirt".into()];
    for i in [a, b, c] {
        let t = repo::create_task(&mut conn, &i).unwrap();
        repo::complete_task(&mut conn, &t.id, false, None).unwrap();
    }
    let q = |s| repo::list_completed(&conn, Some(s), None, 10).unwrap().len();
    assert_eq!(q("newspaper"), 1);
    assert_eq!(q("titration"), 1);
    assert_eq!(q("cotton"), 1);
    assert_eq!(q("100%"), 1, "LIKE wildcards are escaped");
    assert_eq!(q("zzz"), 0);
    assert_eq!(q(""), 3);
}

#[test]
fn focus_sessions_track_time_and_recover() {
    let (_dir, path) = temp_db();
    let t0 = timefmt::parse("2026-10-18T10:00:00.000Z").unwrap();
    let task_id = {
        let mut conn = db::open(&path).unwrap();
        let t = repo::create_task(&mut conn, &input("Write")).unwrap();
        repo::start_session(&mut conn, Some(&t.id), "focus", 1500, t0).unwrap();
        repo::pause_session(&conn, t0 + Duration::minutes(10)).unwrap();
        t.id
    };
    // "Restart" while paused: the session is still there and still paused.
    let mut conn = db::open(&path).unwrap();
    let s = repo::active_session(&conn).unwrap().unwrap();
    assert!(s.paused_at.is_some());
    repo::resume_session(&conn, t0 + Duration::minutes(40)).unwrap();
    // The machine sleeps through the end; the loop finishes it at its planned end.
    let done = repo::finish_elapsed_session(&conn, t0 + Duration::hours(3)).unwrap().unwrap();
    assert!(done.completed);
    assert_eq!(done.ended_at.as_deref(), Some("2026-10-18T10:55:00.000Z"));
    assert_eq!(repo::get_task(&conn, &task_id).unwrap().focus_sec, 1500);
    assert!(repo::active_session(&conn).unwrap().is_none());

    // Stopping early counts only the time actually focused, and is not "completed".
    let t1 = t0 + Duration::hours(4);
    repo::start_session(&mut conn, Some(&task_id), "focus", 1500, t1).unwrap();
    let s = repo::stop_session(&conn, false, t1 + Duration::minutes(5)).unwrap().unwrap();
    assert!(!s.completed);
    assert_eq!(repo::get_task(&conn, &task_id).unwrap().focus_sec, 1500 + 300);

    // Breaks never count as focus time; starting a new session stops the old one.
    repo::start_session(&mut conn, Some(&task_id), "short_break", 300, t1 + Duration::minutes(6)).unwrap();
    repo::start_session(&mut conn, Some(&task_id), "focus", 1500, t1 + Duration::minutes(8)).unwrap();
    let sessions = repo::list_sessions(&conn, "2026-10-18T00:00:00.000Z").unwrap();
    assert_eq!(sessions.len(), 4);
    assert_eq!(sessions.iter().filter(|s| s.ended_at.is_none()).count(), 1);
}

#[test]
fn migrations_run_once_and_keep_data() {
    let (_dir, path) = temp_db();
    {
        let mut conn = db::open(&path).unwrap();
        repo::create_task(&mut conn, &input("Keep me")).unwrap();
        assert_eq!(db::schema_version(&conn).unwrap(), db::MIGRATIONS.last().unwrap().version);
    }
    // Reopening re-runs nothing.
    let mut conn = db::open(&path).unwrap();
    // A future migration adding a column must preserve existing rows.
    let future = [db::Migration { version: 99, sql: "ALTER TABLE tasks ADD COLUMN energy INTEGER;" }];
    db::migrate(&mut conn, &future).unwrap();
    assert_eq!(db::schema_version(&conn).unwrap(), 99);
    assert_eq!(repo::list_active(&conn).unwrap()[0].title, "Keep me");
    // A failing migration rolls back entirely.
    let broken = [db::Migration { version: 100, sql: "ALTER TABLE tasks ADD COLUMN x INTEGER; NOT SQL;" }];
    assert!(db::migrate(&mut conn, &broken).is_err());
    assert_eq!(db::schema_version(&conn).unwrap(), 99);
    assert_eq!(repo::list_active(&conn).unwrap().len(), 1);
}

#[test]
fn export_then_import_round_trips() {
    let mut src = db::open_in_memory().unwrap();
    let p = repo::create_project(&src, "Guitar", "#bf5af2").unwrap();
    let mut i = input("Scales");
    i.project_id = Some(p.id.clone());
    i.subtasks = vec!["Major".into()];
    let t = repo::create_task(&mut src, &i).unwrap();
    let now = Utc::now();
    repo::start_session(&mut src, Some(&t.id), "focus", 60, now).unwrap();
    repo::stop_session(&src, true, now + Duration::seconds(60)).unwrap();
    repo::complete_task(&mut src, &t.id, false, None).unwrap();
    repo::create_task(&mut src, &input("Open task")).unwrap();
    repo::set_setting(&src, "focusMin", "30").unwrap();

    let data = repo::export_all(&src).unwrap();
    let json = serde_json::to_string(&data).unwrap();
    let parsed: ExportData = serde_json::from_str(&json).unwrap();

    let mut dst = db::open_in_memory().unwrap();
    let summary = repo::import_all(&mut dst, &parsed).unwrap();
    assert_eq!(summary, ImportSummary { projects: 1, tasks: 2, focus_sessions: 1 });
    let done = repo::list_completed(&dst, None, None, 10).unwrap();
    assert_eq!(done[0].title, "Scales");
    assert_eq!(done[0].subtasks[0].title, "Major");
    assert_eq!(done[0].focus_sec, 60);
    assert_eq!(repo::list_active(&dst).unwrap().len(), 1);
    // Importing twice is harmless.
    repo::import_all(&mut dst, &parsed).unwrap();
    assert_eq!(repo::list_active(&dst).unwrap().len(), 1);

    let mut bad = parsed.clone();
    bad.app = "other".into();
    assert!(repo::import_all(&mut dst, &bad).is_err());
}
