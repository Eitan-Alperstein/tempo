import { CircleCheck, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { computeStats, statsSince, type Stats } from "../lib/stats";
import { format, formatDuration, relativeDay, startOfDay } from "../lib/time";
import type { FocusSession, Task } from "../lib/types";
import { useStore } from "../store";

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** Completions per week: one series, one hue, hover for exact values. */
function WeeklyTrend({ weekly }: { weekly: Stats["weekly"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weekly.map((w) => w.count));
  const W = 200;
  const H = 48;
  const gap = 4;
  const bw = (W - gap * (weekly.length - 1)) / weekly.length;
  const h = hover !== null ? weekly[hover] : null;
  return (
    <figure className="trend">
      <figcaption>
        Tasks completed per week
        <span className="trend-readout" aria-live="polite">
          {h ? `Week of ${format(h.weekStart, "MMM d")}: ${h.count}` : `Last ${weekly.length} weeks`}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 2}`} width="100%" height={H + 2} role="img" aria-label="Weekly completions bar chart; see table">
        <line x1={0} x2={W} y1={H + 1} y2={H + 1} className="trend-axis" />
        {weekly.map((w, i) => {
          const bh = w.count ? Math.max(3, (w.count / max) * (H - 4)) : 0;
          const x = i * (bw + gap);
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Hit target spans the full column, bigger than the bar. */}
              <rect x={x} y={0} width={bw} height={H + 2} fill="transparent" />
              {bh > 0 && (
                <path
                  className={`trend-bar ${hover === i ? "is-hover" : ""} ${i === weekly.length - 1 ? "is-current" : ""}`}
                  d={`M${x},${H} v${-(bh - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${bh - 3} z`}
                />
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Tasks completed per week</caption>
        <tbody>
          {weekly.map((w) => (
            <tr key={+w.weekStart}>
              <th scope="row">Week of {format(w.weekStart, "MMM d")}</th>
              <td>{w.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function CompletedView() {
  const projects = useStore((s) => s.projects);
  const version = useStore((s) => s.completedVersion);
  const uncomplete = useStore((s) => s.uncomplete);
  const now = useStore((s) => s.now);
  const searchFocus = useStore((s) => s.searchFocus);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Task[] | null>(null);
  const [statsData, setStatsData] = useState<{ completed: Task[]; sessions: FocusSession[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const day = startOfDay(now).getTime();

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api
        .listCompleted(query || null, null, 500)
        .then((r) => live && (setItems(r), setError(null)))
        .catch((e) => live && setError(errorMessage(e)));
    }, query ? 150 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, version]);

  useEffect(() => {
    const since = statsSince(new Date(day)).toISOString();
    Promise.all([api.listCompleted(null, since, 5000), api.listSessions(since)])
      .then(([completed, sessions]) => setStatsData({ completed, sessions }))
      .catch((e) => setError(errorMessage(e)));
  }, [version, day]);

  useEffect(() => {
    if (searchFocus) document.getElementById("completed-search")?.focus();
  }, [searchFocus]);

  const stats = statsData ? computeStats(statsData.completed, statsData.sessions, now) : null;

  const groups = useMemo(() => {
    const out: { label: string; tasks: Task[] }[] = [];
    for (const t of items ?? []) {
      const label = relativeDay(new Date(t.completedAt!), now);
      if (out.at(-1)?.label !== label) out.push({ label, tasks: [] });
      out.at(-1)!.tasks.push(t);
    }
    return out;
  }, [items, now]);

  return (
    <div className="completed">
      {stats && (
        <section className="stats" aria-label="Statistics">
          <StatTile label="Done today" value={String(stats.completedToday)} />
          <StatTile label="Done this week" value={String(stats.completedThisWeek)} />
          <StatTile
            label="Focus this week"
            value={formatDuration(stats.focusedMinThisWeek) || "0m"}
            sub={`${stats.focusSessionsThisWeek} session${stats.focusSessionsThisWeek === 1 ? "" : "s"} completed`}
          />
          <StatTile
            label="Focus vs. estimate"
            value={stats.estimateAccuracy === null ? "—" : `${Math.round(stats.estimateAccuracy * 100)}%`}
            sub={
              stats.estimateAccuracy === null
                ? "Use the timer on estimated tasks"
                : stats.estimateAccuracy > 1.1
                  ? "Tasks take longer than estimated"
                  : stats.estimateAccuracy < 0.9
                    ? "Tasks take less time than estimated"
                    : "Estimates are on target"
            }
          />
          <WeeklyTrend weekly={stats.weekly} />
        </section>
      )}

      <div className="search-field">
        <Search size={13} aria-hidden />
        <input
          id="completed-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search completed tasks"
          aria-label="Search completed tasks"
        />
      </div>

      {error && <p className="warn">{error}</p>}
      {items && items.length === 0 && (
        <div className="empty">
          <CircleCheck size={28} aria-hidden />
          <p>{query ? "No completed tasks match." : "Completed tasks will appear here."}</p>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.label} className="task-group">
          <header className="group-header">
            <h3>{g.label}</h3>
            <span className="group-count">{g.tasks.length}</span>
          </header>
          {g.tasks.map((t) => {
            const p = t.projectId ? projectById.get(t.projectId) : undefined;
            const doneSubs = t.subtasks.filter((s) => s.done).length;
            return (
              <div key={t.id} className="task-row is-done">
                <span className="check is-checked" aria-hidden>
                  <CircleCheck size={16} />
                </span>
                <div className="task-main">
                  <span className="task-title">{t.title}</span>
                </div>
                <div className="task-meta always">
                  {t.subtasks.length > 0 && (
                    <span className="meta">
                      {doneSubs}/{t.subtasks.length} steps
                    </span>
                  )}
                  {p && (
                    <span className="meta project-tag">
                      <i style={{ background: p.color }} aria-hidden />
                      {p.name}
                    </span>
                  )}
                  <span className="meta" title="Estimated">
                    est. {formatDuration(t.estimateMin) || "—"}
                  </span>
                  <span className="meta" title="Tracked focus time">
                    focused {formatDuration(Math.round(t.focusSec / 60)) || "—"}
                  </span>
                  <span className="meta muted">{format(new Date(t.completedAt!), "h:mm a")}</span>
                  <button
                    type="button"
                    className="row-action"
                    aria-label={`Mark ${t.title} as not done`}
                    title="Mark as not done"
                    onClick={() => void uncomplete(t)}
                  >
                    <RotateCcw size={12} aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
