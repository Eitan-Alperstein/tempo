import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export function IconButton({
  label,
  shortcut,
  active,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; active?: boolean }) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? "is-active" : ""} ${className}`}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  return <button type="button" className={`btn btn-${variant} ${className}`} {...rest} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={o.value === value ? "is-on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

/** Modal dialog. Escape or clicking outside cancels; focus moves to the first action. */
export function Dialog({
  title,
  children,
  actions,
  onClose,
}: {
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus], .dialog-actions button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={ref}>
        <h2 id="dialog-title">{title}</h2>
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

/** Importance as five small bars: readable without color, with a text label for screen readers. */
export function ImportanceBars({ value }: { value: number }) {
  return (
    <span className={`imp imp-${value}`} role="img" aria-label={`Importance ${value} of 5`} title={`Importance ${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= value ? "on" : ""} />
      ))}
    </span>
  );
}

export const PROJECT_COLORS = ["#0a84ff", "#30b158", "#ff9f0a", "#ff453a", "#bf5af2", "#64d2ff", "#ff375f", "#a2845e", "#8e8e93"];
