import { addDays, addMonths, getDaysInMonth } from "date-fns";
import { atLocalTime, differenceInCalendarDays, hm, localDate, parseLocalDate } from "./time";
import type { NextOccurrence, Recurrence, Task, Weekday } from "./types";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function describeRecurrence(r: Recurrence): string {
  switch (r.freq) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Every weekday";
    case "weekly": {
      const days = (r.days ?? []).slice().sort();
      return days.length ? `Weekly on ${days.map((d) => WEEKDAY_NAMES[d]).join(", ")}` : "Every week";
    }
    case "monthly":
      return r.monthDay ? `Monthly on the ${ordinal(r.monthDay)}` : "Every month";
    case "interval":
      return `Every ${r.interval ?? 1} days`;
  }
}

/** The first date strictly after `base` ("YYYY-MM-DD") that matches the rule. */
export function nextDate(r: Recurrence, base: string): string {
  const d = parseLocalDate(base);
  switch (r.freq) {
    case "daily":
      return localDate(addDays(d, 1));
    case "interval":
      return localDate(addDays(d, Math.max(1, r.interval ?? 1)));
    case "weekdays": {
      let n = addDays(d, 1);
      while (n.getDay() === 0 || n.getDay() === 6) n = addDays(n, 1);
      return localDate(n);
    }
    case "weekly": {
      const days = new Set<Weekday>(r.days?.length ? r.days : [d.getDay() as Weekday]);
      let n = addDays(d, 1);
      while (!days.has(n.getDay() as Weekday)) n = addDays(n, 1);
      return localDate(n);
    }
    case "monthly": {
      const want = r.monthDay ?? d.getDate();
      // Try this month first (e.g. base is the 3rd, rule is the 15th), then next.
      for (const month of [d, addMonths(d, 1), addMonths(d, 2)]) {
        const day = Math.min(want, getDaysInMonth(month));
        const candidate = new Date(month.getFullYear(), month.getMonth(), day);
        if (+candidate > +d) return localDate(candidate);
      }
      return localDate(addMonths(d, 1));
    }
  }
}

/**
 * Dates for the next instance when a recurring task is completed. The next
 * date is always in the future, so finishing an overdue daily task once
 * doesn't leave a backlog of overdue copies. A time block moves to the same
 * wall-clock time on the new day.
 */
export function nextOccurrence(t: Task, completedAt: Date): NextOccurrence | null {
  const r = t.recurrence;
  if (!r) return null;
  const today = localDate(completedAt);
  const anchor =
    r.from === "completion" ? today : (t.dueDate ?? (t.schedStart ? localDate(new Date(t.schedStart)) : today));
  let next = nextDate(r, anchor);
  while (next <= today) next = nextDate(r, next);

  let schedStart: string | null = null;
  let schedEnd: string | null = null;
  if (t.schedStart && t.schedEnd) {
    const s = new Date(t.schedStart);
    const e = new Date(t.schedEnd);
    const shift = differenceInCalendarDays(parseLocalDate(next), parseLocalDate(t.dueDate ?? localDate(s)));
    const newStart = atLocalTime(addDays(s, shift), hm(s));
    const newEnd = atLocalTime(addDays(e, shift), hm(e));
    schedStart = newStart.toISOString();
    schedEnd = newEnd.toISOString();
  }
  return {
    dueDate: t.dueDate || !t.schedStart ? next : null,
    dueTime: t.dueDate ? t.dueTime : null,
    schedStart,
    schedEnd,
  };
}
