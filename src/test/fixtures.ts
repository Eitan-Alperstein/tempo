import type { FocusSession, Task } from "../lib/types";

let n = 0;

export function makeTask(over: Partial<Task> = {}): Task {
  n++;
  return {
    id: over.id ?? `t${n}`,
    title: `Task ${n}`,
    notes: "",
    estimateMin: null,
    dueDate: null,
    dueTime: null,
    schedStart: null,
    schedEnd: null,
    projectId: null,
    importance: 3,
    pinned: false,
    pinOrder: 0,
    manualOrder: n,
    recurrence: null,
    completedAt: null,
    createdAt: "2026-10-18T12:00:00.000Z",
    updatedAt: "2026-10-18T12:00:00.000Z",
    subtasks: [],
    focusSec: 0,
    ...over,
  };
}

export function makeSession(over: Partial<FocusSession> = {}): FocusSession {
  n++;
  return {
    id: `s${n}`,
    taskId: null,
    kind: "focus",
    plannedSec: 1500,
    startedAt: "2026-10-18T14:00:00.000Z",
    pausedAt: null,
    pausedTotalSec: 0,
    endedAt: null,
    completed: false,
    ...over,
  };
}
