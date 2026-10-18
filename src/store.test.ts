// UI-state tests against a mocked backend: completion, undo, ordering, prompts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTask } from "./test/fixtures";
import type { Task } from "./lib/types";

const backend = vi.hoisted(() => ({ handlers: {} as Record<string, (args: Record<string, unknown>) => unknown> }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    const h = backend.handlers[cmd];
    if (!h) throw new Error(`unmocked command ${cmd}`);
    return h(args);
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store";

function seed(tasks: Task[]) {
  useStore.setState({ tasks, toasts: [], undoStack: [], prompt: null, detailId: null, selectedId: null });
}

beforeEach(() => {
  vi.mocked(invoke).mockClear();
  backend.handlers = {};
});

describe("completing tasks", () => {
  it("asks before completing a task with unfinished subtasks", () => {
    const t = makeTask({ subtasks: [{ id: "s1", taskId: "x", title: "a", done: false, sort: 0, createdAt: "" }] });
    seed([t]);
    useStore.getState().requestComplete(t.id);
    expect(useStore.getState().prompt).toEqual({ kind: "complete-subtasks", taskId: t.id });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("completes, removes from the list, and undo brings it back", async () => {
    const t = makeTask({ title: "Essay" });
    seed([t]);
    backend.handlers.complete_task = () => ({ task: { ...t, completedAt: "now" }, next: null });
    backend.handlers.uncomplete_task = () => ({ ...t, completedAt: null });

    useStore.getState().requestComplete(t.id);
    await vi.waitFor(() => expect(useStore.getState().tasks).toHaveLength(0));
    expect(useStore.getState().toasts[0]).toMatchObject({ message: "Completed “Essay”", undoable: true });

    await useStore.getState().undo();
    expect(useStore.getState().tasks.map((x) => x.id)).toEqual([t.id]);
    expect(invoke).toHaveBeenCalledWith("uncomplete_task", { id: t.id, removeNext: null });
  });

  it("sends the next occurrence for recurring tasks and undo removes it", async () => {
    const t = makeTask({ dueDate: "2020-01-01", recurrence: { freq: "daily", from: "due" } });
    const next = makeTask({ id: "next" });
    seed([t]);
    backend.handlers.complete_task = (args) => {
      expect((args.next as { dueDate: string }).dueDate > "2020-01-01").toBe(true);
      return { task: { ...t, completedAt: "now" }, next };
    };
    backend.handlers.uncomplete_task = () => t;
    await useStore.getState().complete(t.id, false);
    expect(useStore.getState().tasks.map((x) => x.id)).toEqual(["next"]);
    await useStore.getState().undo();
    expect(invoke).toHaveBeenLastCalledWith("uncomplete_task", { id: t.id, removeNext: "next" });
    expect(useStore.getState().tasks.map((x) => x.id)).toEqual([t.id]);
  });
});

describe("delete and undo", () => {
  it("soft-deletes and restores", async () => {
    const t = makeTask();
    seed([t]);
    backend.handlers.delete_task = () => null;
    backend.handlers.restore_task = () => t;
    await useStore.getState().deleteTask(t.id);
    expect(useStore.getState().tasks).toHaveLength(0);
    await useStore.getState().undo();
    expect(useStore.getState().tasks).toHaveLength(1);
  });
});

describe("manual reorder", () => {
  it("persists the merged full order and updates local state", async () => {
    const [a, b, c] = [makeTask({ id: "a", manualOrder: 0 }), makeTask({ id: "b", manualOrder: 1 }), makeTask({ id: "c", manualOrder: 2 })];
    seed([a, b, c]);
    let saved: string[] = [];
    backend.handlers.reorder_manual = (args) => {
      saved = args.ids as string[];
      return null;
    };
    // A view showing only a and c swaps them; b keeps its slot.
    await useStore.getState().reorderManual(["c", "a"]);
    expect(saved).toEqual(["c", "b", "a"]);
    const order = [...useStore.getState().tasks].sort((x, y) => x.manualOrder - y.manualOrder).map((t) => t.id);
    expect(order).toEqual(["c", "b", "a"]);
  });
});

describe("errors", () => {
  it("surfaces backend failures and rolls back optimistic edits", async () => {
    const t = makeTask({ title: "Old" });
    seed([t]);
    backend.handlers.update_task = () => {
      throw "Database error: disk full";
    };
    await useStore.getState().patchTask(t.id, { title: "New" });
    expect(useStore.getState().tasks[0].title).toBe("Old");
    expect(useStore.getState().toasts[0]).toMatchObject({ tone: "error", message: "Database error: disk full" });
  });
});
