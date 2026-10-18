import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";
import { api, errorMessage } from "./api";
import { localDate } from "./time";

export async function exportBackup() {
  const { toast } = useStore.getState();
  const path = await saveDialog({
    defaultPath: `Tempo Backup ${localDate(new Date())}.json`,
    filters: [{ name: "Tempo backup", extensions: ["json"] }],
  });
  if (!path) return;
  try {
    await api.exportBackup(path);
    toast("Backup saved.");
  } catch (e) {
    toast(errorMessage(e), { tone: "error" });
  }
}

/** Merges a backup into the current data; nothing is deleted. */
export async function importBackup() {
  const { toast } = useStore.getState();
  const path = await openDialog({ multiple: false, filters: [{ name: "Tempo backup", extensions: ["json"] }] });
  if (!path || Array.isArray(path)) return;
  try {
    const r = await api.importBackup(path);
    const b = await api.bootstrap();
    useStore.setState((s) => ({ tasks: b.tasks, projects: b.projects, completedVersion: s.completedVersion + 1 }));
    toast(`Imported ${r.tasks} tasks and ${r.projects} projects.`);
  } catch (e) {
    toast(errorMessage(e), { tone: "error" });
  }
}
