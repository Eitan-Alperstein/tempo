import { MINUTE, atLocalTime, isSameDay } from "./time";
import type { CalendarEvent, Task } from "./types";

export interface Block {
  id: string;
  kind: "task" | "event";
  title: string;
  start: Date;
  end: Date;
}

export const SNAP_MIN = 15;
export const DEFAULT_BLOCK_MIN = 30;

export function taskBlock(t: Task): Block | null {
  if (!t.schedStart || !t.schedEnd) return null;
  return { id: t.id, kind: "task", title: t.title, start: new Date(t.schedStart), end: new Date(t.schedEnd) };
}

/** All-day events don't block specific hours. */
export function eventBlock(e: CalendarEvent): Block | null {
  if (e.allDay) return null;
  return { id: `event:${e.id}`, kind: "event", title: e.title, start: new Date(e.start), end: new Date(e.end) };
}

export function overlaps(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return +a.start < +b.end && +b.start < +a.end;
}

/** Pairs of overlapping blocks, and the set of block ids involved in any conflict. */
export function findConflicts(blocks: Block[]): { pairs: [Block, Block][]; ids: Set<string> } {
  const sorted = [...blocks].sort((a, b) => +a.start - +b.start);
  const pairs: [Block, Block][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && +sorted[j].start < +sorted[i].end; j++) {
      // Two calendar events overlapping is the calendar's business, not a planning conflict.
      if (sorted[i].kind === "event" && sorted[j].kind === "event") continue;
      pairs.push([sorted[i], sorted[j]]);
    }
  }
  return { pairs, ids: new Set(pairs.flat().map((b) => b.id)) };
}

/** Blocks that a proposed slot would collide with. */
export function conflictsFor(slot: { start: Date; end: Date }, blocks: Block[], ignoreId?: string): Block[] {
  return blocks.filter((b) => b.id !== ignoreId && overlaps(slot, b));
}

/** Union length, in minutes, of intervals clipped to [from, to]. */
function busyMinutes(blocks: { start: Date; end: Date }[], from: Date, to: Date): number {
  const clipped = blocks
    .map((b) => [Math.max(+b.start, +from), Math.min(+b.end, +to)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curS = -Infinity;
  let curE = -Infinity;
  for (const [s, e] of clipped) {
    if (s > curE) {
      total += curE - curS > 0 ? curE - curS : 0;
      curS = s;
      curE = e;
    } else curE = Math.max(curE, e);
  }
  total += curE - curS > 0 ? curE - curS : 0;
  return total / MINUTE;
}

/**
 * Free minutes left today within working hours, after calendar events and
 * already-scheduled blocks. Before the workday starts this is the whole day.
 */
export function freeMinutesToday(now: Date, workStart: string, workEnd: string, busy: Block[]): number {
  const start = atLocalTime(now, workStart);
  const end = atLocalTime(now, workEnd);
  const from = new Date(Math.max(+now, +start));
  if (+end <= +from) return 0;
  return Math.max(0, Math.round((+end - +from) / MINUTE - busyMinutes(busy, from, end)));
}

/** Minutes a task takes up in today's plan: its block if scheduled today, else its estimate. */
export function plannedMinutes(t: Task, day: Date): number {
  const b = taskBlock(t);
  if (b && isSameDay(b.start, day)) return Math.round((+b.end - +b.start) / MINUTE);
  return t.estimateMin ?? 0;
}

export interface PlanSummary {
  plannedMin: number;
  availableMin: number;
  unestimated: number;
  over: boolean;
}

export function planSummary(todayTasks: Task[], day: Date, availableMin: number): PlanSummary {
  const plannedMin = todayTasks.reduce((s, t) => s + plannedMinutes(t, day), 0);
  const unestimated = todayTasks.filter((t) => !t.estimateMin && !t.schedStart).length;
  return { plannedMin, availableMin, unestimated, over: plannedMin > availableMin };
}

export function snap(d: Date, minutes = SNAP_MIN): Date {
  const ms = minutes * MINUTE;
  return new Date(Math.round(+d / ms) * ms);
}
