import type { BrowserWindow } from "electron";

/** What a feature's IPC module needs from the main process. */
export type FeatureContext = {
  requireWorkspace: () => string;
  mainWindow: () => BrowserWindow | undefined;
  /** The app-owned Agy home for this workspace (the terminal's, or prepared on first use). */
  agyHomeFor: (workspace: string) => Promise<string>;
  userDataPath: () => string;
  appRoot: () => string;
  /** Lists the workspace's jobs as id → "Company, Title". */
  jobNames: () => Promise<Record<string, string>>;
};
