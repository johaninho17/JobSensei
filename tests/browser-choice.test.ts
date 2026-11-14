import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { availableBrowsers, browserCommand, browserOpener, readBrowserChoice, saveBrowserChoice } from "../electron/browser-choice";

const macInstalled = (apps: string[]) => (path: string) => apps.some((app) => path === `/Applications/${app}.app`);
const winEnv = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\alex\\AppData\\Local" };

describe("where web links open (#5)", () => {
  it("offers the default plus the browsers installed; Safari only on macOS", () => {
    expect(availableBrowsers("darwin", macInstalled(["Safari", "Google Chrome"]))).toEqual(["default", "safari", "chrome"]);
    expect(availableBrowsers("win32", (path) => path === "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", winEnv)).toEqual(["default", "edge"]);
    expect(availableBrowsers("linux", () => true)).toEqual(["default"]);
  });
  it("opens the chosen browser with the link, or the default when it is missing", () => {
    expect(browserCommand("chrome", "https://jobs.example.com/1", "darwin", macInstalled(["Google Chrome"]))).toEqual({ command: "open", args: ["-a", "Google Chrome", "https://jobs.example.com/1"] });
    expect(browserCommand("firefox", "https://jobs.example.com/1", "darwin", macInstalled(["Google Chrome"]))).toBeNull();
    expect(browserCommand("default", "https://jobs.example.com/1", "darwin", () => true)).toBeNull();
    expect(browserCommand("chrome", "https://jobs.example.com/1", "win32", (path) => path.endsWith("chrome.exe"), winEnv)).toEqual({ command: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", args: ["https://jobs.example.com/1"] });
  });
  it("saves the choice per computer and ignores unknown values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sensei-browser-"));
    expect(await readBrowserChoice(dir)).toBe("default");
    await saveBrowserChoice(dir, "chrome");
    expect(await readBrowserChoice(dir)).toBe("chrome");
    expect(await saveBrowserChoice(dir, "netscape")).toBe("default");
  });
  it("falls back to the default browser when the chosen one fails to start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sensei-browser-"));
    await saveBrowserChoice(dir, "chrome");
    const opened: string[] = [];
    const ran: string[][] = [];
    const fallback = async (url: string) => { opened.push(url); };
    await browserOpener(() => dir, fallback, async (command, args) => { ran.push([command, ...args]); }, "darwin", macInstalled(["Google Chrome"]))("https://jobs.example.com/2");
    expect(ran).toEqual([["open", "-a", "Google Chrome", "https://jobs.example.com/2"]]);
    expect(opened).toEqual([]);
    await browserOpener(() => dir, fallback, async () => { throw new Error("not found"); }, "darwin", macInstalled(["Google Chrome"]))("https://jobs.example.com/3");
    expect(opened).toEqual(["https://jobs.example.com/3"]);
  });
});
