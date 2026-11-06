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
import { autoDraftPicks } from "../src/shared/job-search";
import { prepareAgyHome } from "./agy-home";
import { readCandidateProfile } from "./candidate-profile";
import { listJobFolders } from "./job-folders";
import { JOB_SEARCH_DIR, RATING_SCHEMA, SEARCH_SCHEMA, readSearchSettings, readSearchState, releaseSearchLock, runSearch, saveSearchState, takeSearchLock } from "./job-search";
import { jobKey } from "../src/shared/job-search";
import { headlessAgy } from "./question-agent";
import { appRoot, resolveAgyExecutable } from "./terminal";

export function runnerArgs(argv: string[]): { workspace: string; userData: string } | null {
  const value = (flag: string) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] ?? null : null; };
  const workspace = value("--workspace");
  const userData = value("--user-data");
  return workspace && userData ? { workspace: resolve(workspace), userData: resolve(userData) } : null;
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

  const profile = await readCandidateProfile(workspace).catch(() => null);
  const settings = await readSearchSettings(workspace, profile);
  if (!settings.schedule.enabled) { await log("Schedule is off in Search settings; nothing to do."); return 0; }
  if (!settings.titles.length) { await log("No job titles in Search settings; skipped."); return 0; }
  const lock = await takeSearchLock(workspace, "schedule");
  if (!lock.ok) { await log(`A search started from the ${lock.by} is already running; skipped.`); return 0; }
  try {
    const agyPath = resolveAgyExecutable();
    const agyHome = agyPath ? await prepareAgyHome(userData, workspace, [], { appRoot: appRoot(), runtimePath: process.execPath }) : null;
    const jobs = await listJobFolders(workspace).catch(() => []);
    const existingKeys = new Set(jobs.map((job) => jobKey(job.company, job.title)).filter((key): key is string => Boolean(key)));
    const { run } = await runSearch({
      workspace,
      profile,
      scheduled: true,
      existingKeys,
      runner: agyPath && agyHome ? headlessAgy({ agyPath, agyHome, cwd: workspace, timeoutSeconds: 420, jsonSchema: SEARCH_SCHEMA }) : null,
      rater: agyPath && agyHome ? headlessAgy({ agyPath, agyHome, cwd: workspace, timeoutSeconds: 240, jsonSchema: RATING_SCHEMA }) : null,
    });
    // Strong matches are marked for drafts; the app queues them (within the daily cap) when it next runs.
    const state = await readSearchState(workspace);
    const picks = run.status === "done" ? autoDraftPicks({ ...state, items: state.items.filter((item) => item.runId === run.id) }, settings) : [];
    if (picks.length) await saveSearchState(workspace, { ...state, pendingDrafts: [...new Set([...state.pendingDrafts, ...picks.map((item) => item.id)])] });
    await log(`${run.status}: ${run.found} links, ${run.added} new, ${run.rated} rated, ${picks.length} marked for drafts${run.error ? `; ${run.error}` : ""}${agyPath ? "" : "; Agy not found, watched companies only"}`);
    if (run.status === "failed") notify("JobSensei search didn't finish", run.error ?? "Open Job Search for details.");
    else if (run.added) notify("JobSensei found new jobs", `${run.added} new match${run.added === 1 ? "" : "es"}${picks.length ? `; ${picks.length} will be drafted when you open the app` : ""}.`);
    return 0;
  } catch (error) {
    await log(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await releaseSearchLock(workspace);
  }
}

if (require.main === module) void main().then((code) => { process.exitCode = code; });
