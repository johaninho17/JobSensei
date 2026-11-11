// Candidate list IPC (Recruiter Edition, recruiter plan R1). Loaded only when the edition has `features.candidates`.
import { ipcMain } from "electron";
import { artifactPrefixFor, candidateStatusSchema, type CandidateOverview, type CandidatesState } from "../src/shared/candidates";
import { effectiveStatus, readyToSend } from "../src/shared/tracker";
import { listJobFolders } from "./job-folders";
import { createCandidateProfile } from "./candidate-profile";
import { addCandidate, candidatePath, clearActiveCandidate, deleteCandidate, readRecruiterNotes, saveRecruiterNotes, readRecruiterSettings, readRoster, renameCandidate, setActiveCandidate, setCandidateStatus } from "./candidates";
import { SettingsStore } from "./settings";
import { readJobQueue } from "./job-queue";
import { listPipeline, setPipelineStatus } from "./pipeline";
import { zipFolder } from "./zip-folder";
import { applyIntake, type CandidateIntake } from "./candidate-intake";
import { applicationReview } from "./application-review";
import { candidateAgyHomePath } from "./agy-home";
import { nextQueuedCandidate, sendPosting, setLibraryCompany, stageLibraryLink, stageLibraryPaste, suggestCandidates } from "./posting-library";
import { join } from "node:path";

export type CandidateContext = {
  /** The recruiter folder that holds `recruiter/` and `candidates/`. */
  root: () => string;
  /** Why switching must wait (a job running for the current candidate), or null. */
  busyReason: () => Promise<string | null>;
  /** Re-points the app at a candidate's folder: settings, watcher, caches, Agy home. The renderer then reloads. */
  openCandidate: (id: string, folder: string) => Promise<void>;
  /** Leaves no candidate open (after archiving the active one). */
  closeCandidate: () => Promise<void>;
  /** The app's data folder, which holds each candidate's Agy home. */
  userDataPath: () => string;
  /** Asks where to save a file; null when the user cancels. */
  chooseSavePath: (defaultName: string) => Promise<string | null>;
  /** Asks for a resume (one file) or extra candidate files (several); empty when cancelled. */
  chooseFiles: (kind: "resume" | "files") => Promise<string[]>;
};

/** Settings for one candidate live in their own folder, never in the recruiter's app settings. */
export function candidateSettingsStore(folder: string): SettingsStore {
  return new SettingsStore(join(folder, ".sensei", "app"));
}

const text = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim() || value.length > 120) throw new Error(`Enter the ${field}.`);
  return value.trim();
};

export function registerCandidateIpc(ctx: CandidateContext): void {
  const state = async (): Promise<CandidatesState> => {
    const root = ctx.root();
    const [roster, settings] = await Promise.all([readRoster(root), readRecruiterSettings(root)]);
    const active = roster.candidates.find((candidate) => candidate.id === settings.activeCandidateId && candidate.status !== "archived");
    const waiting: Record<string, number> = {};
    const overview: Record<string, CandidateOverview> = {};
    await Promise.all(roster.candidates.filter((candidate) => candidate.status !== "archived").map(async (candidate) => {
      const folder = await candidatePath(root, candidate.id);
      const [queue, settings, jobs] = await Promise.all([
        readJobQueue(folder).catch(() => null),
        candidateSettingsStore(folder).get().catch(() => null),
        listJobFolders(folder).catch(() => []),
      ]);
      const count = queue?.items.filter((item) => item.status === "queued").length ?? 0;
      if (count) waiting[candidate.id] = count;
      overview[candidate.id] = {
        resume: Boolean(settings?.baseResumePath),
        jobs: jobs.length,
        applied: jobs.filter((job) => effectiveStatus(job) === "applied").length,
        ready: jobs.filter((job) => readyToSend(job)).length,
      };
    }));
    return { candidates: roster.candidates, activeId: active?.id ?? null, waiting, overview };
  };
  const switchTo = async (id: string) => {
    const busy = await ctx.busyReason();
    if (busy) throw new Error(busy);
    const folder = await setActiveCandidate(ctx.root(), id);
    await ctx.openCandidate(id, folder);
  };

  ipcMain.handle("candidates:state", state);
  /** Adds a candidate (their folder and profile with name and file prefix), then opens them. */
  ipcMain.handle("candidates:choose-files", async (_event, kind: unknown) => ctx.chooseFiles(kind === "resume" ? "resume" : "files"));
  /** Adds a candidate with everything the recruiter has (name, base resume, extra files, notes), then opens them. */
  ipcMain.handle("candidates:add", async (_event, name: unknown, intake: unknown) => {
    const busy = await ctx.busyReason();
    if (busy) throw new Error(busy);
    const displayName = text(name, "candidate's name");
    const input = (intake && typeof intake === "object" ? intake : {}) as CandidateIntake;
    const files = Array.isArray(input.files) ? input.files.filter((path): path is string => typeof path === "string").slice(0, 50) : [];
    const resumePath = typeof input.resumePath === "string" && input.resumePath ? input.resumePath : null;
    const notes = typeof input.notes === "string" ? input.notes.slice(0, 50_000) : null;
    const entry = await addCandidate(ctx.root(), displayName);
    const folder = await candidatePath(ctx.root(), entry.id);
    const store = candidateSettingsStore(folder);
    await createCandidateProfile(folder, { fullName: displayName, artifactPrefix: artifactPrefixFor(displayName) }, await store.get());
    const result = await applyIntake(folder, store, { resumePath, files, notes });
    await switchTo(entry.id);
    return { entry, ...result };
  });
  const activeFolder = async () => {
    const { activeId } = await state();
    if (!activeId) throw new Error("Open a candidate first.");
    return candidatePath(ctx.root(), activeId);
  };
  ipcMain.handle("review:get", async (_event, jobId: unknown) => applicationReview(await activeFolder(), id(jobId)));
  ipcMain.handle("candidates:notes", async () => readRecruiterNotes(await activeFolder()));
  /** Saves the open candidate's recruiter notes; returns the context path so the renderer checks it for Agy. */
  ipcMain.handle("candidates:save-notes", async (_event, notes: unknown) => {
    if (typeof notes !== "string") throw new Error("Notes must be text.");
    return saveRecruiterNotes(await activeFolder(), notes);
  });
  // Posting library and "Who is this for?" (recruiter plan R5).
  const id = (value: unknown) => String(value ?? "");
  ipcMain.handle("library:stage-link", async (_event, url: unknown, postingId: unknown) => stageLibraryLink(ctx.root(), id(url), id(postingId)));
  ipcMain.handle("library:stage-paste", async (_event, text: unknown, postingId: unknown) => stageLibraryPaste(ctx.root(), text, id(postingId)));
  ipcMain.handle("library:set-company", async (_event, postingId: unknown, company: unknown) => setLibraryCompany(ctx.root(), id(postingId), id(company)));
  ipcMain.handle("library:suggest", async (_event, postingId: unknown) => suggestCandidates(ctx.root(), id(postingId)));
  ipcMain.handle("library:send", async (_event, postingId: unknown, candidateIds: unknown) => {
    if (!Array.isArray(candidateIds) || !candidateIds.length || candidateIds.length > 100) throw new Error("Choose at least one candidate.");
    return sendPosting(ctx.root(), id(postingId), candidateIds.map(id), (await state()).activeId);
  });
  // Export and delete (recruiter plan R6).
  ipcMain.handle("candidates:export", async (_event, candidateId: unknown) => {
    const roster = await readRoster(ctx.root());
    const entry = roster.candidates.find((candidate) => candidate.id === id(candidateId));
    if (!entry) throw new Error("That candidate isn't on the list.");
    const stamp = new Date().toISOString().slice(0, 10);
    const target = await ctx.chooseSavePath(`${artifactPrefixFor(entry.displayName)}_${stamp}.zip`);
    if (!target) return null;
    const files = await zipFolder(await candidatePath(ctx.root(), entry.id), target, artifactPrefixFor(entry.displayName));
    return { path: target, files };
  });
  ipcMain.handle("candidates:delete", async (_event, candidateId: unknown, typedName: unknown) => {
    const roster = await readRoster(ctx.root());
    const entry = roster.candidates.find((candidate) => candidate.id === id(candidateId));
    if (!entry) throw new Error("That candidate isn't on the list.");
    if (typeof typedName !== "string" || typedName.trim() !== entry.displayName) throw new Error(`Type ${entry.displayName} exactly to delete them.`);
    const current = await state();
    if (current.activeId === entry.id) {
      const busy = await ctx.busyReason();
      if (busy) throw new Error(busy);
      await ctx.closeCandidate();
    }
    return deleteCandidate(ctx.root(), entry.id, candidateAgyHomePath(ctx.userDataPath(), entry.id));
  });
  ipcMain.handle("pipeline:list", async () => listPipeline(ctx.root()));
  ipcMain.handle("pipeline:set-status", async (_event, entries: unknown, status: unknown) => {
    if (!Array.isArray(entries)) throw new Error("Choose the jobs to change.");
    return setPipelineStatus(ctx.root(), entries.map((entry) => ({ candidateId: id((entry as { candidateId?: unknown }).candidateId), jobId: id((entry as { jobId?: unknown }).jobId) })), status);
  });
  ipcMain.handle("candidates:next-queued", async () => nextQueuedCandidate(ctx.root(), (await state()).activeId));
  /** Closes the open candidate so the Candidates page shows (the recruiter's home). */
  ipcMain.handle("candidates:show-all", async () => {
    const busy = await ctx.busyReason();
    if (busy) throw new Error(busy);
    await clearActiveCandidate(ctx.root());
    await ctx.closeCandidate();
  });
  ipcMain.handle("candidates:switch", async (_event, id: unknown) => switchTo(String(id ?? "")));
  ipcMain.handle("candidates:rename", async (_event, id: unknown, name: unknown) => renameCandidate(ctx.root(), String(id ?? ""), text(name, "candidate's name")));
  ipcMain.handle("candidates:set-status", async (_event, id: unknown, status: unknown) => {
    const next = candidateStatusSchema.parse(status);
    const current = await state();
    if (next === "archived" && current.activeId === id) {
      const busy = await ctx.busyReason();
      if (busy) throw new Error(busy);
    }
    const entry = await setCandidateStatus(ctx.root(), String(id ?? ""), next);
    if (next === "archived" && current.activeId === id) await ctx.closeCandidate();
    return entry;
  });
}
