// The scheduled search, one owner for both callers: the OS schedule's runner (app closed) and the app itself when it
// opens or the computer wakes and the day's search hasn't run (src/shared/job-search.ts `dailyRunDue` decides).
// Watched companies always; Agy's web search on the days the user chose; a run whose Agy part failed is retried once.
import { autoDraftPicks, dailyRunDue, scheduledAgyToday, type SearchRun } from "../src/shared/job-search";
import { reachedInterview } from "../src/shared/tracker";
import { pruneHeadlessConversations } from "./agy-home";
import { readCandidateProfile } from "./candidate-profile";
import { listJobFolders } from "./job-folders";
import { RATING_SCHEMA, SEARCH_SCHEMA, SEARCH_TIMEOUT_SECONDS, jobsForSearch, readSearchSettings, readSearchState, releaseSearchLock, runSearch, saveSearchState, searchLearning, takeSearchLock } from "./job-search";
import { headlessAgy } from "./question-agent";
import { resolveAgyExecutable } from "./terminal";
import { writeMorningSummary } from "./today";

export type ScheduledOutcome = { ran: false; reason: string } | { ran: true; run: SearchRun; picks: number; summaryLine: string | null };

export async function runScheduledSearch(deps: {
  workspace: string;
  agyHome: () => Promise<string | null>;
  log?: (line: string) => Promise<unknown>;
  /** Waits for the network after a wake; false skips the run (it tries again later). */
  waitForNetwork?: () => Promise<boolean>;
  onUpdate?: Parameters<typeof runSearch>[0]["onUpdate"];
  now?: () => Date;
}): Promise<ScheduledOutcome> {
  const { workspace } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (async () => undefined);
  const profile = await readCandidateProfile(workspace).catch(() => null);
  const settings = await readSearchSettings(workspace, profile);
  if (!settings.schedule.enabled) return { ran: false, reason: "Schedule is off in Search settings." };
  if (!settings.titles.length) return { ran: false, reason: "No job titles in Search settings." };
  // Daily mode: only the window's first chance runs (and one Agy-only retry when Agy failed in it).
  let agyOnly = false;
  if (settings.schedule.mode === "daily") {
    const due = dailyRunDue((await readSearchState(workspace)).runs, settings.schedule, now());
    if (!due.due) return { ran: false, reason: due.reason };
    agyOnly = due.agyOnly;
  }
  const withAgy = scheduledAgyToday(settings.schedule, now());
  if (agyOnly && !withAgy) return { ran: false, reason: "Agy's search isn't set for today." };
  if (deps.waitForNetwork && !(await deps.waitForNetwork())) return { ran: false, reason: "No network after waiting; the search will try again at the next login, wake, or set time." };
  const lock = await takeSearchLock(workspace, "schedule");
  if (!lock.ok) return { ran: false, reason: `A search started from the ${lock.by} is already running.` };
  try {
    const agyPath = withAgy ? resolveAgyExecutable() : null;
    const agyHome = agyPath ? await deps.agyHome().catch(() => null) : null;
    const allJobs = await listJobFolders(workspace).catch(() => []);
    const { existingKeys, companies } = await jobsForSearch(workspace, allJobs.map((job) => ({ id: job.id, company: job.company, title: job.title, reachedInterview: reachedInterview(job) })));
    const { run } = await runSearch({
      workspace,
      profile,
      scheduled: true,
      agyOnly,
      existingKeys,
      jobCompanies: companies,
      learned: searchLearning(allJobs),
      runner: agyPath && agyHome ? headlessAgy({ agyPath, agyHome, cwd: workspace, timeoutSeconds: SEARCH_TIMEOUT_SECONDS, jsonSchema: SEARCH_SCHEMA }) : null,
      rater: agyPath && agyHome ? headlessAgy({ agyPath, agyHome, cwd: workspace, timeoutSeconds: 240, jsonSchema: RATING_SCHEMA }) : null,
      onUpdate: deps.onUpdate,
    });
    // Strong matches are marked for drafts; the app queues them (within the daily cap).
    const state = await readSearchState(workspace);
    const picks = run.status === "done" ? autoDraftPicks({ ...state, items: state.items.filter((item) => item.runId === run.id) }, settings) : [];
    if (picks.length) await saveSearchState(workspace, { ...state, pendingDrafts: [...new Set([...state.pendingDrafts, ...picks.map((item) => item.id)])] });
    await log(`${agyOnly ? "Agy retry " : ""}${run.status}: ${run.found} links, ${run.added} new, ${run.rated} rated, ${picks.length} marked for drafts${run.error ? `; ${run.error}` : ""}${withAgy ? (agyPath ? "" : "; Agy not found, watched companies only") : "; watched companies only (Search settings)"}`);
    // Second step, after the search: the morning summary (closed postings, what's due, questions), no Agy.
    const summary = await writeMorningSummary(workspace, { jobs: allJobs, profile }).catch((error) => { void log(`summary error: ${error instanceof Error ? error.message : String(error)}`); return null; });
    if (agyHome) await pruneHeadlessConversations(agyHome).catch(() => undefined);
    return { ran: true, run, picks: picks.length, summaryLine: summary?.line ?? null };
  } finally {
    await releaseSearchLock(workspace);
  }
}
