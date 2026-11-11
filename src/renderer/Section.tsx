// One collapsible section for every page (Today, Search settings, Setup, Learnings): a title with a count and a
// one-line note, open or closed as the user last left it (remembered per section on this computer).
import { useState, type ReactNode } from "react";

const key = (id: string) => `sensei-section-${id}`;

function remembered(id: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key(id));
    return value === null ? fallback : value === "1";
  } catch { return fallback; }
}

export function Section({ id, title, count, note, defaultOpen = true, actions, className, children }: {
  /** Stable ID, used to remember open or closed. */
  id: string;
  title: ReactNode;
  count?: number | string | null;
  /** A short line under the title, shown when open. */
  note?: ReactNode;
  defaultOpen?: boolean;
  /** Buttons on the title row (they don't toggle the section). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => remembered(id, defaultOpen));
  return <details className={`section${className ? ` ${className}` : ""}`} open={open} onToggle={(event) => {
    const next = (event.currentTarget as HTMLDetailsElement).open;
    setOpen(next);
    try { window.localStorage.setItem(key(id), next ? "1" : "0"); } catch { /* storage unavailable */ }
  }}>
    <summary>
      <span className="section-chevron" aria-hidden="true" />
      <span className="section-title">{title}</span>
      {count !== undefined && count !== null && <span className="section-count">{count}</span>}
      {actions && <span className="section-actions" onClick={(event) => event.preventDefault()}>{actions}</span>}
    </summary>
    <div className="section-body">
      {note && <p className="section-note">{note}</p>}
      {children}
    </div>
  </details>;
}
