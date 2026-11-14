// Reads a job page the way a browser shows it, for career sites that build the posting with JavaScript.
// The app registers it with jd-fetch (setPageRenderer); everything else about reading a posting stays in jd-fetch.ts.
import { BrowserWindow, session } from "electron";

const PARTITION = "jobsensei-page-reader"; // not persisted: no cookies or sign-ins are kept between reads
const LOAD_TIMEOUT_MS = 25_000;
const SETTLE_TIMEOUT_MS = 15_000;

let configured = false;
function readerSession() {
  const reader = session.fromPartition(PARTITION);
  if (!configured) {
    configured = true;
    reader.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    reader.on("will-download", (event) => event.preventDefault());
  }
  return reader;
}

/** The page's HTML once its text stops growing, or null when it can't be loaded. */
export async function renderPage(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { session: readerSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, images: false, offscreen: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.setAudioMuted(true);
  // Some career sites refuse unknown browsers; read as plain Chrome (the app's own name and Electron removed).
  window.webContents.setUserAgent(window.webContents.getUserAgent().replace(/\s(?:Electron|jobsensei[\w-]*)\/\S+/gi, ""));
  try {
    await Promise.race([
      window.loadURL(url),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MS)),
    ]).catch(() => undefined);
    if (window.isDestroyed()) return null;
    const started = Date.now();
    let last = -1;
    let stable = 0;
    while (Date.now() - started < SETTLE_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const length = Number(await window.webContents.executeJavaScript("document.body ? document.body.innerText.length : 0").catch(() => 0));
      stable = length > 400 && length === last ? stable + 1 : 0;
      last = length;
      if (stable >= 2) break;
    }
    // Scripts often put the posting in the page as text only; keep JSON-LD and add the visible text as the body.
    return await window.webContents.executeJavaScript(`(() => {
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.outerHTML).join("");
      const candidate = document.querySelector("main, [role=main], article");
      const main = candidate && candidate.innerText.length > document.body.innerText.length * 0.5 ? candidate : document.body;
      return "<html><head><title>" + document.title.replace(/</g, "&lt;") + "</title>" + ld + "</head><body>" + main.innerHTML + "</body></html>";
    })()`) as string;
  } catch {
    return null;
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}
