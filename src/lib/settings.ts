import type { SortMode } from "./order";
import type { TimerSettings } from "./timer";

/** Settings are stored as strings in SQLite; these are the defaults. */
export const DEFAULT_SETTINGS = {
  sortMode: "recommended",
  availableMin: "180",
  workdayStart: "09:00",
  workdayEnd: "18:00",
  focusMin: "25",
  shortBreakMin: "5",
  longBreakMin: "15",
  longBreakEvery: "4",
  notifications: "0",
  reminderLeadMin: "10",
  calendar: "0",
  globalShortcut: "Control+Alt+Space",
  theme: "system",
  sidebarCollapsed: "0",
  scheduleOpen: "0",
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export type Settings = Record<SettingKey, string>;

export function withDefaults(stored: Record<string, string>): Settings {
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export function num(s: Settings, k: SettingKey): number {
  const n = Number(s[k]);
  return Number.isFinite(n) ? n : Number(DEFAULT_SETTINGS[k]);
}

export function sortMode(s: Settings): SortMode {
  return s.sortMode === "manual" ? "manual" : "recommended";
}

export function timerSettings(s: Settings): TimerSettings {
  return {
    focusMin: num(s, "focusMin"),
    shortBreakMin: num(s, "shortBreakMin"),
    longBreakMin: num(s, "longBreakMin"),
    longBreakEvery: num(s, "longBreakEvery"),
  };
}
