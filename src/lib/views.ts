// Which tasks each view shows, and in what groups.
import { sortRecommended, sortTasks, type SortMode } from "./order";
import type { ScoreBreakdown } from "./score";
import { plannedMinutes } from "./schedule";
import { localDate, schedDate } from "./time";
import type { Project, Task } from "./types";

export interface Group {
  id: string;
  title: string;
  tasks: Task[];
  /** Muted styling, e.g. suggestions. */
  hint?: string;
}

export const MAX_SUGGESTIONS = 5;
/** Planning assumption for tasks without an estimate. */
export const ASSUMED_MIN = 30;

export function isOverdue(t: Task, now: Date): boolean {
  return !!t.dueDate && t.dueDate < localDate(now);
}

/** Overdue, due today, scheduled today, or pinned. */
export function isToday(t: Task, now: Date): boolean {
  const today = localDate(now);
  return (!!t.dueDate && t.dueDate <= today) || schedDate(t) === today || t.pinned;
}

export function todayGroups(
  tasks: Task[],
  scores: Map<string, ScoreBreakdown>,
  mode: SortMode,
  now: Date,
  availableMin: number,
): Group[] {
  const overdue = tasks.filter((t) => isOverdue(t, now));
  const today = tasks.filter((t) => !isOverdue(t, now) && isToday(t, now));
  const committed = [...overdue, ...today];
  const planned = committed.reduce((s, t) => s + plannedMinutes(t, now), 0);

  // Suggest the best-ranked remaining tasks that fit in what's left of the day.
  const suggestions: Task[] = [];
  let room = availableMin - planned;
  for (const t of sortRecommended(tasks.filter((t) => !isToday(t, now)), scores)) {
    if (suggestions.length >= MAX_SUGGESTIONS || room <= 0) break;
    const need = t.estimateMin ?? ASSUMED_MIN;
    if (need <= room) {
      suggestions.push(t);
      room -= need;
    }
  }

  return [
    { id: "overdue", title: "Overdue", tasks: sortTasks(overdue, mode, scores) },
    { id: "today", title: "Today", tasks: sortTasks(today, mode, scores) },
    { id: "suggested", title: "Suggested", tasks: suggestions, hint: "Fits in the time you have left today" },
  ].filter((g) => g.tasks.length > 0);
}

/** The date a task shows under in Upcoming: the earlier of its due and scheduled dates. */
export function upcomingDate(t: Task): string | null {
  const dates = [t.dueDate, schedDate(t)].filter((d): d is string => !!d).sort();
  return dates[0] ?? null;
}

export function upcomingTasks(tasks: Task[], now: Date): Task[] {
  const today = localDate(now);
  return tasks.filter((t) => {
    const d = upcomingDate(t);
    return d !== null && d > today;
  });
}

export function filterProject(tasks: Task[], projectId: string): Task[] {
  return tasks.filter((t) => t.projectId === projectId);
}

export function counts(tasks: Task[], now: Date) {
  const perProject = new Map<string, number>();
  for (const t of tasks) if (t.projectId) perProject.set(t.projectId, (perProject.get(t.projectId) ?? 0) + 1);
  return {
    today: tasks.filter((t) => isToday(t, now)).length,
    overdue: tasks.filter((t) => isOverdue(t, now)).length,
    upcoming: upcomingTasks(tasks, now).length,
    all: tasks.length,
    perProject,
  };
}

/** Every word must appear somewhere in the title, notes, project name or subtasks. */
export function searchTasks(tasks: Task[], projects: Project[], query: string): Task[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tasks;
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return tasks.filter((t) => {
    const hay = [t.title, t.notes, t.projectId ? names.get(t.projectId) : "", ...t.subtasks.map((s) => s.title)]
      .join(" \n ")
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
