import { dueInstant } from "./time";
import type { ScoreBreakdown } from "./score";
import type { Task } from "./types";

export type SortMode = "recommended" | "manual";

/**
 * Recommended order: pinned tasks first in the user's pin order, then by score.
 * Ties go to the earlier deadline, then the older task, so the order is stable.
 */
export function sortRecommended(tasks: Task[], scores: Map<string, ScoreBreakdown>): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) return a.pinOrder - b.pinOrder;
    const d = (scores.get(b.id)?.score ?? 0) - (scores.get(a.id)?.score ?? 0);
    if (Math.abs(d) > 1e-9) return d;
    const da = dueInstant(a)?.getTime() ?? Infinity;
    const db = dueInstant(b)?.getTime() ?? Infinity;
    if (da !== db) return da - db;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** Manual order is exactly what the user arranged. Pins don't move anything. */
export function sortManual(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.manualOrder - b.manualOrder || a.createdAt.localeCompare(b.createdAt));
}

export function sortTasks(tasks: Task[], mode: SortMode, scores: Map<string, ScoreBreakdown>): Task[] {
  return mode === "recommended" ? sortRecommended(tasks, scores) : sortManual(tasks);
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * A view usually shows a subset of tasks. After reordering that subset, write
 * its new order back into the slots it occupied in the full list, leaving
 * every hidden task exactly where it was.
 */
export function mergeOrder(fullIds: string[], visibleIds: string[]): string[] {
  const visible = new Set(visibleIds);
  const queue = [...visibleIds];
  const merged = fullIds.map((id) => (visible.has(id) ? queue.shift()! : id));
  // Tasks visible but missing from the full list (shouldn't happen) go last.
  return [...merged, ...queue];
}
