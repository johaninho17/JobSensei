// Interview content refresh IPC. Loaded only when the edition has `features.contentRefresh` (src/shared/edition.ts).
import { readCandidateProfile } from "./candidate-profile";
import { practiceCountsAsEvidence } from "../src/shared/practice-evidence";
import { ipcMain } from "electron";
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
  ipcMain.handle("content:review-update", async () => reviewUpdate(ctx.requireWorkspace()));
  ipcMain.handle("content:finish-update", async (_event, keepOld: unknown) => finishUpdate(ctx.requireWorkspace(), Array.isArray(keepOld) ? keepOld.filter((item): item is string => typeof item === "string") : []));
  ipcMain.handle("content:undo-update", async () => undoUpdate(ctx.requireWorkspace()));
  ipcMain.handle("content:skip", async (_event, paths: unknown) => skipRecordings(ctx.requireWorkspace(), Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : []));
}
