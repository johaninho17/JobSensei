// The job posting beside a document (issue #127). One per-computer setting, shared by the Application tab's toggle and
// the ⌘K command; a window event keeps every open view in step. Off by default.
import { useEffect, useState } from "react";

export const SIDE_BY_SIDE_KEY = "sensei-side-by-side";
const SIDE_BY_SIDE_EVENT = "sensei-side-by-side";

/** The Application views that can show the posting beside them: the documents written against it. */
export const SIDE_BY_SIDE_VIEWS = ["resume", "letter", "evaluation"] as const;

export function sideBySideFits(view: string): boolean {
  return (SIDE_BY_SIDE_VIEWS as readonly string[]).includes(view);
}

export function readSideBySide(): boolean {
  try { return window.localStorage.getItem(SIDE_BY_SIDE_KEY) === "on"; } catch { return false; }
}

/** Saves the choice for this computer and tells every open view. */
export function setSideBySide(on: boolean): void {
  try { window.localStorage.setItem(SIDE_BY_SIDE_KEY, on ? "on" : "off"); } catch { /* stays for this session */ }
  window.dispatchEvent(new CustomEvent<boolean>(SIDE_BY_SIDE_EVENT, { detail: on }));
}

export function useSideBySide(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readSideBySide);
  useEffect(() => {
    const listener = (event: Event) => setOn(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener(SIDE_BY_SIDE_EVENT, listener);
    return () => window.removeEventListener(SIDE_BY_SIDE_EVENT, listener);
  }, []);
  return [on, setSideBySide];
}
