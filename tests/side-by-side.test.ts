// Issue #127: the job posting beside the resume, cover letter or evaluation. A per-computer setting (off by default)
// shared by the Application tab's toggle and ⌘K; the posting pane is read only; one split layout for both editions.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIDE_BY_SIDE_KEY, readSideBySide, setSideBySide, sideBySideFits } from "../src/renderer/side-by-side";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function fakeWindow(stored: Record<string, string> = {}, broken = false) {
  const events: boolean[] = [];
  const storage = {
    getItem: (key: string) => { if (broken) throw new Error("blocked"); return stored[key] ?? null; },
    setItem: (key: string, value: string) => { if (broken) throw new Error("blocked"); stored[key] = value; },
  };
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: (event: CustomEvent<boolean>) => { events.push(event.detail); return true; } });
  return { stored, events };
}

afterEach(() => vi.unstubAllGlobals());

describe("the side-by-side setting", () => {
  it("shows only on the documents written against the posting", () => {
    expect(["resume", "letter", "evaluation"].every(sideBySideFits)).toBe(true);
    expect(["review", "questions", "posting", "checks"].some(sideBySideFits)).toBe(false);
  });

  it("is off by default, remembered per computer, and announced to open views", () => {
    const { stored, events } = fakeWindow();
    expect(readSideBySide()).toBe(false);
    setSideBySide(true);
    expect(stored[SIDE_BY_SIDE_KEY]).toBe("on");
    expect(readSideBySide()).toBe(true);
    setSideBySide(false);
    expect(readSideBySide()).toBe(false);
    expect(events).toEqual([true, false]);
  });

  it("still works for the session when storage is blocked", () => {
    const { events } = fakeWindow({}, true);
    expect(readSideBySide()).toBe(false);
    setSideBySide(true);
    expect(events).toEqual([true]);
  });
});

describe("the posting pane and layout", () => {
  const workspace = source("src/renderer/JobWorkspace.tsx");
  const pane = workspace.slice(workspace.indexOf("export function PostingPane"), workspace.indexOf("/**", workspace.indexOf("export function PostingPane")));

  it("renders the posting read only: no editor, no save", () => {
    expect(pane).toMatch(/Read only/);
    expect(pane).not.toMatch(/DocumentView|textarea|Edit Markdown|files\.save|writeFile/);
  });

  it("uses one split layout in both editions, from tokens", () => {
    expect(source("src/renderer/Review.tsx")).toMatch(/className="doc-split is-aside-first"/);
    const css = source("src/renderer/layout.css");
    expect(css).not.toMatch(/\.review-cols\b/);
    const block = css.slice(css.indexOf(".doc-split {"), css.indexOf("/* Documents read at"));
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("is in ⌘K", () => {
    expect(source("src/renderer/App.tsx")).toMatch(/id: "toggle-side-by-side"/);
  });
});
