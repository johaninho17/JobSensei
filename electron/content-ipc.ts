// Interview content refresh IPC. Loaded only when the edition has `features.contentRefresh` (src/shared/edition.ts).
import { RECORDING_EXTENSIONS, importRecordings } from "./recording-import";
import type { RecordingKind } from "../src/shared/recordings";
import { readCandidateProfile } from "./candidate-profile";
import { practiceCountsAsEvidence } from "../src/shared/practice-evidence";
import { dialog, ipcMain } from "electron";
import { finishUpdate, readPendingUpdate, reviewUpdate, scanRecordings, skipRecordings, startUpdate, undoUpdate } from "./content-refresh";
import type { FeatureContext } from "./feature-context";

export function registerContentIpc(ctx: FeatureContext): void {
  ipcMain.handle("content:recordings", async () => {
    const names = await ctx.jobNames();
    return { recordings: await scanRecordings(ctx.requireWorkspace(), Object.keys(names)), pending: await readPendingUpdate(ctx.requireWorkspace()) };
  });
  ipcMain.handle("content:start-update", async () => {
    const names = await ctx.jobNames();
    const workspace = ctx.requireWorkspace();
    return (await startUpdate(workspace, await scanRecordings(workspace, Object.keys(names)), names, new Date(), practiceCountsAsEvidence(await readCandidateProfile(workspace)))).prompt;
  });
  // Recordings added from Interviews → Your content: a file dialog, or paths of dropped files (electron/recording-import.ts).
  const kindOf = (kind: unknown): RecordingKind => kind === "practice" ? "practice" : "interview";
  const jobOf = (jobId: unknown): string | null => typeof jobId === "string" && /^[a-z0-9][a-z0-9-]*$/.test(jobId) ? jobId : null;
  ipcMain.handle("content:add-recordings", async (_event, kind: unknown, jobId: unknown) => {
    const window = ctx.mainWindow();
    if (!window) throw new Error("The Sensei window is not ready.");
    const result = await dialog.showOpenDialog(window, { title: kind === "practice" ? "Add practice interviews" : "Add interview recordings or notes", properties: ["openFile", "multiSelections"], filters: [{ name: "Transcripts and notes", extensions: RECORDING_EXTENSIONS.map((extension) => extension.slice(1)) }] });
    if (result.canceled || !result.filePaths.length) return { added: [], skipped: [] };
    return importRecordings(ctx.requireWorkspace(), result.filePaths, kindOf(kind), jobOf(jobId));
  });
  ipcMain.handle("content:import-recording-paths", async (_event, paths: unknown, kind: unknown, jobId: unknown) => {
    if (!Array.isArray(paths) || paths.length > 50 || paths.some((path) => typeof path !== "string" || !path)) throw new Error("Choose up to 50 files.");
    return importRecordings(ctx.requireWorkspace(), paths as string[], kindOf(kind), jobOf(jobId));
  });
  ipcMain.handle("content:review-update", async () => reviewUpdate(ctx.requireWorkspace()));
  ipcMain.handle("content:finish-update", async (_event, keepOld: unknown) => finishUpdate(ctx.requireWorkspace(), Array.isArray(keepOld) ? keepOld.filter((item): item is string => typeof item === "string") : []));
  ipcMain.handle("content:undo-update", async () => undoUpdate(ctx.requireWorkspace()));
  ipcMain.handle("content:skip", async (_event, paths: unknown) => skipRecordings(ctx.requireWorkspace(), Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : []));
}
