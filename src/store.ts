import { create } from "zustand";
import { api, errorMessage } from "./lib/api";
import { mergeOrder, sortManual } from "./lib/order";
import { nextOccurrence } from "./lib/recurrence";
import { withDefaults, timerSettings, type SettingKey, type Settings } from "./lib/settings";
import { addDays, localDate, startOfDay } from "./lib/time";
import { focusStreak, nextBreak } from "./lib/timer";
import type {
  CalendarEvent,
  CalendarStatus,
  FocusSession,
  Project,
  Task,
  TaskInput,
  View,
} from "./lib/types";

export interface Toast {
  id: number;
  message: string;
  undoable?: boolean;
  tone?: "info" | "error";
}

export type Prompt =
  | { kind: "complete-subtasks"; taskId: string }
  | { kind: "focus-ended"; session: FocusSession }
  /** Dragging in Recommended order: pin the task there, or switch to manual order. */
  | { kind: "recommended-drag"; taskId: string; pinIds: string[]; manualIds: string[] }
  | { kind: "delete-project"; projectId: string }
  | null;

interface UndoEntry {
  label: string;
  run: () => Promise<void>;
}

export function toInput(t: Task): TaskInput {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    estimateMin: t.estimateMin,
    dueDate: t.dueDate,
    dueTime: t.dueTime,
    schedStart: t.schedStart,
    schedEnd: t.schedEnd,
    projectId: t.projectId,
    importance: t.importance,
    recurrence: t.recurrence,
  };
}

interface State {
  ready: boolean;
  loadError: string | null;
  tasks: Task[];
  projects: Project[];
  settings: Settings;
  session: FocusSession | null;
  dbPath: string;

  view: View;
  selectedId: string | null;
  detailId: string | null;
  search: string;
  now: Date;
  quickAddFocus: number;
  searchFocus: number;
  completedVersion: number;

  calendarEvents: CalendarEvent[];
  calendarStatus: CalendarStatus | null;
  calendarError: string | null;
  scheduleDay: string;

  toasts: Toast[];
  undoStack: UndoEntry[];
  prompt: Prompt;
  /** Task ids in on-screen order, for keyboard navigation. */
  visibleIds: string[];
}

interface Actions {
  init(): Promise<void>;
  reloadTasks(): Promise<void>;
  setView(v: View): void;
  select(id: string | null): void;
  openDetail(id: string | null): void;
  setSearch(q: string): void;
  focusQuickAdd(): void;
  focusSearch(): void;
  tick(): void;
  setSetting(key: SettingKey, value: string): Promise<void>;

  createTask(input: TaskInput): Promise<Task | null>;
  patchTask(id: string, patch: Partial<Task>): Promise<void>;
  requestComplete(id: string): void;
  complete(id: string, completeSubtasks: boolean): Promise<void>;
  uncomplete(task: Task): Promise<void>;
  deleteTask(id: string): Promise<void>;
  togglePin(id: string): Promise<void>;
  reorderManual(visibleIds: string[]): Promise<void>;
  reorderPins(ids: string[]): Promise<void>;
  pinAt(taskId: string, pinnedIdsInOrder: string[]): Promise<void>;
  switchToManualWith(ids: string[]): Promise<void>;

  createProject(name: string, color: string): Promise<Project | null>;
  updateProject(id: string, name: string, color: string): Promise<void>;
  deleteProject(id: string, moveTo: string | null): Promise<void>;
  reorderProjects(ids: string[]): Promise<void>;

  addSubtask(taskId: string, title: string): Promise<void>;
  updateSubtask(id: string, title: string, done: boolean): Promise<void>;
  deleteSubtask(id: string): Promise<void>;
  reorderSubtasks(taskId: string, ids: string[]): Promise<void>;

  startFocus(taskId: string | null): Promise<void>;
  startBreak(): Promise<void>;
  toggleTimer(): Promise<void>;
  stopTimer(): Promise<void>;
  focusEnded(s: FocusSession): void;

  setScheduleDay(day: string): void;
  refreshCalendar(): Promise<void>;
  setCalendarStatus(s: CalendarStatus): void;

  toast(message: string, opts?: Partial<Omit<Toast, "id" | "message">>): void;
  dismissToast(id: number): void;
  pushUndo(label: string, run: () => Promise<void>): void;
  undo(): Promise<void>;
  setPrompt(p: Prompt): void;
  setVisibleIds(ids: string[]): void;
}

let toastId = 0;

export const useStore = create<State & Actions>((set, get) => {
  const replaceTask = (t: Task) =>
    set((s) => ({
      tasks: t.completedAt ? s.tasks.filter((x) => x.id !== t.id) : s.tasks.some((x) => x.id === t.id) ? s.tasks.map((x) => (x.id === t.id ? t : x)) : [t, ...s.tasks],
    }));

  // Run a backend call; surface failures instead of losing them.
  async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      get().toast(errorMessage(e), { tone: "error" });
      return null;
    }
  }

  return {
    ready: false,
    loadError: null,
    tasks: [],
    projects: [],
    settings: withDefaults({}),
    session: null,
    dbPath: "",
    view: { kind: "today" },
    selectedId: null,
    detailId: null,
    search: "",
    now: new Date(),
    quickAddFocus: 0,
    searchFocus: 0,
    completedVersion: 0,
    calendarEvents: [],
    calendarStatus: null,
    calendarError: null,
    scheduleDay: localDate(new Date()),
    toasts: [],
    undoStack: [],
    prompt: null,
    visibleIds: [],

    async init() {
      try {
        const b = await api.bootstrap();
        set({
          ready: true,
          tasks: b.tasks,
          projects: b.projects,
          settings: withDefaults(b.settings),
          session: b.activeSession,
          dbPath: b.dbPath,
        });
        if (get().settings.calendar === "1") void get().refreshCalendar();
      } catch (e) {
        set({ loadError: errorMessage(e) });
      }
    },

    async reloadTasks() {
      const tasks = await attempt(api.listActiveTasks);
      if (tasks) set({ tasks });
    },

    setView(view) {
      set({ view, search: "", detailId: null });
    },
    select(selectedId) {
      set({ selectedId });
    },
    openDetail(detailId) {
      set(detailId ? { detailId, selectedId: detailId } : { detailId });
    },
    setSearch(search) {
      set({ search });
    },
    focusQuickAdd() {
      const v = get().view.kind;
      if (v === "completed" || v === "settings") set({ view: { kind: "today" } });
      set((s) => ({ quickAddFocus: s.quickAddFocus + 1 }));
    },
    focusSearch() {
      set((s) => ({ searchFocus: s.searchFocus + 1 }));
    },
    tick() {
      const prev = get().now;
      const now = new Date();
      set({ now });
      // When the date rolls over, follow it in the schedule.
      if (localDate(prev) !== localDate(now) && get().scheduleDay === localDate(prev)) {
        set({ scheduleDay: localDate(now) });
        if (get().settings.calendar === "1") void get().refreshCalendar();
      }
    },

    async setSetting(key, value) {
      const prev = get().settings[key];
      set((s) => ({ settings: { ...s.settings, [key]: value } }));
      const ok = await attempt(() => api.setSetting(key, value));
      if (ok === null) set((s) => ({ settings: { ...s.settings, [key]: prev } }));
    },

    async createTask(input) {
      const t = await attempt(() => api.createTask(input));
      if (!t) return null;
      replaceTask(t);
      get().pushUndo(`Add “${t.title}”`, async () => {
        await api.deleteTask(t.id);
        set((s) => ({ tasks: s.tasks.filter((x) => x.id !== t.id) }));
      });
      return t;
    },

    async patchTask(id, patch) {
      const cur = get().tasks.find((t) => t.id === id);
      if (!cur) return;
      const next = { ...cur, ...patch };
      replaceTask(next);
      const saved = await attempt(() => api.updateTask(toInput(next)));
      replaceTask(saved ?? cur);
    },

    requestComplete(id) {
      const t = get().tasks.find((x) => x.id === id);
      if (!t) return;
      if (t.subtasks.some((s) => !s.done)) set({ prompt: { kind: "complete-subtasks", taskId: id } });
      else void get().complete(id, false);
    },

    async complete(id, completeSubtasks) {
      const t = get().tasks.find((x) => x.id === id);
      if (!t) return;
      const next = nextOccurrence(t, new Date());
      const r = await attempt(() => api.completeTask(id, completeSubtasks, next));
      if (!r) return;
      set((s) => ({
        tasks: [...(r.next ? [r.next] : []), ...s.tasks.filter((x) => x.id !== id)],
        completedVersion: s.completedVersion + 1,
        detailId: s.detailId === id ? null : s.detailId,
      }));
      get().toast(r.next ? `Completed “${t.title}”. Next one is set.` : `Completed “${t.title}”`, { undoable: true });
      get().pushUndo(`Complete “${t.title}”`, async () => {
        const back = await api.uncompleteTask(id, r.next?.id ?? null);
        set((s) => ({
          tasks: [back, ...s.tasks.filter((x) => x.id !== id && x.id !== r.next?.id)],
          completedVersion: s.completedVersion + 1,
        }));
      });
    },

    async uncomplete(task) {
      const back = await attempt(() => api.uncompleteTask(task.id, null));
      if (!back) return;
      set((s) => ({ tasks: [back, ...s.tasks], completedVersion: s.completedVersion + 1 }));
      get().toast(`Moved “${task.title}” back to your list`);
    },

    async deleteTask(id) {
      const t = get().tasks.find((x) => x.id === id);
      if (!t) return;
      if ((await attempt(() => api.deleteTask(id))) === null) return;
      set((s) => ({
        tasks: s.tasks.filter((x) => x.id !== id),
        detailId: s.detailId === id ? null : s.detailId,
        selectedId: s.selectedId === id ? null : s.selectedId,
      }));
      get().toast(`Deleted “${t.title}”`, { undoable: true });
      get().pushUndo(`Delete “${t.title}”`, async () => {
        replaceTask(await api.restoreTask(id));
      });
    },

    async togglePin(id) {
      const t = get().tasks.find((x) => x.id === id);
      if (!t) return;
      const saved = await attempt(() => api.setPinned(id, !t.pinned));
      if (saved) replaceTask(saved);
    },

    async reorderManual(visibleIds) {
      const full = sortManual(get().tasks).map((t) => t.id);
      const merged = mergeOrder(full, visibleIds);
      const index = new Map(merged.map((id, i) => [id, i]));
      set((s) => ({ tasks: s.tasks.map((t) => ({ ...t, manualOrder: index.get(t.id) ?? t.manualOrder })) }));
      if ((await attempt(() => api.reorderManual(merged))) === null) await get().reloadTasks();
    },

    async reorderPins(ids) {
      const index = new Map(ids.map((id, i) => [id, i + 1]));
      set((s) => ({ tasks: s.tasks.map((t) => (index.has(t.id) ? { ...t, pinOrder: index.get(t.id)! } : t)) }));
      if ((await attempt(() => api.reorderPins(ids.map(String)))) === null) await get().reloadTasks();
    },

    async pinAt(taskId, pinnedIdsInOrder) {
      const saved = await attempt(() => api.setPinned(taskId, true));
      if (!saved) return;
      replaceTask(saved);
      await get().reorderPins(pinnedIdsInOrder);
    },

    /** Save the given full order (the current recommended order, with the drag applied) as manual, then switch. */
    async switchToManualWith(ids) {
      await get().reorderManual(ids);
      await get().setSetting("sortMode", "manual");
      get().toast("Switched to manual order. Your list won't be reshuffled.");
    },

    async createProject(name, color) {
      const p = await attempt(() => api.createProject(name, color));
      if (p) set((s) => ({ projects: [...s.projects, p] }));
      return p;
    },
    async updateProject(id, name, color) {
      const p = await attempt(() => api.updateProject(id, name, color));
      if (p) set((s) => ({ projects: s.projects.map((x) => (x.id === id ? p : x)) }));
    },
    async deleteProject(id, moveTo) {
      const name = get().projects.find((p) => p.id === id)?.name ?? "project";
      const moved = await attempt(() => api.deleteProject(id, moveTo));
      if (moved === null) return;
      set((s) => ({
        projects: s.projects.filter((p) => p.id !== id),
        tasks: s.tasks.map((t) => (t.projectId === id ? { ...t, projectId: moveTo } : t)),
        view: s.view.kind === "project" && s.view.projectId === id ? { kind: "all" } : s.view,
        completedVersion: s.completedVersion + 1,
      }));
      get().toast(`Deleted ${name}. ${moved} task${moved === 1 ? "" : "s"} kept.`);
    },
    async reorderProjects(ids) {
      const index = new Map(ids.map((id, i) => [id, i]));
      set((s) => ({ projects: [...s.projects].sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0)) }));
      await attempt(() => api.reorderProjects(ids));
    },

    async addSubtask(taskId, title) {
      const t = await attempt(() => api.addSubtask(taskId, title));
      if (t) replaceTask(t);
    },
    async updateSubtask(id, title, done) {
      // Optimistic: checkboxes should respond instantly.
      set((s) => ({
        tasks: s.tasks.map((t) => ({
          ...t,
          subtasks: t.subtasks.map((st) => (st.id === id ? { ...st, title, done } : st)),
        })),
      }));
      const t = await attempt(() => api.updateSubtask(id, title, done));
      if (t) replaceTask(t);
      else await get().reloadTasks();
    },
    async deleteSubtask(id) {
      const t = await attempt(() => api.deleteSubtask(id));
      if (t) replaceTask(t);
    },
    async reorderSubtasks(taskId, ids) {
      const index = new Map(ids.map((id, i) => [id, i]));
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId ? { ...t, subtasks: [...t.subtasks].sort((a, b) => index.get(a.id)! - index.get(b.id)!) } : t,
        ),
      }));
      const t = await attempt(() => api.reorderSubtasks(taskId, ids));
      if (t) replaceTask(t);
    },

    async startFocus(taskId) {
      const min = timerSettings(get().settings).focusMin;
      const s = await attempt(() => api.startSession(taskId, "focus", Math.round(min * 60)));
      if (s) set({ session: s, prompt: null });
    },
    async startBreak() {
      const since = startOfDay(new Date()).toISOString();
      const sessions = (await attempt(() => api.listSessions(since))) ?? [];
      const b = nextBreak(focusStreak(sessions), timerSettings(get().settings));
      const s = await attempt(() => api.startSession(null, b.kind, Math.round(b.minutes * 60)));
      if (s) set({ session: s, prompt: null });
    },
    async toggleTimer() {
      const s = get().session;
      if (!s) {
        const id = get().selectedId ?? get().detailId;
        await get().startFocus(id);
        return;
      }
      const next = await attempt(s.pausedAt ? api.resumeSession : api.pauseSession);
      if (next !== null) set({ session: next });
    },
    async stopTimer() {
      const stopped = await attempt(api.stopSession);
      if (stopped === null) return;
      set({ session: null });
      // Tracked time changed: refresh that task's total.
      if (stopped?.taskId) await get().reloadTasks();
    },
    focusEnded(s) {
      set({ session: null, prompt: { kind: "focus-ended", session: s } });
      if (s.taskId) void get().reloadTasks();
    },

    setScheduleDay(day) {
      set({ scheduleDay: day });
      if (get().settings.calendar === "1") void get().refreshCalendar();
    },
    async refreshCalendar() {
      if (get().settings.calendar !== "1") {
        set({ calendarEvents: [], calendarError: null });
        return;
      }
      // Today and the day being viewed, so free time and the schedule both have data.
      const today = startOfDay(new Date());
      const viewed = startOfDay(new Date(`${get().scheduleDay}T00:00:00`));
      const from = new Date(Math.min(+today, +viewed));
      const to = addDays(new Date(Math.max(+today, +viewed)), 1);
      try {
        const events = await api.calendarEvents(from.toISOString(), to.toISOString());
        set({ calendarEvents: events, calendarError: null });
      } catch (e) {
        set({ calendarEvents: [], calendarError: errorMessage(e) });
      }
    },
    setCalendarStatus(calendarStatus) {
      set({ calendarStatus });
    },

    toast(message, opts = {}) {
      const id = ++toastId;
      set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, ...opts }] }));
      setTimeout(() => get().dismissToast(id), opts.tone === "error" ? 8000 : 6000);
    },
    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
    pushUndo(label, run) {
      set((s) => ({ undoStack: [...s.undoStack.slice(-19), { label, run }] }));
    },
    async undo() {
      const stack = get().undoStack;
      const last = stack.at(-1);
      if (!last) return;
      set({ undoStack: stack.slice(0, -1), toasts: [] });
      try {
        await last.run();
        get().toast(`Undid: ${last.label}`);
      } catch (e) {
        get().toast(errorMessage(e), { tone: "error" });
      }
    },
    setPrompt(prompt) {
      set({ prompt });
    },
    setVisibleIds(visibleIds) {
      const cur = get().visibleIds;
      if (cur.length !== visibleIds.length || cur.some((id, i) => id !== visibleIds[i])) set({ visibleIds });
    },
  };
});
