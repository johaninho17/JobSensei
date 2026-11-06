// Application questions IPC. Loaded only when the edition has `features.applicationQuestions` (src/shared/edition.ts).
import { ipcMain } from "electron";
import { prepareAgyHome } from "./agy-home";
import { parsePastedQuestions } from "./application-questions";
import type { FeatureContext } from "./feature-context";
import { QuestionAgent, headlessAgy } from "./question-agent";
import { resolveAgyExecutable } from "./terminal";

export function registerQuestionIpc(ctx: FeatureContext): void {
  // Written application questions: answered by a separate headless Agy in the background (never the terminal Agy).
  const questionAgent = new QuestionAgent({
    workspace: ctx.requireWorkspace,
    runner: async () => {
      const agyPath = resolveAgyExecutable();
      if (!agyPath) throw new Error("Agy isn't installed, so questions can't be answered.");
      const workspace = ctx.requireWorkspace();
      // The same app-owned Agy home (and sign-in) as the terminal; prepared here when the terminal hasn't started yet.
      const agyHome = ctx.agyHome() ?? await prepareAgyHome(ctx.userDataPath(), workspace, [], { appRoot: ctx.appRoot(), runtimePath: process.execPath });
      return headlessAgy({ agyPath, agyHome, cwd: workspace });
    },
    onUpdate: (jobId, state) => ctx.mainWindow()?.webContents.send("questions:updated", jobId, state),
  });
  const questionJobId = (value: unknown) => { const jobId = String(value ?? ""); if (!/^[a-z0-9][a-z0-9._-]*$/i.test(jobId)) throw new Error("Invalid job."); return jobId; };
  ipcMain.handle("questions:get", async (_event, jobId: unknown) => { const id = questionJobId(jobId); return { state: await questionAgent.get(id), running: questionAgent.isRunning(id) }; });
  ipcMain.handle("questions:auto", async (_event, jobId: unknown) => { void questionAgent.auto(questionJobId(jobId)); });
  ipcMain.handle("questions:ask", async (_event, jobId: unknown, text: unknown) => {
    if (typeof text !== "string" || text.length > 20_000) throw new Error("Paste the questions as text.");
    if (!parsePastedQuestions(text).length) throw new Error("Paste at least one question.");
    void questionAgent.ask(questionJobId(jobId), text).catch(() => undefined);
  });
  ipcMain.handle("questions:answer-anyway", async (_event, jobId: unknown, questionId: unknown) => {
    if (typeof questionId !== "string" || !/^q:\d+$/.test(questionId)) throw new Error("Invalid question.");
    void questionAgent.answerAnyway(questionJobId(jobId), questionId);
  });
  ipcMain.handle("questions:retry", async (_event, jobId: unknown) => {
    const id = questionJobId(jobId);
    const state = await questionAgent.get(id);
    if (!state || state.source === "posting") { void questionAgent.auto(id, true); return; }
    void questionAgent.ask(id, state.questions.map((question) => question.label).join("\n\n"));
  });
}
