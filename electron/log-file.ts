// A log file a user can send when something goes wrong (Docs → Troubleshooting): everything the main process writes
// to the console, with the time, in <app data>/logs/main.log. The newest 1 MB is kept (the previous one as main.log.1).
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { format } from "node:util";

const LIMIT = 1_000_000;

export function installLogFile(path: string): void {
  try { mkdirSync(dirname(path), { recursive: true }); } catch { return; }
  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        if ((statSync(path, { throwIfNoEntry: false })?.size ?? 0) > LIMIT) renameSync(path, `${path}.1`);
        appendFileSync(path, `${new Date().toISOString()} ${level.toUpperCase()} ${format(...args)}\n`);
      } catch { /* the log is a convenience; never let it break the app */ }
    };
  }
  console.info(`Log started (${process.platform}, ${process.arch}).`);
}
