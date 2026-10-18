import { describe, expect, it } from "vitest";
import { makeTask } from "../test/fixtures";
import { sortRecommended } from "./order";
import { scoreAll, scoreTask, type ScoreContext } from "./score";

// Sunday Oct 18 2026, 10:00 local (America/New_York in tests).
const now = new Date(2026, 9, 18, 10, 0);
const ctx: ScoreContext = { now, freeMinutes: 120 };
const s = (over: Parameters<typeof makeTask>[0], c = ctx) => scoreTask(makeTask(over), c);

describe("components are normalized", () => {
  it("every component and the total stay within 0–1", () => {
    const cases = [
      {},
      { importance: 5, dueDate: "2026-09-01", estimateMin: 10 },
      { importance: 1, createdAt: "2020-01-01T00:00:00.000Z" },
    ];
    for (const c of cases) {
      const b = s(c);
      for (const v of [b.score, b.importance, b.urgency, b.overdue, b.fit]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("urgency", () => {
  it("rises as the deadline approaches", () => {
    const week = s({ dueDate: "2026-10-25" }).urgency;
    const threeDays = s({ dueDate: "2026-10-21" }).urgency;
    const tomorrow = s({ dueDate: "2026-10-19" }).urgency;
    const today = s({ dueDate: "2026-10-18" }).urgency;
    expect(week).toBeLessThan(threeDays);
    expect(threeDays).toBeLessThan(tomorrow);
    expect(tomorrow).toBeLessThan(today);
  });

  it("is about 0.5 three days out", () => {
    // Date-only deadlines mean end of day, so Oct 20 23:59 is ~3.6 days away.
    const u = s({ dueDate: "2026-10-21", dueTime: "10:00" }).urgency;
    expect(u).toBeCloseTo(0.5, 1);
  });

  it("undated tasks are never invisible and slowly gain urgency", () => {
    const fresh = s({ createdAt: now.toISOString() });
    const old = s({ createdAt: "2026-08-01T00:00:00.000Z" });
    expect(fresh.urgency).toBeCloseTo(0.15);
    expect(old.urgency).toBeCloseTo(0.3);
    expect(old.reasons).toContain("Waiting 11 weeks");
    // An important undated task outranks a so-so task due next week.
    expect(s({ importance: 5 }).score).toBeGreaterThan(s({ dueDate: "2026-10-25" }).score);
  });

  it("treats a scheduled start as a soft deadline", () => {
    const sched = s({ schedStart: "2026-10-18T19:00:00.000Z", schedEnd: "2026-10-18T20:00:00.000Z" });
    expect(sched.urgency).toBeGreaterThan(0.8);
    expect(sched.overdue).toBe(0);
  });
});

describe("overdue", () => {
  it("gives a capped boost that grows slowly", () => {
    const yesterday = s({ dueDate: "2026-10-17" });
    const lastMonth = s({ dueDate: "2026-09-01" });
    expect(yesterday.overdue).toBeGreaterThanOrEqual(0.5);
    expect(lastMonth.overdue).toBe(1);
    expect(yesterday.reasons[0]).toBe("Overdue by 1 day");
  });

  it("does not bury an important task due tomorrow under a trivial overdue one", () => {
    const trivialOverdue = s({ importance: 1, dueDate: "2026-09-01" });
    const importantTomorrow = s({ importance: 5, dueDate: "2026-10-19" });
    expect(importantTomorrow.score).toBeGreaterThan(trivialOverdue.score);
  });

  it("still lifts an overdue task above an equal task due later", () => {
    expect(s({ dueDate: "2026-10-16" }).score).toBeGreaterThan(s({ dueDate: "2026-10-22" }).score);
  });
});

describe("time fit", () => {
  it("credits any task that fits equally, regardless of length", () => {
    const five = s({ estimateMin: 5 });
    const hour = s({ estimateMin: 60 });
    expect(five.fit).toBe(1);
    expect(hour.fit).toBe(1);
    expect(five.score).toBeCloseTo(hour.score);
  });

  it("gives no fit credit when a task doesn't fit, and neutral when unknown", () => {
    expect(s({ estimateMin: 180 }).fit).toBe(0);
    expect(s({ estimateMin: null }).fit).toBe(0.5);
    expect(s({ estimateMin: 30 }, { now, freeMinutes: null }).fit).toBe(0.5);
    expect(s({ estimateMin: 30 }, { now, freeMinutes: 0 }).fit).toBe(0.5);
  });
});

describe("reasons", () => {
  it("are short and strongest first", () => {
    expect(s({ importance: 5, dueDate: "2026-10-19" }).reasons).toEqual(["Top importance", "Due tomorrow"]);
    expect(s({ dueDate: "2026-10-18", dueTime: "15:00" }).reasons[0]).toBe("Due today at 3 PM");
    expect(s({}).reasons.length).toBeLessThanOrEqual(2);
  });
});

describe("recommended order", () => {
  it("produces a sensible ranking", () => {
    const tasks = [
      makeTask({ id: "someday", importance: 2 }),
      makeTask({ id: "essay", importance: 4, dueDate: "2026-10-19" }),
      makeTask({ id: "overdue-chore", importance: 2, dueDate: "2026-10-15" }),
      makeTask({ id: "exam", importance: 5, dueDate: "2026-10-18" }),
      makeTask({ id: "next-week", importance: 3, dueDate: "2026-10-26" }),
    ];
    const order = sortRecommended(tasks, scoreAll(tasks, ctx)).map((t) => t.id);
    expect(order).toEqual(["exam", "essay", "overdue-chore", "next-week", "someday"]);
  });

  it("puts pinned tasks first, in pin order", () => {
    const tasks = [
      makeTask({ id: "top", importance: 5, dueDate: "2026-10-18" }),
      makeTask({ id: "pinB", importance: 1, pinned: true, pinOrder: 2 }),
      makeTask({ id: "pinA", importance: 1, pinned: true, pinOrder: 1 }),
    ];
    expect(sortRecommended(tasks, scoreAll(tasks, ctx)).map((t) => t.id)).toEqual(["pinA", "pinB", "top"]);
  });

  it("re-ranks when the date changes", () => {
    const tasks = [
      makeTask({ id: "a", importance: 4 }),
      makeTask({ id: "b", importance: 2, dueDate: "2026-10-22" }),
    ];
    const before = sortRecommended(tasks, scoreAll(tasks, ctx)).map((t) => t.id);
    const later = { now: new Date(2026, 9, 22, 9), freeMinutes: 120 };
    const after = sortRecommended(tasks, scoreAll(tasks, later)).map((t) => t.id);
    expect(before).toEqual(["a", "b"]);
    expect(after).toEqual(["b", "a"]);
  });
});
