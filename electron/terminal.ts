import { spawn, type IPty } from "node-pty";
import { join, resolve } from "node:path";
import type { ContextManifest } from "../src/shared/schemas";

export class TerminalSession {
  private process: IPty | null = null;
  private cwd = process.cwd();
  private workspacePath = process.cwd();
  private manifest: ContextManifest | null = null;
  private pendingInput: string[] = [];
  private onDataCallback: ((data: string) => void) | null = null;
  private onExitCallback: ((code: number) => void) | null = null;

  start(cwd: string, workspacePath: string, manifest: ContextManifest | null = null): { cwd: string } {
    this.stop();
    this.cwd = resolve(cwd);
    this.workspacePath = resolve(workspacePath);
    this.manifest = manifest;
    const windows = process.platform === "win32";
    const shell = windows ? process.env.ComSpec || "powershell.exe" : process.env.SHELL || "/bin/zsh";
    this.process = spawn(shell, windows ? [] : ["-l"], { name: "xterm-256color", cols: 100, rows: 28, cwd: this.cwd, env: this.environment() });
    this.process.onData((data) => this.onDataCallback?.(data));
    const ptyProcess = this.process;
    ptyProcess.onExit(({ exitCode }) => { if (this.process === ptyProcess) this.process = null; this.onExitCallback?.(exitCode); });
    for (const input of this.pendingInput.splice(0)) ptyProcess.write(input);
    return { cwd: this.cwd };
  }

  restart(): { cwd: string } { return this.start(this.cwd, this.workspacePath, this.manifest); }
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
  onData(callback: (data: string) => void): void { this.onDataCallback = callback; }
  onExit(callback: (code: number) => void): void { this.onExitCallback = callback; }
  private environment(): NodeJS.ProcessEnv {
    return { ...process.env, TERM: "xterm-256color", SENSEI_WORKSPACE: this.workspacePath, SENSEI_SELECTED_JOBS: this.manifest?.selectedJobIds.join(",") ?? "", SENSEI_SELECTED_CONTEXT_FILES: this.manifest?.selectedCareerPaths.concat(this.manifest.selectedJobFiles).join(",") ?? "", SENSEI_SELECTED_STRUCTURED_CONTEXT: this.manifest?.selectedStructuredPaths.join(",") ?? "", SENSEI_SELECTED_BROAD_CONTEXT: this.manifest?.selectedBroadPaths.join(",") ?? "", SENSEI_CONTEXT_MANIFEST: this.manifest ? join(this.workspacePath, ".sensei", "active-context.json") : "", SENSEI_CONTEXT_POLICY: this.manifest ? join(this.workspacePath, this.manifest.policyPaths[0] ?? "context/denylist.md") : "", SENSEI_FALLBACK_REFERENCES: this.manifest ? join(this.workspacePath, this.manifest.fallbackReferenceRoots[0] ?? "fallback-references") : "" };
  }
}

export function defaultTerminalCwd(projectRoot: string): string { return resolve(projectRoot); }
