import { useDroppable } from "@dnd-kit/core";
import { CalendarDays, ChevronLeft, ChevronRight, TriangleAlert, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { eventBlock, findConflicts, snap, taskBlock, type Block } from "../lib/schedule";
import { MINUTE, addDays, atLocalTime, formatTime, isSameDay, localDate, parseLocalDate, relativeDay } from "../lib/time";
import { useStore } from "../store";
import { IconButton } from "./ui";

export const START_HOUR = 6;
export const END_HOUR = 24;
export const HOUR_PX = 48;

/** Shared with the app-level drag handler so list rows can be dropped onto the timeline. */
export const timeline = { el: null as HTMLElement | null, day: localDate(new Date()) };

/** The time at a vertical screen position on the timeline, snapped to 15 minutes. */
export function timeAtY(clientY: number): Date | null {
  if (!timeline.el) return null;
  const rect = timeline.el.getBoundingClientRect();
  const minutes = ((clientY - rect.top) / HOUR_PX) * 60 + START_HOUR * 60;
  const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 15, minutes));
  const d = parseLocalDate(timeline.day);
  return snap(new Date(+d + clamped * MINUTE));
}

/** Side-by-side columns for overlapping blocks. */
function layout(blocks: Block[]): Map<string, { col: number; cols: number }> {
  const sorted = [...blocks].sort((a, b) => +a.start - +b.start || +b.end - +a.end);
  const out = new Map<string, { col: number; cols: number }>();
  let cluster: Block[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const colEnds: number[] = [];
    const assigned: [Block, number][] = [];
    for (const b of cluster) {
      let col = colEnds.findIndex((end) => end <= +b.start);
      if (col === -1) col = colEnds.length;
      colEnds[col] = +b.end;
      assigned.push([b, col]);
    }
    for (const [b, col] of assigned) out.set(b.id, { col, cols: colEnds.length });
    cluster = [];
  };
  for (const b of sorted) {
    if (cluster.length && +b.start >= clusterEnd) flush();
    clusterEnd = cluster.length ? Math.max(clusterEnd, +b.end) : +b.end;
    cluster.push(b);
  }
  if (cluster.length) flush();
  return out;
}

const minutesOf = (d: Date, day: Date) => (+d - +day) / MINUTE;

export function SchedulePanel({ onClose }: { onClose: () => void }) {
  const day = useStore((s) => s.scheduleDay);
  const setDay = useStore((s) => s.setScheduleDay);
  const tasks = useStore((s) => s.tasks);
  const events = useStore((s) => s.calendarEvents);
  const settings = useStore((s) => s.settings);
  const calendarError = useStore((s) => s.calendarError);
  const now = useStore((s) => s.now);
  const patchTask = useStore((s) => s.patchTask);
  const openDetail = useStore((s) => s.openDetail);
  const setView = useStore((s) => s.setView);

  const { setNodeRef, isOver } = useDroppable({ id: "timeline" });
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dayStart = parseLocalDate(day);
  timeline.day = day;

  const dayEvents = events.filter((e) => localDate(new Date(e.start)) === day || (e.allDay && e.start.slice(0, 10) <= day && e.end.slice(0, 10) >= day));
  const allDay = dayEvents.filter((e) => e.allDay);
  const blocks = useMemo(
    () =>
      [...tasks.map(taskBlock), ...dayEvents.map(eventBlock)].filter(
        (b): b is Block => b !== null && isSameDay(b.start, dayStart),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, events, day],
  );

  // Live preview while dragging or resizing a block.
  const [drag, setDrag] = useState<{ id: string; start: Date; end: Date } | null>(null);
  const shown = blocks.map((b) => (drag && b.id === drag.id ? { ...b, start: drag.start, end: drag.end } : b));
  const conflicts = findConflicts(shown);
  const cols = layout(shown);

  useLayoutEffect(() => {
    // Open scrolled to the start of the workday (or now, if later).
    const el = scrollRef.current;
    if (!el) return;
    const ref = isSameDay(dayStart, new Date()) ? Math.max(new Date().getHours() - 1, 0) : 0;
    const startH = Math.max(parseInt(settings.workdayStart, 10) || 9, ref) - 0.5;
    el.scrollTop = Math.max(0, (startH - START_HOUR) * HOUR_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  useEffect(() => () => void (timeline.el = null), []);

  function beginDrag(e: React.PointerEvent, b: Block, mode: "move" | "resize") {
    if (b.kind !== "task" || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    let moved = false;
    let latest = { id: b.id, start: b.start, end: b.end };
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 3) moved = true;
      const deltaMin = Math.round(((dy / HOUR_PX) * 60) / 15) * 15;
      if (mode === "move") {
        latest = { id: b.id, start: new Date(+b.start + deltaMin * MINUTE), end: new Date(+b.end + deltaMin * MINUTE) };
      } else {
        const end = new Date(Math.max(+b.start + 15 * MINUTE, +b.end + deltaMin * MINUTE));
        latest = { id: b.id, start: b.start, end };
      }
      setDrag(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      if (!moved) {
        openDetail(b.id);
        return;
      }
      if (+latest.start !== +b.start || +latest.end !== +b.end) {
        void patchTask(b.id, { schedStart: latest.start.toISOString(), schedEnd: latest.end.toISOString() });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const isToday = isSameDay(dayStart, now);
  const nowTop = (minutesOf(now, dayStart) / 60 - START_HOUR) * HOUR_PX;
  const workTop = (minutesOf(atLocalTime(day, settings.workdayStart), dayStart) / 60 - START_HOUR) * HOUR_PX;
  const workBottom = (minutesOf(atLocalTime(day, settings.workdayEnd), dayStart) / 60 - START_HOUR) * HOUR_PX;
  const conflictCount = conflicts.pairs.length;

  return (
    <aside className="schedule" aria-label="Day schedule">
      <header className="schedule-header">
        <div className="day-nav">
          <IconButton label="Previous day" onClick={() => setDay(localDate(addDays(dayStart, -1)))}>
            <ChevronLeft size={15} />
          </IconButton>
          <button type="button" className="day-label" onClick={() => setDay(localDate(new Date()))} title="Go to today">
            {relativeDay(dayStart, now)}
          </button>
          <IconButton label="Next day" onClick={() => setDay(localDate(addDays(dayStart, 1)))}>
            <ChevronRight size={15} />
          </IconButton>
        </div>
        <IconButton label="Close schedule" shortcut="⇧⌘D" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </header>
      {conflictCount > 0 && (
        <p className="schedule-warning" role="status">
          <TriangleAlert size={12} aria-hidden /> {conflictCount} overlap{conflictCount === 1 ? "" : "s"}:{" "}
          {conflicts.pairs
            .slice(0, 2)
            .map(([a, b]) => `“${a.title}” and “${b.title}”`)
            .join("; ")}
          {conflictCount > 2 ? "…" : ""}
        </p>
      )}
      {settings.calendar !== "1" ? (
        <p className="schedule-note">
          <CalendarDays size={12} aria-hidden /> Calendar events are off.{" "}
          <button type="button" className="link" onClick={() => setView({ kind: "settings" })}>
            Turn on in Settings
          </button>
        </p>
      ) : calendarError ? (
        <p className="schedule-note">
          <CalendarDays size={12} aria-hidden /> {calendarError}
        </p>
      ) : null}
      {allDay.length > 0 && (
        <div className="all-day">
          {allDay.map((e) => (
            <span key={e.id} className="all-day-event" title={`${e.calendar} · all day`}>
              {e.title}
            </span>
          ))}
        </div>
      )}
      <div className="schedule-scroll" ref={scrollRef}>
        <div
          className={`timeline ${isOver ? "is-over" : ""}`}
          style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}
          ref={(el) => {
            setNodeRef(el);
            gridRef.current = el;
            timeline.el = el;
          }}
        >
          <div className="work-hours" style={{ top: workTop, height: Math.max(0, workBottom - workTop) }} aria-hidden />
          {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
            <div key={i} className="hour" style={{ top: i * HOUR_PX }}>
              <span>{formatTime(new Date(2000, 0, 1, START_HOUR + i))}</span>
            </div>
          ))}
          {shown.map((b) => {
            const top = (minutesOf(b.start, dayStart) / 60 - START_HOUR) * HOUR_PX;
            const height = Math.max(18, ((+b.end - +b.start) / MINUTE / 60) * HOUR_PX - 2);
            const c = cols.get(b.id) ?? { col: 0, cols: 1 };
            const conflict = conflicts.ids.has(b.id);
            return (
              <div
                key={b.id}
                className={`block block-${b.kind} ${conflict ? "is-conflict" : ""} ${drag?.id === b.id ? "is-dragging" : ""}`}
                style={{
                  top,
                  height,
                  left: `calc(var(--gutter) + (100% - var(--gutter)) * ${c.col / c.cols})`,
                  width: `calc((100% - var(--gutter)) / ${c.cols} - 3px)`,
                }}
                title={`${b.kind === "event" ? "Calendar event (busy)" : "Task"}: ${b.title}, ${formatTime(b.start)}–${formatTime(b.end)}${conflict ? " — overlaps another block" : ""}`}
                onPointerDown={(e) => beginDrag(e, b, "move")}
                role={b.kind === "task" ? "button" : undefined}
                tabIndex={b.kind === "task" ? 0 : undefined}
                onKeyDown={(e) => b.kind === "task" && e.key === "Enter" && openDetail(b.id)}
              >
                <span className="block-title">
                  {conflict && <TriangleAlert size={11} aria-label="Overlap" />}
                  {b.kind === "event" && <CalendarDays size={11} aria-label="Calendar event" />}
                  {b.title}
                </span>
                {height > 30 && (
                  <span className="block-time">
                    {formatTime(b.start)}–{formatTime(b.end)}
                  </span>
                )}
                {b.kind === "task" && <span className="resize" onPointerDown={(e) => beginDrag(e, b, "resize")} aria-hidden />}
              </div>
            );
          })}
          {isToday && nowTop >= 0 && (
            <div className="now-line" style={{ top: nowTop }} aria-label={`Now, ${formatTime(now)}`}>
              <i />
            </div>
          )}
        </div>
      </div>
      <p className="schedule-foot">Drag a task here to give it a time. Drag blocks to move; drag the bottom edge to resize.</p>
    </aside>
  );
}
