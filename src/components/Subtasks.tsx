import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, X } from "lucide-react";
import { useState } from "react";
import type { Subtask, Task } from "../lib/types";
import { useStore } from "../store";

function SubtaskItem({ s }: { s: Subtask }) {
  const updateSubtask = useStore((st) => st.updateSubtask);
  const deleteSubtask = useStore((st) => st.deleteSubtask);
  const [draft, setDraft] = useState(s.title);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });

  function commit() {
    const title = draft.trim();
    if (!title) setDraft(s.title);
    else if (title !== s.title) void updateSubtask(s.id, title, s.done);
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`subtask ${s.done ? "is-done" : ""} ${isDragging ? "is-dragging" : ""}`}
    >
      <button type="button" className="drag-handle" ref={setActivatorNodeRef} {...listeners} {...attributes} aria-label={`Reorder ${s.title}`}>
        <GripVertical size={12} aria-hidden />
      </button>
      <input
        type="checkbox"
        checked={s.done}
        onChange={(e) => void updateSubtask(s.id, s.title, e.target.checked)}
        aria-label={`Done: ${s.title}`}
      />
      <input
        className="subtask-title"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(s.title);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Subtask title"
      />
      <button type="button" className="icon-btn subtle" aria-label={`Delete ${s.title}`} onClick={() => void deleteSubtask(s.id)}>
        <X size={12} aria-hidden />
      </button>
    </li>
  );
}

export function Subtasks({ task }: { task: Task }) {
  const addSubtask = useStore((s) => s.addSubtask);
  const reorderSubtasks = useStore((s) => s.reorderSubtasks);
  const [draft, setDraft] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const done = task.subtasks.filter((s) => s.done).length;

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = task.subtasks.map((s) => s.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    void reorderSubtasks(task.id, next);
  }

  return (
    <div className="subtasks">
      <div className="field-label">
        Subtasks
        {task.subtasks.length > 0 && (
          <span className="muted">
            {" "}
            {done}/{task.subtasks.length}
          </span>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={task.subtasks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul>
            {task.subtasks.map((s) => (
              <SubtaskItem key={s.id} s={s} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <form
        className="subtask-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          void addSubtask(task.id, draft);
          setDraft("");
        }}
      >
        <Plus size={12} aria-hidden />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a step" aria-label="New subtask" />
      </form>
    </div>
  );
}
