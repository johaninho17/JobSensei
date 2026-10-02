import { app, BrowserWindow, clipboard, dialog, ipcMain, session } from "electron";
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { copyFile, mkdir, stat } from "node:fs/promises";
import type { Settings } from "../src/shared/schemas";
import { markdownSaveInputSchema, pdfExportRequestSchema } from "../src/shared/schemas";
import { SettingsStore } from "./settings";
import { deleteWorkspacePath, getBaseResume, listFileTree, listResumePaths, previewFile, revealWorkspacePath, saveMarkdownFile } from "./files";
import { listJobArtifacts, listJobFolders, listJobTree } from "./job-folders";
import { assertInsideWorkspace, indexContext, summarizeWorkspace } from "./workspace";
import { initializeWorkspace } from "./workspace-init";
import { TerminalSession } from "./terminal";
import { buildContextManifest, contextSources, readActiveContextManifest } from "./context";
import { exportMarkdownPdf } from "./pdf-export";
import { getInterviewOverview, listInterviewRounds, refreshInterviewDashboard, setCurrentInterviewRound } from "./interviews";
import { invalidateSearchIndex, searchWorkspace } from "./search";
import { getJobApplicationStatus, validateJobApplication } from "./application-validation";
import { createCandidateProfile, readCandidateProfile, updateCandidateProfileSources } from "./candidate-profile";

let mainWindow: BrowserWindow | undefined;
let interviewWindow: BrowserWindow | undefined;
let workspacePath: string;
let settingsStore: SettingsStore;
let workspaceWatcher: FSWatcher | undefined;
let workspaceWatchTimer: ReturnType<typeof setTimeout> | undefined;
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
  if (process.env.VITE_DEV_SERVER_URL) void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void mainWindow.loadFile(join(__dirname, "../../dist-renderer/index.html"));
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
      if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);
      workspaceWatchTimer = setTimeout(() => {
        invalidateSearchIndex(path);
        mainWindow?.webContents.send("workspace:changed");
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

ipcMain.handle("workspace:get-summary", async () => summarizeWorkspace(workspacePath, app.getAppPath(), await settingsStore.get()));
ipcMain.handle("workspace:rescan", async () => {
  invalidateSearchIndex(requireWorkspace());
  return summarizeWorkspace(requireWorkspace(), app.getAppPath(), await settingsStore.get());
});
ipcMain.handle("profile:get", async () => readCandidateProfile(requireWorkspace()));
ipcMain.handle("profile:create", async (_event, input) => createCandidateProfile(requireWorkspace(), input, await settingsStore.get()));

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
  const selectedRelative = relative(requireWorkspace(), selected);
  if (!selectedRelative || selectedRelative.startsWith("..") || !selectedRelative.startsWith(`resumes/`)) {
    const originalName = basename(selected);
    const extension = extname(originalName);
    const stem = basename(originalName, extension).replace(/[^a-zA-Z0-9._-]+/g, "-") || "resume";
    target = join(resumesRoot, `${stem}${extension.toLowerCase()}`);
    let suffix = 2;
    while (await stat(target).then(() => true).catch(() => false)) { target = join(resumesRoot, `${stem}-${suffix}${extension.toLowerCase()}`); suffix += 1; }
    await copyFile(selected, target);
  }
  const relativeTarget = relative(requireWorkspace(), target);
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
ipcMain.handle("jobs:validate-application", async (_event, jobId: string) => validateJobApplication(requireWorkspace(), jobId, false));

ipcMain.handle("interviews:get-overview", async (_event, jobId: string) => getInterviewOverview(requireWorkspace(), jobId));
ipcMain.handle("interviews:list-rounds", async (_event, jobId: string) => listInterviewRounds(requireWorkspace(), jobId));
ipcMain.handle("interviews:set-current-round", async (_event, input: { jobId: string; roundId: string }) => setCurrentInterviewRound(requireWorkspace(), input?.jobId, input?.roundId));
ipcMain.handle("interviews:refresh-dashboard", async (_event, jobId: string) => refreshInterviewDashboard(requireWorkspace(), jobId));
ipcMain.handle("interviews:open-workspace-window", async (_event, input: { jobId: string; roundId: string }) => openInterviewWorkspaceWindow(input?.jobId, input?.roundId));
ipcMain.handle("search:query", async (_event, input) => searchWorkspace(requireWorkspace(), input));

ipcMain.handle("context:get-manifest", async (_event, selection) => { const settings = await settingsStore.get(); return buildContextManifest(requireWorkspace(), selection ?? {}, settings); });
ipcMain.handle("context:get-active-manifest", async () => readActiveContextManifest(requireWorkspace()));
ipcMain.handle("context:get-sources", async () => contextSources());

ipcMain.handle("terminal:start", async (_event, input: { cwd?: string }) => {
  if (input?.cwd && input.cwd !== ".") assertInsideWorkspace(requireWorkspace(), resolve(requireWorkspace(), input.cwd));
  const cwd = resolve(app.getAppPath());
  const manifest = await buildContextManifest(requireWorkspace(), {}, await settingsStore.get());
  return terminal.start(cwd, requireWorkspace(), manifest);
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
ipcMain.handle("terminal:restart", async () => terminal.restart());
ipcMain.handle("terminal:stop", async () => terminal.stop());

app.whenReady().then(async () => {
  settingsStore = new SettingsStore(app.getPath("userData"));
  workspacePath = resolve(app.getAppPath(), "data");
  await initializeWorkspace(workspacePath);
  await indexContext(workspacePath);
  await settingsStore.setWorkspace(workspacePath);
  startWorkspaceWatcher(workspacePath);
  const scriptPolicy = process.env.VITE_DEV_SERVER_URL ? "'self' 'unsafe-inline'" : "'self'";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src ${scriptPolicy}; img-src 'self' data:; object-src 'self' data:; frame-src 'self' data:; connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173`] } }));
  terminal.onData((data) => mainWindow?.webContents.send("terminal:data", data));
  terminal.onExit((code) => mainWindow?.webContents.send("terminal:exit", code));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("before-quit", () => { workspaceWatcher?.close(); if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer); terminal.stop(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
