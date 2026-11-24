// Tune IPC (ledger U76). Loaded only when the edition has `features.tune` (src/shared/edition.ts).
import { ipcMain } from "electron";
import { TUNE_AREAS, type TuneArea } from "../src/shared/tune-schemas";
import { practiceCountsAsEvidence } from "../src/shared/practice-evidence";
import { readCandidateProfile } from "./candidate-profile";
import type { FeatureContext } from "./feature-context";
import { applyTune, cancelTune, collectTune, startTune, tuneStatus, tuneView, undoTune } from "./tune-runner";

const areaOf = (value: unknown): TuneArea => {
  if (typeof value === "string" && (TUNE_AREAS as readonly string[]).includes(value)) return value as TuneArea;
  throw new Error("Unknown Tune area.");
};
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && /^t-[0-9a-f]{12}$/.test(id)) : [];

export function registerTuneIpc(ctx: FeatureContext): void {
  ipcMain.handle("tune:status", async () => tuneStatus(ctx.requireWorkspace(), TUNE_AREAS));
  ipcMain.handle("tune:start", async (_event, area: unknown) => {
    const workspace = ctx.requireWorkspace();
    return (await startTune(workspace, areaOf(area), { practiceStories: practiceCountsAsEvidence(await readCandidateProfile(workspace)) })).prompt;
  });
  ipcMain.handle("tune:collect", async (_event, area: unknown) => collectTune(ctx.requireWorkspace(), areaOf(area)));
  ipcMain.handle("tune:view", async (_event, area: unknown) => tuneView(ctx.requireWorkspace(), areaOf(area)));
  ipcMain.handle("tune:apply", async (_event, area: unknown, apply: unknown, decline: unknown) => applyTune(ctx.requireWorkspace(), areaOf(area), ids(apply), ids(decline)));
  ipcMain.handle("tune:undo", async () => undoTune(ctx.requireWorkspace()));
  ipcMain.handle("tune:cancel", async (_event, area: unknown) => cancelTune(ctx.requireWorkspace(), areaOf(area)));
}
