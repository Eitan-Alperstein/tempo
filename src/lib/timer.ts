// Mirrors src-tauri/src/timer.rs: remaining time comes from stored timestamps.
import type { FocusSession, SessionKind } from "./types";

export function elapsedSec(s: FocusSession, now: Date): number {
  const start = +new Date(s.startedAt);
  let end = s.endedAt ? +new Date(s.endedAt) : +now;
  if (s.pausedAt && !s.endedAt) end = Math.min(end, +new Date(s.pausedAt));
  return Math.max(0, Math.floor((end - start) / 1000) - s.pausedTotalSec);
}

export function remainingSec(s: FocusSession, now: Date): number {
  return Math.max(0, s.plannedSec - elapsedSec(s, now));
}

export function progress(s: FocusSession, now: Date): number {
  return Math.min(1, elapsedSec(s, now) / s.plannedSec);
}

export interface TimerSettings {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longBreakEvery: number;
}

/** Which break follows a focus session, given focus sessions completed since the last long break. */
export function nextBreak(completedSinceLongBreak: number, cfg: TimerSettings): { kind: SessionKind; minutes: number } {
  if (cfg.longBreakEvery > 0 && completedSinceLongBreak > 0 && completedSinceLongBreak % cfg.longBreakEvery === 0) {
    return { kind: "long_break", minutes: cfg.longBreakMin };
  }
  return { kind: "short_break", minutes: cfg.shortBreakMin };
}

/** Completed focus sessions since the most recent long break, from a chronological list. */
export function focusStreak(sessions: FocusSession[]): number {
  let n = 0;
  for (const s of sessions) {
    if (s.kind === "long_break") n = 0;
    else if (s.kind === "focus" && s.completed) n++;
  }
  return n;
}
