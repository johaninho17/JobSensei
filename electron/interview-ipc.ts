// Interview prep IPC and windows. Loaded only when the edition has `features.interviews` (src/shared/edition.ts).
import { BrowserWindow, ipcMain, shell } from "electron";
import { handleLinks } from "./open-link";
import { join } from "node:path";
import type { FeatureContext } from "./feature-context";
import { getInterviewOverview, listInterviewRounds, refreshInterviewDashboard, setCurrentInterviewRound } from "./interviews";

let interviewWindow: BrowserWindow | undefined;
/** Set when the IPC is registered: web links open in the browser chosen in Settings. */
let openLink: (url: string) => Promise<unknown> = (url) => shell.openExternal(url);

/** The interview window also needs context updates; main sends them through this. */
export function interviewWindows(): BrowserWindow[] {
  return [interviewWindow].filter((window): window is BrowserWindow => Boolean(window && !window.isDestroyed()));
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
  handleLinks(interviewWindow.webContents, process.env.VITE_DEV_SERVER_URL ?? "", openLink);
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
    handleLinks(liveWindow.webContents, process.env.VITE_DEV_SERVER_URL ?? "", openLink);
    liveWindow.on("closed", () => { liveWindow = undefined; });
  }
  if (process.env.VITE_DEV_SERVER_URL) await liveWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${query}`);
  else await liveWindow.loadFile(join(__dirname, "../../dist-renderer/index.html"), { search: `?${query}` });
  liveWindow.focus();
}

export function registerInterviewIpc(ctx: FeatureContext): void {
  openLink = ctx.openLink;
  ipcMain.handle("interviews:get-overview", async (_event, jobId: string) => getInterviewOverview(ctx.requireWorkspace(), jobId));
  ipcMain.handle("interviews:list-rounds", async (_event, jobId: string) => listInterviewRounds(ctx.requireWorkspace(), jobId));
  ipcMain.handle("interviews:set-current-round", async (_event, input: { jobId: string; roundId: string }) => setCurrentInterviewRound(ctx.requireWorkspace(), input?.jobId, input?.roundId));
  ipcMain.handle("interviews:refresh-dashboard", async (_event, jobId: string) => refreshInterviewDashboard(ctx.requireWorkspace(), jobId));
  ipcMain.handle("interviews:open-workspace-window", async (_event, input: { jobId: string; roundId: string; live?: boolean }) => input?.live ? openLiveWindow(String(input.jobId), String(input.roundId)) : openInterviewWorkspaceWindow(input?.jobId, input?.roundId));
  ipcMain.handle("interviews:set-live-collapsed", async (_event, collapsed: unknown) => {
    if (!liveWindow || liveWindow.isDestroyed()) return;
    const [width] = liveWindow.getSize();
    liveWindow.setSize(width ?? LIVE_SIZE.width, collapsed === true ? LIVE_STRIP_HEIGHT : LIVE_SIZE.height, true);
  });
}
