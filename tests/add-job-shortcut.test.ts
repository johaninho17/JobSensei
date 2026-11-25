// Issue #168: a system-wide shortcut sends the copied job link to the queue.
import { describe, expect, it } from "vitest";
import { ADD_JOB_ACCELERATOR, linkFromClipboard, setAddJobShortcut, type ShortcutPress } from "../electron/add-job-shortcut";

describe("the link on the clipboard", () => {
  it("takes a bare link, or the first link in copied text", () => {
    expect(linkFromClipboard("https://boards.greenhouse.io/example/jobs/123")).toBe("https://boards.greenhouse.io/example/jobs/123");
    expect(linkFromClipboard("  Look at this role: https://jobs.lever.co/example/abc-123. Thoughts?\nhttps://other.example.com")).toBe("https://jobs.lever.co/example/abc-123");
    expect(linkFromClipboard("(https://example.com/careers/role?id=7)")).toBe("https://example.com/careers/role?id=7");
  });
  it("finds nothing in plain text, other schemes, or hostless links", () => {
    expect(linkFromClipboard("Senior Support Engineer at Example")).toBeNull();
    expect(linkFromClipboard("ftp://example.com/file")).toBeNull();
    expect(linkFromClipboard("mailto:someone@example.com")).toBeNull();
    expect(linkFromClipboard("https://intranet/jobs")).toBeNull();
    expect(linkFromClipboard(`https://example.com/${"a".repeat(2_100)}`)).toBeNull();
  });
});

function fakeShortcuts(refuse = false) {
  const held = new Map<string, () => void>();
  return {
    held,
    register: (accelerator: string, callback: () => void) => { if (refuse) return false; held.set(accelerator, callback); return true; },
    unregister: (accelerator: string) => { held.delete(accelerator); },
    isRegistered: (accelerator: string) => held.has(accelerator),
  };
}

describe("turning the shortcut on and off", () => {
  it("uses a three-modifier combo", () => expect(ADD_JOB_ACCELERATOR).toBe("CommandOrControl+Alt+Shift+J"));

  it("registers once, reads the clipboard on each press, and unregisters when off", () => {
    const shortcuts = fakeShortcuts();
    const presses: ShortcutPress[] = [];
    let clipboard = "https://jobs.example.com/role/1";
    expect(setAddJobShortcut(shortcuts, true, () => clipboard, (press) => presses.push(press))).toEqual({ enabled: true, registered: true, accelerator: ADD_JOB_ACCELERATOR });
    // Turning it on again replaces the old registration instead of failing.
    expect(setAddJobShortcut(shortcuts, true, () => clipboard, (press) => presses.push(press)).registered).toBe(true);
    shortcuts.held.get(ADD_JOB_ACCELERATOR)!();
    clipboard = "no link here";
    shortcuts.held.get(ADD_JOB_ACCELERATOR)!();
    expect(presses).toEqual([{ url: "https://jobs.example.com/role/1" }, { url: null }]);
    expect(setAddJobShortcut(shortcuts, false, () => clipboard, () => undefined)).toEqual({ enabled: false, registered: false, accelerator: ADD_JOB_ACCELERATOR });
    expect(shortcuts.held.size).toBe(0);
  });

  it("reports a combo another app holds instead of failing silently", () => {
    expect(setAddJobShortcut(fakeShortcuts(true), true, () => "", () => undefined)).toMatchObject({ enabled: true, registered: false });
  });
});
