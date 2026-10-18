import { TriangleAlert } from "lucide-react";
import { planSummary } from "../lib/schedule";
import { atLocalTime, formatDuration, formatTime } from "../lib/time";
import type { Task } from "../lib/types";
import { useStore } from "../store";

/** "Planned: 2h 15m / Available: 3h", with a warning when the day is overfull. */
export function PlanBar({ todayTasks, freeMinutes, availableMin }: { todayTasks: Task[]; freeMinutes: number; availableMin: number }) {
  const now = useStore((s) => s.now);
  const workdayEnd = useStore((s) => s.settings.workdayEnd);
  const p = planSummary(todayTasks, now, availableMin);
  const ratio = availableMin > 0 ? Math.min(1, p.plannedMin / availableMin) : 1;
  const end = atLocalTime(now, workdayEnd);

  return (
    <div className={`plan-bar ${p.over ? "is-over" : ""}`} role="status">
      <div className="plan-text">
        <span>
          Planned <strong>{formatDuration(p.plannedMin) || "0m"}</strong> / Available <strong>{formatDuration(availableMin) || "0m"}</strong>
        </span>
        {p.over && (
          <span className="plan-warn">
            <TriangleAlert size={12} aria-hidden /> Over by {formatDuration(p.plannedMin - availableMin)}
          </span>
        )}
        {p.unestimated > 0 && (
          <span className="muted">
            {p.unestimated} without an estimate
          </span>
        )}
        <span className="muted plan-free">
          {freeMinutes > 0 ? `${formatDuration(freeMinutes)} free until ${formatTime(end)}` : "Workday's over"}
        </span>
      </div>
      <div className="meter" aria-hidden>
        <i style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
