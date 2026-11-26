// Questions for you IPC (Profile page). Loaded only when the edition has `features.profileQuestions` (src/shared/edition.ts).
// Questions come from the user's own data (electron/profile-questions.ts); skill answers are filed into the career records by a
// background Agy run (electron/answer-filing.ts).
import { ipcMain } from "electron";
import { FILING_SCHEMA, fileAnswers, migrateOldAnswersFile, readAnswerInbox } from "./answer-filing";
import { readCandidateProfile } from "./candidate-profile";
import type { FeatureContext } from "./feature-context";
import { listJobFolders } from "./job-folders";
import { headlessAgy } from "./question-agent";
import { resolveAgyExecutable } from "./terminal";
import { answerQuestion, refreshQuestions, removeQuestion } from "./profile-questions";

/** A minute after the last answer (so several answers go in one Agy call). */
const FILING_DELAY_MS = 60_000;

export function registerProfileQuestionsIpc(ctx: FeatureContext): void {
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
        ctx.mainWindow()?.webContents.send("profile-questions:changed");
        // Filed rows are new career evidence; the app re-reads the workspace and Agy gets them on its next run.
        ctx.mainWindow()?.webContents.send("workspace:changed", [...new Set(result.filed.map((answer) => answer.filedTo!))]);
      }
    } catch (error) {
      console.error("Filing answers failed:", error);
    } finally {
      filing = false;
    }
  };
  // Answers left from an earlier session (or the old answers file) are filed shortly after the app opens.
  fileSoon(20_000);

  ipcMain.handle("profile-questions:get", async () => {
    const workspace = ctx.requireWorkspace();
    return refreshQuestions(workspace, { jobs: await listJobFolders(workspace), profile: await readCandidateProfile(workspace).catch(() => null) });
  });
  ipcMain.handle("profile-questions:answer", async (_event, id: unknown, answer: unknown) => {
    const result = await answerQuestion(ctx.requireWorkspace(), String(id), String(answer ?? ""));
    if (result.queued) fileSoon();
    return result;
  });
  ipcMain.handle("profile-questions:remove", async (_event, id: unknown) => removeQuestion(ctx.requireWorkspace(), String(id)));
}
