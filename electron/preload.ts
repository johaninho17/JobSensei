import { contextBridge, ipcRenderer } from "electron";
import type { SenseiApi } from "../src/shared/schemas";

const api: SenseiApi = {
  app: {
    copyText: (text) => ipcRenderer.invoke("app:copy-text", text),
  },
  workspace: {
    getSummary: () => ipcRenderer.invoke("workspace:get-summary"),
    rescan: () => ipcRenderer.invoke("workspace:rescan"),
    onChanged: (callback) => { const listener = () => callback(); ipcRenderer.on("workspace:changed", listener); return () => ipcRenderer.removeListener("workspace:changed", listener); },
  },
  profile: {
    get: () => ipcRenderer.invoke("profile:get"),
    create: (input) => ipcRenderer.invoke("profile:create", input),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (input) => ipcRenderer.invoke("settings:save", input),
    chooseResume: (role) => ipcRenderer.invoke("settings:choose-resume", role),
    removeSecondary: (path) => ipcRenderer.invoke("settings:remove-secondary", path),
  },
  files: {
    listTree: () => ipcRenderer.invoke("files:list-tree"),
    preview: (relativePath) => ipcRenderer.invoke("files:preview", relativePath),
    saveMarkdown: (input) => ipcRenderer.invoke("files:save-markdown", input),
    deletePath: (relativePath) => ipcRenderer.invoke("files:delete", relativePath),
    reveal: (relativePath) => ipcRenderer.invoke("files:reveal", relativePath),
    getBaseResume: () => ipcRenderer.invoke("files:get-base-resume"),
    exportMarkdownPdf: (relativePath, textSize = "auto") => ipcRenderer.invoke("files:export-markdown-pdf", { relativePath, textSize }),
  },
  jobs: {
    list: () => ipcRenderer.invoke("jobs:list"),
    listTree: () => ipcRenderer.invoke("jobs:list-tree"),
    listArtifacts: (jobId) => ipcRenderer.invoke("jobs:list-artifacts", jobId),
    previewArtifact: (jobId, relativePath) => ipcRenderer.invoke("jobs:preview-artifact", jobId, relativePath),
    getApplicationStatus: (jobId) => ipcRenderer.invoke("jobs:get-application-status", jobId),
    validateApplication: (jobId) => ipcRenderer.invoke("jobs:validate-application", jobId),
  },
  interviews: {
    getOverview: (jobId) => ipcRenderer.invoke("interviews:get-overview", jobId),
    listRounds: (jobId) => ipcRenderer.invoke("interviews:list-rounds", jobId),
    setCurrentRound: (jobId, roundId) => ipcRenderer.invoke("interviews:set-current-round", { jobId, roundId }),
    refreshDashboard: (jobId) => ipcRenderer.invoke("interviews:refresh-dashboard", jobId),
    openWorkspaceWindow: (jobId, roundId) => ipcRenderer.invoke("interviews:open-workspace-window", { jobId, roundId }),
  },
  search: {
    query: (input) => ipcRenderer.invoke("search:query", input),
  },
  context: {
    getManifest: (selection) => ipcRenderer.invoke("context:get-manifest", selection ?? {}),
    getActiveManifest: () => ipcRenderer.invoke("context:get-active-manifest"),
    getSources: () => ipcRenderer.invoke("context:get-sources"),
    onUpdated: (callback) => { const listener = (_event: Electron.IpcRendererEvent, manifest: Parameters<NonNullable<SenseiApi["context"]["onUpdated"]>>[0] extends (value: infer Value) => void ? Value : never) => callback(manifest); ipcRenderer.on("context:updated", listener); return () => ipcRenderer.removeListener("context:updated", listener); },
  },
  terminal: {
    start: (input) => ipcRenderer.invoke("terminal:start", input),
    setContext: (input) => ipcRenderer.invoke("terminal:set-context", input),
    write: (data) => ipcRenderer.invoke("terminal:write", data),
    insertPrompt: (text) => ipcRenderer.invoke("terminal:insert-prompt", text),
    resize: (input) => ipcRenderer.invoke("terminal:resize", input),
    restart: () => ipcRenderer.invoke("terminal:restart"),
    stop: () => ipcRenderer.invoke("terminal:stop"),
    onData: (callback) => { const listener = (_event: Electron.IpcRendererEvent, data: string) => callback(data); ipcRenderer.on("terminal:data", listener); return () => ipcRenderer.removeListener("terminal:data", listener); },
    onExit: (callback) => { const listener = (_event: Electron.IpcRendererEvent, code: number) => callback(code); ipcRenderer.on("terminal:exit", listener); return () => ipcRenderer.removeListener("terminal:exit", listener); },
  },
};

contextBridge.exposeInMainWorld("sensei", api);
