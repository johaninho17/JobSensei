import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { SenseiApi } from "../src/shared/schemas";

const api: SenseiApi = {
  app: {
    checkUpdate: () => ipcRenderer.invoke("app:check-update"),
    openRelease: (url) => ipcRenderer.invoke("app:open-release", url),
    copyText: (text) => ipcRenderer.invoke("app:copy-text", text),
  },
  setup: {
    readiness: () => ipcRenderer.invoke("setup:readiness"),
  },
  workspace: {
    getSummary: () => ipcRenderer.invoke("workspace:get-summary"),
    rescan: () => ipcRenderer.invoke("workspace:rescan"),
    onChanged: (callback) => { const listener = (_event: Electron.IpcRendererEvent, paths?: string[]) => callback(paths ?? []); ipcRenderer.on("workspace:changed", listener); return () => ipcRenderer.removeListener("workspace:changed", listener); },
  },
  profile: {
    get: () => ipcRenderer.invoke("profile:get"),
    create: (input) => ipcRenderer.invoke("profile:create", input),
    updatePreferences: (preferences) => ipcRenderer.invoke("profile:update-preferences", preferences),
    saveVoice: (text) => ipcRenderer.invoke("profile:save-voice", text),
    updateDetails: (details) => ipcRenderer.invoke("profile:update-details", details),
    preview: () => ipcRenderer.invoke("profile:preview"),
  },
  bulletBank: {
    get: () => ipcRenderer.invoke("bullet-bank:get"),
    save: (bank) => ipcRenderer.invoke("bullet-bank:save", bank),
  },
  clarifications: {
    getQuestions: (jobId) => ipcRenderer.invoke("clarifications:get-questions", jobId),
    submitAnswers: (jobId, answers) => ipcRenderer.invoke("clarifications:submit-answers", { jobId, answers }),
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
    pathForFile: (file) => webUtils.getPathForFile(file),
    getBaseResume: () => ipcRenderer.invoke("files:get-base-resume"),
    exportMarkdownPdf: (relativePath, textSize) => ipcRenderer.invoke("files:export-markdown-pdf", { relativePath, textSize }),
  },
  jobs: {
    list: () => ipcRenderer.invoke("jobs:list"),
    listTree: () => ipcRenderer.invoke("jobs:list-tree"),
    listArtifacts: (jobId) => ipcRenderer.invoke("jobs:list-artifacts", jobId),
    previewArtifact: (jobId, relativePath) => ipcRenderer.invoke("jobs:preview-artifact", jobId, relativePath),
    getApplicationStatus: (jobId) => ipcRenderer.invoke("jobs:get-application-status", jobId),
    validateApplication: (jobId) => ipcRenderer.invoke("jobs:validate-application", jobId),
    updateTracker: (jobId, update) => ipcRenderer.invoke("jobs:update-tracker", jobId, update),
    stagePastedJd: (text, id) => ipcRenderer.invoke("jobs:stage-pasted-jd", text, id),
    stageLink: (url, id) => ipcRenderer.invoke("jobs:stage-link", url, id),
    setStagedCompany: (id, company) => ipcRenderer.invoke("jobs:set-staged-company", id, company),
    exportCsv: (csv) => ipcRenderer.invoke("jobs:export-csv", csv),
  },
  interviews: {
    getOverview: (jobId) => ipcRenderer.invoke("interviews:get-overview", jobId),
    listRounds: (jobId) => ipcRenderer.invoke("interviews:list-rounds", jobId),
    setCurrentRound: (jobId, roundId) => ipcRenderer.invoke("interviews:set-current-round", { jobId, roundId }),
    refreshDashboard: (jobId) => ipcRenderer.invoke("interviews:refresh-dashboard", jobId),
    openWorkspaceWindow: (jobId, roundId, live) => ipcRenderer.invoke("interviews:open-workspace-window", { jobId, roundId, live: live === true }),
    setLiveCollapsed: (collapsed) => ipcRenderer.invoke("interviews:set-live-collapsed", collapsed === true),
  },
  questions: {
    get: (jobId) => ipcRenderer.invoke("questions:get", jobId),
    auto: (jobId) => ipcRenderer.invoke("questions:auto", jobId),
    ask: (jobId, text) => ipcRenderer.invoke("questions:ask", jobId, text),
    retry: (jobId) => ipcRenderer.invoke("questions:retry", jobId),
    answerAnyway: (jobId, questionId) => ipcRenderer.invoke("questions:answer-anyway", jobId, questionId),
    onUpdated: (callback) => { const listener = (_event: Electron.IpcRendererEvent, jobId: string, state: Parameters<Parameters<SenseiApi["questions"]["onUpdated"]>[0]>[1]) => callback(jobId, state); ipcRenderer.on("questions:updated", listener); return () => ipcRenderer.removeListener("questions:updated", listener); },
  },
  runs: {
    latest: () => ipcRenderer.invoke("runs:latest"),
  },
  queue: {
    get: () => ipcRenderer.invoke("queue:get"),
    save: (queue) => ipcRenderer.invoke("queue:save", queue),
  },
  search: {
    query: (input) => ipcRenderer.invoke("search:query", input),
  },
  context: {
    getManifest: (selection) => ipcRenderer.invoke("context:get-manifest", selection ?? {}),
    addFiles: (kind) => ipcRenderer.invoke("context:add-files", kind),
    importPaths: (paths, kind) => ipcRenderer.invoke("context:import-paths", paths, kind),
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
    status: () => ipcRenderer.invoke("terminal:status"),
    stop: () => ipcRenderer.invoke("terminal:stop"),
    onData: (callback) => { const listener = (_event: Electron.IpcRendererEvent, data: string) => callback(data); ipcRenderer.on("terminal:data", listener); return () => ipcRenderer.removeListener("terminal:data", listener); },
    onExit: (callback) => { const listener = (_event: Electron.IpcRendererEvent, code: number) => callback(code); ipcRenderer.on("terminal:exit", listener); return () => ipcRenderer.removeListener("terminal:exit", listener); },
  },
};

contextBridge.exposeInMainWorld("sensei", api);
