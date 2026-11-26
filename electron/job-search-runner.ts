/**
 * Scheduled Job Search, started by the OS schedule (launchd on macOS, Task Scheduler on Windows) with the app's own
 * runtime as Node (ELECTRON_RUN_AS_NODE=1), so it runs while the app is closed. Same run as Run now: watched
 * companies, one Agy search, the app's link checks, quick fit, and Agy's light rating. Strong matches are only marked
 * for drafts; the app queues them when it next runs, because the app owns the job queue.
 *
 * Usage: <runtime> job-search-runner.js --workspace <path> --user-data <path>
 */
import { execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prepareAgyHome } from "./agy-home";
import { JOB_SEARCH_DIR } from "./job-search";
import { runScheduledSearch } from "./scheduled-search";
import { appRoot } from "./terminal";

export function runnerArgs(argv: string[]): { workspace: string; userData: string } | null {
  const value = (flag: string) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] ?? null : null; };
  const workspace = value("--workspace");
  const userData = value("--user-data");
  return workspace && userData ? { workspace: resolve(workspace), userData: resolve(userData) } : null;
}

/** Right after a wake the network can take a while (Wi-Fi, VPN, captive portals); waits up to about 10 minutes. */
export async function waitForNetwork(fetcher: typeof fetch = fetch, tries = 20, delayMs = 30_000): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetcher("https://www.google.com/generate_204", { method: "HEAD", signal: AbortSignal.timeout(8_000) });
      if (response.status < 500) return true;
    } catch { /* offline: wait and try again */ }
    if (attempt < tries - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

/** A desktop notification without a window (macOS only; Windows shows the result when the app opens). */
function notify(title: string, body: string): void {
  if (process.platform !== "darwin") return;
  const quote = (text: string) => `"${text.replace(/["\\]/g, "")}"`;
  execFile("osascript", ["-e", `display notification ${quote(body)} with title ${quote(title)}`], () => undefined);
}

async function main(): Promise<number> {
  const args = runnerArgs(process.argv.slice(2));
  if (!args) { console.error("Usage: job-search-runner.js --workspace <path> --user-data <path>"); return 2; }
  const { workspace, userData } = args;
  const logFile = join(workspace, JOB_SEARCH_DIR, "scheduled.log");
  await mkdir(join(workspace, JOB_SEARCH_DIR), { recursive: true });
  const log = (line: string) => appendFile(logFile, `${new Date().toISOString()} ${line}\n`).catch(() => undefined);
  try {
    const outcome = await runScheduledSearch({
      workspace,
      agyHome: () => prepareAgyHome(userData, workspace, [], { appRoot: appRoot(), runtimePath: process.execPath }),
      log,
      waitForNetwork: () => waitForNetwork(),
    });
    if (!outcome.ran) {
      // "Already searched" is the usual answer on later wakes; only unusual reasons go to the log.
      if (!/already searched|not a search day/.test(outcome.reason)) await log(outcome.reason);
      return 0;
    }
    const { run, picks } = outcome;
    if (run.status === "failed") notify("JobSensei search didn't finish", run.error ?? "Open Job Search for details.");
    else notify("JobSensei: new matches", `${run.added} new match${run.added === 1 ? "" : "es"}.${picks ? ` ${picks} will be drafted when you open the app.` : ""}${run.agyFailed ? " Agy's search will try once more later today." : ""}`);
    return 0;
  } catch (error) {
    await log(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (require.main === module) void main().then((code) => { process.exitCode = code; });
