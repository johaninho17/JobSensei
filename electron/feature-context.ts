import type { BrowserWindow } from "electron";

/** What a feature's IPC module needs from the main process. */
export type FeatureContext = {
  requireWorkspace: () => string;
  mainWindow: () => BrowserWindow | undefined;
  /** The Agy home the terminal last prepared, or null before the terminal has started. */
  agyHome: () => string | null;
  userDataPath: () => string;
  appRoot: () => string;
  /** Lists the workspace's jobs as id → "Company, Title". */
  jobNames: () => Promise<Record<string, string>>;
};
