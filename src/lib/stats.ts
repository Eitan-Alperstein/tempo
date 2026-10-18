import { startOfWeek, subWeeks } from "date-fns";
import { startOfDay } from "./time";
import { elapsedSec } from "./timer";
import type { FocusSession, Task } from "./types";

export const TREND_WEEKS = 8;

export interface Stats {
  completedToday: number;
  completedThisWeek: number;
  focusSessionsToday: number;
  focusSessionsThisWeek: number;
  /** Over tasks completed this week. */
  estimatedMinThisWeek: number;
  /** All focused minutes this week, completed or stopped early. */
  focusedMinThisWeek: number;
  /** Tracked ÷ estimated, over completed tasks with both (all time loaded). */
  estimateAccuracy: number | null;
  /** Completions per week, oldest first, ending with this week. */
  weekly: { weekStart: Date; count: number }[];
}

/** The start of the history window stats need. */
export function statsSince(now: Date): Date {
  return subWeeks(startOfWeek(now, { weekStartsOn: 1 }), TREND_WEEKS - 1);
}

export function computeStats(completed: Task[], sessions: FocusSession[], now: Date): Stats {
  const today = startOfDay(now);
  const week = startOfWeek(now, { weekStartsOn: 1 });
  const at = (s: string) => new Date(s);

  const doneToday = completed.filter((t) => t.completedAt && at(t.completedAt) >= today);
  const doneWeek = completed.filter((t) => t.completedAt && at(t.completedAt) >= week);
  const focus = sessions.filter((s) => s.kind === "focus" && s.endedAt);
  const focusWeek = focus.filter((s) => at(s.startedAt) >= week);

  const both = completed.filter((t) => t.estimateMin && t.focusSec > 0);
  const est = both.reduce((s, t) => s + (t.estimateMin ?? 0), 0);
  const tracked = both.reduce((s, t) => s + t.focusSec / 60, 0);

  const weekly = Array.from({ length: TREND_WEEKS }, (_, i) => {
    const weekStart = subWeeks(week, TREND_WEEKS - 1 - i);
    const weekEnd = subWeeks(week, TREND_WEEKS - 2 - i);
    const count = completed.filter((t) => {
      if (!t.completedAt) return false;
      const c = at(t.completedAt);
      return c >= weekStart && (i === TREND_WEEKS - 1 || c < weekEnd);
    }).length;
    return { weekStart, count };
  });

  return {
    completedToday: doneToday.length,
    completedThisWeek: doneWeek.length,
    focusSessionsToday: focus.filter((s) => s.completed && at(s.startedAt) >= today).length,
    focusSessionsThisWeek: focusWeek.filter((s) => s.completed).length,
    estimatedMinThisWeek: doneWeek.reduce((s, t) => s + (t.estimateMin ?? 0), 0),
    focusedMinThisWeek: Math.round(focusWeek.reduce((s, x) => s + elapsedSec(x, now), 0) / 60),
    estimateAccuracy: est > 0 ? tracked / est : null,
    weekly,
  };
}
