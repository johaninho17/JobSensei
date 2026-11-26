// Tabs inside a page (Prep · Questions · Research · Files, Resume · Cover letter · …): one shared component so
// every page's subtabs look and behave the same. Arrow keys move between tabs (WAI-ARIA tabs pattern).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/** `group` puts related tabs into one dropdown tab named after the open one (#239). */
export type SubTab<T extends string> = { id: T; label: string; count?: number | null; disabled?: boolean; group?: string };

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
      {tabs.map((tab, index) => {
        if (tab.group) {
          // The first tab of a group draws the group's dropdown; the others live inside it.
          if (tabs.findIndex((other) => other.group === tab.group) !== index) return null;
          const items = tabs.filter((other) => other.group === tab.group && !other.disabled);
          return <TabMenu key={`group-${tab.group}`} id={`${idPrefix}-tab-group-${tab.group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} label={tab.group} itemIdPrefix={`${idPrefix}-tab-`} items={items} open={items.find((item) => item.id === value) ?? null} onPick={(item) => onChange(item.id)} />;
        }
        return <button
        key={tab.id}
        id={`${idPrefix}-tab-${tab.id}`}
        role="tab"
        aria-selected={tab.id === value}
        aria-controls={`${idPrefix}-panel`}
        tabIndex={tab.id === value ? 0 : -1}
        disabled={tab.disabled}
        onClick={() => onChange(tab.id)}
      >{tab.label}{tab.count != null && <span className="subtabs-count">{tab.count}</span>}</button>;
      })}
    </div>
    {actions && <div className="subtabs-actions">{actions}</div>}
  </div>;
}

/** The panel a SubTabs row controls. */
export function SubTabPanel({ idPrefix, value, children }: { idPrefix: string; value: string; children: ReactNode }) {
  return <div className="subtabs-panel" id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${value}`} tabIndex={0}>{children}</div>;
}

type MenuItem = { id: string; label: string; count?: number | null };

/**
 * A dropdown tab (#222, #239): one tab whose menu lists related tabs; its label names the open one. Escape or a click
 * outside closes it; arrow keys move through the list. Used by grouped SubTabs and the job page's Application tab.
 */
export function TabMenu<T extends MenuItem>({ id, label, itemIdPrefix, items, open, onPick }: { id: string; label: string; itemIdPrefix: string; items: T[]; open: T | null; onPick: (item: T) => void }) {
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown) return;
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"][aria-current="page"], [role="menuitem"]')?.focus();
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setShown(false); };
    const keys = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setShown(false); ref.current?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const list = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      list[(at + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
      event.preventDefault();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", keys);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", keys); };
  }, [shown]);
  return <div className="tab-menu" ref={ref}>
    <button role="tab" id={id} aria-selected={open !== null} aria-haspopup="menu" aria-expanded={shown} className={open ? "is-active" : ""} onClick={() => setShown((value) => !value)}>{open ? open.label : label}<span className="tab-menu-caret" aria-hidden="true">▾</span></button>
    {shown && <div className="tab-menu-list jobs-more-menu" role="menu" aria-label={label}>{items.map((item) => <button key={item.id} role="menuitem" id={`${itemIdPrefix}${item.id}`} className="menu-item" aria-current={open?.id === item.id ? "page" : undefined} onClick={() => { setShown(false); onPick(item); }}>{item.label}{item.count ? <span className="subtabs-count"> {item.count}</span> : null}</button>)}</div>}
  </div>;
}
