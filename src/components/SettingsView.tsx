import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { exportBackup, importBackup } from "../lib/backup";
import { num, type SettingKey } from "../lib/settings";
import { formatDuration } from "../lib/time";
import type { CalendarStatus } from "../lib/types";
import { useStore } from "../store";
import { Button, Segmented, Switch } from "./ui";

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function NumberSetting({ k, min, max, step = 1, suffix }: { k: SettingKey; min: number; max: number; step?: number; suffix: string }) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const [v, setV] = useState(String(num(settings, k)));
  return (
    <span className="row-inputs">
      <input
        type="number"
        className="num"
        min={min}
        max={max}
        step={step}
        value={v}
        aria-label={suffix}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Math.min(max, Math.max(min, Math.round(Number(v)) || min));
          setV(String(n));
          void setSetting(k, String(n));
        }}
      />
      <span className="muted">{suffix}</span>
    </span>
  );
}

function calendarText(s: CalendarStatus | null): string {
  if (!s) return "Checking…";
  switch (s.state) {
    case "granted":
      return "Access granted.";
    case "notDetermined":
      return "Tempo will ask for permission.";
    case "denied":
      return "Access denied. Allow Tempo in System Settings → Privacy & Security → Calendars, then turn this on again.";
    case "restricted":
      return "Calendar access is restricted on this Mac.";
    case "unavailable":
      return s.reason;
  }
}

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const dbPath = useStore((s) => s.dbPath);
  const toast = useStore((s) => s.toast);
  const calendarStatus = useStore((s) => s.calendarStatus);
  const setCalendarStatus = useStore((s) => s.setCalendarStatus);
  const refreshCalendar = useStore((s) => s.refreshCalendar);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [shortcut, setShortcut] = useState(settings.globalShortcut);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    autostartEnabled().then(setAutostart).catch(() => setAutostart(null));
    api.calendarStatus().then(setCalendarStatus).catch(() => {});
  }, [setCalendarStatus]);

  async function toggleNotifications(on: boolean) {
    if (!on) return setSetting("notifications", "0");
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (!granted) {
        toast("Notifications are blocked. Allow Tempo in System Settings → Notifications.", { tone: "error" });
        return;
      }
      await setSetting("notifications", "1");
    } catch (e) {
      toast(errorMessage(e), { tone: "error" });
    }
  }

  async function toggleCalendar(on: boolean) {
    if (!on) {
      await setSetting("calendar", "0");
      await refreshCalendar();
      return;
    }
    setBusy(true);
    try {
      const status = await api.calendarRequestAccess();
      setCalendarStatus(status);
      if (status.state === "granted") {
        await setSetting("calendar", "1");
        await refreshCalendar();
      }
    } catch (e) {
      toast(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings">
      <section>
        <h2>Planning</h2>
        <Row label="Time available for tasks each day" hint={`Used for the Planned / Available summary. Currently ${formatDuration(num(settings, "availableMin"))}.`}>
          <NumberSetting k="availableMin" min={0} max={960} step={15} suffix="minutes" />
        </Row>
        <Row label="Working hours" hint="The schedule highlights these hours, and free time is counted until the end of them.">
          <span className="row-inputs">
            <input type="time" aria-label="Workday start" value={settings.workdayStart} onChange={(e) => e.target.value && void setSetting("workdayStart", e.target.value)} />
            <span className="muted">to</span>
            <input type="time" aria-label="Workday end" value={settings.workdayEnd} onChange={(e) => e.target.value && void setSetting("workdayEnd", e.target.value)} />
          </span>
        </Row>
      </section>

      <section>
        <h2>Focus timer</h2>
        <Row label="Focus session">
          <NumberSetting k="focusMin" min={1} max={180} suffix="minutes" />
        </Row>
        <Row label="Short break">
          <NumberSetting k="shortBreakMin" min={1} max={60} suffix="minutes" />
        </Row>
        <Row label="Long break">
          <NumberSetting k="longBreakMin" min={1} max={90} suffix="minutes" />
        </Row>
        <Row label="Long break after" hint="Set to 0 to never take long breaks.">
          <NumberSetting k="longBreakEvery" min={0} max={12} suffix="focus sessions" />
        </Row>
      </section>

      <section>
        <h2>Reminders</h2>
        <Row label="Notifications" hint="Reminders for scheduled tasks and deadlines. They fire while Tempo is open or hidden. Closing the window keeps Tempo running; ⌘Q quits it.">
          <Switch label="Notifications" checked={settings.notifications === "1"} onChange={(v) => void toggleNotifications(v)} />
        </Row>
        <Row label="Remind me before">
          <select value={settings.reminderLeadMin} onChange={(e) => void setSetting("reminderLeadMin", e.target.value)} disabled={settings.notifications !== "1"}>
            {[0, 5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "At the time" : `${m} minutes before`}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Open at login" hint="So reminders work without opening Tempo first.">
          <Switch
            label="Open at login"
            checked={!!autostart}
            disabled={autostart === null}
            onChange={async (v) => {
              try {
                await (v ? enableAutostart() : disableAutostart());
                setAutostart(await autostartEnabled());
              } catch (e) {
                toast(errorMessage(e), { tone: "error" });
              }
            }}
          />
        </Row>
      </section>

      <section>
        <h2>Calendar</h2>
        <Row
          label="Show calendar events"
          hint={
            <>
              Tempo reads events from your Mac's calendars to show busy time in the day schedule. It never changes your calendar. <br />
              <span className={calendarStatus?.state === "granted" ? "" : "warn-text"}>{calendarText(calendarStatus)}</span>
            </>
          }
        >
          <Switch label="Show calendar events" checked={settings.calendar === "1"} disabled={busy} onChange={(v) => void toggleCalendar(v)} />
        </Row>
      </section>

      <section>
        <h2>Keyboard</h2>
        <Row label="Quick add from anywhere" hint="Opens a small window to add a task, even when Tempo is in the background.">
          <form
            className="row-inputs"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.setGlobalShortcut(shortcut.trim());
                useStore.setState((s) => ({ settings: { ...s.settings, globalShortcut: shortcut.trim() } }));
                toast("Shortcut updated.");
              } catch (err) {
                toast(errorMessage(err), { tone: "error" });
              }
            }}
          >
            <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} aria-label="Global shortcut" className="shortcut-input" />
            <Button type="submit" disabled={shortcut === settings.globalShortcut}>
              Save
            </Button>
          </form>
        </Row>
        <div className="shortcut-list">
          {[
            ["New task", "⌘N"],
            ["Search", "⌘F"],
            ["Complete selected", "⌘↩"],
            ["Delete selected", "⌘⌫"],
            ["Start / pause focus", "⌘T"],
            ["Stop focus", "⇧⌘T"],
            ["Pin / unpin", "⇧⌘P"],
            ["Today · Upcoming · All · Completed", "⌘1 – ⌘4"],
            ["Move selection", "↑ ↓ or J K"],
            ["Open details", "↩"],
            ["Day schedule", "⇧⌘D"],
            ["Toggle sidebar", "⌃⌘S"],
            ["Undo", "⌘Z"],
            ["Close panel / cancel", "Esc"],
          ].map(([a, k]) => (
            <div key={a} className="shortcut">
              <span>{a}</span>
              <kbd className="kbd">{k}</kbd>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Appearance</h2>
        <Row label="Theme">
          <Segmented
            label="Theme"
            value={settings.theme}
            onChange={(v) => void setSetting("theme", v)}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Row>
      </section>

      <section>
        <h2>Data</h2>
        <Row label="Backup" hint="A JSON file with all tasks, subtasks, projects, focus history and settings. Importing merges a backup into your current data; nothing is deleted.">
          <span className="row-inputs">
            <Button onClick={() => void exportBackup()}>Export…</Button>
            <Button onClick={() => void importBackup()}>Import…</Button>
          </span>
        </Row>
        <p className="setting-hint mono">Database: {dbPath}</p>
      </section>
    </div>
  );
}
