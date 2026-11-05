import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session, shell } from "electron";
import { textContextMenu } from "./context-menu";
import { watch, type FSWatcher } from "node:fs";
import { updateJobTracker } from "./tracker";
import { latestRun } from "./run-status";
import { setStagedCompany, stagePastedJobDescription, stageLinkJobDescription } from "./jd-fetch";
import { readJobQueue, saveJobQueue } from "./job-queue";
import { prepareAgyHome, writeSenseiLauncher } from "./agy-home";
import { QuestionAgent, headlessAgy } from "./question-agent";
import { parsePastedQuestions } from "./application-questions";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { Settings } from "../src/shared/schemas";
import { markdownSaveInputSchema, pdfExportRequestSchema } from "../src/shared/schemas";
import { SettingsStore } from "./settings";
import { deleteWorkspacePath, getBaseResume, listFileTree, listResumePaths, previewFile, revealWorkspacePath, saveMarkdownFile } from "./files";
import { invalidateJobCache, listJobArtifacts, listJobFolders, listJobTree } from "./job-folders";
import { assertInsideWorkspace, indexContext, summarizeWorkspace } from "./workspace";
import { capWorkspaceNpmCache, initializeWorkspace, syncWorkspaceAgentFiles, type AgentSyncReport } from "./workspace-init";
import { TerminalSession, appRoot as terminalAppRoot, resolveAgyExecutable } from "./terminal";
import { buildContextManifest, contextSources, readActiveContextManifest } from "./context";
import { exportMarkdownPdf } from "./pdf-export";
import { getInterviewOverview, listInterviewRounds, refreshInterviewDashboard, setCurrentInterviewRound } from "./interviews";
import { invalidateSearchIndex, searchWorkspace } from "./search";
import { getJobApplicationStatus, validateJobApplication } from "./application-validation";
import { computeReadiness } from "./setup-readiness";
import { createCandidateProfile, readCandidateProfile, updateCandidateProfileDetails, updateCandidateProfilePreferences, updateCandidateProfileSources } from "./candidate-profile";
import { compactStyleRules, profileInstructionLines } from "./evidence-snapshot";
import { loadCanonicalResumeBaseline } from "./canonical-resume";
import { readBulletBank, saveBulletBank } from "./bullet-bank";
import { generateJobClarifyingQuestions, saveJobClarificationAnswers } from "./clarifying-questions";

// Tests and the new-user check run the app with a throwaway settings folder, so real settings are never touched.
if (process.env.SENSEI_USER_DATA) app.setPath("userData", resolve(process.env.SENSEI_USER_DATA));
if (process.argv.includes("--dev") && !process.env.VITE_DEV_SERVER_URL) {
  process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173";
}

let mainWindow: BrowserWindow | undefined;
let interviewWindow: BrowserWindow | undefined;
let workspacePath: string;
let settingsStore: SettingsStore;
let workspaceWatcher: FSWatcher | undefined;
let workspaceWatchTimer: ReturnType<typeof setTimeout> | undefined;
const workspaceChangedPaths = new Set<string>();
const terminal = new TerminalSession();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#f4f6f8",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => console.error(`Sensei renderer failed to load (${code}): ${description} ${url}`));
  mainWindow.webContents.on("render-process-gone", (_event, details) => console.error(`Sensei renderer exited: ${details.reason}`));
  mainWindow.webContents.on("console-message", (event) => console.error(`Sensei renderer: ${event.message}`));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://127.0.0.1:5173") && !url.startsWith("file://")) event.preventDefault();
  });
  mainWindow.on("closed", () => { terminal.stop(); mainWindow = undefined; });
  if (process.env.SENSEI_SMOKE_OUT) runSmokeCheck(mainWindow, process.env.SENSEI_SMOKE_OUT);
  if (process.env.VITE_DEV_SERVER_URL) void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void mainWindow.loadFile(join(__dirname, "../../dist-renderer/index.html"));
}

/**
 * Release smoke test (SENSEI_SMOKE_OUT=<file>): once the packaged app's window loads, checks that the interface
 * rendered and the preload bridge works, writes the result to the file, and quits with 0 (ok) or 1. The release
 * workflow runs it on each platform before the draft is published.
 */
function runSmokeCheck(window: BrowserWindow, outPath: string): void {
  const finish = (result: { ok: boolean; detail: string }) => {
    void writeFile(outPath, `${JSON.stringify({ ...result, platform: process.platform, version: app.getVersion() })}\n`).finally(() => app.exit(result.ok ? 0 : 1));
  };
  const timer = setTimeout(() => finish({ ok: false, detail: "The window did not finish loading within 60 seconds." }), 60_000);
  window.webContents.on("render-process-gone", (_event, details) => { clearTimeout(timer); finish({ ok: false, detail: `Renderer exited: ${details.reason}` }); });
  window.webContents.on("did-fail-load", (_event, code, description) => { clearTimeout(timer); finish({ ok: false, detail: `Load failed (${code}): ${description}` }); });
  window.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      void window.webContents.executeJavaScript(`(async () => {
        const root = document.getElementById("root");
        const workspace = await window.sensei.workspace.getSummary().then((value) => value.status).catch((error) => "error: " + error.message);
        return { rendered: Boolean(root && root.childElementCount > 0 && document.body.innerText.trim().length > 20), workspace, text: document.body.innerText.slice(0, 120) };
      })()`).then((check: { rendered: boolean; workspace: string; text: string }) => {
        clearTimeout(timer);
        finish({ ok: check.rendered && !String(check.workspace).startsWith("error"), detail: JSON.stringify(check) });
      }, (error: unknown) => { clearTimeout(timer); finish({ ok: false, detail: String(error) }); });
    }, 4000);
  });
}

async function openInterviewWorkspaceWindow(jobId: string, roundId: string): Promise<void> {
  if (!jobId || !roundId) throw new Error("A job and interview round are required.");
  if (interviewWindow && !interviewWindow.isDestroyed()) {
    const query = `interviewWorkspace=1&jobId=${encodeURIComponent(jobId)}&roundId=${encodeURIComponent(roundId)}`;
    if (process.env.VITE_DEV_SERVER_URL) await interviewWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${query}`);
    else await interviewWindow.loadFile(join(__dirname, "../../dist-renderer/index.html"), { search: `?${query}` });
    interviewWindow.focus();
    return;
  }
  interviewWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    title: "Sensei Interview Workspace",
    backgroundColor: "#f4f6f8",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const query = `interviewWorkspace=1&jobId=${encodeURIComponent(jobId)}&roundId=${encodeURIComponent(roundId)}`;
  if (process.env.VITE_DEV_SERVER_URL) await interviewWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${query}`);
  else await interviewWindow.loadFile(join(__dirname, "../../dist-renderer/index.html"), { search: `?${query}` });
  interviewWindow.on("closed", () => { interviewWindow = undefined; });
}

let liveWindow: BrowserWindow | undefined;
const LIVE_SIZE = { width: 440, height: 560 };
const LIVE_STRIP_HEIGHT = 176;

/** Compact always-on-top live window: one interview card at a time over the video call. */
async function openLiveWindow(jobId: string, roundId: string): Promise<void> {
  if (!jobId || !roundId) throw new Error("A job and interview round are required.");
  const query = `interviewWorkspace=1&live=1&jobId=${encodeURIComponent(jobId)}&roundId=${encodeURIComponent(roundId)}`;
  if (!liveWindow || liveWindow.isDestroyed()) {
    liveWindow = new BrowserWindow({
      ...LIVE_SIZE,
      minWidth: 340,
      minHeight: LIVE_STRIP_HEIGHT,
      alwaysOnTop: true,
      title: "Sensei Live",
      backgroundColor: "#f6f7f5",
      webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    liveWindow.setAlwaysOnTop(true, "floating");
    liveWindow.on("closed", () => { liveWindow = undefined; });
  }
  if (process.env.VITE_DEV_SERVER_URL) await liveWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${query}`);
  else await liveWindow.loadFile(join(__dirname, "../../dist-renderer/index.html"), { search: `?${query}` });
  liveWindow.focus();
}

function logAgentSync(report: AgentSyncReport | null): void {
  if (!report || (!report.updated.length && !report.added.length && !report.removed.length)) return;
  console.info(`Agy runtime files synced from ${report.sourceRoot}: updated ${report.updated.length}, added ${report.added.length}, removed ${report.removed.length}${report.backupPath ? `; previous copies in ${report.backupPath}` : ""}`);
}

function requireWorkspace(): string {
  if (!workspacePath) throw new Error("Choose a workspace before using this feature.");
  return workspacePath;
}

function startWorkspaceWatcher(path: string): void {
  workspaceWatcher?.close();
  if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);
  try {
    workspaceWatcher = watch(path, { recursive: true }, (_eventType, filename) => {
      const changedPath = filename?.toString().replaceAll("\\", "/") ?? "";
      if (!changedPath || changedPath.startsWith(".sensei/") || changedPath.includes("/.sensei/") || changedPath.includes(".tmp-") || changedPath === "context/index.json") return;
      invalidateJobCache(path, changedPath);
      workspaceChangedPaths.add(changedPath);
      if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);
      workspaceWatchTimer = setTimeout(() => {
        invalidateSearchIndex(path);
        mainWindow?.webContents.send("workspace:changed", [...workspaceChangedPaths]);
        workspaceChangedPaths.clear();
      }, 350);
    });
    workspaceWatcher.on("error", (error) => console.error(`Sensei workspace watcher: ${error.message}`));
  } catch (error) {
    console.error(`Sensei workspace watcher unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

ipcMain.handle("app:copy-text", async (_event, text: string) => {
  if (typeof text !== "string" || !text.trim() || text.length > 10_000 || /\x00/.test(text)) {
    throw new Error("The text could not be copied safely.");
  }
  clipboard.writeText(text);
});

function getRepositoryRoot(): string {
  return app.isPackaged ? workspacePath : resolve(app.getAppPath());
}

ipcMain.handle("workspace:get-summary", async () => summarizeWorkspace(workspacePath, getRepositoryRoot(), await settingsStore.get()));
ipcMain.handle("workspace:rescan", async () => {
  invalidateSearchIndex(requireWorkspace());
  return summarizeWorkspace(requireWorkspace(), getRepositoryRoot(), await settingsStore.get());
});
ipcMain.handle("profile:get", async () => readCandidateProfile(requireWorkspace()));
ipcMain.handle("profile:create", async (_event, input) => createCandidateProfile(requireWorkspace(), input, await settingsStore.get()));
ipcMain.handle("profile:update-preferences", async (_event, preferences) => updateCandidateProfilePreferences(requireWorkspace(), preferences));
ipcMain.handle("profile:update-details", async (_event, details) => updateCandidateProfileDetails(requireWorkspace(), {
  transitionSummary: typeof details?.transitionSummary === "string" ? details.transitionSummary : undefined,
  confidentialNames: Array.isArray(details?.confidentialNames) ? details.confidentialNames.filter((value: unknown): value is string => typeof value === "string") : undefined,
  boundaries: Array.isArray(details?.boundaries) ? details.boundaries.filter((value: unknown): value is string => typeof value === "string") : undefined,
  interviewLogistics: details?.interviewLogistics && typeof details.interviewLogistics === "object" ? details.interviewLogistics : undefined,
}));
ipcMain.handle("profile:preview", async () => {
  const workspace = requireWorkspace();
  const profile = await readCandidateProfile(workspace);
  const voicePath = profile?.sources.applicationVoicePath ?? "context/application_voice_profile.md";
  const voiceText = await readFile(assertInsideWorkspace(workspace, join(workspace, voicePath)), "utf8").catch(() => "");
  const basePath = profile?.sources.baseResumePath ?? (await settingsStore.get()).baseResumePath;
  const baseline = basePath ? await loadCanonicalResumeBaseline(workspace, basePath).catch(() => null) : null;
  return {
    styleRules: compactStyleRules(voiceText, profile),
    instructions: profileInstructionLines(profile),
    baseResumeHasSummary: baseline ? Boolean(baseline.originalSummaryLines?.length) : null,
    interviewLogistics: Object.entries(profile?.preferences.interview ?? {})
      .map(([key, value]) => `${key}: ${value || "⚠ not set (prep will ask you to fill it in)"}`),
    storyBankPath: await readFile(assertInsideWorkspace(workspace, join(workspace, "profile", "story_bank.md")), "utf8").then(() => "profile/story_bank.md", () => null),
  };
});
ipcMain.handle("bullet-bank:get", async () => readBulletBank(requireWorkspace()));
ipcMain.handle("bullet-bank:save", async (_event, bank) => saveBulletBank(requireWorkspace(), bank));
ipcMain.handle("clarifications:get-questions", async (_event, jobId: string) => generateJobClarifyingQuestions(requireWorkspace(), jobId));
ipcMain.handle("clarifications:submit-answers", async (_event, { jobId, answers }: { jobId: string; answers: any[] }) => saveJobClarificationAnswers(requireWorkspace(), jobId, answers));

ipcMain.handle("settings:get", async () => {
  const current = await settingsStore.get();
  if (workspacePath) {
    const { baseResumePath, secondaryResumePaths } = await listResumePaths(workspacePath, current.baseResumePath, current.secondaryResumePaths);
    let linkedinProfilePath = current.linkedinProfilePath;
    if (linkedinProfilePath) {
      try {
        const safe = assertInsideWorkspace(workspacePath, resolve(workspacePath, linkedinProfilePath));
        const info = await stat(safe).catch(() => null);
        if (!info?.isFile()) linkedinProfilePath = null;
      } catch {
        linkedinProfilePath = null;
      }
    }
    const changed = baseResumePath !== current.baseResumePath
      || linkedinProfilePath !== current.linkedinProfilePath
      || secondaryResumePaths.length !== current.secondaryResumePaths.length
      || secondaryResumePaths.some((path, i) => path !== current.secondaryResumePaths[i]);

    if (changed) {
      return settingsStore.save({ baseResumePath, secondaryResumePaths, linkedinProfilePath });
    }
  }
  return current;
});
ipcMain.handle("settings:save", async (_event, input: Pick<Settings, "baseResumePath"> & Partial<Pick<Settings, "secondaryResumePaths" | "linkedinProfilePath">>) => {
  const next = await settingsStore.save(input);
  await updateCandidateProfileSources(requireWorkspace(), next);
  return next;
});
ipcMain.handle("settings:choose-resume", async (_event, role: "base" | "secondary") => {
  if (role !== "base" && role !== "secondary") throw new Error("Resume role is invalid.");
  if (!mainWindow) throw new Error("The Sensei window is not ready.");
  const resumesRoot = assertInsideWorkspace(requireWorkspace(), join(requireWorkspace(), "resumes"));
  await mkdir(resumesRoot, { recursive: true });
  const result = await dialog.showOpenDialog(mainWindow, { title: role === "base" ? "Choose base resume" : "Add secondary resume", defaultPath: resumesRoot, properties: ["openFile"], filters: [{ name: "Resume files", extensions: ["md", "pdf", "docx"] }] });
  if (result.canceled || !result.filePaths[0]) return settingsStore.get();
  const selected = resolve(result.filePaths[0]);
  let target = selected;
  const selectedRelative = relative(requireWorkspace(), selected).replaceAll("\\", "/");
  if (!selectedRelative || selectedRelative.startsWith("..") || !selectedRelative.startsWith(`resumes/`)) {
    const originalName = basename(selected);
    const extension = extname(originalName);
    const stem = basename(originalName, extension).replace(/[^a-zA-Z0-9._-]+/g, "-") || "resume";
    target = join(resumesRoot, `${stem}${extension.toLowerCase()}`);
    let suffix = 2;
    while (await stat(target).then(() => true).catch(() => false)) { target = join(resumesRoot, `${stem}-${suffix}${extension.toLowerCase()}`); suffix += 1; }
    await copyFile(selected, target);
  }
  const relativeTarget = relative(requireWorkspace(), target).replaceAll("\\", "/");
  const current = await settingsStore.get();
  const next = role === "base" ? await settingsStore.save({ baseResumePath: relativeTarget }) : await settingsStore.save({ baseResumePath: current.baseResumePath, secondaryResumePaths: [...new Set([...current.secondaryResumePaths, relativeTarget])] });
  await updateCandidateProfileSources(requireWorkspace(), next);
  return next;
});
ipcMain.handle("settings:remove-secondary", async (_event, path: string) => {
  if (typeof path !== "string" || !path.startsWith("resumes/")) throw new Error("Secondary resume path is invalid.");
  const current = await settingsStore.get();
  const next = await settingsStore.save({ baseResumePath: current.baseResumePath, secondaryResumePaths: current.secondaryResumePaths.filter((candidate) => candidate !== path) });
  await updateCandidateProfileSources(requireWorkspace(), next);
  return next;
});

ipcMain.handle("files:list-tree", async () => listFileTree(requireWorkspace()));
ipcMain.handle("files:preview", async (_event, relativePath: string) => previewFile(requireWorkspace(), relativePath));
ipcMain.handle("files:save-markdown", async (_event, input) => {
  const workspace = requireWorkspace();
  const preview = await saveMarkdownFile(workspace, markdownSaveInputSchema.parse(input));
  invalidateSearchIndex(workspace);
  return preview;
});
ipcMain.handle("files:delete", async (_event, relativePath: string) => {
  const workspace = requireWorkspace();
  await deleteWorkspacePath(workspace, relativePath);
  invalidateSearchIndex(workspace);
  const current = await settingsStore.get();
  const deletedPrefix = `${relativePath}/`;
  const isDeleted = (candidate: string | null): boolean => Boolean(candidate && (candidate === relativePath || candidate.startsWith(deletedPrefix)));
  return settingsStore.save({
    baseResumePath: isDeleted(current.baseResumePath) ? null : current.baseResumePath,
    secondaryResumePaths: current.secondaryResumePaths.filter((candidate) => !isDeleted(candidate)),
  });
});
ipcMain.handle("files:reveal", async (_event, relativePath: string) => revealWorkspacePath(requireWorkspace(), relativePath));
ipcMain.handle("files:get-base-resume", async () => getBaseResume(requireWorkspace(), (await settingsStore.get()).baseResumePath));
ipcMain.handle("files:export-markdown-pdf", async (_event, input) => {
  const request = pdfExportRequestSchema.parse(input);
  return exportMarkdownPdf(requireWorkspace(), request.relativePath, request.textSize);
});

ipcMain.handle("jobs:list", async () => listJobFolders(requireWorkspace()));
ipcMain.handle("jobs:list-tree", async () => listJobTree(requireWorkspace()));
ipcMain.handle("jobs:list-artifacts", async (_event, jobId: string) => listJobArtifacts(requireWorkspace(), jobId));
ipcMain.handle("jobs:preview-artifact", async (_event, jobId: string, relativePath: string) => {
  if (!relativePath.startsWith(`jobs/${jobId}/`)) throw new Error("Artifact path does not belong to this job.");
  return previewFile(requireWorkspace(), relativePath);
});
ipcMain.handle("jobs:get-application-status", async (_event, jobId: string) => getJobApplicationStatus(requireWorkspace(), jobId));
ipcMain.handle("queue:get", async () => readJobQueue(requireWorkspace()));
ipcMain.handle("queue:save", async (_event, queue: unknown) => saveJobQueue(requireWorkspace(), queue));
ipcMain.handle("jobs:stage-pasted-jd", async (_event, text: unknown, id: unknown) => stagePastedJobDescription(requireWorkspace(), text, String(id)));
ipcMain.handle("jobs:set-staged-company", async (_event, id: unknown, company: unknown) => setStagedCompany(requireWorkspace(), String(id), String(company ?? "")));
ipcMain.handle("jobs:stage-link", async (_event, url: unknown, id: unknown) => stageLinkJobDescription(requireWorkspace(), String(url), String(id)));
// Writes only to the file the user picks in the save dialog.
ipcMain.handle("jobs:export-csv", async (_event, csv: unknown) => {
  if (typeof csv !== "string" || !csv.startsWith("\uFEFF") || csv.length > 10_000_000) throw new Error("The export is invalid.");
  const options = { title: "Export jobs", defaultPath: join(app.getPath("documents"), `jobs-${new Date().toISOString().slice(0, 10)}.csv`), filters: [{ name: "CSV", extensions: ["csv"] }] };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, csv, "utf8");
  return result.filePath;
});
// Update notice: release builds record their GitHub repository at build time (release.yml); other builds skip the check.
async function releaseRepository(): Promise<string | null> {
  const raw = await readFile(join(app.getAppPath(), "dist-electron", "release-source.json"), "utf8").catch(() => null);
  const repository = raw ? (JSON.parse(raw) as { repository?: string }).repository : null;
  return repository && /^[\w.-]+\/[\w.-]+$/.test(repository) ? repository : null;
}
function newerVersion(latest: string, current: string): boolean {
  const parse = (value: string) => value.replace(/^v/, "").split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index]! > b[index]!;
  return false;
}
ipcMain.handle("app:check-update", async () => {
  const repository = await releaseRepository();
  if (!repository) return null;
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!response?.ok) return null;
  const release = await response.json() as { tag_name?: string; html_url?: string };
  if (!release.tag_name || !release.html_url || !newerVersion(release.tag_name, app.getVersion())) return null;
  return { version: release.tag_name.replace(/^v/, ""), url: release.html_url };
});
ipcMain.handle("app:open-release", async (_event, url: unknown) => {
  const repository = await releaseRepository();
  if (typeof url === "string" && repository && url.startsWith(`https://github.com/${repository}/releases/`)) await shell.openExternal(url);
});
ipcMain.handle("runs:latest", async () => latestRun(requireWorkspace()));

// Written application questions: answered by a separate headless Agy in the background (never the terminal Agy).
let questionAgyHome: string | null = null;
const questionAgent = new QuestionAgent({
  workspace: requireWorkspace,
  runner: async () => {
    const agyPath = resolveAgyExecutable();
    if (!agyPath) throw new Error("Agy isn't installed, so questions can't be answered.");
    const workspace = requireWorkspace();
    // The same app-owned Agy home (and sign-in) as the terminal; prepared here when the terminal hasn't started yet.
    questionAgyHome ??= await prepareAgyHome(app.getPath("userData"), workspace, [], { appRoot: terminalAppRoot(), runtimePath: process.execPath });
    return headlessAgy({ agyPath, agyHome: questionAgyHome, cwd: workspace });
  },
  onUpdate: (jobId, state) => mainWindow?.webContents.send("questions:updated", jobId, state),
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
ipcMain.handle("jobs:update-tracker", async (_event, jobId: unknown, update: unknown) => updateJobTracker(requireWorkspace(), String(jobId), update));
ipcMain.handle("jobs:validate-application", async (_event, jobId: string) => validateJobApplication(requireWorkspace(), jobId, false));

ipcMain.handle("interviews:get-overview", async (_event, jobId: string) => getInterviewOverview(requireWorkspace(), jobId));
ipcMain.handle("interviews:list-rounds", async (_event, jobId: string) => listInterviewRounds(requireWorkspace(), jobId));
ipcMain.handle("interviews:set-current-round", async (_event, input: { jobId: string; roundId: string }) => setCurrentInterviewRound(requireWorkspace(), input?.jobId, input?.roundId));
ipcMain.handle("interviews:refresh-dashboard", async (_event, jobId: string) => refreshInterviewDashboard(requireWorkspace(), jobId));
ipcMain.handle("interviews:open-workspace-window", async (_event, input: { jobId: string; roundId: string; live?: boolean }) => input?.live ? openLiveWindow(String(input.jobId), String(input.roundId)) : openInterviewWorkspaceWindow(input?.jobId, input?.roundId));
ipcMain.handle("interviews:set-live-collapsed", async (_event, collapsed: unknown) => {
  if (!liveWindow || liveWindow.isDestroyed()) return;
  const [width] = liveWindow.getSize();
  liveWindow.setSize(width ?? LIVE_SIZE.width, collapsed === true ? LIVE_STRIP_HEIGHT : LIVE_SIZE.height, true);
});
ipcMain.handle("search:query", async (_event, input) => searchWorkspace(requireWorkspace(), input));

ipcMain.handle("context:get-manifest", async (_event, selection) => { const settings = await settingsStore.get(); return buildContextManifest(requireWorkspace(), selection ?? {}, settings); });
ipcMain.handle("context:get-active-manifest", async () => readActiveContextManifest(requireWorkspace()));
ipcMain.handle("context:get-sources", async () => contextSources());

ipcMain.handle("terminal:start", async (_event, input: { cwd?: string }) => {
  const workspace = requireWorkspace();
  if (input?.cwd && input.cwd !== ".") assertInsideWorkspace(workspace, resolve(workspace, input.cwd));
  const cwd = input?.cwd && input.cwd !== "." ? resolve(workspace, input.cwd) : workspace;
  logAgentSync(await syncWorkspaceAgentFiles(workspace).catch((error) => { console.error("Agy skill sync failed:", error); return null; }));
  if (await capWorkspaceNpmCache(workspace).catch(() => false)) console.info("Agy npm cache passed its size limit and was cleared.");
  const manifest = await buildContextManifest(workspace, {}, await settingsStore.get());
  // Agy runs with an app-owned home whose rules keep its file tools inside the workspace.
  const agyHome = await prepareAgyHome(app.getPath("userData"), workspace, [], { appRoot: terminalAppRoot(), runtimePath: process.execPath })
    .then(async (home) => { await writeSenseiLauncher(home, { appRoot: terminalAppRoot(), packaged: app.isPackaged, runtimePath: process.execPath }); return home; })
    .catch((error) => { console.error("Agy home setup failed:", error); return null; });
  terminal.setAgyHome(agyHome);
  questionAgyHome = agyHome ?? questionAgyHome;
  return terminal.start(cwd, workspace, manifest);
});
ipcMain.handle("terminal:set-context", async (_event, input) => {
  const manifest = await buildContextManifest(requireWorkspace(), input ?? {}, await settingsStore.get());
  terminal.setContext(manifest);
  interviewWindow?.webContents.send("context:updated", manifest);
  return manifest;
});
ipcMain.handle("terminal:write", async (_event, data: string) => terminal.write(data));
ipcMain.handle("terminal:insert-prompt", async (_event, text: string) => {
  if (typeof text !== "string" || !text.trim() || text.length > 500 || /[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    throw new Error("Job Action prompts must be a single safe line.");
  }
  return terminal.write(text);
});
ipcMain.handle("terminal:resize", async (_event, input: { cols: number; rows: number }) => {
  if (!Number.isInteger(input?.cols) || !Number.isInteger(input?.rows) || input.cols < 2 || input.rows < 2 || input.cols > 500 || input.rows > 200) return;
  return terminal.resize(input.cols, input.rows);
});
ipcMain.handle("terminal:status", async () => { const status = terminal.status(); void noteAgySignIn(status); return status; });

// Agy runs with an app-owned home that needs one sign-in. The first time its ready screen is seen, that is
// remembered (userData/agy-signed-in.json), so Setup can say "Agy is ready" even before Agy is started again.
let agySignedIn: boolean | null = null;
async function noteAgySignIn(status: ReturnType<TerminalSession["status"]>): Promise<void> {
  if (status.agy && status.screen === "ready" && agySignedIn !== true) {
    agySignedIn = true;
    await writeFile(join(app.getPath("userData"), "agy-signed-in.json"), `${JSON.stringify({ seenReadyAt: new Date().toISOString() })}\n`).catch(() => undefined);
  }
}
async function agySignInState(): Promise<boolean | null> {
  if (agySignedIn === null) agySignedIn = await stat(join(app.getPath("userData"), "agy-signed-in.json")).then(() => true, () => null);
  if (agySignedIn) return true;
  const status = terminal.status();
  return status.running && status.agy && /\b(?:sign in|log in|login|authenticate|authorize)\b/i.test(status.recentOutput) ? false : null;
}

/** Setup readiness for the current workspace (electron/setup-readiness.ts owns the rules). */
async function readinessNow() {
  const workspace = requireWorkspace();
  const [profile, settings, manifest, summary] = await Promise.all([
    readCandidateProfile(workspace).catch(() => null),
    settingsStore.get().catch(() => null),
    readActiveContextManifest(workspace).catch(() => null),
    summarizeWorkspace(workspace, getRepositoryRoot(), await settingsStore.get().catch(() => undefined)),
  ]);
  return computeReadiness({ workspacePath: workspace, profile, settings, manifest, contextFileCount: summary.contextFileCount, agy: { installed: summary.agyAvailable, signedIn: await agySignInState() } });
}
ipcMain.handle("setup:readiness", async () => readinessNow());
ipcMain.handle("terminal:restart", async () => terminal.restart());
ipcMain.handle("terminal:stop", async () => terminal.stop());

async function resolveInitialWorkspacePath(store: SettingsStore): Promise<string> {
  if (process.env.SENSEI_WORKSPACE) {
    return resolve(process.env.SENSEI_WORKSPACE);
  }
  const current = await store.get().catch(() => null);
  if (current?.workspacePath) {
    try {
      const candidate = resolve(current.workspacePath);
      const candidateStat = await stat(candidate);
      if (candidateStat.isDirectory()) return candidate;
    } catch {
      // Fallback if stored path is invalid or moved
    }
  }
  if (app.isPackaged) {
    return join(app.getPath("documents"), "JobSensei");
  }
  return resolve(app.getAppPath(), "data");
}

app.whenReady().then(async () => {
  try {
    settingsStore = new SettingsStore(app.getPath("userData"));
    workspacePath = await resolveInitialWorkspacePath(settingsStore);
    logAgentSync(await initializeWorkspace(workspacePath));
    await indexContext(workspacePath);
    await settingsStore.setWorkspace(workspacePath);
    startWorkspaceWatcher(workspacePath);
  } catch (error) {
    console.error("Sensei startup initialization error:", error);
  }

  const scriptPolicy = process.env.VITE_DEV_SERVER_URL ? "'self' 'unsafe-inline'" : "'self'";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src ${scriptPolicy}; worker-src 'self' blob:; img-src 'self' data:; object-src 'self' data:; frame-src 'self' data:; connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173`] } }));
  terminal.onData((data) => mainWindow?.webContents.send("terminal:data", data));
  terminal.onExit((code) => mainWindow?.webContents.send("terminal:exit", code));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => {
  console.error("Sensei fatal whenReady error:", error);
  createWindow();
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("context-menu", (_menuEvent, params) => {
    const items = textContextMenu(params);
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
});

app.on("before-quit", () => { workspaceWatcher?.close(); if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer); terminal.stop(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
