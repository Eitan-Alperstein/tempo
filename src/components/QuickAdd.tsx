import { CalendarClock, CalendarDays, Clock, Flag, Folder, Plus, Repeat, TriangleAlert } from "lucide-react";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { parseTaskInput, type ParsedTask } from "../lib/parse";
import { DEFAULT_BLOCK_MIN } from "../lib/schedule";
import { atLocalTime, formatBlock, formatDue, formatDuration, localDate, MINUTE } from "../lib/time";
import type { Project, TaskInput } from "../lib/types";
import { PROJECT_COLORS } from "./ui";

export interface QuickAddDefaults {
  dueDate?: string;
  projectId?: string;
  /** Explains a default in the preview, e.g. "from Today". */
  note?: string;
}

interface Props {
  projects: Project[];
  now: Date;
  defaults?: QuickAddDefaults;
  onSubmit: (input: TaskInput) => Promise<unknown>;
  onCreateProject: (name: string, color: string) => Promise<Project | null>;
  onCancel?: () => void;
  autoFocus?: boolean;
}

export interface QuickAddHandle {
  focus(): void;
}

/** Turn the parse result (plus the user's choice for an ambiguous time) into task fields. */
export function toTaskInput(p: ParsedTask, timeAsBlock: boolean, defaults: QuickAddDefaults = {}): TaskInput {
  const input: TaskInput = {
    title: p.title,
    estimateMin: p.estimateMin ?? null,
    importance: p.importance ?? 3,
    projectId: p.projectId ?? defaults.projectId ?? null,
    dueDate: p.dueDate ?? null,
    dueTime: p.dueTime ?? null,
  };
  if (p.schedDate && p.schedStartTime && p.schedEndTime) {
    input.schedStart = atLocalTime(p.schedDate, p.schedStartTime).toISOString();
    input.schedEnd = atLocalTime(p.schedDate, p.schedEndTime).toISOString();
  } else if (timeAsBlock && p.dueDate && p.dueTime) {
    const start = atLocalTime(p.dueDate, p.dueTime);
    input.schedStart = start.toISOString();
    input.schedEnd = new Date(+start + (p.estimateMin ?? DEFAULT_BLOCK_MIN) * MINUTE).toISOString();
    input.dueDate = null;
    input.dueTime = null;
  }
  if (!input.dueDate && !input.schedStart && defaults.dueDate) input.dueDate = defaults.dueDate;
  return input;
}

export const QuickAdd = forwardRef<QuickAddHandle, Props>(function QuickAdd(
  { projects, now, defaults, onSubmit, onCreateProject, onCancel, autoFocus },
  ref,
) {
  const [text, setText] = useState("");
  const [timeAsBlock, setTimeAsBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const parsed = useMemo(() => (text.trim() ? parseTaskInput(text, { now, projects }) : null), [text, now, projects]);
  const input = parsed ? toTaskInput(parsed, timeAsBlock, defaults) : null;
  const project = input?.projectId ? projects.find((p) => p.id === input.projectId) : undefined;

  async function submit() {
    if (!input || busy) return;
    setBusy(true);
    const ok = await onSubmit(input);
    setBusy(false);
    if (ok) {
      setText("");
      setTimeAsBlock(false);
    }
  }

  async function createProject(name: string) {
    const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
    // Once the project exists, the same #tag resolves to it on the next parse.
    await onCreateProject(name, color);
    inputRef.current?.focus();
  }

  const timeRole = parsed?.ambiguities.find((a) => a.kind === "time-role");

  return (
    <div className="quick-add">
      <div className="quick-add-field">
        <Plus size={16} aria-hidden className="quick-add-icon" />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (text) setText("");
              else {
                inputRef.current?.blur();
                onCancel?.();
              }
            }
          }}
          placeholder="Add a task — e.g. “Essay Friday 2h #school !”"
          aria-label="New task"
          spellCheck={false}
        />
        {text && (
          <span className="quick-add-hint" aria-hidden>
            ↩ to add
          </span>
        )}
      </div>
      {parsed && input && (
        <div className="parse-preview" aria-live="polite">
          {input.dueDate && (
            <span className="chip">
              <CalendarDays size={12} aria-hidden /> Due {formatDue({ dueDate: input.dueDate, dueTime: input.dueTime ?? null }, now)}
              {!parsed.dueDate && defaults?.note && <em> {defaults.note}</em>}
            </span>
          )}
          {input.schedStart && input.schedEnd && (
            <span className="chip">
              <CalendarClock size={12} aria-hidden /> {formatBlock(new Date(input.schedStart), new Date(input.schedEnd), now)}
            </span>
          )}
          {input.estimateMin && (
            <span className="chip">
              <Clock size={12} aria-hidden /> {formatDuration(input.estimateMin)}
            </span>
          )}
          {parsed.importance && (
            <span className="chip">
              <Flag size={12} aria-hidden /> Importance {parsed.importance}
            </span>
          )}
          {project && (
            <span className="chip">
              <Folder size={12} aria-hidden style={{ color: project.color }} /> {project.name}
            </span>
          )}
          {timeRole && (
            <button type="button" className="chip chip-action" onClick={() => setTimeAsBlock((v) => !v)}>
              <Repeat size={12} aria-hidden /> {timeAsBlock ? "Make it a deadline" : "Schedule a block instead"}
            </button>
          )}
          {parsed.ambiguities.map((a) =>
            a.kind === "maybe-date" ? (
              <span key={a.text} className="chip chip-note" title="Add “on” to use it as a date, e.g. “on sat”">
                <TriangleAlert size={12} aria-hidden /> “{a.text}” kept in title
              </span>
            ) : a.kind === "unknown-project" ? (
              <button key={a.text} type="button" className="chip chip-action" onClick={() => void createProject(a.text)}>
                <Folder size={12} aria-hidden /> Create project “{a.text}”
              </button>
            ) : null,
          )}
          <span className="parse-title" title="Title">
            {input.title}
          </span>
        </div>
      )}
    </div>
  );
});

export function defaultsForView(view: { kind: string; projectId?: string }, now: Date): QuickAddDefaults {
  if (view.kind === "today") return { dueDate: localDate(now), note: "(from Today)" };
  if (view.kind === "project" && view.projectId) return { projectId: view.projectId };
  return {};
}
