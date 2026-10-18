import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useEffect, useMemo } from "react";
import type { ScoreBreakdown } from "../lib/score";
import type { Project } from "../lib/types";
import type { Group } from "../lib/views";
import { useStore } from "../store";
import { TaskRow } from "./TaskRow";

interface Props {
  groups: Group[];
  scores: Map<string, ScoreBreakdown>;
  projects: Project[];
  showReasons: boolean;
  /** Hide the project tag when viewing a single project. */
  hideProject?: boolean;
  empty: React.ReactNode;
}

export function TaskList({ groups, scores, projects, showReasons, hideProject, empty }: Props) {
  const now = useStore((s) => s.now);
  const selectedId = useStore((s) => s.selectedId);
  const session = useStore((s) => s.session);
  const openDetail = useStore((s) => s.openDetail);
  const requestComplete = useStore((s) => s.requestComplete);
  const patchTask = useStore((s) => s.patchTask);
  const startFocus = useStore((s) => s.startFocus);
  const setVisibleIds = useStore((s) => s.setVisibleIds);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const ids = useMemo(() => groups.flatMap((g) => g.tasks.map((t) => t.id)), [groups]);
  useEffect(() => setVisibleIds(ids), [ids, setVisibleIds]);

  const onRename = useMemo(() => (id: string, title: string) => void patchTask(id, { title }), [patchTask]);
  const onFocus = useMemo(() => (id: string) => void startFocus(id), [startFocus]);

  if (ids.length === 0) return <div className="empty">{empty}</div>;

  const showHeaders = groups.length > 1 || groups.some((g) => g.title);
  return (
    <div className="task-list" role="listbox" aria-label="Tasks">
      {groups.map((g) => (
        <section key={g.id} className={`task-group group-${g.id}`} aria-label={g.title || "Tasks"}>
          {showHeaders && g.title && (
            <header className="group-header">
              <h3>{g.title}</h3>
              <span className="group-count">{g.tasks.length}</span>
              {g.hint && <span className="group-hint">{g.hint}</span>}
            </header>
          )}
          <SortableContext items={g.tasks.map((t) => `${g.id}:${t.id}`)} strategy={verticalListSortingStrategy}>
            {g.tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                groupId={g.id}
                project={hideProject || !t.projectId ? undefined : projectById.get(t.projectId)}
                score={scores.get(t.id)}
                showReason={showReasons}
                selected={selectedId === t.id}
                now={now}
                focusing={session?.taskId === t.id}
                onOpen={openDetail}
                onComplete={requestComplete}
                onRename={onRename}
                onFocus={onFocus}
              />
            ))}
          </SortableContext>
        </section>
      ))}
    </div>
  );
}
