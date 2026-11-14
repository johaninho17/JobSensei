import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, powerMonitor, session, shell } from "electron";
import { handleLinks } from "./open-link";
import { availableBrowsers, BROWSER_NAMES, browserOpener, readBrowserChoice, saveBrowserChoice } from "./browser-choice";
import { pdfFreshness } from "./pdf-freshness";
import { installLogFile } from "./log-file";
import { recruiterInstructionsFor } from "./recruiter-defaults";
import { textContextMenu } from "./context-menu";
import { EDITION_INFO, featuresFor } from "../src/shared/edition";
import { currentEdition, prepareEditionFolder } from "./edition";
import type { FeatureContext } from "./feature-context";
import { activeCandidatePath, ensureRecruiterRoot, readRoster } from "./candidates";
import { watch, type FSWatcher } from "node:fs";
import { updateJobTracker } from "./tracker";
import { latestRun } from "./run-status";
import { setPageRenderer, setStagedCompany, stagePastedJobDescription, stageLinkJobDescription, stageSavedJob } from "./jd-fetch";
import { renderPage } from "./page-render";
import { readJobQueue, saveJobQueue } from "./job-queue";
import { RunWatcher } from "./run-watcher";
import { createAgyHomeCache, prepareAgyHome, pruneHeadlessConversations, writeSenseiLauncher } from "./agy-home";
import { reachedInterview } from "../src/shared/tracker";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { Settings } from "../src/shared/schemas";
import { markdownSaveInputSchema, pdfExportRequestSchema } from "../src/shared/schemas";
import { SettingsStore } from "./settings";
import { deleteWorkspacePath, getBaseResume, listFileTree, listResumePaths, previewFile, revealWorkspacePath, saveMarkdownFile } from "./files";
import { invalidateJobCache, listJobArtifacts, listJobFolders, listJobTree } from "./job-folders";
import { assertInsideWorkspace, indexContext, layoutVersion, summarizeWorkspace } from "./workspace";
import { toLogical } from "../src/shared/workspace-layout";
import { applyMigration, healStrayPaths, planMigration, undoMigration } from "./layout-migration";
import { capWorkspaceNpmCache, initializeWorkspace, syncWorkspaceAgentFiles, type AgentSyncReport } from "./workspace-init";
import { TerminalSession, appRoot as terminalAppRoot, resolveAgyExecutable } from "./terminal";
import { buildContextManifest, contextSources, readActiveContextManifest } from "./context";
import { exportMarkdownPdf } from "./pdf-export";
import { invalidateSearchIndex, searchWorkspace } from "./search";
import { getJobApplicationStatus, validateJobApplication } from "./application-validation";
import { computeReadiness } from "./setup-readiness";
import { CONTEXT_EXTENSIONS, importContextFiles, type ContextKind } from "./context-import";
import { createCandidateProfile, readCandidateProfile, updateCandidateProfileDetails, updateCandidateProfilePreferences, updateCandidateProfileSources } from "./candidate-profile";
import { compactStyleRules, profileInstructionLines } from "./evidence-snapshot";
import { loadCanonicalResumeBaseline } from "./canonical-resume";
import { readBulletBank, saveBulletBank } from "./bullet-bank";

// Tests and the new-user check run the app with a throwaway settings folder, so real settings are never touched.
const edition = currentEdition();
// Each edition has its own dev server port (src/shared/edition.ts), so both editions can run at once.
const DEV_URL = `http://127.0.0.1:${EDITION_INFO[edition].devPort}`;
const features = featuresFor(edition);
// The recruiter edition keeps its own settings folder and Agy homes; solo keeps the name it always had.
if (edition !== "solo") app.setName(EDITION_INFO[edition].productName);
if (process.env.SENSEI_USER_DATA) app.setPath("userData", resolve(process.env.SENSEI_USER_DATA));
/** Every app window hands web links to this: the browser chosen in Settings, else the system default. */
const openLink = browserOpener(() => app.getPath("userData"), (url) => shell.openExternal(url));
installLogFile(join(app.getPath("userData"), "logs", "main.log"));
if (process.argv.includes("--dev") && !process.env.VITE_DEV_SERVER_URL) {
  process.env.VITE_DEV_SERVER_URL = DEV_URL;
}

let mainWindow: BrowserWindow | undefined;
let workspacePath: string;
let settingsStore: SettingsStore;
let workspaceWatcher: FSWatcher | undefined;
let workspaceWatchTimer: ReturnType<typeof setTimeout> | undefined;
const workspaceChangedPaths = new Set<string>();
const terminal = new TerminalSession();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: EDITION_INFO[edition].productName,
    width: 1500,
    height: 960,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#f4f6f8",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  handleLinks(mainWindow.webContents, DEV_URL, openLink);
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => console.error(`Sensei renderer failed to load (${code}): ${description} ${url}`));
  mainWindow.webContents.on("render-process-gone", (_event, details) => console.error(`Sensei renderer exited: ${details.reason}`));
  mainWindow.webContents.on("console-message", (event) => console.error(`Sensei renderer: ${event.message}`));
  mainWindow.on("closed", () => { terminal.stop(); runWatcher.stop(); mainWindow = undefined; });
  runWatcher.start();
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
  // Finishes once: on Windows the closing window reports "renderer gone" during the quit, which used to finish a
  // second time with a failure and exit code 1 after the check had passed (release run 2026-11-14).
  let finished = false;
  const finish = (result: { ok: boolean; detail: string }) => {
    if (finished) return;
    finished = true;
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
        // A new, empty workspace must open on the first-run steps.
        return { rendered: Boolean(root && root.childElementCount > 0 && document.body.innerText.trim().length > 20), firstRun: Boolean(document.querySelector(${JSON.stringify(features.candidates ? ".candidates-home" : ".onboarding [aria-current=step]")})), workspace, text: document.body.innerText.slice(0, 120) };
      })()`).then(async (check: { rendered: boolean; firstRun: boolean; workspace: string; text: string }) => {
        clearTimeout(timer);
        const windowOk = check.rendered && check.firstRun && !String(check.workspace).startsWith("error");
        if (!windowOk) { finish({ ok: false, detail: JSON.stringify(check) }); return; }
        // Then Agy itself (2026-11-13: the Windows Recruiter Edition's terminal never started and nothing caught it).
        const agy = await smokeStartAgy();
        finish({ ok: agy.ok, detail: JSON.stringify({ window: check, agy }) });
      }, (error: unknown) => { clearTimeout(timer); finish({ ok: false, detail: String(error) }); });
    }, 4000);
  });
}

/**
 * Smoke test, part two: starts Agy the way the app does (in the Recruiter Edition, for a new test candidate) and
 * waits up to 45 s for Agy's own welcome or sign-in screen. Fails with the start error or Agy's last output.
 */
async function smokeStartAgy(): Promise<{ ok: boolean; detail: string }> {
  if (!features.candidates || !recruiterRoot) return smokeAgyOnce();
  // Recruiter Edition: start Agy for one candidate, switch to a second, then back, the way a recruiter works. Each
  // switch moves the candidates' Agy history, which is where Windows can refuse (an open file can't be moved).
  const { addCandidate, setActiveCandidate } = await import("./candidates.js");
  const first = await addCandidate(recruiterRoot, "Smoke Test");
  const second = await addCandidate(recruiterRoot, "Smoke Second");
  const steps: string[] = [];
  for (const [label, entry] of [["first candidate", first], ["second candidate", second], ["back to the first", first]] as const) {
    try {
      await closeCandidateFolder();
      await openCandidateFolder(await setActiveCandidate(recruiterRoot, entry.id));
    } catch (error) { return { ok: false, detail: `Switching to the ${label} failed: ${error instanceof Error ? error.message : String(error)}` }; }
    const result = await smokeAgyOnce();
    steps.push(`${label}: ${result.ok ? "ok" : result.detail}`);
    if (!result.ok) return { ok: false, detail: steps.join(" | ") };
  }
  return { ok: true, detail: steps.join(" | ") };
}

async function smokeAgyOnce(): Promise<{ ok: boolean; detail: string }> {
  try {
    const started = await startAgyTerminal();
    if (!started.agyStarted) return { ok: false, detail: "Agy was not found; a plain shell started instead." };
    const end = Date.now() + 45_000;
    while (Date.now() < end) {
      const status = terminal.status();
      if (/Antigravity|sign in|signed in|login method/i.test(status.recentOutput)) {
        await terminal.stopAndWait(5_000);
        return { ok: true, detail: `Agy started: ${status.recentOutput.replace(/\s+/g, " ").slice(0, 160)}` };
      }
      if (!status.running) return { ok: false, detail: `Agy exited right away. Last output: ${status.recentOutput.replace(/\s+/g, " ").slice(-400)}` };
      await new Promise((done) => setTimeout(done, 500));
    }
    const tail = terminal.status().recentOutput.replace(/\s+/g, " ").slice(-400);
    await terminal.stopAndWait(5_000);
    return { ok: false, detail: `Agy showed no welcome screen within 45 s. Last output: ${tail || "(none)"}` };
  } catch (error) {
    return { ok: false, detail: `Agy could not start: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function logAgentSync(report: AgentSyncReport | null): void {
  if (!report || (!report.updated.length && !report.added.length && !report.removed.length)) return;
  console.info(`Agy runtime files synced from ${report.sourceRoot}: updated ${report.updated.length}, added ${report.added.length}, removed ${report.removed.length}${report.backupPath ? `; previous copies in ${report.backupPath}` : ""}`);
}

function requireWorkspace(): string {
  if (!workspacePath) throw new Error("Choose a workspace before using this feature.");
  return workspacePath;
}

let strayTimer: NodeJS.Timeout | null = null;

function startWorkspaceWatcher(path: string): void {
  workspaceWatcher?.close();
  if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);
  try {
    workspaceWatcher = watch(path, { recursive: true }, (_eventType, filename) => {
      const rawPath = filename?.toString().replaceAll("\\", "/") ?? "";
      // A tidy workspace has no original folders: a file appearing in one was written to an old path. Bring it home.
      if (layoutVersion(path) === 2 && /^(context|debrief)\//.test(rawPath)) {
        if (strayTimer) clearTimeout(strayTimer);
        strayTimer = setTimeout(() => void healStrayPaths(path).catch(() => undefined), 2000);
      }
      const changedPath = toLogical(rawPath, layoutVersion(path));
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

// No workspace yet (Recruiter Edition before the first candidate): say so instead of reporting an error.
ipcMain.handle("workspace:get-summary", async () => workspacePath
  ? summarizeWorkspace(workspacePath, getRepositoryRoot(), await settingsStore.get())
  : { path: "", repositoryRoot: getRepositoryRoot(), status: "unconfigured" as const, contextFileCount: 0, jobCount: 0, hasIndex: false, hasCandidateProfile: false, hasBaseResume: false, agyAvailable: false, warnings: [] });
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
    instructions: profileInstructionLines(profile, true, await recruiterInstructionsFor(workspace)),
    baseResumeHasSummary: baseline ? Boolean(baseline.originalSummaryLines?.length) : null,
    interviewLogistics: Object.entries(profile?.preferences.interview ?? {})
      .map(([key, value]) => `${key}: ${value || "⚠ not set (prep will ask you to fill it in)"}`),
    storyBankPath: await readFile(assertInsideWorkspace(workspace, join(workspace, "profile", "story_bank.md")), "utf8").then(() => "profile/story_bank.md", () => null),
  };
});
ipcMain.handle("bullet-bank:get", async () => readBulletBank(requireWorkspace()));
ipcMain.handle("bullet-bank:save", async (_event, bank) => saveBulletBank(requireWorkspace(), bank));

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
    // Show only files that exist, but never save that view: a file missing for a moment (another workspace on
    // the same settings, a resume being saved) must not erase the user's choice of base resume.
    return { ...current, baseResumePath, secondaryResumePaths, linkedinProfilePath };
  }
  return current;
});
ipcMain.handle("settings:save", async (_event, input: Pick<Settings, "baseResumePath"> & Partial<Pick<Settings, "secondaryResumePaths" | "linkedinProfilePath">>) => {
  const next = await settingsStore.save(input);
  await updateCandidateProfileSources(requireWorkspace(), next);
  return next;
});
ipcMain.handle("settings:choose-resume", async (_event, role: "base" | "secondary" | "linkedin") => {
  if (role !== "base" && role !== "secondary" && role !== "linkedin") throw new Error("Resume role is invalid.");
  if (!mainWindow) throw new Error("The Sensei window is not ready.");
  const resumesRoot = assertInsideWorkspace(requireWorkspace(), join(requireWorkspace(), "resumes"));
  await mkdir(resumesRoot, { recursive: true });
  const result = await dialog.showOpenDialog(mainWindow, { title: role === "base" ? "Choose base resume" : role === "linkedin" ? "Add your LinkedIn export" : "Add secondary resume", defaultPath: resumesRoot, properties: ["openFile"], filters: [{ name: role === "linkedin" ? "LinkedIn export" : "Resume files", extensions: role === "linkedin" ? ["pdf", "md", "txt", "csv", "docx"] : ["md", "pdf", "docx"] }] });
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
  const next = role === "base" ? await settingsStore.save({ baseResumePath: relativeTarget })
    : role === "linkedin" ? await settingsStore.save({ baseResumePath: current.baseResumePath, linkedinProfilePath: relativeTarget })
    : await settingsStore.save({ baseResumePath: current.baseResumePath, secondaryResumePaths: [...new Set([...current.secondaryResumePaths, relativeTarget])] });
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
// Career context files added from the app: a file dialog, or paths of files dropped on the Sources tab.
const contextKind = (kind: unknown): ContextKind => kind === "structured" ? "structured" : "broad";
ipcMain.handle("context:add-files", async (_event, kind: unknown) => {
  if (!mainWindow) throw new Error("The Sensei window is not ready.");
  const result = await dialog.showOpenDialog(mainWindow, { title: kind === "structured" ? "Add work records" : "Add notes and documents", properties: ["openFile", "multiSelections"], filters: [{ name: "Career files", extensions: CONTEXT_EXTENSIONS.map((extension) => extension.slice(1)) }] });
  if (result.canceled || !result.filePaths.length) return { added: [], skipped: [] };
  return importContextFiles(requireWorkspace(), result.filePaths, contextKind(kind));
});
ipcMain.handle("context:import-paths", async (_event, paths: unknown, kind: unknown) => {
  if (!Array.isArray(paths) || paths.length > 50 || paths.some((path) => typeof path !== "string" || !path)) throw new Error("Choose up to 50 files.");
  return importContextFiles(requireWorkspace(), paths as string[], contextKind(kind));
});
ipcMain.handle("files:get-base-resume", async () => getBaseResume(requireWorkspace(), (await settingsStore.get()).baseResumePath));
ipcMain.handle("files:pdf-freshness", async (_event, jobId: unknown) => {
  const workspace = requireWorkspace();
  return pdfFreshness(workspace, jobId, (await readCandidateProfile(workspace))?.identity.artifactPrefix ?? undefined);
});
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
// A saved job (posting only) goes to the queue; a Job Search match saved as that job moves to "Sent for drafts".
ipcMain.handle("jobs:stage-saved", async (_event, jobId: unknown, id: unknown) => {
  const workspace = requireWorkspace();
  const meta = await stageSavedJob(workspace, jobId, String(id));
  if (features.jobSearch) await (await import("./job-search.js")).markSavedJobQueued(workspace, String(jobId));
  return meta;
});
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
// Which browser links open in: a setting for this computer (electron/browser-choice.ts).
ipcMain.handle("app:browser", async () => {
  const available = availableBrowsers();
  const choice = await readBrowserChoice(app.getPath("userData"));
  return { choice: available.includes(choice) ? choice : "default", options: available.map((id) => ({ id, name: BROWSER_NAMES[id] })) };
});
ipcMain.handle("app:set-browser", async (_event, choice: unknown) => saveBrowserChoice(app.getPath("userData"), choice));
ipcMain.handle("app:open-release", async (_event, url: unknown) => {
  const repository = await releaseRepository();
  if (typeof url === "string" && repository && url.startsWith(`https://github.com/${repository}/releases/`)) await shell.openExternal(url);
});
// One watcher reads the latest run for the whole app and pushes "runs:changed" when it changes.
const runWatcher = new RunWatcher({
  read: async () => workspacePath ? latestRun(workspacePath) : null,
  onChange: (run) => mainWindow?.webContents.send("runs:changed", run),
});
ipcMain.handle("runs:latest", async () => runWatcher.current());

// The app-owned Agy home for background Agy runs (written answers, search, rating), one per workspace (a candidate's
// folder in the Recruiter Edition shares it, with that candidate's Agy history swapped in).
const agyHomes = createAgyHomeCache((workspace) => prepareAgyHome(app.getPath("userData"), workspace, [], { appRoot: terminalAppRoot(), runtimePath: process.execPath }, agyHomeName));
ipcMain.handle("jobs:update-tracker", async (_event, jobId: unknown, update: unknown) => updateJobTracker(requireWorkspace(), String(jobId), update));
ipcMain.handle("jobs:validate-application", async (_event, jobId: string) => validateJobApplication(requireWorkspace(), jobId, false));

ipcMain.handle("search:query", async (_event, input) => searchWorkspace(requireWorkspace(), input));

ipcMain.handle("context:get-manifest", async (_event, selection) => { const settings = await settingsStore.get(); return buildContextManifest(requireWorkspace(), selection ?? {}, settings); });
ipcMain.handle("context:get-active-manifest", async () => readActiveContextManifest(requireWorkspace()));
ipcMain.handle("context:get-sources", async () => contextSources());

ipcMain.handle("terminal:start", async (_event, input: { cwd?: string }) => startAgyTerminal(input?.cwd));

/** Starts Agy in the open workspace (the app's terminal and the release smoke test both use this). */
async function startAgyTerminal(requestedCwd?: string): Promise<{ cwd: string; agyStarted: boolean }> {
  const workspace = requireWorkspace();
  if (requestedCwd && requestedCwd !== ".") assertInsideWorkspace(workspace, resolve(workspace, requestedCwd));
  const cwd = requestedCwd && requestedCwd !== "." ? resolve(workspace, requestedCwd) : workspace;
  logAgentSync(await syncWorkspaceAgentFiles(workspace).catch((error) => { console.error("Agy skill sync failed:", error); return null; }));
  if (await capWorkspaceNpmCache(workspace).catch(() => false)) console.info("Agy npm cache passed its size limit and was cleared.");
  const manifest = await buildContextManifest(workspace, {}, await settingsStore.get());
  // Agy runs with an app-owned home whose rules keep its file tools inside the workspace.
  let homeError: string | null = null;
  const agyHome = await prepareAgyHome(app.getPath("userData"), workspace, [], { appRoot: terminalAppRoot(), runtimePath: process.execPath }, agyHomeName)
    .then(async (home) => { await writeSenseiLauncher(home, { appRoot: terminalAppRoot(), packaged: app.isPackaged, runtimePath: process.execPath }); return home; })
    .catch((error) => { console.error("Agy home setup failed:", error); homeError = error instanceof Error ? error.message : String(error); return null; });
  // A candidate's Agy never runs outside the app's home: that would mix their history with the user's own Agy.
  if (!agyHome && agyHomeName) throw new Error(`Agy couldn't be prepared for this candidate (${homeError ?? "unknown error"}). Close and reopen the candidate, then try again.`);
  terminal.setAgyHome(agyHome);
  // A candidate's Agy picks up their own last conversation (their history is the only one in the home).
  terminal.setContinueConversation(Boolean(agyHomeName));
  // The terminal start rewrote the home's settings; background runs reuse it for this workspace.
  if (agyHome) agyHomes.set(workspace, agyHome);
  return terminal.start(cwd, workspace, manifest);
}
ipcMain.handle("terminal:set-context", async (_event, input) => {
  const manifest = await buildContextManifest(requireWorkspace(), input ?? {}, await settingsStore.get());
  terminal.setContext(manifest);
  for (const window of featureWindows()) window.webContents.send("context:updated", manifest);
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
  await noteAgySignIn(terminal.status());
  const [profile, settings, manifest, summary] = await Promise.all([
    readCandidateProfile(workspace).catch(() => null),
    settingsStore.get().catch(() => null),
    readActiveContextManifest(workspace).catch(() => null),
    summarizeWorkspace(workspace, getRepositoryRoot(), await settingsStore.get().catch(() => undefined)),
  ]);
  return computeReadiness({ workspacePath: workspace, profile, settings, manifest, contextFileCount: summary.contextFileCount, agy: { installed: summary.agyAvailable, signedIn: await agySignInState() } });
}
ipcMain.handle("setup:readiness", async () => readinessNow());
// Workspace folders: preview, tidy, undo (electron/layout-migration.ts; names owned by src/shared/workspace-layout.ts).
ipcMain.handle("layout:plan", async () => planMigration(requireWorkspace()));
ipcMain.handle("layout:apply", async () => {
  const workspace = requireWorkspace();
  await closeAgyForLayoutChange(workspace);
  const plan = await applyMigration(workspace);
  await afterLayoutChange(workspace);
  return plan;
});
ipcMain.handle("layout:undo", async () => {
  const workspace = requireWorkspace();
  await closeAgyForLayoutChange(workspace);
  const result = await undoMigration(workspace);
  await afterLayoutChange(workspace);
  return result;
});

/** Agy holds the old folder names in its loaded instructions, so it is closed first; never in the middle of a job. */
async function closeAgyForLayoutChange(workspace: string): Promise<void> {
  const queue = await readJobQueue(workspace).catch(() => null);
  if (queue?.items.some((item) => item.status === "running")) throw new Error("A job is running in Agy. Wait for it to finish, then try again.");
  terminal.stop();
}

/** Agy's instructions name real folders, so they are rewritten for the new layout; every cache starts over. */
async function afterLayoutChange(workspace: string): Promise<void> {
  logAgentSync(await syncWorkspaceAgentFiles(workspace).catch((error) => { console.error("Agy skill sync failed:", error); return null; }));
  invalidateSearchIndex(workspace);
  mainWindow?.webContents.send("workspace:changed", ["context", "debrief", "profile"]);
}

// Interview content refresh (electron/content-refresh.ts): new recordings, the update Agy runs, and its check.
async function jobNames(): Promise<Record<string, string>> {
  const jobs = await listJobFolders(requireWorkspace()).catch(() => []);
  return Object.fromEntries(jobs.map((job) => [job.id, [job.company, job.title].filter(Boolean).join(", ")]));
}
// The writing-voice file is the user's own; Setup edits only this one context file (other career sources stay read-only).
ipcMain.handle("profile:save-voice", async (_event, text: unknown) => {
  if (typeof text !== "string" || text.length > 20_000) throw new Error("The voice profile must be text under 20,000 characters.");
  const workspace = requireWorkspace();
  const profile = await readCandidateProfile(workspace).catch(() => null);
  const relativePath = profile?.sources.applicationVoicePath ?? "context/application_voice_profile.md";
  if (!/^context\/[^/]+\.md$/.test(relativePath)) throw new Error("The voice profile must be a Markdown file in the context folder.");
  const path = assertInsideWorkspace(workspace, join(workspace, relativePath));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  return relativePath;
});
ipcMain.handle("terminal:restart", async () => terminal.restart());
ipcMain.handle("terminal:stop", async () => terminal.stop());

// Feature-only IPC lives in its own modules, loaded only when this edition has the feature (src/shared/edition.ts);
// the recruiter build leaves those modules out of the app entirely.
let interviewIpc: typeof import("./interview-ipc.js") | null = null;
const featureContext: FeatureContext = {
  requireWorkspace,
  mainWindow: () => mainWindow,
  agyHomeFor: (workspace) => agyHomes.get(workspace),
  userDataPath: () => app.getPath("userData"),
  openLink: (url) => openLink(url),
  appRoot: terminalAppRoot,
  jobNames,
};
function featureWindows(): BrowserWindow[] { return interviewIpc?.interviewWindows() ?? []; }
async function registerFeatureIpc(): Promise<void> {
  if (features.interviews) { const module = await import("./interview-ipc.js"); module.registerInterviewIpc(featureContext); interviewIpc = module; }
  if (features.applicationQuestions) (await import("./question-ipc.js")).registerQuestionIpc(featureContext);
  if (features.contentRefresh) (await import("./content-ipc.js")).registerContentIpc(featureContext);
  if (features.jobSearch) (await import("./search-ipc.js")).registerSearchIpc(featureContext);
  if (features.today) (await import("./today-ipc.js")).registerTodayIpc(featureContext, { readiness: () => readinessNow() });
  if (features.candidates) (await import("./candidate-ipc.js")).registerCandidateIpc({
    root: () => { if (!recruiterRoot) throw new Error("The recruiter folder isn't open."); return recruiterRoot; },
    busyReason: candidateBusyReason,
    openCandidate: async (_id, folder) => { await closeCandidateFolder(); await openCandidateFolder(folder); },
    closeCandidate: closeCandidateFolder,
    userDataPath: () => app.getPath("userData"),
    chooseSavePath: async (defaultName) => {
      const result = mainWindow ? await dialog.showSaveDialog(mainWindow, { title: "Export candidate", defaultPath: join(app.getPath("downloads"), defaultName), filters: [{ name: "Zip archive", extensions: ["zip"] }] }) : { canceled: true, filePath: undefined };
      return result.canceled || !result.filePath ? null : result.filePath;
    },
    chooseFiles: async (kind) => {
      if (!mainWindow) return [];
      const result = await dialog.showOpenDialog(mainWindow, kind === "resume"
        ? { title: "Choose the candidate's resume", properties: ["openFile"], filters: [{ name: "Resume", extensions: featuresFor(currentEdition()).pdfResumes ? ["docx", "md", "pdf"] : ["docx", "md"] }] }
        : kind === "image" ? { title: "Add the confirmation", properties: ["openFile"], filters: [{ name: "Screenshot or PDF", extensions: ["png", "jpg", "jpeg", "webp", "gif", "pdf"] }] }
        : { title: "Add the candidate's files", properties: ["openFile", "multiSelections"], filters: [{ name: "Candidate files", extensions: ["md", "txt", "pdf", "docx", "rtf", "json", "csv"] }] });
      return result.canceled ? [] : result.filePaths;
    },
  });
}

/** Opens a workspace: seeds Agy's files, indexes career context, restores the base resume, and watches for changes. */
async function openWorkspace(folder: string): Promise<void> {
  workspacePath = folder;
  logAgentSync(await initializeWorkspace(workspacePath));
  await indexContext(workspacePath);
  await settingsStore.setWorkspace(workspacePath);
  // The profile also records the base resume; if the app's settings lost it, put it back so nothing downstream
  // (career sources, the context manifest, Setup) sees "no resume".
  const savedSettings = await settingsStore.get();
  const profileResume = (await readCandidateProfile(workspacePath).catch(() => null))?.sources.baseResumePath ?? null;
  if (!savedSettings.baseResumePath && profileResume) {
    await settingsStore.save({ baseResumePath: profileResume, secondaryResumePaths: savedSettings.secondaryResumePaths, linkedinProfilePath: savedSettings.linkedinProfilePath });
    console.info(`Base resume restored from the profile: ${profileResume}`);
  }
  startWorkspaceWatcher(workspacePath);
}

// Recruiter Edition (recruiter plan R1/R2): the recruiter folder, the active candidate's own settings, and whose Agy
// history the shared Agy home holds (agyHomeName = the candidate id; electron/agy-home.ts swaps it in).
let recruiterRoot: string | null = null;
let agyHomeName: string | undefined;
async function openCandidateFolder(folder: string): Promise<void> {
  const id = basename(folder);
  const { candidateSettingsStore } = await import("./candidate-ipc.js");
  settingsStore = candidateSettingsStore(folder);
  agyHomeName = id;
  invalidateSearchIndex();
  await openWorkspace(folder);
}
async function closeCandidateFolder(): Promise<void> {
  // Agy must be fully gone before the next candidate's history is swapped into the shared home.
  await terminal.stopAndWait();
  workspaceWatcher?.close();
  workspaceWatcher = undefined;
  workspacePath = undefined as unknown as string;
  agyHomeName = undefined;
  invalidateSearchIndex();
}
/**
 * A job still running for the current candidate blocks a switch: a queue item Agy is working on, or a run the run
 * tracker reports as running (a job sent from the chat). Agy's own output (starting up, signing in) never counts.
 */
async function candidateBusyReason(): Promise<string | null> {
  if (!workspacePath) return null;
  const queue = await readJobQueue(workspacePath).catch(() => null);
  const queued = queue?.items.some((item) => item.status === "running") ?? false;
  const run = await latestRun(workspacePath).catch(() => null);
  if (!queued && run?.state !== "running") return null;
  const name = recruiterRoot ? (await readRoster(recruiterRoot).catch(() => null))?.candidates.find((candidate) => candidate.id === basename(workspacePath))?.displayName : null;
  return `${name ?? "This candidate"}'s job is still running. Wait for it to finish or stop Agy first.`;
}

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
    return join(app.getPath("documents"), EDITION_INFO[edition].defaultFolder);
  }
  return resolve(app.getAppPath(), "data");
}

app.whenReady().then(async () => {
  setPageRenderer(renderPage);
  // A morning search the computer slept through runs when it wakes or unlocks (the check decides if it's due).
  if (features.jobSearch) {
    let wakeTimer: NodeJS.Timeout | null = null;
    const onWake = () => {
      if (wakeTimer) clearTimeout(wakeTimer);
      // A minute for the network to come back after a wake.
      wakeTimer = setTimeout(() => { if (workspacePath) void import("./search-ipc.js").then((module) => module.runScheduledIfDue(featureContext, workspacePath)).catch(() => undefined); }, 60_000);
    };
    powerMonitor.on("resume", onWake);
    powerMonitor.on("unlock-screen", onWake);
  }
  try {
    await registerFeatureIpc();
    settingsStore = new SettingsStore(app.getPath("userData"));
    const chosen = await prepareEditionFolder(await resolveInitialWorkspacePath(settingsStore), edition, join(app.getPath("documents"), EDITION_INFO[edition].defaultFolder));
    if (features.candidates) {
      // Recruiter Edition: the chosen folder holds the candidate list; the workspace is the active candidate's folder.
      recruiterRoot = chosen;
      await ensureRecruiterRoot(chosen);
      await settingsStore.setWorkspace(chosen);
      const active = await activeCandidatePath(chosen);
      if (active) await openCandidateFolder(active);
    } else {
      await openWorkspace(chosen);
    }
    // Only editions with background Agy runs (written answers, Job Search) make conversations to clean up.
    if (features.applicationQuestions || features.jobSearch) {
      // Background Agy conversations the app started and no longer needs (older than 14 days, beyond the newest 20).
      const opened = workspacePath;
      void agyHomes.get(opened).then((home) => pruneHeadlessConversations(home)).then((removed) => { if (removed.length) console.info(`Removed ${removed.length} old background Agy conversations.`); }).catch(() => undefined);
    }
    if (features.jobSearch) {
      const opened = workspacePath;
      // The schedule follows its settings; then a morning search the computer slept through runs now.
      void import("./search-ipc.js").then(async (module) => { await module.repairSchedule(featureContext, opened); await module.runScheduledIfDue(featureContext, opened); }).catch(() => undefined);
    }
    startWorkspaceWatcher(workspacePath);
  } catch (error) {
    console.error("Sensei startup initialization error:", error);
  }

  const scriptPolicy = process.env.VITE_DEV_SERVER_URL ? "'self' 'unsafe-inline'" : "'self'";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src ${scriptPolicy}; worker-src 'self' blob:; img-src 'self' data:; object-src 'self' data:; frame-src 'self' data:; connect-src 'self' ${DEV_URL} ${DEV_URL.replace("http", "ws")}`] } }));
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
