// Today IPC. Loaded only when the edition has `features.today` (src/shared/edition.ts).
// Today is built from the user's own data (electron/today.ts); closed postings are checked in the background once a day.
import { ipcMain } from "electron";
import { readCandidateProfile } from "./candidate-profile";
import type { FeatureContext } from "./feature-context";
import { listJobFolders } from "./job-folders";
import { answerQuestion, buildTodayData, checkClosedPostings, keepPosting, removeQuestion } from "./today";
import { updateJobTracker } from "./tracker";
import type { Readiness } from "../src/shared/readiness";

export function registerTodayIpc(ctx: FeatureContext, deps: { readiness: () => Promise<Readiness | null> }): void {
  ipcMain.handle("today:get", async () => {
  const workspace = ctx.requireWorkspace();
  const jobs = await listJobFolders(workspace);
  const readiness = await deps.readiness().catch(() => null);
  const today = await buildTodayData(workspace, { jobs, profile: await readCandidateProfile(workspace).catch(() => null), readiness });
  void checkClosedPostings(workspace, jobs).then((state) => { if (state.closed.length !== today.due.closedPostings.length) ctx.mainWindow()?.webContents.send("today:changed"); }).catch(() => undefined);
  return today;
});
  ipcMain.handle("today:answer", async (_event, id: unknown, answer: unknown) => answerQuestion(ctx.requireWorkspace(), String(id), String(answer ?? "")));
  ipcMain.handle("today:remove-question", async (_event, id: unknown) => removeQuestion(ctx.requireWorkspace(), String(id)));
  ipcMain.handle("today:keep-posting", async (_event, jobId: unknown) => keepPosting(ctx.requireWorkspace(), String(jobId)));
  ipcMain.handle("today:close-posting", async (_event, jobId: unknown) => {
  const workspace = ctx.requireWorkspace();
  await updateJobTracker(workspace, String(jobId), { status: "rejected", outcome: { stageReached: null, result: "no_reply", reason: "Posting closed", date: new Date().toISOString().slice(0, 10) } });
  await keepPosting(workspace, String(jobId));
});
}
