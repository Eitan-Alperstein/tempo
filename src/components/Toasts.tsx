import { X } from "lucide-react";
import { useStore } from "../store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const undo = useStore((s) => s.undo);
  return (
    <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone === "error" ? "is-error" : ""}`} role={t.tone === "error" ? "alert" : "status"}>
          <span>{t.message}</span>
          {t.undoable && (
            <button type="button" className="toast-undo" onClick={() => void undo()} title="Undo (⌘Z)">
              Undo
            </button>
          )}
          <button type="button" className="icon-btn subtle" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
