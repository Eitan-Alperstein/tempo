import { useMemo } from "react";
import { eventBlock, freeMinutesToday, taskBlock, type Block } from "../lib/schedule";
import { scoreAll } from "../lib/score";
import { num } from "../lib/settings";
import { isSameDay } from "../lib/time";
import { useStore } from "../store";

/** Scores and free time, recomputed whenever tasks, events or the minute change. */
export function usePlanning() {
  const tasks = useStore((s) => s.tasks);
  const events = useStore((s) => s.calendarEvents);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);

  return useMemo(() => {
    const busyToday: Block[] = [
      ...events.map(eventBlock),
      ...tasks.map(taskBlock),
    ].filter((b): b is Block => b !== null && isSameDay(b.start, now));
    const freeMinutes = freeMinutesToday(now, settings.workdayStart, settings.workdayEnd, busyToday);
    const scores = scoreAll(tasks, { now, freeMinutes });
    return { scores, freeMinutes, availableMin: num(settings, "availableMin") };
  }, [tasks, events, settings, now]);
}
