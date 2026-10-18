# Tempo

A calm, fast macOS task manager for deciding **what to do next**, **how long it will take**, and **when you can do it**. Tempo ranks tasks by importance, deadline and the time you have left, rather than by when you created them.

Built with Tauri 2, React and TypeScript, Rust, and SQLite. Fully offline: no accounts, servers or API keys.

## Run it

Requirements: macOS 14+, Rust (stable), Node 22+, and the Xcode Command Line Tools.

```sh
npm install
npm run tauri dev        # run in development (hot reload)
npm run tauri build      # build Tempo.app and a .dmg
```

The built app is at `src-tauri/target/release/bundle/macos/Tempo.app` (drag it to /Applications). The DMG is in `bundle/dmg/`. Builds are ad-hoc signed for local use, not notarized.

Checks:

```sh
npm run check            # typecheck + lint + frontend tests + Rust tests
npm test                 # Vitest (frontend logic and UI)
npm run test:rust        # cargo test (database, reminders, timer, calendar)
```

For development against a throwaway database, set `TEMPO_DB=/path/to/scratch.db`.

## How it works

### Views
- **Today**: overdue tasks, tasks due or scheduled today, and pinned tasks. Below them, up to five **Suggested** tasks: the top-ranked ones that fit in the time left. A bar shows `Planned / Available` and warns when the day is overfull.
- **Upcoming**: future tasks grouped by date (the earlier of the due date and the scheduled date).
- **All Tasks**, **Projects**, and **Completed** (searchable history, with a few stats and an 8-week trend).
- **Day schedule** (⇧⌘D): a timeline beside the list. Drag tasks onto it to give them a time block, drag blocks to move them, drag the bottom edge to resize. Calendar events show as hatched "busy" blocks. Overlaps are flagged and never overwritten.

### Quick add
Type one line, for example `Review calculus, 1 hour, high priority` or `Essay Friday 2h #school !`. Tempo extracts:

| Field | Examples |
|---|---|
| Estimate | `45m`, `90 mins`, `1.5 hours`, `1h30`, `half an hour` |
| Due date / time | `tomorrow`, `Friday`, `Oct 23`, `tomorrow at 3pm`, `eod` |
| Time block | `4-5:30pm`, `from 4pm to 5pm` |
| Importance | `!` / `!!` (4), `!!!` (5), `p1`–`p5`, `high priority`, `low priority` |
| Project | `#school`, or a unique prefix like `#eng` |

Text that isn't recognized stays in the title, so nothing is dropped. When input is ambiguous, the preview says so and lets you choose. A single time like "at 3pm" can be a deadline or a block. A short word like "sun" or "May" stays in the title unless written "on sat". An unknown `#tag` stays in the title and offers to create the project. The parser is a plain pipeline of extractors in `src/lib/parse/`.

An **estimate** (how long) and a **time block** (when) are separate fields. A task can have either, both or neither.

### Recommended order
Every active task gets a score from 0 to 100. The code and constants are in `src/lib/score.ts`:

```
score = 0.40·importance + 0.35·urgency + 0.10·overdue + 0.15·fit      (each 0–1)
```

- **importance**: your 1–5 rating, normalized.
- **urgency**: rises as the deadline nears (about 0.5 three days out, 0.8 one day out, 1 when due). A scheduled start counts as a soft deadline. Undated tasks get 0.15, growing to 0.30 over 30 days, so they never disappear.
- **overdue**: a capped boost once the deadline passes. A trivial overdue task does not bury an important one due tomorrow.
- **fit**: 1 if the estimate fits in today's remaining free time (working hours minus calendar events and blocks), 0 if not, 0.5 if unknown. Every task that fits gets the same credit, so short tasks aren't favoured.

Each row shows the top reason (for example "Due tomorrow" or "High importance"), and the detail panel shows the score. **Pinned** tasks stay at the top in your order. Dragging in Recommended order asks whether to pin the task or switch to **Manual** order, which never reshuffles. Both orders are stored in the database.

### Focus timer
Start one from any task (▶ on hover, the detail panel, or ⌘T). Focus, short-break and long-break lengths are configurable (25 / 5 / 15 min, long break every 4 sessions). Remaining time is always computed from stored timestamps, so it stays correct through sleep, closing the window, or restarting. When a session ends you get a notification and a choice: mark the task done, take a break, or keep going. Tempo never completes a task on its own. Tracked focus time is stored separately from the estimate.

### Reminders and notifications
Turn them on in Settings. Tempo sends a reminder before scheduled blocks and timed deadlines (default 10 minutes before), a morning reminder for date-only deadlines, and at most one "overdue" reminder the next morning. Each reminder is logged once in `notification_log`, so it never repeats, and changing a deadline produces a fresh reminder. After a restart, missed reminders are delivered only if they're recent, so reopening Tempo never floods you.

**Tempo must be running for reminders to fire.** Closing the window keeps Tempo running in the background, with a menu-bar icon showing the timer. ⌘Q quits it. Turn on **Open at login** in Settings so reminders work after a reboot.

### Calendar
Settings → **Show calendar events** asks macOS for read-only calendar access, and only at that moment. Events appear in the day schedule as busy time and reduce today's free time. Tempo never creates, edits or deletes events. If access is denied, Tempo explains how to allow it in System Settings → Privacy & Security → Calendars. Calendar access works only in the **built app**: in `tauri dev` the binary isn't an app bundle, so macOS can't show the permission prompt, and Tempo says so instead of trying. The integration lives behind the `CalendarProvider` trait in `src-tauri/src/calendar.rs` (EventKit via `objc2-event-kit`).

## Keyboard

| Action | Shortcut |
|---|---|
| Quick add from anywhere | ⌃⌥Space (change in Settings) |
| New task | ⌘N |
| Search | ⌘F or / |
| Complete selected | ⌘↩ |
| Delete selected | ⌘⌫ |
| Start / pause focus | ⌘T |
| Stop focus | ⇧⌘T |
| Pin / unpin | ⇧⌘P |
| Today · Upcoming · All · Completed | ⌘1 – ⌘4 |
| Move selection | ↑ ↓ or J K |
| Open details | ↩ (or click) |
| Toggle Recommended / Manual | ⌥⌘O |
| Day schedule | ⇧⌘D |
| Toggle sidebar | ⌃⌘S |
| Undo last action | ⌘Z |
| Close panel / cancel | Esc |

Double-click a task title to rename it in place.

## Architecture

```
src/                     React + TypeScript UI
  lib/score.ts           priority scoring (pure, unit-tested)
  lib/parse/             natural-language quick-add pipeline
  lib/views.ts           what each view shows (Today groups, Upcoming, search)
  lib/schedule.ts        conflicts, free time, planned-vs-available
  lib/recurrence.ts      repeat rules and next occurrence (DST-safe)
  lib/timer.ts, stats.ts focus-session math, history statistics
  store.ts               Zustand store; optimistic updates and undo
  components/            sidebar, list, detail panel, schedule, settings…
src-tauri/src/           Rust
  db.rs                  connection setup and versioned migrations
  repo.rs                every query (tasks, projects, subtasks, sessions, export)
  commands.rs            thin Tauri command layer
  notify.rs              reminder planning and de-duplication
  timer.rs               session arithmetic
  calendar.rs            read-only EventKit behind a trait
  shell.rs               menu bar, tray, global shortcut, background loop
```

### Database
SQLite at `~/Library/Application Support/com.eitan.tempo/tempo.db`, in WAL mode with foreign keys on. Tables: `projects`, `tasks`, `subtasks`, `focus_sessions`, `settings`, `notification_log`. IDs are UUIDs. Instants are UTC ISO-8601. Due dates are stored as local wall-clock values (`due_date` `YYYY-MM-DD`, `due_time` `HH:MM`), so "Friday 3pm" stays Friday 3pm across time zones and DST.

- Migrations are append-only, run in a transaction, and are tracked in `PRAGMA user_version`. The file is copied to `tempo.db.bak-v<N>` before any upgrade.
- Deleting a task is a soft delete, so it can be undone. It's purged after 7 days. Completed tasks are never deleted automatically.
- Deleting a project never deletes its tasks: they move to another project or to none.

**Backup:** Settings → Data → Export (or File → Export Backup…) writes a JSON file with every task, subtask, project, focus session and setting. Import merges a backup by ID and never deletes anything.

## Known limitations
- Reminders only fire while Tempo is running (open or hidden), not after ⌘Q. This is a limitation of Tauri's notification plugin on macOS.
- Calendar events are read for today and the day shown in the schedule, and refresh every 5 minutes and when the window gains focus.
- Not notarized: on first launch from a DMG, right-click → Open, or allow it in System Settings → Privacy & Security.
- No end-to-end UI automation (Tauri doesn't support WebDriver on macOS). UI behaviour is covered by component and store tests against a mocked backend, plus manual runs.
