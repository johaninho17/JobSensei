// Which browser web links open in: a setting per computer (not per workspace or candidate), kept in the app's own data
// folder. `electron/open-link.ts` decides which links leave the app; this file decides where they go. A chosen browser
// that is missing or fails to start falls back to the system default, so a link always opens.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "./persistence";

export const BROWSER_CHOICES = ["default", "safari", "chrome", "edge", "firefox"] as const;
export type BrowserChoice = (typeof BROWSER_CHOICES)[number];

export const BROWSER_NAMES: Record<BrowserChoice, string> = { default: "Default browser", safari: "Safari", chrome: "Chrome", edge: "Edge", firefox: "Firefox" };

const MAC_APPS: Partial<Record<BrowserChoice, string>> = { safari: "Safari", chrome: "Google Chrome", edge: "Microsoft Edge", firefox: "Firefox" };
const WINDOWS_EXES: Partial<Record<BrowserChoice, string[]>> = {
  chrome: ["Google\\Chrome\\Application\\chrome.exe"],
  edge: ["Microsoft\\Edge\\Application\\msedge.exe"],
  firefox: ["Mozilla Firefox\\firefox.exe"],
};

/** The browsers this computer offers: the default always, then those installed. Safari only on macOS. */
export function availableBrowsers(platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = existsSync, env: NodeJS.ProcessEnv = process.env): BrowserChoice[] {
  return BROWSER_CHOICES.filter((choice) => choice === "default" || installedPath(choice, platform, exists, env) !== null);
}

function installedPath(choice: BrowserChoice, platform: NodeJS.Platform, exists: (path: string) => boolean, env: NodeJS.ProcessEnv): string | null {
  if (platform === "darwin") {
    const app = MAC_APPS[choice];
    if (!app) return null;
    return [`/Applications/${app}.app`, join(homedir(), "Applications", `${app}.app`)].find(exists) ?? null;
  }
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter((root): root is string => Boolean(root));
    for (const exe of WINDOWS_EXES[choice] ?? []) for (const root of roots) if (exists(`${root}\\${exe}`)) return `${root}\\${exe}`;
  }
  return null;
}

/** The command that opens `url` in the chosen browser, or null for the system default (Electron's `shell.openExternal`). */
export function browserCommand(choice: BrowserChoice, url: string, platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = existsSync, env: NodeJS.ProcessEnv = process.env): { command: string; args: string[] } | null {
  if (choice === "default") return null;
  const path = installedPath(choice, platform, exists, env);
  if (!path) return null;
  if (platform === "darwin") return { command: "open", args: ["-a", MAC_APPS[choice]!, url] };
  if (platform === "win32") return { command: path, args: [url] };
  return null;
}

const SETTINGS_FILE = "browser.json";

export async function readBrowserChoice(userData: string): Promise<BrowserChoice> {
  try {
    const value = (JSON.parse(await readFile(join(userData, SETTINGS_FILE), "utf8")) as { browser?: unknown }).browser;
    return BROWSER_CHOICES.includes(value as BrowserChoice) ? value as BrowserChoice : "default";
  } catch {
    return "default";
  }
}

export async function saveBrowserChoice(userData: string, choice: unknown): Promise<BrowserChoice> {
  const browser = BROWSER_CHOICES.includes(choice as BrowserChoice) ? choice as BrowserChoice : "default";
  await writeJsonAtomic(join(userData, SETTINGS_FILE), { browser });
  return browser;
}

type Runner = (command: string, args: string[]) => Promise<void>;

/** Starts a browser and resolves when it launched (macOS `open` exits 0), rejects when it could not. */
const run: Runner = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "ignore", detached: process.platform === "win32" });
  child.once("error", reject);
  if (process.platform === "win32") { child.unref(); resolve(); return; }
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
});

/**
 * The opener every app window uses: the chosen browser when it is installed and starts, otherwise the system default.
 * `fallback` is Electron's `shell.openExternal`.
 */
export function browserOpener(userData: () => string, fallback: (url: string) => Promise<unknown>, runner: Runner = run, platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = existsSync): (url: string) => Promise<unknown> {
  return async (url) => {
    const command = browserCommand(await readBrowserChoice(userData()), url, platform, exists);
    if (!command) return fallback(url);
    try {
      await runner(command.command, command.args);
    } catch (error) {
      console.error(`Could not open the chosen browser (${String(error)}); using the default.`);
      return fallback(url);
    }
  };
}
