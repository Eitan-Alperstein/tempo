import { CalendarClock, Pin, PinOff, Play, Trash2, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { usePlanning } from "../hooks/usePlanning";
import { describeRecurrence } from "../lib/recurrence";
import { DEFAULT_BLOCK_MIN, conflictsFor, eventBlock, taskBlock, type Block } from "../lib/schedule";
import { atLocalTime, format, formatDuration, hm, localDate, MINUTE } from "../lib/time";
import type { Recurrence, Task, Weekday } from "../lib/types";
import { useStore } from "../store";
import { Subtasks } from "./Subtasks";
import { Button, IconButton, Segmented } from "./ui";

const ESTIMATE_PRESETS = [15, 30, 45, 60, 90, 120];
const IMPORTANCE_LABELS = ["", "Minimal", "Low", "Normal", "High", "Top"];
const WEEKDAYS: { d: Weekday; label: string }[] = [
  { d: 1, label: "M" },
  { d: 2, label: "T" },
  { d: 3, label: "W" },
  { d: 4, label: "T" },
  { d: 5, label: "F" },
  { d: 6, label: "S" },
  { d: 0, label: "S" },
];

export function DetailPanel() {
  const detailId = useStore((s) => s.detailId);
  const task = useStore((s) => s.tasks.find((t) => t.id === detailId));
  if (!task) return null;
  return <Detail key={task.id} task={task} />;
}

function Detail({ task: t }: { task: Task }) {
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const events = useStore((s) => s.calendarEvents);
  const session = useStore((s) => s.session);
  const patchTask = useStore((s) => s.patchTask);
  const openDetail = useStore((s) => s.openDetail);
  const togglePin = useStore((s) => s.togglePin);
  const deleteTask = useStore((s) => s.deleteTask);
  const requestComplete = useStore((s) => s.requestComplete);
  const startFocus = useStore((s) => s.startFocus);
  const { scores } = usePlanning();
  const score = scores.get(t.id);

  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes);
  const patch = (p: Partial<Task>) => void patchTask(t.id, p);

  const block = taskBlock(t);
  const conflicts = useMemo(() => {
    if (!block) return [];
    const others = [...tasks.map(taskBlock), ...events.map(eventBlock)].filter((b): b is Block => b !== null);
    return conflictsFor(block, others, t.id);
  }, [block, tasks, events, t.id]);

  function setSchedule(date: string | null, start: string, end: string) {
    if (!date) return patch({ schedStart: null, schedEnd: null });
    const s = atLocalTime(date, start);
    let e = atLocalTime(date, end);
    if (+e <= +s) e = new Date(+s + (t.estimateMin ?? DEFAULT_BLOCK_MIN) * MINUTE);
    patch({ schedStart: s.toISOString(), schedEnd: e.toISOString() });
  }

  function addSchedule() {
    // Next round half hour, as long as the estimate.
    const now = new Date();
    const s = new Date(Math.ceil(+now / (30 * MINUTE)) * 30 * MINUTE);
    const e = new Date(+s + (t.estimateMin ?? DEFAULT_BLOCK_MIN) * MINUTE);
    patch({ schedStart: s.toISOString(), schedEnd: e.toISOString() });
  }

  const blockMin = block ? Math.round((+block.end - +block.start) / MINUTE) : 0;
  const isFocusing = session?.taskId === t.id;

  return (
    <aside className="detail" aria-label="Task details">
      <header className="detail-header">
        <button type="button" className="check big" aria-label={`Complete ${t.title}`} title="Complete (⌘↩)" onClick={() => requestComplete(t.id)} />
        <textarea
          className="detail-title"
          value={title}
          rows={1}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
          onBlur={() => (title.trim() && title !== t.title ? patch({ title: title.trim() }) : setTitle(t.title))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          aria-label="Title"
        />
        <IconButton label="Close details" shortcut="Esc" onClick={() => openDetail(null)}>
          <X size={16} />
        </IconButton>
      </header>

      <div className="detail-body">
        {score && (
          <p className="why">
            <span className="score-badge" title="Priority score, 0–100">
              {Math.round(score.score * 100)}
            </span>
            {score.reasons.length ? score.reasons.join(" · ") : "No deadline or special importance"}
            {t.pinned && " · Pinned"}
          </p>
        )}

        <div className="field">
          <span className="field-label">Importance</span>
          <Segmented
            label="Importance"
            value={t.importance}
            onChange={(v) => patch({ importance: v })}
            options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v), title: IMPORTANCE_LABELS[v] }))}
          />
          <span className="field-hint">{IMPORTANCE_LABELS[t.importance]}</span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="est">
            Estimate
          </label>
          <div className="row-inputs">
            <input
              id="est"
              type="number"
              min={1}
              step={5}
              className="num"
              value={t.estimateMin ?? ""}
              placeholder="—"
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                patch({ estimateMin: Number.isFinite(v) && v > 0 ? v : null });
              }}
            />
            <span className="muted">min</span>
            <div className="presets">
              {ESTIMATE_PRESETS.map((m) => (
                <button key={m} type="button" className={`preset ${t.estimateMin === m ? "is-on" : ""}`} onClick={() => patch({ estimateMin: m })}>
                  {formatDuration(m)}
                </button>
              ))}
            </div>
          </div>
          {t.focusSec > 0 && (
            <span className="field-hint">
              Focused {formatDuration(Math.round(t.focusSec / 60))}
              {t.estimateMin ? ` of ${formatDuration(t.estimateMin)} estimated` : ""}
            </span>
          )}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="due">
            Due
          </label>
          <div className="row-inputs">
            <input
              id="due"
              type="date"
              value={t.dueDate ?? ""}
              onChange={(e) => patch({ dueDate: e.target.value || null, dueTime: e.target.value ? t.dueTime : null })}
            />
            <input
              type="time"
              aria-label="Due time"
              value={t.dueTime ?? ""}
              disabled={!t.dueDate}
              onChange={(e) => patch({ dueTime: e.target.value || null })}
            />
            {t.dueDate && (
              <IconButton label="Clear due date" className="subtle" onClick={() => patch({ dueDate: null, dueTime: null })}>
                <X size={12} />
              </IconButton>
            )}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Scheduled</span>
          {block ? (
            <>
              <div className="row-inputs">
                <input
                  type="date"
                  aria-label="Scheduled date"
                  value={localDate(block.start)}
                  onChange={(e) => setSchedule(e.target.value || null, hm(block.start), hm(block.end))}
                />
                <input type="time" aria-label="Start" value={hm(block.start)} onChange={(e) => e.target.value && setSchedule(localDate(block.start), e.target.value, hm(block.end))} />
                <span className="muted">–</span>
                <input type="time" aria-label="End" value={hm(block.end)} onChange={(e) => e.target.value && setSchedule(localDate(block.start), hm(block.start), e.target.value)} />
                <IconButton label="Unschedule" className="subtle" onClick={() => patch({ schedStart: null, schedEnd: null })}>
                  <X size={12} />
                </IconButton>
              </div>
              <span className="field-hint">
                {formatDuration(blockMin)} block
                {t.estimateMin && t.estimateMin !== blockMin ? ` · estimate is ${formatDuration(t.estimateMin)}` : ""}
              </span>
              {conflicts.length > 0 && (
                <p className="warn" role="status">
                  <TriangleAlert size={12} aria-hidden /> Overlaps {conflicts.map((c) => `${c.kind === "event" ? "event " : ""}“${c.title}”`).join(", ")}
                </p>
              )}
            </>
          ) : (
            <Button variant="ghost" className="inline" onClick={addSchedule}>
              <CalendarClock size={13} aria-hidden /> Add a time block
            </Button>
          )}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="proj">
            Project
          </label>
          <select id="proj" value={t.projectId ?? ""} onChange={(e) => patch({ projectId: e.target.value || null })}>
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <RecurrenceField value={t.recurrence} onChange={(recurrence) => patch({ recurrence })} />

        <Subtasks task={t} />

        <div className="field">
          <label className="field-label" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            className="notes"
            value={notes}
            placeholder="Add notes"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== t.notes && patch({ notes })}
          />
        </div>

        <p className="timestamps">
          Created {format(new Date(t.createdAt), "MMM d, h:mm a")} · Updated {format(new Date(t.updatedAt), "MMM d, h:mm a")}
        </p>
      </div>

      <footer className="detail-footer">
        <Button variant="primary" onClick={() => void startFocus(t.id)} disabled={isFocusing}>
          <Play size={13} aria-hidden /> {isFocusing ? "Focusing" : "Focus"}
        </Button>
        <Button onClick={() => void togglePin(t.id)} title="Pinned tasks stay at the top of Recommended order (⇧⌘P)">
          {t.pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />} {t.pinned ? "Unpin" : "Pin"}
        </Button>
        <span className="spacer" />
        <IconButton label="Delete task" shortcut="⌘⌫" onClick={() => void deleteTask(t.id)}>
          <Trash2 size={15} />
        </IconButton>
      </footer>
    </aside>
  );
}

function RecurrenceField({ value, onChange }: { value: Recurrence | null; onChange: (r: Recurrence | null) => void }) {
  const freq = value?.freq ?? "none";
  const set = (r: Partial<Recurrence>) => onChange({ from: "due", ...(value ?? {}), ...r } as Recurrence);
  return (
    <div className="field">
      <label className="field-label" htmlFor="repeat">
        Repeat
      </label>
      <div className="row-inputs">
        <select
          id="repeat"
          value={freq}
          onChange={(e) => {
            const f = e.target.value;
            if (f === "none") onChange(null);
            else if (f === "weekly") set({ freq: "weekly", days: value?.days?.length ? value.days : [new Date().getDay() as Weekday] });
            else if (f === "monthly") set({ freq: "monthly", monthDay: value?.monthDay ?? new Date().getDate() });
            else if (f === "interval") set({ freq: "interval", interval: value?.interval ?? 2 });
            else set({ freq: f as Recurrence["freq"] });
          }}
        >
          <option value="none">Never</option>
          <option value="daily">Every day</option>
          <option value="weekdays">Every weekday</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="interval">Every N days</option>
        </select>
        {value?.freq === "interval" && (
          <>
            <input
              type="number"
              className="num"
              min={1}
              aria-label="Days between"
              value={value.interval ?? 2}
              onChange={(e) => set({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            />
            <span className="muted">days</span>
          </>
        )}
        {value?.freq === "monthly" && (
          <>
            <span className="muted">on day</span>
            <input
              type="number"
              className="num"
              min={1}
              max={31}
              aria-label="Day of month"
              value={value.monthDay ?? 1}
              onChange={(e) => set({ monthDay: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
            />
          </>
        )}
      </div>
      {value?.freq === "weekly" && (
        <div className="weekdays" role="group" aria-label="Repeat on">
          {WEEKDAYS.map(({ d, label }) => {
            const on = value.days?.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d]}
                className={on ? "is-on" : ""}
                onClick={() => {
                  const days = new Set(value.days ?? []);
                  if (on) days.delete(d);
                  else days.add(d);
                  if (days.size) set({ days: [...days].sort() as Weekday[] });
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {value && (
        <div className="row-inputs">
          <span className="field-hint">{describeRecurrence(value)}, counted from the</span>
          <select aria-label="Count from" value={value.from} onChange={(e) => set({ from: e.target.value as Recurrence["from"] })}>
            <option value="due">due date</option>
            <option value="completion">completion date</option>
          </select>
        </div>
      )}
    </div>
  );
}
