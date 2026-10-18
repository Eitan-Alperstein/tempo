import { CalendarDays, CircleCheck, Inbox, MoreHorizontal, Plus, Settings as SettingsIcon, Sun } from "lucide-react";
import { useMemo, useState } from "react";
import type { View } from "../lib/types";
import { counts } from "../lib/views";
import { useStore } from "../store";
import { PROJECT_COLORS } from "./ui";

function NavItem({
  icon,
  label,
  count,
  alert,
  active,
  shortcut,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  alert?: number;
  active: boolean;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`nav-item ${active ? "is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {alert ? (
        <span className="nav-count is-alert" title={`${alert} overdue`}>
          {alert}
        </span>
      ) : count ? (
        <span className="nav-count">{count}</span>
      ) : null}
    </button>
  );
}

function ProjectMenu({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const project = useStore((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useStore((s) => s.updateProject);
  const setPrompt = useStore((s) => s.setPrompt);
  const [name, setName] = useState(project?.name ?? "");
  if (!project) return null;
  return (
    <div className="popover" role="dialog" aria-label={`Edit ${project.name}`} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <input
        autoFocus
        value={name}
        aria-label="Project name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (name.trim()) void updateProject(project.id, name, project.color);
            onClose();
          }
        }}
        onBlur={() => name.trim() && name !== project.name && void updateProject(project.id, name, project.color)}
      />
      <div className="swatches" role="radiogroup" aria-label="Color">
        {PROJECT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === project.color}
            aria-label={c}
            className={c === project.color ? "is-on" : ""}
            style={{ background: c }}
            onClick={() => void updateProject(project.id, project.name, c)}
          />
        ))}
      </div>
      <button
        type="button"
        className="menu-danger"
        onClick={() => {
          onClose();
          setPrompt({ kind: "delete-project", projectId: project.id });
        }}
      >
        Delete project…
      </button>
    </div>
  );
}

export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const now = useStore((s) => s.now);
  const createProject = useStore((s) => s.createProject);
  const focusQuickAdd = useStore((s) => s.focusQuickAdd);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const c = useMemo(() => counts(tasks, now), [tasks, now]);

  const is = (v: View) => view.kind === v.kind && (v.kind !== "project" || (view.kind === "project" && view.projectId === v.projectId));

  return (
    <nav className="sidebar" aria-label="Views">
      <div className="sidebar-top" data-tauri-drag-region />
      <button type="button" className="new-task" onClick={focusQuickAdd} title="New Task (⌘N)">
        <Plus size={15} aria-hidden /> New Task
      </button>
      <div className="nav-group">
        <NavItem icon={<Sun size={15} />} label="Today" count={c.today} alert={c.overdue} active={is({ kind: "today" })} shortcut="⌘1" onClick={() => setView({ kind: "today" })} />
        <NavItem icon={<CalendarDays size={15} />} label="Upcoming" count={c.upcoming} active={is({ kind: "upcoming" })} shortcut="⌘2" onClick={() => setView({ kind: "upcoming" })} />
        <NavItem icon={<Inbox size={15} />} label="All Tasks" count={c.all} active={is({ kind: "all" })} shortcut="⌘3" onClick={() => setView({ kind: "all" })} />
        <NavItem icon={<CircleCheck size={15} />} label="Completed" active={is({ kind: "completed" })} shortcut="⌘4" onClick={() => setView({ kind: "completed" })} />
      </div>

      <div className="nav-section">
        <h2>Projects</h2>
        <button type="button" className="icon-btn subtle" aria-label="New project" title="New project" onClick={() => setAdding(true)}>
          <Plus size={13} />
        </button>
      </div>
      <div className="nav-group projects">
        {projects.map((p) => (
          <div key={p.id} className="project-item">
            <NavItem
              icon={<i className="dot" style={{ background: p.color }} />}
              label={p.name}
              count={c.perProject.get(p.id)}
              active={is({ kind: "project", projectId: p.id })}
              onClick={() => setView({ kind: "project", projectId: p.id })}
            />
            <button
              type="button"
              className="project-more"
              aria-label={`Edit ${p.name}`}
              aria-expanded={menuFor === p.id}
              onClick={() => setMenuFor(menuFor === p.id ? null : p.id)}
            >
              <MoreHorizontal size={13} />
            </button>
            {menuFor === p.id && <ProjectMenu projectId={p.id} onClose={() => setMenuFor(null)} />}
          </div>
        ))}
        {adding && (
          <form
            className="project-add"
            onSubmit={async (e) => {
              e.preventDefault();
              if (draft.trim()) {
                const proj = await createProject(draft, PROJECT_COLORS[projects.length % PROJECT_COLORS.length]);
                if (proj) setView({ kind: "project", projectId: proj.id });
              }
              setDraft("");
              setAdding(false);
            }}
          >
            <i className="dot" style={{ background: PROJECT_COLORS[projects.length % PROJECT_COLORS.length] }} />
            <input
              autoFocus
              value={draft}
              placeholder="Project name"
              aria-label="New project name"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => !draft.trim() && setAdding(false)}
              onKeyDown={(e) => e.key === "Escape" && (setDraft(""), setAdding(false))}
            />
          </form>
        )}
        {!projects.length && !adding && <p className="nav-empty">Group tasks like School or Guitar.</p>}
      </div>

      <div className="sidebar-bottom">
        <NavItem icon={<SettingsIcon size={15} />} label="Settings" active={is({ kind: "settings" })} shortcut="⌘," onClick={() => setView({ kind: "settings" })} />
      </div>
    </nav>
  );
}
