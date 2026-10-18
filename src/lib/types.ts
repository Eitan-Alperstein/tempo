// Mirrors the Rust models in src-tauri/src/models.rs (serialized camelCase).

export interface Project {
  id: string;
  name: string;
  color: string;
  sort: number;
  createdAt: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  sort: number;
  createdAt: string;
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export interface Recurrence {
  freq: "daily" | "weekdays" | "weekly" | "monthly" | "interval";
  /** For "interval": every N days. */
  interval?: number;
  /** For "weekly": which weekdays. */
  days?: Weekday[];
  /** For "monthly": day of month (clamped to the month's length). */
  monthDay?: number;
  /** Count the next date from the previous due date, or from when it was completed. */
  from: "due" | "completion";
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  estimateMin: number | null;
  /** Local calendar date, "YYYY-MM-DD". */
  dueDate: string | null;
  /** Local wall-clock time, "HH:MM". */
  dueTime: string | null;
  /** UTC ISO instants. Scheduling is separate from the estimate. */
  schedStart: string | null;
  schedEnd: string | null;
  projectId: string | null;
  importance: number;
  pinned: boolean;
  pinOrder: number;
  manualOrder: number;
  recurrence: Recurrence | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  subtasks: Subtask[];
  focusSec: number;
}

export interface TaskInput {
  id?: string;
  title: string;
  notes?: string;
  estimateMin?: number | null;
  dueDate?: string | null;
  dueTime?: string | null;
  schedStart?: string | null;
  schedEnd?: string | null;
  projectId?: string | null;
  importance?: number;
  recurrence?: Recurrence | null;
  subtasks?: string[];
  pinned?: boolean;
}

export interface NextOccurrence {
  dueDate: string | null;
  dueTime: string | null;
  schedStart: string | null;
  schedEnd: string | null;
}

export type SessionKind = "focus" | "short_break" | "long_break";

export interface FocusSession {
  id: string;
  taskId: string | null;
  kind: SessionKind;
  plannedSec: number;
  startedAt: string;
  pausedAt: string | null;
  pausedTotalSec: number;
  endedAt: string | null;
  completed: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendar: string;
}

export type CalendarStatus =
  | { state: "notDetermined" }
  | { state: "granted" }
  | { state: "denied" }
  | { state: "restricted" }
  | { state: "unavailable"; reason: string };

export interface Bootstrap {
  tasks: Task[];
  projects: Project[];
  settings: Record<string, string>;
  activeSession: FocusSession | null;
  dbPath: string;
}

export interface ImportSummary {
  projects: number;
  tasks: number;
  focusSessions: number;
}

export type View =
  | { kind: "today" }
  | { kind: "upcoming" }
  | { kind: "all" }
  | { kind: "completed" }
  | { kind: "project"; projectId: string }
  | { kind: "settings" };
