import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, Check, Clock, GripVertical, ListChecks, Pin, Play, Repeat } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { ScoreBreakdown } from "../lib/score";
import { formatBlock, formatDue, formatDuration } from "../lib/time";
import type { Project, Task } from "../lib/types";
import { isOverdue } from "../lib/views";
import { ImportanceBars } from "./ui";

interface Props {
  task: Task;
  groupId: string;
  project?: Project;
  score?: ScoreBreakdown;
  showReason: boolean;
  selected: boolean;
  now: Date;
  focusing: boolean;
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onFocus: (id: string) => void;
}

export const TaskRow = memo(function TaskRow(p: Props) {
  const { task: t, now } = p;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: `${p.groupId}:${t.id}`,
    data: { taskId: t.id, groupId: p.groupId },
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(t.title);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (p.selected && !editing) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [p.selected, editing]);

  const overdue = isOverdue(t, now);
  const done = t.subtasks.filter((s) => s.done).length;
  const reason = p.showReason ? p.score?.reasons[0] : undefined;
  const scoreLabel = p.score ? Math.round(p.score.score * 100) : null;

  function commit() {
    setEditing(false);
    const title = draft.trim();
    if (title && title !== t.title) p.onRename(t.id, title);
    else setDraft(t.title);
  }

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        rowRef.current = el;
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`task-row ${p.selected ? "is-selected" : ""} ${isDragging ? "is-dragging" : ""} ${p.focusing ? "is-focusing" : ""}`}
      role="option"
      aria-selected={p.selected}
      data-task-id={t.id}
      onClick={() => p.onOpen(t.id)}
    >
      <button
        type="button"
        className="drag-handle"
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        aria-label={`Reorder ${t.title}`}
        tabIndex={-1}
      >
        <GripVertical size={14} aria-hidden />
      </button>
      <button
        type="button"
        className="check"
        aria-label={`Complete ${t.title}`}
        title="Complete (⌘↩)"
        onClick={(e) => {
          e.stopPropagation();
          p.onComplete(t.id);
        }}
      >
        <Check size={11} strokeWidth={3} aria-hidden />
      </button>

      <div className="task-main">
        {editing ? (
          <input
            className="task-title-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(t.title);
                setEditing(false);
              }
              e.stopPropagation();
            }}
            aria-label="Task title"
          />
        ) : (
          <span
            className="task-title"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraft(t.title);
              setEditing(true);
            }}
          >
            {t.title}
          </span>
        )}
        {reason && !editing && <span className="task-reason">{reason}</span>}
      </div>

      <div className="task-meta">
        {t.pinned && (
          <span className="meta pin" title="Pinned to the top of Recommended order">
            <Pin size={12} aria-label="Pinned" />
          </span>
        )}
        {t.recurrence && (
          <span className="meta" title="Repeats">
            <Repeat size={12} aria-label="Repeats" />
          </span>
        )}
        {t.subtasks.length > 0 && (
          <span className="meta" title={`${done} of ${t.subtasks.length} subtasks done`}>
            <ListChecks size={12} aria-hidden /> {done}/{t.subtasks.length}
          </span>
        )}
        {p.project && (
          <span className="meta project-tag" title={`Project: ${p.project.name}`}>
            <i style={{ background: p.project.color }} aria-hidden />
            {p.project.name}
          </span>
        )}
        {t.schedStart && t.schedEnd && (
          <span className="meta" title="Scheduled">
            <CalendarClock size={12} aria-hidden /> {formatBlock(new Date(t.schedStart), new Date(t.schedEnd), now)}
          </span>
        )}
        {t.dueDate && (
          <span className={`meta due ${overdue ? "is-overdue" : ""}`} title={overdue ? "Overdue" : "Due"}>
            {overdue ? "Overdue · " : ""}
            {formatDue(t, now)}
          </span>
        )}
        {t.estimateMin && (
          <span className="meta estimate" title="Estimated time">
            <Clock size={12} aria-hidden /> {formatDuration(t.estimateMin)}
          </span>
        )}
        <ImportanceBars value={t.importance} />
        {scoreLabel !== null && (
          <span className="score" title={`Priority score ${scoreLabel}/100${p.score?.reasons.length ? ` — ${p.score.reasons.join(", ")}` : ""}`}>
            {scoreLabel}
          </span>
        )}
        <button
          type="button"
          className="row-action"
          aria-label={`Start focus on ${t.title}`}
          title="Start focus (⌘T)"
          onClick={(e) => {
            e.stopPropagation();
            p.onFocus(t.id);
          }}
        >
          <Play size={12} aria-hidden />
        </button>
      </div>
    </div>
  );
});
