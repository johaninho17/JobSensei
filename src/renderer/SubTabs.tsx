// Tabs inside a page (Prep · Questions · Research · Files, Resume · Cover letter · …): one shared component so
// every page's subtabs look and behave the same. Arrow keys move between tabs (WAI-ARIA tabs pattern).
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type SubTab<T extends string> = { id: T; label: string; count?: number | null; disabled?: boolean };

export function SubTabs<T extends string>({ tabs, value, onChange, label, idPrefix, actions }: {
  tabs: Array<SubTab<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Prefix for tab and panel IDs, so a panel can point back with `aria-labelledby`. */
  idPrefix: string;
  /** Buttons shown at the right end of the tab row. */
  actions?: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const enabled = tabs.filter((tab) => !tab.disabled);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = enabled.findIndex((tab) => tab.id === value);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled[enabled.length - 1] : step ? enabled[(index + step + enabled.length) % enabled.length] : null;
    if (!target) return;
    event.preventDefault();
    onChange(target.id);
    listRef.current?.querySelector<HTMLButtonElement>(`#${idPrefix}-tab-${target.id}`)?.focus();
  }
  return <div className="subtabs">
    <div className="subtabs-list" role="tablist" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
      {tabs.map((tab) => <button
        key={tab.id}
        id={`${idPrefix}-tab-${tab.id}`}
        role="tab"
        aria-selected={tab.id === value}
        aria-controls={`${idPrefix}-panel`}
        tabIndex={tab.id === value ? 0 : -1}
        disabled={tab.disabled}
        onClick={() => onChange(tab.id)}
      >{tab.label}{tab.count != null && <span className="subtabs-count">{tab.count}</span>}</button>)}
    </div>
    {actions && <div className="subtabs-actions">{actions}</div>}
  </div>;
}

/** The panel a SubTabs row controls. */
export function SubTabPanel({ idPrefix, value, children }: { idPrefix: string; value: string; children: ReactNode }) {
  return <div className="subtabs-panel" id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${value}`} tabIndex={0}>{children}</div>;
}
