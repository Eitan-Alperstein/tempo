import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { QuickAdd, type QuickAddHandle } from "./components/QuickAdd";
import { api, errorMessage } from "./lib/api";
import { withDefaults } from "./lib/settings";
import type { Project } from "./lib/types";

/** The small floating window opened by the global shortcut. */
export default function QuickAddWindow() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const ref = useRef<QuickAddHandle>(null);
  const win = getCurrentWindow();

  useEffect(() => {
    const refresh = () =>
      api
        .bootstrap()
        .then((b) => {
          setProjects(b.projects);
          const theme = withDefaults(b.settings).theme;
          if (theme === "system") document.documentElement.removeAttribute("data-theme");
          else document.documentElement.setAttribute("data-theme", theme);
        })
        .catch((e) => setError(errorMessage(e)));
    void refresh();
    const un = [
      listen("quick-add-open", () => {
        setNow(new Date());
        setError(null);
        void refresh();
        setTimeout(() => ref.current?.focus(), 30);
      }),
      win.onFocusChanged(({ payload: focused }) => {
        if (!focused) void win.hide();
      }),
    ];
    return () => un.forEach((p) => void p.then((f) => f()));
  }, [win]);

  return (
    <div className="quick-window" data-tauri-drag-region>
      <div className="quick-window-title" data-tauri-drag-region>
        Add to Tempo
      </div>
      <QuickAdd
        ref={ref}
        autoFocus
        projects={projects}
        now={now}
        onSubmit={async (input) => {
          try {
            await api.createTask(input);
            await emitTo("main", "tasks-changed");
            await win.hide();
            return true;
          } catch (e) {
            setError(errorMessage(e));
            return false;
          }
        }}
        onCreateProject={async (name, color) => {
          try {
            const p = await api.createProject(name, color);
            setProjects((ps) => [...ps, p]);
            return p;
          } catch (e) {
            setError(errorMessage(e));
            return null;
          }
        }}
        onCancel={() => void win.hide()}
      />
      {error && <p className="warn">{error}</p>}
    </div>
  );
}
