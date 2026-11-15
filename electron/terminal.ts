import type { IPty } from "node-pty";
import { workspaceFile } from "./layout";
import { statSync } from "node:fs";
import { execFile } from "node:child_process";
import { delimiter, dirname, join, resolve } from "node:path";
import type { ContextManifest } from "../src/shared/schemas";
import { classifyAgyScreen, plainTerminalText } from "../src/shared/job-queue";

let ptyModule: typeof import("node-pty") | null = null;
let ptyLoadError: string | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ptyModule = require("node-pty");
} catch (error) {
  ptyLoadError = error instanceof Error ? error.message : String(error);
  console.warn("Sensei: node-pty failed to load. Terminal session will be disabled.", ptyLoadError);
}

export function resolveAgyExecutable(): string | null {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const binaryName = process.platform === "win32" ? "agy.exe" : "agy";
  const candidates: string[] = [];

  // 1. Packaged application resources (offline bundled binary)
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, "bin", binaryName));
  }
  // Local project development resources fallback
  candidates.push(join(__dirname, "../../build-resources/bin", process.platform === "win32" ? "win" : "mac", binaryName));
  candidates.push(join(__dirname, "../../resources/bin", binaryName));

  // 2. Standard user-level and system candidate paths
  candidates.push(join(home, ".local", "bin", "agy"));
  candidates.push("/usr/local/bin/agy");
  candidates.push("/opt/homebrew/bin/agy");

  if (process.platform === "win32") {
    candidates.push(join(home, "AppData", "Local", "agy", "bin", "agy.exe"));
    candidates.push(join(home, "AppData", "Local", "Programs", "agy", "agy.exe"));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }

  // 3. Fallback to system PATH
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of pathEntries) {
    const candidate = join(dir, binaryName);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

/**
 * Agy's start flags: `--sandbox` keeps its shell commands inside the workspace (macOS/Linux; untested on Windows);
 * `--continue` resumes the open candidate's last conversation (Recruiter Edition).
 */
export function agyArgs(windows: boolean, continueConversation: boolean, conversationId: string | null = null): string[] {
  const resume = conversationId ? ["--conversation", conversationId] : continueConversation ? ["--continue"] : [];
  return [...(windows ? [] : ["--sandbox"]), ...resume];
}

/** Repository root holding package.json (compiled: dist-electron/electron → ../..; source: electron → ..). */
export function appRoot(): string {
  for (const candidate of [resolve(__dirname, "..", ".."), resolve(__dirname, "..")]) {
    try {
      if (statSync(join(candidate, "package.json")).isFile()) return candidate;
    } catch {
      // try the next layout
    }
  }
  return resolve(__dirname, "..", "..");
}

export class TerminalSession {
  private process: IPty | null = null;
  private cwd = process.cwd();
  private workspacePath = process.cwd();
  private manifest: ContextManifest | null = null;
  private pendingInput: string[] = [];
  private onDataCallback: ((data: string) => void) | null = null;
  private onExitCallback: ((code: number) => void) | null = null;
  /** App-owned Agy home (see agy-home.ts); null runs Agy with the user's own home. */
  private agyHome: string | null = null;
  private startedAt: number | null = null;
  private runningAgy = false;
  private recentOutput = "";
  private lastOutputAt: number | null = null;
  private plainTail = "";
  private screen: "ready" | "blocked" | "unknown" = "unknown";

  /** What the job queue needs to know before it sends a prompt (see agyReadiness). */
  status(): { running: boolean; agy: boolean; startedAt: number | null; lastOutputAt: number | null; screen: "ready" | "blocked" | "unknown"; recentOutput: string } {
    return { running: Boolean(this.process), agy: this.runningAgy, startedAt: this.startedAt, lastOutputAt: this.lastOutputAt, screen: this.screen, recentOutput: this.recentOutput.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "") };
  }

  setAgyHome(home: string | null): void { this.agyHome = home; }

  /**
   * Recruiter Edition: start Agy in the open candidate's most recent conversation (`--continue`). Each candidate's
   * history is swapped into the shared home when they are opened, so "most recent" is always their own; a later job
   * for the same candidate starts from what Agy already read for them, which is much faster (2026-11-12: 114 s → 33 s).
   */
  setContinueConversation(on: boolean): void { this.continueConversation = on; }
  private continueConversation = false;

  /** For the next start only: resume this conversation (Agy page → Conversations), or start a new one (`null`). */
  openConversationNext(id: string | null): void { this.nextConversation = id; }
  private nextConversation: string | null | undefined = undefined;

  start(cwd: string, workspacePath: string, manifest: ContextManifest | null = null): { cwd: string; agyStarted: boolean } {
    this.stop();
    this.cwd = resolve(cwd);
    this.workspacePath = resolve(workspacePath);
    this.manifest = manifest;
    if (!ptyModule) {
      const errorMsg = ptyLoadError
        ? `Terminal helper (node-pty) could not be loaded: ${ptyLoadError}\r\nPlease check C++ build tools if using terminal on Windows.`
        : "Terminal helper is not available in this environment.";
      this.onDataCallback?.(`\r\n\x1b[33m${errorMsg}\x1b[0m\r\n`);
      return { cwd: this.cwd, agyStarted: false };
    }
    const windows = process.platform === "win32";
    const shell = windows ? process.env.ComSpec || "powershell.exe" : process.env.SHELL || "/bin/zsh";
    const agyPath = resolveAgyExecutable();
    const executable = agyPath ?? shell;
    const chosen = this.nextConversation;
    this.nextConversation = undefined;
    const args = agyPath ? agyArgs(windows, chosen === undefined ? this.continueConversation : false, chosen ?? null) : (windows ? [] : ["-l"]);
    this.process = ptyModule.spawn(executable, args, { name: "xterm-256color", cols: 100, rows: 28, cwd: this.cwd, env: this.environment(Boolean(agyPath)) });
    this.startedAt = Date.now();
    this.runningAgy = Boolean(agyPath);
    this.recentOutput = "";
    this.lastOutputAt = null;
    this.plainTail = "";
    this.screen = "unknown";
    this.process.onData((data) => {
      this.lastOutputAt = Date.now();
      this.recentOutput = (this.recentOutput + data).slice(-6000);
      // Classify as output arrives, so the screen state survives long stretches of partial redraws.
      this.plainTail = (this.plainTail + plainTerminalText(data)).slice(-2000);
      const screen = classifyAgyScreen(this.plainTail);
      if (screen !== "unknown") this.screen = screen; this.onDataCallback?.(data); });
    const ptyProcess = this.process;
    ptyProcess.onExit(({ exitCode }) => { if (this.process === ptyProcess) this.process = null; this.onExitCallback?.(exitCode); });
    for (const input of this.pendingInput.splice(0)) ptyProcess.write(input);
    return { cwd: this.cwd, agyStarted: Boolean(agyPath) };
  }

  restart(): { cwd: string; agyStarted: boolean } { return this.start(this.cwd, this.workspacePath, this.manifest); }
  setContext(manifest: ContextManifest): void {
    // The manifest is authoritative and has already been written atomically.
    // Injecting exports into a live PTY can corrupt an interactive CLI prompt.
    this.manifest = manifest;
  }
  write(data: string): void {
    if (typeof data !== "string" || data.length > 100_000) throw new Error("Terminal input is invalid or too large.");
    if (this.process) this.process.write(data);
    else if (data && this.pendingInput.reduce((total, chunk) => total + chunk.length, 0) + data.length <= 100_000) this.pendingInput.push(data);
  }
  resize(cols: number, rows: number): void { if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 500 || rows > 200) throw new Error("Terminal size is invalid."); this.process?.resize(cols, rows); }
  stop(): void { this.process?.kill(); this.process = null; this.pendingInput = []; }

  /**
   * Stops Agy and waits until it and every process it started have exited (up to `timeoutMs`, then forced), so
   * nothing writes into Agy's home afterwards. Switching candidates relies on this before it swaps their histories.
   */
  async stopAndWait(timeoutMs = 8000): Promise<void> {
    const ptyProcess = this.process;
    if (!ptyProcess) return;
    const windows = process.platform === "win32";
    // Agy is the terminal's own process, so on macOS and Linux it leads its process group.
    const target = windows ? ptyProcess.pid : -ptyProcess.pid;
    const alive = () => { try { process.kill(target, 0); return true; } catch { return false; } };
    const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
    const exited = new Promise<void>((done) => ptyProcess.onExit(() => done()));
    // Windows has no process groups: stop Agy and every process it started (its helpers can hold files open, and
    // Windows won't move an open file, so the next candidate's history couldn't be swapped in).
    if (windows) await new Promise<void>((done) => execFile("taskkill", ["/PID", String(ptyProcess.pid), "/T", "/F"], () => done()));
    this.stop();
    if (!windows) { try { process.kill(target, "SIGTERM"); } catch { /* already gone */ } }
    await Promise.race([exited, sleep(timeoutMs)]);
    const end = Date.now() + timeoutMs;
    while (alive() && Date.now() < end) await sleep(200);
    if (alive()) { try { process.kill(target, "SIGKILL"); } catch { /* already gone */ } await sleep(300); }
  }
  onData(callback: (data: string) => void): void { this.onDataCallback = callback; }
  onExit(callback: (code: number) => void): void { this.onExitCallback = callback; }
  private environment(agy = false): NodeJS.ProcessEnv {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const userLocal = home ? join(home, ".local", "bin") : "";
    const agyExecutable = resolveAgyExecutable();
    const agyDir = agyExecutable ? dirname(agyExecutable) : "";
    const currentPath = process.env.PATH ?? "";
    const extraPaths = [agyDir, userLocal, "/opt/homebrew/bin", "/usr/local/bin"].filter((p) => p && !currentPath.includes(p));
    const augmentedPath = extraPaths.length > 0 ? `${extraPaths.join(delimiter)}${delimiter}${currentPath}` : currentPath;

    const ownHome = agy && this.agyHome
      ? { HOME: this.agyHome, ...(process.platform === "win32" ? { USERPROFILE: this.agyHome } : {}), npm_config_cache: join(this.workspacePath, ".sensei", "npm-cache") }
      : {};
    // The app-owned home's bin folder holds the `sensei` command (agy-home.ts).
    const pathWithLauncher = agy && this.agyHome ? `${join(this.agyHome, "bin")}${delimiter}${augmentedPath}` : augmentedPath;
    return {
      ...process.env,
      ...ownHome,
      PATH: pathWithLauncher,
      TERM: "xterm-256color",
      SENSEI_WORKSPACE: this.workspacePath,
      // Where the app's npm scripts live, so Agy can run them from the workspace without searching.
      JOBSENSEI_APP_ROOT: appRoot(),
      SENSEI_SELECTED_JOBS: this.manifest?.selectedJobIds.join(",") ?? "",
      SENSEI_SELECTED_CONTEXT_FILES: this.manifest?.selectedCareerPaths.concat(this.manifest.selectedJobFiles).join(",") ?? "",
      SENSEI_SELECTED_STRUCTURED_CONTEXT: this.manifest?.selectedStructuredPaths.join(",") ?? "",
      SENSEI_SELECTED_BROAD_CONTEXT: this.manifest?.selectedBroadPaths.join(",") ?? "",
      SENSEI_CONTEXT_MANIFEST: this.manifest ? join(this.workspacePath, ".sensei", "active-context.json") : "",
      SENSEI_CONTEXT_POLICY: this.manifest ? workspaceFile(this.workspacePath, this.manifest.policyPaths[0] ?? "context/denylist.md") : "",
      SENSEI_FALLBACK_REFERENCES: this.manifest ? join(this.workspacePath, this.manifest.fallbackReferenceRoots[0] ?? "fallback-references") : "",
    };
  }
}

