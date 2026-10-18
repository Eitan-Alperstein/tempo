// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
import { invoke } from "@tauri-apps/api/core";
import type {
  Bootstrap,
  CalendarEvent,
  CalendarStatus,
  FocusSession,
  ImportSummary,
  NextOccurrence,
  Project,
  SessionKind,
  Task,
  TaskInput,
} from "./types";

export const api = {
  bootstrap: () => invoke<Bootstrap>("bootstrap"),
  listActiveTasks: () => invoke<Task[]>("list_active_tasks"),
  createTask: (input: TaskInput) => invoke<Task>("create_task", { input }),
  updateTask: (input: TaskInput) => invoke<Task>("update_task", { input }),
  setPinned: (id: string, pinned: boolean) => invoke<Task>("set_pinned", { id, pinned }),
  reorderManual: (ids: string[]) => invoke<void>("reorder_manual", { ids }),
  reorderPins: (ids: string[]) => invoke<void>("reorder_pins", { ids }),
  completeTask: (id: string, completeSubtasks: boolean, next: NextOccurrence | null) =>
    invoke<{ task: Task; next: Task | null }>("complete_task", { id, completeSubtasks, next }),
  uncompleteTask: (id: string, removeNext: string | null) => invoke<Task>("uncomplete_task", { id, removeNext }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),
  restoreTask: (id: string) => invoke<Task>("restore_task", { id }),
  listCompleted: (query: string | null, since: string | null, limit = 500) =>
    invoke<Task[]>("list_completed", { query, since, limit }),

  createProject: (name: string, color: string) => invoke<Project>("create_project", { name, color }),
  updateProject: (id: string, name: string, color: string) => invoke<Project>("update_project", { id, name, color }),
  deleteProject: (id: string, moveTo: string | null) => invoke<number>("delete_project", { id, moveTo }),
  reorderProjects: (ids: string[]) => invoke<void>("reorder_projects", { ids }),

  addSubtask: (taskId: string, title: string) => invoke<Task>("add_subtask", { taskId, title }),
  updateSubtask: (id: string, title: string, done: boolean) => invoke<Task>("update_subtask", { id, title, done }),
  deleteSubtask: (id: string) => invoke<Task>("delete_subtask", { id }),
  reorderSubtasks: (taskId: string, ids: string[]) => invoke<Task>("reorder_subtasks", { taskId, ids }),

  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),

  startSession: (taskId: string | null, kind: SessionKind, plannedSec: number) =>
    invoke<FocusSession>("start_session", { taskId, kind, plannedSec }),
  pauseSession: () => invoke<FocusSession | null>("pause_session"),
  resumeSession: () => invoke<FocusSession | null>("resume_session"),
  stopSession: () => invoke<FocusSession | null>("stop_session"),
  activeSession: () => invoke<FocusSession | null>("active_session"),
  listSessions: (since: string) => invoke<FocusSession[]>("list_sessions", { since }),

  exportBackup: (path: string) => invoke<void>("export_backup", { path }),
  importBackup: (path: string) => invoke<ImportSummary>("import_backup", { path }),

  calendarStatus: () => invoke<CalendarStatus>("calendar_status"),
  calendarRequestAccess: () => invoke<CalendarStatus>("calendar_request_access"),
  calendarEvents: (start: string, end: string) => invoke<CalendarEvent[]>("calendar_events", { start, end }),

  setGlobalShortcut: (shortcut: string) => invoke<void>("set_global_shortcut", { shortcut }),
  showMainWindow: () => invoke<void>("show_main_window"),
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
