// Today IPC. Loaded only when the edition has `features.today` (src/shared/edition.ts).
// Today is built from the user's own data (electron/today.ts); closed postings are checked in the background once a day.
// Answers to Today questions are filed into the career records by a background Agy run (electron/answer-filing.ts).
import { ipcMain } from "electron";
import { FILING_SCHEMA, fileAnswers, migrateOldAnswersFile, readAnswerInbox } from "./answer-filing";
import { readCandidateProfile } from "./candidate-profile";
import type { FeatureContext } from "./feature-context";
import { listJobFolders } from "./job-folders";
import { headlessAgy } from "./question-agent";
import { resolveAgyExecutable } from "./terminal";
import { answerQuestion, buildTodayData, checkClosedPostings, keepPosting, removeQuestion } from "./today";
import { updateJobTracker } from "./tracker";
import type { Readiness } from "../src/shared/readiness";

/** A minute after the last answer (so several answers go in one Agy call). */
const FILING_DELAY_MS = 60_000;

export function registerTodayIpc(ctx: FeatureContext, deps: { readiness: () => Promise<Readiness | null> }): void {
  let filingTimer: NodeJS.Timeout | null = null;
  let filing = false;
  const fileSoon = (delay = FILING_DELAY_MS) => {
    if (filingTimer) clearTimeout(filingTimer);
    filingTimer = setTimeout(() => void fileNow(), delay);
  };
  const fileNow = async () => {
    if (filing) { fileSoon(); return; }
    const agyPath = resolveAgyExecutable();
    if (!agyPath) return;
    let workspace: string;
    try { workspace = ctx.requireWorkspace(); } catch { return; }
    filing = true;
    try {
      await migrateOldAnswersFile(workspace);
      if (!(await readAnswerInbox(workspace)).some((answer) => answer.status === "pending")) return;
      const agyHome = await ctx.agyHomeFor(workspace);
      const result = await fileAnswers(workspace, headlessAgy({ agyPath, agyHome, cwd: workspace, timeoutSeconds: 180, jsonSchema: FILING_SCHEMA }));
      if (result.filed.length || result.skipped.length) {
        ctx.mainWindow()?.webContents.send("today:changed");
        // Filed rows are new career evidence; the app re-reads the workspace and Agy gets them on its next run.
        ctx.mainWindow()?.webContents.send("workspace:changed", [...new Set(result.filed.map((answer) => answer.filedTo!))]);
      }
    } catch (error) {
      console.error("Filing Today answers failed:", error);
    } finally {
      filing = false;
    }
  };
  // Answers left from an earlier session (or the old answers file) are filed shortly after the app opens.
  fileSoon(20_000);

  ipcMain.handle("today:get", async () => {
    const workspace = ctx.requireWorkspace();
    const jobs = await listJobFolders(workspace);
    const readiness = await deps.readiness().catch(() => null);
    const today = await buildTodayData(workspace, { jobs, profile: await readCandidateProfile(workspace).catch(() => null), readiness });
    void checkClosedPostings(workspace, jobs).then((state) => { if (state.closed.length !== today.due.closedPostings.length) ctx.mainWindow()?.webContents.send("today:changed"); }).catch(() => undefined);
    return today;
  });
  ipcMain.handle("today:answer", async (_event, id: unknown, answer: unknown) => {
    const result = await answerQuestion(ctx.requireWorkspace(), String(id), String(answer ?? ""));
    if (result.queued) fileSoon();
    return result;
  });
  ipcMain.handle("today:remove-question", async (_event, id: unknown) => removeQuestion(ctx.requireWorkspace(), String(id)));
  ipcMain.handle("today:keep-posting", async (_event, jobId: unknown) => keepPosting(ctx.requireWorkspace(), String(jobId)));
  ipcMain.handle("today:close-posting", async (_event, jobId: unknown) => {
    const workspace = ctx.requireWorkspace();
    await updateJobTracker(workspace, String(jobId), { status: "rejected", outcome: { stageReached: null, result: "no_reply", reason: "Posting closed", date: new Date().toISOString().slice(0, 10) } });
    await keepPosting(workspace, String(jobId));
  });
}
