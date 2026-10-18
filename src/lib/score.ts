/**
 * Recommended-order scoring.
 *
 *   score = 0.40·importance + 0.35·urgency + 0.10·overdue + 0.15·fit
 *
 * Every component is normalized to 0–1, so the weights read directly as each
 * factor's maximum share of the score (which tops out at 1.0, shown as 0–100).
 *
 * importance  (importance − 1) / 4, from the user's 1–5 rating.
 * urgency     Logistic in days until the deadline: ≈0.5 three days out, ≈0.8
 *             one day out, 1 once due. Dated tasks never fall below 0.1.
 *             Undated tasks get 0.15, aging slowly to 0.30 over 30 days so they
 *             never become permanently invisible.
 *             A scheduled start time counts as a soft deadline.
 * overdue     0 until the deadline passes, then 0.5 rising to 1 over two weeks.
 *             Capped, so an overdue trivial task does not bury an important one
 *             due tomorrow.
 * fit         1 if the estimate fits in the free time left today, 0 if it
 *             doesn't, 0.5 when either is unknown. Any task that fits gets the
 *             same credit, so short tasks aren't treated as more important.
 */
import { DAY, daysUntil, dueInstant, formatHm, formatTime, isSameDay } from "./time";
import type { Task } from "./types";

export const WEIGHTS = { importance: 0.4, urgency: 0.35, overdue: 0.1, fit: 0.15 } as const;

export const URGENCY_MIDPOINT_DAYS = 3;
export const URGENCY_SLOPE_DAYS = 1.5;
export const DATED_URGENCY_FLOOR = 0.1;
export const UNDATED_URGENCY = 0.15;
export const UNDATED_AGING_MAX = 0.15;
export const UNDATED_AGING_DAYS = 30;
export const OVERDUE_BASE = 0.5;
export const OVERDUE_RAMP_DAYS = 14;
export const NEUTRAL_FIT = 0.5;

export interface ScoreContext {
  now: Date;
  /** Free minutes left in today's working hours, or null if unknown. */
  freeMinutes: number | null;
}

export interface ScoreBreakdown {
  score: number; // 0–1
  importance: number;
  urgency: number;
  overdue: number;
  fit: number;
  reasons: string[];
}

function logistic(daysLeft: number): number {
  return 1 / (1 + Math.exp((daysLeft - URGENCY_MIDPOINT_DAYS) / URGENCY_SLOPE_DAYS));
}

export function scoreTask(t: Task, ctx: ScoreContext): ScoreBreakdown {
  const { now } = ctx;
  const importance = (Math.min(5, Math.max(1, t.importance)) - 1) / 4;

  const due = dueInstant(t);
  const sched = t.schedStart ? new Date(t.schedStart) : null;
  const softDeadline = [due, sched].filter((d): d is Date => d !== null).sort((a, b) => +a - +b)[0];

  let urgency: number;
  if (softDeadline) {
    const daysLeft = (+softDeadline - +now) / DAY;
    urgency = daysLeft <= 0 ? 1 : Math.max(DATED_URGENCY_FLOOR, logistic(daysLeft));
  } else {
    const ageDays = Math.max(0, (+now - +new Date(t.createdAt)) / DAY);
    urgency = UNDATED_URGENCY + UNDATED_AGING_MAX * Math.min(1, ageDays / UNDATED_AGING_DAYS);
  }

  let overdue = 0;
  if (due && +due < +now) {
    const daysOver = (+now - +due) / DAY;
    overdue = Math.min(1, OVERDUE_BASE + (1 - OVERDUE_BASE) * (daysOver / OVERDUE_RAMP_DAYS));
  }

  let fit = NEUTRAL_FIT;
  if (t.estimateMin && ctx.freeMinutes != null && ctx.freeMinutes > 0) {
    fit = t.estimateMin <= ctx.freeMinutes ? 1 : 0;
  }

  const score =
    WEIGHTS.importance * importance +
    WEIGHTS.urgency * urgency +
    WEIGHTS.overdue * overdue +
    WEIGHTS.fit * fit;

  return { score, importance, urgency, overdue, fit, reasons: explain(t, ctx, { importance, urgency, overdue, fit }) };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Up to two short, human reasons, strongest first. */
function explain(
  t: Task,
  { now }: ScoreContext,
  c: { importance: number; urgency: number; overdue: number; fit: number },
): string[] {
  const out: { text: string; weight: number }[] = [];

  if (c.overdue > 0 && t.dueDate) {
    const days = -daysUntil(t.dueDate, now);
    out.push({
      text: days <= 0 ? "Overdue" : `Overdue by ${plural(days, "day")}`,
      weight: WEIGHTS.urgency + WEIGHTS.overdue * c.overdue,
    });
  } else if (t.dueDate) {
    const days = daysUntil(t.dueDate, now);
    const at = t.dueTime ? ` at ${formatHm(t.dueTime)}` : "";
    const text =
      days === 0 ? `Due today${at}` : days === 1 ? "Due tomorrow" : days < 7 ? `Due in ${days} days` : "";
    if (text) out.push({ text, weight: WEIGHTS.urgency * c.urgency });
  }

  if (t.schedStart) {
    const s = new Date(t.schedStart);
    if (isSameDay(s, now) && +s > +now - 3 * 3600_000) {
      out.push({ text: `Scheduled ${formatTime(s)}`, weight: WEIGHTS.urgency * c.urgency });
    }
  }

  if (t.importance >= 4) {
    out.push({ text: t.importance === 5 ? "Top importance" : "High importance", weight: WEIGHTS.importance * c.importance });
  }

  if (c.fit === 1 && t.estimateMin) {
    out.push({ text: "Fits your free time", weight: WEIGHTS.fit });
  }

  if (!t.dueDate && !t.schedStart) {
    const weeks = Math.floor((+now - +new Date(t.createdAt)) / (7 * DAY));
    if (weeks >= 2) out.push({ text: `Waiting ${plural(weeks, "week")}`, weight: 0.05 });
  }

  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((r) => r.text);
}

export function scoreAll(tasks: Task[], ctx: ScoreContext): Map<string, ScoreBreakdown> {
  return new Map(tasks.map((t) => [t.id, scoreTask(t, ctx)]));
}
