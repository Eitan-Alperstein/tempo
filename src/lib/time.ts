import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  parse,
  startOfDay,
} from "date-fns";
import type { Task } from "./types";

export const MINUTE = 60_000;
export const DAY = 86_400_000;

/** Local calendar date as "YYYY-MM-DD". */
export function localDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Local midnight of a "YYYY-MM-DD" date. */
export function parseLocalDate(s: string): Date {
  return parse(s, "yyyy-MM-dd", new Date(0));
}

/** "HH:MM" → Date on the given local day. */
export function atLocalTime(day: Date | string, hm: string): Date {
  const base = typeof day === "string" ? parseLocalDate(day) : startOfDay(day);
  const [h, m] = hm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

export function hm(d: Date): string {
  return format(d, "HH:mm");
}

/** The instant a task is due. Date-only deadlines mean "by the end of that day". */
export function dueInstant(t: Pick<Task, "dueDate" | "dueTime">): Date | null {
  if (!t.dueDate) return null;
  if (t.dueTime) return atLocalTime(t.dueDate, t.dueTime);
  const end = parseLocalDate(t.dueDate);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function schedDate(t: Pick<Task, "schedStart">): string | null {
  return t.schedStart ? localDate(new Date(t.schedStart)) : null;
}

export function formatDuration(min: number | null | undefined): string {
  if (min == null || min <= 0) return "";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function formatTime(d: Date): string {
  return format(d, d.getMinutes() === 0 ? "h a" : "h:mm a");
}

export function formatHm(hmStr: string): string {
  return formatTime(atLocalTime(new Date(), hmStr));
}

/** "Today", "Tomorrow", "Yesterday", weekday within a week, else "Oct 23". */
export function relativeDay(date: Date, now: Date): string {
  const diff = differenceInCalendarDays(date, now);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return format(date, "EEEE");
  if (date.getFullYear() !== now.getFullYear()) return format(date, "MMM d, yyyy");
  return format(date, "MMM d");
}

export function formatDue(t: Pick<Task, "dueDate" | "dueTime">, now: Date): string {
  if (!t.dueDate) return "";
  const day = relativeDay(parseLocalDate(t.dueDate), now);
  return t.dueTime ? `${day}, ${formatHm(t.dueTime)}` : day;
}

export function formatBlock(start: Date, end: Date, now: Date): string {
  const day = isSameDay(start, now) ? "" : `${relativeDay(start, now)}, `;
  return `${day}${formatTime(start)}–${formatTime(end)}`;
}

export function daysUntil(date: string, now: Date): number {
  return differenceInCalendarDays(parseLocalDate(date), now);
}

export { addDays, differenceInCalendarDays, isSameDay, startOfDay, format };
