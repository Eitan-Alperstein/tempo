import { Coffee, Pause, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { formatClock } from "../lib/time";
import { progress, remainingSec } from "../lib/timer";
import { useStore } from "../store";
import { IconButton } from "./ui";

/** The running session, shown in the toolbar. The display ticks; the truth is the stored timestamps. */
export function TimerPill() {
  const session = useStore((s) => s.session);
  const task = useStore((s) => s.tasks.find((t) => t.id === s.session?.taskId));
  const toggleTimer = useStore((s) => s.toggleTimer);
  const stopTimer = useStore((s) => s.stopTimer);
  const openDetail = useStore((s) => s.openDetail);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!session || session.pausedAt) return;
    const id = setInterval(() => setNow(new Date()), 500);
    return () => clearInterval(id);
  }, [session]);

  if (!session) return null;
  const isBreak = session.kind !== "focus";
  const remaining = remainingSec(session, now);
  const p = progress(session, now);
  const label = isBreak ? (session.kind === "long_break" ? "Long break" : "Break") : (task?.title ?? "Focus");
  const R = 7;
  const C = 2 * Math.PI * R;

  return (
    <div className={`timer-pill ${session.pausedAt ? "is-paused" : ""} ${isBreak ? "is-break" : ""}`} role="timer" aria-label={`${label}: ${formatClock(remaining)} left`}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r={R} className="ring-bg" />
        <circle cx="9" cy="9" r={R} className="ring" strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 9 9)" />
      </svg>
      {isBreak && <Coffee size={12} aria-hidden />}
      <button type="button" className="timer-label" onClick={() => task && openDetail(task.id)} title={label}>
        {label}
      </button>
      <span className="timer-clock">{formatClock(remaining)}</span>
      <IconButton label={session.pausedAt ? "Resume" : "Pause"} shortcut="⌘T" onClick={() => void toggleTimer()}>
        {session.pausedAt ? <Play size={12} /> : <Pause size={12} />}
      </IconButton>
      <IconButton label="Stop" shortcut="⇧⌘T" onClick={() => void stopTimer()}>
        <Square size={11} />
      </IconButton>
    </div>
  );
}
