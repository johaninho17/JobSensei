// Job Search IPC. Loaded only when the edition has `features.jobSearch` (src/shared/edition.ts).
import { ipcMain, shell } from "electron";
import { join } from "node:path";
import { prepareAgyHome } from "./agy-home";
import { readCandidateProfile } from "./candidate-profile";
import type { FeatureContext } from "./feature-context";
import { boardRef } from "./job-boards";
import { invalidateJobCache, listJobFolders } from "./job-folders";
import { RATING_SCHEMA, SEARCH_SCHEMA, clearPendingDrafts, rateItems, releaseSearchLock, searchLockHolder, takeSearchLock, readSearchSettings, readSearchState, runSearch, saveFoundJob, saveSearchSettings, setItemStatus, stageFoundJob } from "./job-search";
import { readPostingRecord } from "./posting-record";
import { headlessAgy } from "./question-agent";
import { installSchedule, removeSchedule, scheduleInfo } from "./search-schedule";
import { resolveAgyExecutable } from "./terminal";
import { jobKey, type SearchRun, type SearchStatus } from "../src/shared/job-search";
import { reachedInterview } from "../src/shared/tracker";

export function registerSearchIpc(ctx: FeatureContext): void {
  // The same app-owned Agy home (and sign-in) as the terminal; prepared here when the terminal hasn't started yet.
  const home = async (workspace: string) => ctx.agyHome() ?? await prepareAgyHome(ctx.userDataPath(), workspace, [], { appRoot: ctx.appRoot(), runtimePath: process.execPath });
  // Job Search: one headless Agy run finds links; the app opens, saves, and rates each one (electron/job-search.ts).
  // The run lives here, not in the page: leaving Job Search never stops it, and every page hears its progress.
  let searchStatus: SearchStatus = { running: false, source: null, progress: null, startedAt: null };
  const setSearchStatus = (next: SearchStatus) => { searchStatus = next; ctx.mainWindow()?.webContents.send("search:status", next); };
  const foundIds = (value: unknown) => (Array.isArray(value) ? value : [value]).map(String).filter((id) => /^find-[a-z0-9-]{4,40}$/.test(id));
  ipcMain.handle("search:get", async () => {
    const workspace = ctx.requireWorkspace();
    const profile = await readCandidateProfile(workspace).catch(() => null);
    // A search the OS schedule started (the app was closed or in the background) shows as running too.
    const scheduled = !searchStatus.running && (await searchLockHolder(workspace))?.by === "schedule";
    return { settings: await readSearchSettings(workspace, profile), state: await readSearchState(workspace), status: scheduled ? { running: true, source: "search" as const, progress: null, startedAt: null, scheduled: true } : searchStatus };
  });
  const scheduleTarget = (workspace: string) => ({ runtime: process.execPath, runner: join(ctx.appRoot(), "dist-electron", "electron", "job-search-runner.js"), workspace, userData: ctx.userDataPath() });
  /** Saves the settings and makes the OS schedule match them (installed when on, removed when off). */
  ipcMain.handle("search:save-settings", async (_event, input: unknown) => {
    const workspace = ctx.requireWorkspace();
    const settings = await saveSearchSettings(workspace, input);
    const info = await scheduleInfo(ctx.userDataPath());
    if (settings.schedule.enabled) await installSchedule(scheduleTarget(workspace), settings.schedule);
    else if (info.installed) await removeSchedule(ctx.userDataPath());
    return settings;
  });
  ipcMain.handle("search:schedule-info", async () => scheduleInfo(ctx.userDataPath()));
  ipcMain.handle("search:clear-pending", async (_event, ids: unknown) => clearPendingDrafts(ctx.requireWorkspace(), foundIds(ids)));
  /** Starts a run and returns at once; "watched" checks watched companies only (no Agy, no quota). */
  ipcMain.handle("search:run", async (_event, mode: unknown) => {
    if (searchStatus.running) throw new Error("A search is already running.");
    const watchedOnly = mode === "watched";
    const agyPath = watchedOnly ? null : resolveAgyExecutable();
    if (!watchedOnly && !agyPath) throw new Error("Agy isn't installed, so the search can't run. Check watched companies works without it.");
    const workspace = ctx.requireWorkspace();
    const lock = await takeSearchLock(workspace, "app");
    if (!lock.ok) throw new Error(lock.by === "schedule" ? "A scheduled search is running right now; its matches appear here when it finishes." : "A search is already running.");
    setSearchStatus({ running: true, source: watchedOnly ? "watched" : "search", progress: null, startedAt: new Date().toISOString() });
    void (async () => {
      let result: { run: SearchRun } | null = null;
      try {
        const agyHome = agyPath ? await home(workspace) : null;
        const jobs = await listJobFolders(workspace);
        const existingKeys = new Set(jobs.map((job) => jobKey(job.company, job.title)).filter((key): key is string => Boolean(key)));
        result = await runSearch({
          workspace,
          profile: await readCandidateProfile(workspace).catch(() => null),
          runner: agyPath && agyHome ? headlessAgy({ agyPath, agyHome, cwd: workspace, timeoutSeconds: 420, jsonSchema: SEARCH_SCHEMA }) : null,
          rater: agyPath && agyHome ? headlessAgy({ agyPath, agyHome, cwd: workspace, timeoutSeconds: 240, jsonSchema: RATING_SCHEMA }) : null,
          existingKeys,
          onUpdate: (state) => ctx.mainWindow()?.webContents.send("search:updated", state),
          onProgress: (progress) => setSearchStatus({ ...searchStatus, progress }),
        });
      } catch (error) {
        console.error("Job search failed:", error);
      } finally {
        await releaseSearchLock(workspace).catch(() => undefined);
        setSearchStatus({ running: false, source: null, progress: null, startedAt: null });
        ctx.mainWindow()?.webContents.send("search:finished", result?.run ?? null);
      }
    })();
  });
  /** Agy's light rating for chosen matches (up to 10, one call), in the background like a search. */
  ipcMain.handle("search:rate", async (_event, ids: unknown) => {
    if (searchStatus.running) throw new Error("A search is already running.");
    const chosen = foundIds(ids).slice(0, 10);
    if (!chosen.length) return;
    const agyPath = resolveAgyExecutable();
    if (!agyPath) throw new Error("Agy isn't installed, so matches can't be rated.");
    const workspace = ctx.requireWorkspace();
    const lock = await takeSearchLock(workspace, "app");
    if (!lock.ok) throw new Error("A search is running right now; rate these when it finishes.");
    setSearchStatus({ running: true, source: "rating", progress: { phase: "rating", checked: 0, total: chosen.length }, startedAt: new Date().toISOString() });
    void (async () => {
      let message = "";
      try {
        const agyHome = await home(workspace);
        const rated = await rateItems({ workspace, profile: await readCandidateProfile(workspace).catch(() => null), rater: headlessAgy({ agyPath, agyHome, cwd: workspace, timeoutSeconds: 240, jsonSchema: RATING_SCHEMA }), ids: chosen, onUpdate: (state) => ctx.mainWindow()?.webContents.send("search:updated", state) });
        message = `Agy rated ${rated} of ${chosen.length} match${chosen.length === 1 ? "" : "es"}.`;
      } catch (error) {
        message = `Agy couldn't rate them: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`;
      } finally {
        await releaseSearchLock(workspace).catch(() => undefined);
        setSearchStatus({ running: false, source: null, progress: null, startedAt: null });
        ctx.mainWindow()?.webContents.send("search:rated", message);
      }
    })();
  });
  /** Companies from your jobs whose postings are on Ashby, Greenhouse, or Lever, for the watched list. */
  ipcMain.handle("search:suggest-watched", async () => {
    const workspace = ctx.requireWorkspace();
    const jobs = await listJobFolders(workspace);
    const found = new Map<string, { board: "ashby" | "greenhouse" | "lever"; slug: string; name: string; jobs: number; interviewed: boolean }>();
    for (const job of jobs) {
      const url = (await readPostingRecord(join(workspace, "jobs", job.id)).catch(() => null))?.url;
      const ref = url ? boardRef(url) : null;
      if (!ref) continue;
      const key = `${ref.board}:${ref.slug.toLowerCase()}`;
      const current = found.get(key) ?? { ...ref, name: job.company ?? ref.slug, jobs: 0, interviewed: false };
      current.jobs += 1;
      current.interviewed ||= reachedInterview(job);
      found.set(key, current);
    }
    return [...found.values()].sort((a, b) => Number(b.interviewed) - Number(a.interviewed) || b.jobs - a.jobs || a.name.localeCompare(b.name));
  });
  ipcMain.handle("search:set-status", async (_event, ids: unknown, status: unknown) => {
    if (status !== "new" && status !== "dismissed") throw new Error("Use Save or Add to queue for those.");
    return setItemStatus(ctx.requireWorkspace(), foundIds(ids), status);
  });
  ipcMain.handle("search:save-job", async (_event, id: unknown) => {
    const [itemId] = foundIds(id);
    if (!itemId) throw new Error("That isn't a found job.");
    const workspace = ctx.requireWorkspace();
    const jobId = await saveFoundJob(workspace, itemId);
    invalidateJobCache(workspace, join(workspace, "jobs", jobId));
    return jobId;
  });
  // Opens only a found job's own posting link (taken from the inbox, never from the renderer).
  ipcMain.handle("search:open-posting", async (_event, id: unknown) => {
    const [itemId] = foundIds(id);
    const item = (await readSearchState(ctx.requireWorkspace())).items.find((candidate) => candidate.id === itemId);
    if (item && /^https?:\/\//i.test(item.url)) await shell.openExternal(item.url);
  });
  ipcMain.handle("search:stage", async (_event, id: unknown, pasteId: unknown, auto: unknown) => {
    const [itemId] = foundIds(id);
    if (!itemId || typeof pasteId !== "string") throw new Error("That isn't a found job.");
    return stageFoundJob(ctx.requireWorkspace(), itemId, pasteId, auto === true);
  });
}
