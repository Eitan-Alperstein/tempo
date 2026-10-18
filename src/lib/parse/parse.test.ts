import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { parseTaskInput } from "./index";

// Sunday, Oct 18 2026, 10:00 local.
const now = new Date(2026, 9, 18, 10, 0);
const projects: Project[] = [
  { id: "p-school", name: "School", color: "#0a84ff", sort: 0, createdAt: "" },
  { id: "p-eng", name: "Engineering", color: "#30d158", sort: 1, createdAt: "" },
  { id: "p-news", name: "Newspaper", color: "#ff9f0a", sort: 2, createdAt: "" },
];
const parse = (s: string) => parseTaskInput(s, { now, projects });

describe("examples from the spec", () => {
  it("Study physics for 45 minutes tomorrow", () => {
    const r = parse("Study physics for 45 minutes tomorrow");
    expect(r).toMatchObject({ title: "Study physics", estimateMin: 45, dueDate: "2026-10-19" });
    expect(r.dueTime).toBeUndefined();
  });

  it("Finish history essay Friday", () => {
    expect(parse("Finish history essay Friday")).toMatchObject({ title: "Finish history essay", dueDate: "2026-10-23" });
  });

  it("Practice guitar for 30 min tonight", () => {
    const r = parse("Practice guitar for 30 min tonight");
    expect(r).toMatchObject({ title: "Practice guitar", estimateMin: 30, dueDate: "2026-10-18" });
    expect(r.dueTime).toBeUndefined();
  });

  it("Submit newspaper ad proposal tomorrow at 3pm", () => {
    const r = parse("Submit newspaper ad proposal tomorrow at 3pm");
    expect(r).toMatchObject({ title: "Submit newspaper ad proposal", dueDate: "2026-10-19", dueTime: "15:00" });
    // "newspaper" is not an explicit project reference.
    expect(r.projectId).toBeUndefined();
    expect(r.ambiguities).toContainEqual({ kind: "time-role", text: "tomorrow at 3pm" });
  });

  it("Review calculus, 1 hour, high priority", () => {
    expect(parse("Review calculus, 1 hour, high priority")).toMatchObject({
      title: "Review calculus",
      estimateMin: 60,
      importance: 4,
    });
  });
});

describe("durations", () => {
  it.each([
    ["Read 45m", 45],
    ["Read 90 mins", 90],
    ["Read 1.5 hours", 90],
    ["Read 2h", 120],
    ["Read 1h30", 90],
    ["Read 1h 15m", 75],
    ["Read 1 hour and 20 minutes", 80],
    ["Read for half an hour", 30],
    ["Read for an hour", 60],
    ["Read an hour and a half", 90],
  ])("%s → %i min", (input, min) => {
    const r = parse(input);
    expect(r.estimateMin).toBe(min);
    expect(r.title).toBe("Read");
  });

  it("'in 45 minutes' is a time, not an estimate", () => {
    expect(parse("Call back in 45 minutes").estimateMin).toBeUndefined();
  });

  it("does not treat clock times as durations", () => {
    expect(parse("Dentist at 3pm").estimateMin).toBeUndefined();
  });
});

describe("dates and times", () => {
  it("time ranges become scheduled blocks", () => {
    const r = parse("Deep work tomorrow 4-5:30pm");
    expect(r).toMatchObject({ title: "Deep work", schedDate: "2026-10-19", schedStartTime: "16:00", schedEndTime: "17:30" });
    expect(r.dueDate).toBeUndefined();
  });

  it("drops a dangling preposition before the date", () => {
    expect(parse("Pay rent by next Friday").title).toBe("Pay rent");
    expect(parse("Lab report due Oct 23").dueDate).toBe("2026-10-23");
  });

  it("understands eod", () => {
    expect(parse("Send invoice eod")).toMatchObject({ title: "Send invoice", dueDate: "2026-10-18" });
  });

  it("keeps risky short words in the title and flags them", () => {
    const r = parse("Buy sun hat");
    expect(r.title).toBe("Buy sun hat");
    expect(r.dueDate).toBeUndefined();
    expect(r.ambiguities).toContainEqual({ kind: "maybe-date", text: "sun" });
  });

  it("accepts a risky word with a preposition", () => {
    expect(parse("Call mom on sat").dueDate).toBe("2026-10-24");
  });
});

describe("importance and projects", () => {
  it.each([
    ["Fix bug !", 4],
    ["Fix bug !!!", 5],
    ["Fix bug p1", 5],
    ["Fix bug p3", 3],
    ["Fix bug low priority", 2],
    ["Fix bug, top priority", 5],
  ])("%s → %i", (input, imp) => {
    const r = parse(input);
    expect(r.importance).toBe(imp);
    expect(r.title).toBe("Fix bug");
  });

  it("ignores 'important' inside a title", () => {
    const r = parse("Read important email");
    expect(r.importance).toBeUndefined();
    expect(r.title).toBe("Read important email");
  });

  it("matches #tags case-insensitively and by unique prefix", () => {
    expect(parse("Problem set #school")).toMatchObject({ title: "Problem set", projectId: "p-school" });
    expect(parse("Wire motor #eng")).toMatchObject({ title: "Wire motor", projectId: "p-eng" });
  });

  it("keeps unknown tags in the title and flags them", () => {
    const r = parse("Plan trip #travel");
    expect(r.title).toBe("Plan trip #travel");
    expect(r.projectId).toBeUndefined();
    expect(r.ambiguities).toContainEqual({ kind: "unknown-project", text: "travel" });
  });
});

describe("never discards text", () => {
  it("a title-only input is untouched", () => {
    expect(parse("Email Ms. Rivera about the trip")).toMatchObject({ title: "Email Ms. Rivera about the trip" });
  });

  it("an input that is only a date keeps its words as the title", () => {
    expect(parse("tomorrow")).toMatchObject({ title: "tomorrow", dueDate: "2026-10-19" });
  });

  it("combines everything", () => {
    const r = parse("Wire the motor #eng 2h Friday p2");
    expect(r).toMatchObject({ title: "Wire the motor", projectId: "p-eng", estimateMin: 120, dueDate: "2026-10-23", importance: 4 });
  });
});
