import { describe, expect, it } from "vitest";
import { makeSession, makeTask } from "../test/fixtures";
import { mergeOrder, moveItem, sortManual } from "./order";
import { nextDate, nextOccurrence, describeRecurrence } from "./recurrence";
import { conflictsFor, findConflicts, freeMinutesToday, planSummary, snap, type Block } from "./schedule";
import { scoreAll } from "./score";
import { computeStats } from "./stats";
import { formatDuration } from "./time";
import { elapsedSec, focusStreak, nextBreak, remainingSec } from "./timer";
import { counts, searchTasks, todayGroups, upcomingTasks } from "./views";

const now = new Date(2026, 9, 18, 10, 0); // Sun Oct 18 2026, 10:00 local
const at = (h: number, m = 0, day = 18) => new Date(2026, 9, day, h, m);
const block = (id: string, s: Date, e: Date, kind: Block["kind"] = "task"): Block => ({ id, kind, title: id, start: s, end: e });

describe("manual order", () => {
  it("merges a reordered subset back without moving hidden tasks", () => {
    // Full list a b c d e; the view shows b, d, e and the user drags e to the top.
    expect(mergeOrder(["a", "b", "c", "d", "e"], ["e", "b", "d"])).toEqual(["a", "e", "c", "b", "d"]);
  });

  it("sorts strictly by stored order and ignores scores and pins", () => {
    const tasks = [
      makeTask({ id: "x", manualOrder: 2, importance: 5, pinned: true }),
      makeTask({ id: "y", manualOrder: 0 }),
      makeTask({ id: "z", manualOrder: 1 }),
    ];
    expect(sortManual(tasks).map((t) => t.id)).toEqual(["y", "z", "x"]);
  });

  it("moves items", () => {
    expect(moveItem([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
  });
});

describe("estimates vs scheduled time", () => {
  it("planned time uses the block length when scheduled today, else the estimate", () => {
    const estimated = makeTask({ estimateMin: 45 });
    // Estimate says 30m but the block is an hour: the block is what's planned.
    const scheduled = makeTask({ estimateMin: 30, schedStart: at(14).toISOString(), schedEnd: at(15).toISOString() });
    const bare = makeTask();
    const p = planSummary([estimated, scheduled, bare], now, 90);
    expect(p.plannedMin).toBe(105);
    expect(p.unestimated).toBe(1);
    expect(p.over).toBe(true);
    expect(formatDuration(p.plannedMin)).toBe("1h 45m");
  });
});

describe("conflicts", () => {
  it("detects overlapping blocks, including with calendar events", () => {
    const blocks = [
      block("write", at(14), at(15)),
      block("meeting", at(14, 30), at(15, 30), "event"),
      block("gym", at(16), at(17)),
      block("call", at(16, 15), at(16, 45), "event"),
      block("lunch", at(12), at(13), "event"),
      block("other-event", at(12, 30), at(13, 30), "event"),
    ];
    const c = findConflicts(blocks);
    expect(c.ids).toEqual(new Set(["write", "meeting", "gym", "call"]));
    // Two calendar events overlapping each other aren't a planning conflict.
    expect(c.ids.has("lunch")).toBe(false);
  });

  it("back-to-back blocks don't conflict", () => {
    expect(findConflicts([block("a", at(9), at(10)), block("b", at(10), at(11))]).pairs).toHaveLength(0);
  });

  it("checks a proposed slot, ignoring the block being moved", () => {
    const blocks = [block("a", at(9), at(10)), block("b", at(11), at(12))];
    expect(conflictsFor({ start: at(9, 30), end: at(10, 30) }, blocks).map((b) => b.id)).toEqual(["a"]);
    expect(conflictsFor({ start: at(9, 30), end: at(10, 30) }, blocks, "a")).toHaveLength(0);
  });
});

describe("free time", () => {
  it("counts from now to the end of the workday, minus busy time", () => {
    const busy = [block("m", at(11), at(12), "event"), block("w", at(11, 30), at(12, 30)), block("late", at(19), at(20))];
    // 10:00–18:00 = 480m, busy union 11:00–12:30 = 90m.
    expect(freeMinutesToday(now, "09:00", "18:00", busy)).toBe(390);
  });

  it("is zero after hours and the full day before it starts", () => {
    expect(freeMinutesToday(at(19), "09:00", "18:00", [])).toBe(0);
    expect(freeMinutesToday(at(7), "09:00", "18:00", [])).toBe(540);
  });

  it("snaps to 15 minutes", () => {
    expect(snap(at(14, 7))).toEqual(at(14, 0));
    expect(snap(at(14, 8))).toEqual(at(14, 15));
  });
});

describe("focus timer", () => {
  it("computes remaining time from timestamps, surviving sleep", () => {
    const s = makeSession({ startedAt: "2026-10-18T14:00:00.000Z", plannedSec: 1500 });
    expect(remainingSec(s, new Date("2026-10-18T14:10:00.000Z"))).toBe(900);
    expect(remainingSec(s, new Date("2026-10-18T20:00:00.000Z"))).toBe(0);
  });

  it("freezes while paused", () => {
    const s = makeSession({ startedAt: "2026-10-18T14:00:00.000Z", pausedAt: "2026-10-18T14:05:00.000Z" });
    expect(elapsedSec(s, new Date("2026-10-18T18:00:00.000Z"))).toBe(300);
  });

  it("takes a long break after every N completed focus sessions", () => {
    const cfg = { focusMin: 25, shortBreakMin: 5, longBreakMin: 15, longBreakEvery: 4 };
    expect(nextBreak(1, cfg)).toEqual({ kind: "short_break", minutes: 5 });
    expect(nextBreak(4, cfg)).toEqual({ kind: "long_break", minutes: 15 });
    const done = (kind: "focus" | "long_break") => makeSession({ kind, completed: true });
    expect(focusStreak([done("focus"), done("focus"), done("long_break"), done("focus")])).toBe(1);
    expect(focusStreak([done("focus"), makeSession({ kind: "focus", completed: false })])).toBe(1);
  });
});

describe("recurrence", () => {
  it("computes the next date for each rule", () => {
    expect(nextDate({ freq: "daily", from: "due" }, "2026-10-18")).toBe("2026-10-19");
    expect(nextDate({ freq: "weekdays", from: "due" }, "2026-10-23")).toBe("2026-10-26"); // Fri → Mon
    expect(nextDate({ freq: "weekly", days: [1, 3], from: "due" }, "2026-10-19")).toBe("2026-10-21"); // Mon → Wed
    expect(nextDate({ freq: "monthly", monthDay: 31, from: "due" }, "2026-10-31")).toBe("2026-11-30"); // clamped
    expect(nextDate({ freq: "monthly", monthDay: 15, from: "due" }, "2026-10-03")).toBe("2026-10-15");
    expect(nextDate({ freq: "interval", interval: 3, from: "due" }, "2026-10-18")).toBe("2026-10-21");
  });

  it("never schedules the next instance in the past", () => {
    const t = makeTask({ dueDate: "2026-10-10", recurrence: { freq: "daily", from: "due" } });
    expect(nextOccurrence(t, now)?.dueDate).toBe("2026-10-19");
  });

  it("counts from completion when asked", () => {
    const t = makeTask({ dueDate: "2026-10-01", recurrence: { freq: "interval", interval: 7, from: "completion" } });
    expect(nextOccurrence(t, now)?.dueDate).toBe("2026-10-25");
  });

  it("moves a time block to the same wall-clock time across a DST change", () => {
    // Nov 1 2026: US clocks fall back. 9:00 local before and after.
    const t = makeTask({
      dueDate: "2026-10-31",
      schedStart: new Date(2026, 9, 31, 9, 0).toISOString(),
      schedEnd: new Date(2026, 9, 31, 10, 0).toISOString(),
      recurrence: { freq: "daily", from: "due" },
    });
    const next = nextOccurrence(t, new Date(2026, 9, 31, 12))!;
    expect(next.dueDate).toBe("2026-11-01");
    const s = new Date(next.schedStart!);
    expect([s.getDate(), s.getHours(), s.getMinutes()]).toEqual([1, 9, 0]);
  });

  it("describes rules", () => {
    expect(describeRecurrence({ freq: "weekly", days: [1, 3], from: "due" })).toBe("Weekly on Mon, Wed");
    expect(describeRecurrence({ freq: "monthly", monthDay: 2, from: "due" })).toBe("Monthly on the 2nd");
  });
});

describe("views", () => {
  const tasks = [
    makeTask({ id: "late", dueDate: "2026-10-16" }),
    makeTask({ id: "today", dueDate: "2026-10-18" }),
    makeTask({ id: "block", schedStart: at(15).toISOString(), schedEnd: at(16).toISOString() }),
    makeTask({ id: "pinned", pinned: true, pinOrder: 1 }),
    makeTask({ id: "tomorrow", dueDate: "2026-10-19", estimateMin: 30 }),
    makeTask({ id: "big", importance: 5, estimateMin: 600 }),
    makeTask({ id: "small", importance: 4, estimateMin: 20 }),
  ];
  const scores = scoreAll(tasks, { now, freeMinutes: 300 });

  it("groups Today into overdue, today and suggestions that fit", () => {
    const groups = todayGroups(tasks, scores, "recommended", now, 180);
    expect(groups.map((g) => g.id)).toEqual(["overdue", "today", "suggested"]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["late"]);
    expect(new Set(groups[1].tasks.map((t) => t.id))).toEqual(new Set(["today", "block", "pinned"]));
    const suggested = groups[2].tasks.map((t) => t.id);
    expect(suggested).toContain("small");
    expect(suggested).not.toContain("big"); // 10 hours doesn't fit
  });

  it("suggests nothing when the day is already full", () => {
    expect(todayGroups(tasks, scores, "recommended", now, 30).find((g) => g.id === "suggested")).toBeUndefined();
  });

  it("lists future tasks in Upcoming and counts views", () => {
    expect(upcomingTasks(tasks, now).map((t) => t.id)).toEqual(["tomorrow"]);
    const c = counts(tasks, now);
    expect(c).toMatchObject({ today: 4, overdue: 1, upcoming: 1, all: 7 });
  });

  it("searches titles, notes, projects and subtasks", () => {
    const ts = [
      makeTask({ id: "a", title: "Physics lab", projectId: "p1" }),
      makeTask({ id: "b", title: "Essay", notes: "about the French Revolution" }),
      makeTask({ id: "c", title: "Trip", subtasks: [{ id: "s", taskId: "c", title: "Book train", done: false, sort: 0, createdAt: "" }] }),
    ];
    const projects = [{ id: "p1", name: "School", color: "", sort: 0, createdAt: "" }];
    const q = (s: string) => searchTasks(ts, projects, s).map((t) => t.id);
    expect(q("school")).toEqual(["a"]);
    expect(q("french rev")).toEqual(["b"]);
    expect(q("train")).toEqual(["c"]);
    expect(q("")).toEqual(["a", "b", "c"]);
  });
});

describe("statistics", () => {
  it("summarizes completions and focus", () => {
    const completed = [
      makeTask({ completedAt: at(9).toISOString(), estimateMin: 30, focusSec: 1800 * 1.2 }),
      makeTask({ completedAt: new Date(2026, 9, 14, 12).toISOString(), estimateMin: 60, focusSec: 3600 }),
      makeTask({ completedAt: new Date(2026, 9, 10, 12).toISOString() }),
      makeTask({ completedAt: new Date(2026, 8, 1, 12).toISOString() }),
    ];
    const sessions = [
      makeSession({ startedAt: at(8).toISOString(), endedAt: at(8, 25).toISOString(), completed: true }),
      makeSession({ startedAt: at(9).toISOString(), endedAt: at(9, 10).toISOString(), completed: false }),
      makeSession({ kind: "short_break", startedAt: at(8, 25).toISOString(), endedAt: at(8, 30).toISOString(), completed: true }),
    ];
    const st = computeStats(completed, sessions, now);
    // Week starts Monday Oct 12.
    expect(st.completedToday).toBe(1);
    expect(st.completedThisWeek).toBe(2);
    expect(st.focusSessionsToday).toBe(1);
    expect(st.focusedMinThisWeek).toBe(35);
    expect(st.estimatedMinThisWeek).toBe(90);
    expect(st.estimateAccuracy).toBeCloseTo((36 + 60) / 90);
    expect(st.weekly).toHaveLength(8);
    expect(st.weekly.at(-1)!.count).toBe(2);
    expect(st.weekly.at(-2)!.count).toBe(1);
  });
});
