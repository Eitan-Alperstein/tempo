import { useState } from "react";
import { formatDuration } from "../lib/time";
import { elapsedSec } from "../lib/timer";
import { useStore } from "../store";
import { Button, Dialog } from "./ui";

export function Prompts() {
  const prompt = useStore((s) => s.prompt);
  const setPrompt = useStore((s) => s.setPrompt);
  const close = () => setPrompt(null);
  if (!prompt) return null;
  switch (prompt.kind) {
    case "complete-subtasks":
      return <CompleteSubtasks taskId={prompt.taskId} onClose={close} />;
    case "focus-ended":
      return <FocusEnded onClose={close} />;
    case "recommended-drag":
      return <RecommendedDrag onClose={close} />;
    case "delete-project":
      return <DeleteProject projectId={prompt.projectId} onClose={close} />;
  }
}

function CompleteSubtasks({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const complete = useStore((s) => s.complete);
  if (!task) return null;
  const open = task.subtasks.filter((s) => !s.done).length;
  return (
    <Dialog
      title={`Complete “${task.title}”?`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onClose();
              void complete(task.id, false);
            }}
          >
            Leave them unchecked
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              void complete(task.id, true);
            }}
          >
            Check them all off
          </Button>
        </>
      }
    >
      {open} subtask{open === 1 ? " isn't" : "s aren't"} done yet. The checklist is kept in your history either way.
    </Dialog>
  );
}

function FocusEnded({ onClose }: { onClose: () => void }) {
  const prompt = useStore((s) => s.prompt);
  const session = prompt?.kind === "focus-ended" ? prompt.session : null;
  const task = useStore((s) => s.tasks.find((t) => t.id === session?.taskId));
  const requestComplete = useStore((s) => s.requestComplete);
  const startBreak = useStore((s) => s.startBreak);
  const startFocus = useStore((s) => s.startFocus);
  if (!session) return null;
  const minutes = Math.round(elapsedSec(session, new Date()) / 60);

  if (session.kind !== "focus") {
    return (
      <Dialog
        title="Break's over"
        onClose={onClose}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Not now
            </Button>
            <Button variant="primary" onClick={() => void startFocus(task?.id ?? null)}>
              Start focusing
            </Button>
          </>
        }
      />
    );
  }
  return (
    <Dialog
      title="Focus session complete"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void startFocus(task?.id ?? null)}>Keep going</Button>
          <Button onClick={() => void startBreak()}>Take a break</Button>
          {task && (
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                requestComplete(task.id);
              }}
            >
              Mark task done
            </Button>
          )}
        </>
      }
    >
      {formatDuration(minutes) || "Less than a minute"} of focus
      {task ? (
        <>
          {" "}
          on <strong>{task.title}</strong>. Is it done? Tempo won't mark it complete unless you say so.
        </>
      ) : (
        "."
      )}
    </Dialog>
  );
}

function RecommendedDrag({ onClose }: { onClose: () => void }) {
  const prompt = useStore((s) => s.prompt);
  const task = useStore((s) => s.tasks.find((t) => prompt?.kind === "recommended-drag" && t.id === prompt.taskId));
  const pinAt = useStore((s) => s.pinAt);
  const switchToManualWith = useStore((s) => s.switchToManualWith);
  if (prompt?.kind !== "recommended-drag" || !task) return null;
  return (
    <Dialog
      title="Keep it here?"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onClose();
              void switchToManualWith(prompt.manualIds);
            }}
          >
            Switch to manual order
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              void pinAt(task.id, prompt.pinIds);
            }}
          >
            Pin to top
          </Button>
        </>
      }
    >
      Recommended order is sorted automatically. You can <strong>pin</strong> “{task.title}” so it stays at the top, or switch to
      manual order and arrange everything yourself.
    </Dialog>
  );
}

function DeleteProject({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const projects = useStore((s) => s.projects);
  const activeCount = useStore((s) => s.tasks.filter((t) => t.projectId === projectId).length);
  const deleteProject = useStore((s) => s.deleteProject);
  const [moveTo, setMoveTo] = useState("");
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;
  return (
    <Dialog
      title={`Delete “${project.name}”?`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onClose();
              void deleteProject(projectId, moveTo || null);
            }}
          >
            Delete project
          </Button>
        </>
      }
    >
      <p>
        Its tasks won't be deleted{activeCount ? ` (${activeCount} active)` : ""}, including completed ones in your history.
      </p>
      <label className="inline-field">
        Move its tasks to{" "}
        <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} data-autofocus>
          <option value="">No project</option>
          {projects
            .filter((p) => p.id !== projectId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
    </Dialog>
  );
}
