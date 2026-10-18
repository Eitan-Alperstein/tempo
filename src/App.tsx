import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { listen } from "@tauri-apps/api/event";
import { CalendarClock, CalendarDays, CircleCheck, Inbox, PanelLeft, Search, Sun, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompletedView } from "./components/CompletedView";
import { DetailPanel } from "./components/DetailPanel";
import { PlanBar } from "./components/PlanBar";
import { Prompts } from "./components/Prompts";
import { QuickAdd, defaultsForView, type QuickAddHandle } from "./components/QuickAdd";
import { SchedulePanel, timeAtY } from "./components/SchedulePanel";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { TaskList } from "./components/TaskList";
import { TimerPill } from "./components/TimerPill";
import { Toasts } from "./components/Toasts";
import { IconButton, Segmented } from "./components/ui";
import { usePlanning } from "./hooks/usePlanning";
import { api } from "./lib/api";
import { exportBackup, importBackup } from "./lib/backup";
import { mergeOrder, sortRecommended, sortTasks } from "./lib/order";
import { DEFAULT_BLOCK_MIN, conflictsFor, eventBlock, taskBlock, type Block } from "./lib/schedule";
import { sortMode } from "./lib/settings";
import { MINUTE, format, formatTime, localDate, parseLocalDate, relativeDay, daysUntil } from "./lib/time";
import type { FocusSession, Task } from "./lib/types";
import { filterProject, isToday, searchTasks, todayGroups, upcomingDate, upcomingTasks, type Group } from "./lib/views";
import { useStore } from "./store";

function isField(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
}

// Rows sort by closest center; the timeline accepts a drop when the pointer is over it.
const collision: CollisionDetection = (args) => {
  const timeline = pointerWithin(args).find((c) => c.id === "timeline");
  if (timeline) return [timeline];
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.id !== "timeline") });
};

export default function App() {
  const s = useStore();
  const { scores, freeMinutes, availableMin } = usePlanning();
  const quickAdd = useRef<QuickAddHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState<Task | null>(null);
  const mode = sortMode(s.settings);
  const sidebarCollapsed = s.settings.sidebarCollapsed === "1";
  const scheduleOpen = s.settings.scheduleOpen === "1";

  useEffect(() => {
    void s.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep "now" fresh so scores, overdue states and the date roll over on their own.
  useEffect(() => {
    const id = setInterval(() => useStore.getState().tick(), 30_000);
    const onFocus = () => {
      const st = useStore.getState();
      st.tick();
      void api.activeSession().then((session) => useStore.setState({ session }));
      if (st.settings.calendar === "1") void st.refreshCalendar();
    };
    window.addEventListener("focus", onFocus);
    const cal = setInterval(() => {
      const st = useStore.getState();
      if (st.settings.calendar === "1") void st.refreshCalendar();
    }, 5 * 60_000);
    return () => {
      clearInterval(id);
      clearInterval(cal);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (s.settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", s.settings.theme);
  }, [s.settings.theme]);

  useEffect(() => {
    if (s.quickAddFocus) quickAdd.current?.focus();
  }, [s.quickAddFocus]);
  useEffect(() => {
    if (s.searchFocus && s.view.kind !== "completed") searchRef.current?.focus();
  }, [s.searchFocus, s.view.kind]);

  // ----- what the current view shows -----
  const groups: Group[] = useMemo(() => {
    const { tasks, projects, view, now, search } = s;
    if (search.trim()) {
      const found = sortRecommended(searchTasks(tasks, projects, search), scores);
      return [{ id: "results", title: "", tasks: found }];
    }
    switch (view.kind) {
      case "today":
        return todayGroups(tasks, scores, mode, now, availableMin);
      case "upcoming": {
        const byDate = new Map<string, Task[]>();
        for (const t of upcomingTasks(tasks, now)) {
          const d = upcomingDate(t)!;
          const key = daysUntil(d, now) > 14 ? "later" : d;
          byDate.set(key, [...(byDate.get(key) ?? []), t]);
        }
        return [...byDate.entries()]
          .sort(([a], [b]) => (a === "later" ? 1 : b === "later" ? -1 : a.localeCompare(b)))
          .map(([d, ts]) => ({
            id: d,
            title: d === "later" ? "Later" : `${relativeDay(parseLocalDate(d), now)} · ${format(parseLocalDate(d), "EEE, MMM d")}`,
            tasks: sortTasks(ts, mode, scores),
          }));
      }
      case "all":
        return [{ id: "all", title: "", tasks: sortTasks(tasks, mode, scores) }];
      case "project":
        return [{ id: "project", title: "", tasks: sortTasks(filterProject(tasks, view.projectId), mode, scores) }];
      default:
        return [];
    }
  }, [s, scores, mode, availableMin]);

  // ----- drag and drop -----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (e: DragStartEvent) => {
    const id = e.active.data.current?.taskId as string | undefined;
    setDragging(s.tasks.find((t) => t.id === id) ?? null);
  };

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDragging(null);
      const taskId = e.active.data.current?.taskId as string | undefined;
      const groupId = e.active.data.current?.groupId as string | undefined;
      const st = useStore.getState();
      const task = st.tasks.find((t) => t.id === taskId);
      if (!task || !e.over) return;

      if (e.over.id === "timeline") {
        const pointer = e.activatorEvent as PointerEvent;
        const start = timeAtY((pointer.clientY ?? 0) + e.delta.y);
        if (!start) return;
        const end = new Date(+start + (task.estimateMin ?? DEFAULT_BLOCK_MIN) * MINUTE);
        void st.patchTask(task.id, { schedStart: start.toISOString(), schedEnd: end.toISOString() });
        const others = [...st.tasks.map(taskBlock), ...st.calendarEvents.map(eventBlock)].filter((b): b is Block => !!b);
        const clash = conflictsFor({ start, end }, others, task.id);
        st.toast(
          clash.length
            ? `Scheduled at ${formatTime(start)}, but it overlaps “${clash[0].title}”.`
            : `Scheduled “${task.title}” at ${formatTime(start)}.`,
          { undoable: false },
        );
        st.pushUndo(`Schedule “${task.title}”`, () => st.patchTask(task.id, { schedStart: task.schedStart, schedEnd: task.schedEnd }));
        return;
      }

      const overTaskId = e.over.data.current?.taskId as string | undefined;
      const overGroup = e.over.data.current?.groupId as string | undefined;
      if (!overTaskId || overTaskId === taskId || overGroup !== groupId) return;
      const group = groups.find((g) => g.id === groupId);
      if (!group || groupId === "suggested" || groupId === "results") return;
      const ids = group.tasks.map((t) => t.id);
      const moved = arrayMove(ids, ids.indexOf(task.id), ids.indexOf(overTaskId));

      if (mode === "manual") {
        void st.reorderManual(moved);
        return;
      }
      const over = st.tasks.find((t) => t.id === overTaskId);
      const allPinned = sortRecommended(st.tasks.filter((t) => t.pinned), scores).map((t) => t.id);
      if (task.pinned && over?.pinned) {
        void st.reorderPins(mergeOrder(allPinned, moved.filter((id) => allPinned.includes(id))));
        return;
      }
      // Recommended order sorts itself, so ask how to honour the drag.
      const pinIds = mergeOrder(
        [...allPinned, task.id],
        moved.filter((id) => allPinned.includes(id) || id === task.id),
      );
      const fullRecommended = sortRecommended(st.tasks, scores).map((t) => t.id);
      st.setPrompt({ kind: "recommended-drag", taskId: task.id, pinIds, manualIds: mergeOrder(fullRecommended, moved) });
    },
    [groups, mode, scores],
  );

  // ----- keyboard and menu commands -----
  const selected = () => {
    const st = useStore.getState();
    return st.selectedId ?? st.detailId;
  };

  const runCommand = useCallback((id: string) => {
    const st = useStore.getState();
    const sel = selected();
    switch (id) {
      case "new_task":
        return st.focusQuickAdd();
      case "search":
        return st.focusSearch();
      case "settings":
        return st.setView({ kind: "settings" });
      case "export":
        return void exportBackup();
      case "import":
        return void importBackup();
      case "undo":
        // In a text field, undo typing; elsewhere, undo the last task action.
        if (isField(document.activeElement)) document.execCommand("undo");
        else void st.undo();
        return;
      case "complete":
        if (sel) st.requestComplete(sel);
        return;
      case "pin":
        if (sel) void st.togglePin(sel);
        return;
      case "open":
        if (sel) st.openDetail(sel);
        return;
      case "timer":
        return void st.toggleTimer();
      case "timer_stop":
        return void st.stopTimer();
      case "view_today":
        return st.setView({ kind: "today" });
      case "view_upcoming":
        return st.setView({ kind: "upcoming" });
      case "view_all":
        return st.setView({ kind: "all" });
      case "view_completed":
        return st.setView({ kind: "completed" });
      case "toggle_sort":
        return void st.setSetting("sortMode", sortMode(st.settings) === "manual" ? "recommended" : "manual");
      case "schedule":
        return void st.setSetting("scheduleOpen", st.settings.scheduleOpen === "1" ? "0" : "1");
      case "sidebar":
        return void st.setSetting("sidebarCollapsed", st.settings.sidebarCollapsed === "1" ? "0" : "1");
    }
  }, []);

  useEffect(() => {
    const unlisten = [
      listen<string>("menu", (e) => runCommand(e.payload)),
      listen<FocusSession>("focus-ended", (e) => useStore.getState().focusEnded(e.payload)),
      listen("tasks-changed", () => void useStore.getState().reloadTasks()),
    ];
    return () => unlisten.forEach((p) => void p.then((f) => f()));
  }, [runCommand]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (st.prompt) return;
      if (e.key === "Escape") {
        if (st.detailId) st.openDetail(null);
        else if (st.search) st.setSearch("");
        else (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (isField(e.target) || e.defaultPrevented) return;
      const ids = st.visibleIds;
      const cur = st.selectedId ? ids.indexOf(st.selectedId) : -1;
      const move = (d: number) => {
        if (!ids.length) return;
        const next = ids[Math.max(0, Math.min(ids.length - 1, cur === -1 ? (d > 0 ? 0 : ids.length - 1) : cur + d))];
        st.select(next);
        if (st.detailId) st.openDetail(next);
      };
      if (e.metaKey && e.key === "Backspace") {
        e.preventDefault();
        if (st.selectedId) void st.deleteTask(st.selectedId);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const action =
          e.key === "ArrowDown" || e.key === "j"
            ? () => move(1)
            : e.key === "ArrowUp" || e.key === "k"
              ? () => move(-1)
              : e.key === "Enter" && st.selectedId
                ? () => st.openDetail(st.selectedId)
                : e.key === "/"
                  ? () => st.focusSearch()
                  : null;
        if (action) {
          e.preventDefault();
          action();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (s.loadError) {
    return (
      <div className="fatal">
        <h1>Tempo couldn't open its database</h1>
        <p>{s.loadError}</p>
        <p className="muted">Your data hasn't been changed. Quit and reopen Tempo; if this keeps happening, restore from a backup.</p>
      </div>
    );
  }
  if (!s.ready) return <div className="loading" data-tauri-drag-region />;

  const { view } = s;
  const project = view.kind === "project" ? s.projects.find((p) => p.id === view.projectId) : undefined;
  const isList = view.kind !== "completed" && view.kind !== "settings";
  const title = {
    today: "Today",
    upcoming: "Upcoming",
    all: "All Tasks",
    completed: "Completed",
    settings: "Settings",
    project: project?.name ?? "Project",
  }[view.kind];
  const todayCommitted = s.tasks.filter((t) => isToday(t, s.now));

  const empty = s.search ? (
    <>
      <Search size={28} aria-hidden />
      <p>No active tasks match “{s.search}”.</p>
      <p className="muted">Completed tasks are searchable in Completed.</p>
    </>
  ) : view.kind === "today" ? (
    <>
      <Sun size={28} aria-hidden />
      <p>Nothing due today.</p>
      <p className="muted">
        Add a task above, or press <kbd className="kbd">⌘N</kbd>. Tasks due today, scheduled today or pinned show up here.
      </p>
    </>
  ) : view.kind === "upcoming" ? (
    <>
      <CalendarDays size={28} aria-hidden />
      <p>Nothing scheduled ahead.</p>
      <p className="muted">Tasks with a future due date or time block appear here.</p>
    </>
  ) : view.kind === "project" ? (
    <>
      <Inbox size={28} aria-hidden />
      <p>No active tasks in {project?.name}.</p>
      <p className="muted">
        Add one above, or type <code>#{project?.name.toLowerCase().replace(/\s+/g, "")}</code> in any quick add.
      </p>
    </>
  ) : (
    <>
      <CircleCheck size={28} aria-hidden />
      <p>All clear.</p>
      <p className="muted">
        Add a task above. Try “Review calculus 1h Friday !” to set a time, deadline and importance in one go.
      </p>
    </>
  );

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        {!sidebarCollapsed && <Sidebar />}
        <main className="main">
          <header className="toolbar" data-tauri-drag-region>
            <IconButton
              label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
              shortcut="⌃⌘S"
              className="sidebar-toggle"
              onClick={() => void s.setSetting("sidebarCollapsed", sidebarCollapsed ? "0" : "1")}
            >
              <PanelLeft size={16} />
            </IconButton>
            <div className="toolbar-title" data-tauri-drag-region>
              <h1 data-tauri-drag-region>{title}</h1>
              {view.kind === "today" && (
                <span className="subtitle" data-tauri-drag-region>
                  {format(s.now, "EEEE, MMMM d")}
                </span>
              )}
            </div>
            <span className="spacer" data-tauri-drag-region />
            <TimerPill />
            {isList && (
              <>
                <div className="search-field toolbar-search">
                  <Search size={13} aria-hidden />
                  <input
                    ref={searchRef}
                    type="search"
                    value={s.search}
                    placeholder="Search"
                    aria-label="Search tasks"
                    title="Search (⌘F)"
                    onChange={(e) => s.setSearch(e.target.value)}
                  />
                  {s.search && (
                    <button type="button" className="icon-btn subtle" aria-label="Clear search" onClick={() => s.setSearch("")}>
                      <X size={12} />
                    </button>
                  )}
                </div>
                <Segmented
                  label="Order"
                  value={mode}
                  onChange={(v) => void s.setSetting("sortMode", v)}
                  options={[
                    { value: "recommended", label: "Recommended", title: "Sorted by priority score (⌥⌘O)" },
                    { value: "manual", label: "Manual", title: "Your own drag-and-drop order (⌥⌘O)" },
                  ]}
                />
                <IconButton
                  label="Day schedule"
                  shortcut="⇧⌘D"
                  active={scheduleOpen}
                  onClick={() => void s.setSetting("scheduleOpen", scheduleOpen ? "0" : "1")}
                >
                  <CalendarClock size={16} />
                </IconButton>
              </>
            )}
          </header>

          <div className="content">
            {isList && (
              <>
                {view.kind === "today" && !s.search && (
                  <PlanBar todayTasks={todayCommitted} freeMinutes={freeMinutes} availableMin={availableMin} />
                )}
                <QuickAdd
                  ref={quickAdd}
                  projects={s.projects}
                  now={s.now}
                  defaults={defaultsForView(view, s.now)}
                  onSubmit={async (input) => {
                    const t = await s.createTask(input);
                    if (t && view.kind === "upcoming" && !upcomingDate(t)) s.toast(`Added “${t.title}” to All Tasks (no date).`);
                    else if (t && view.kind === "project" && t.projectId !== view.projectId) s.toast(`Added “${t.title}” to another project.`);
                    return t;
                  }}
                  onCreateProject={s.createProject}
                />
                {mode === "manual" && view.kind !== "upcoming" && !s.search && (
                  <p className="mode-note">Manual order: drag to arrange. Nothing moves unless you move it.</p>
                )}
                <TaskList
                  groups={groups}
                  scores={scores}
                  projects={s.projects}
                  showReasons={mode === "recommended"}
                  hideProject={view.kind === "project"}
                  empty={empty}
                />
                {view.kind === "project" && <ProjectCompleted projectId={view.projectId} />}
              </>
            )}
            {view.kind === "completed" && <CompletedView />}
            {view.kind === "settings" && <SettingsView />}
          </div>
        </main>
        {isList && scheduleOpen && <SchedulePanel onClose={() => void s.setSetting("scheduleOpen", "0")} />}
        <DetailPanel />
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="drag-ghost">
            {dragging.title}
            {dragging.estimateMin ? <span className="muted"> · {dragging.estimateMin}m</span> : null}
          </div>
        )}
      </DragOverlay>
      <Prompts />
      <Toasts />
    </DndContext>
  );
}

/** A project's completed tasks, collapsed by default. */
function ProjectCompleted({ projectId }: { projectId: string }) {
  const version = useStore((s) => s.completedVersion);
  const uncomplete = useStore((s) => s.uncomplete);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Task[]>([]);
  useEffect(() => {
    if (!open) return;
    void api.listCompleted(null, null, 2000).then((all) => setItems(all.filter((t) => t.projectId === projectId)));
  }, [open, projectId, version]);
  return (
    <section className="project-completed">
      <button type="button" className="disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} completed
      </button>
      {open &&
        (items.length ? (
          items.map((t) => (
            <div key={t.id} className="task-row is-done">
              <span className="check is-checked" aria-hidden>
                <CircleCheck size={16} />
              </span>
              <div className="task-main">
                <span className="task-title">{t.title}</span>
              </div>
              <div className="task-meta always">
                <span className="meta muted">{localDate(new Date(t.completedAt!))}</span>
                <button type="button" className="row-action" onClick={() => void uncomplete(t)} aria-label={`Mark ${t.title} as not done`} title="Mark as not done">
                  ↺
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="muted small">No completed tasks yet.</p>
        ))}
    </section>
  );
}
