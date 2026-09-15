import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ApplicationStatus, ApplicationValidationReport, CandidateProfile, ChallengeExercise, ChallengePractice, ContextManifest, FilePreview, FileTreeNode, InterviewDashboardItem, InterviewOverview, InterviewRound, JobFolderSummary, PdfTextSize, SearchResult, Settings, WorkspaceSummary } from "../shared/schemas";
// pdfjs-dist ships the browser runtime without declarations for this subpath.
// @ts-expect-error The Vite browser bundle is intentionally imported directly.
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { filterChallengeExercises, parseChallengePractice, type ChallengeFilter } from "./challenge-practice";
import { buildJobActions, type JobAction } from "./job-actions";
import { evaluationCategoryLabels, evaluationCredits, evaluationLabel, evaluationSection, parseEvaluationRequirements } from "./evaluation-model";
import { parseQuestionBank, type QuestionEntry } from "./question-navigation";
import { SearchPalette, type PaletteAction } from "./SearchPalette";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const emptyWorkspace: WorkspaceSummary = { path: "", repositoryRoot: "", status: "unconfigured", contextFileCount: 0, jobCount: 0, hasIndex: false, hasCandidateProfile: false, hasBaseResume: false, agyAvailable: false, warnings: [] };
const emptySettings: Settings = { schemaVersion: 1, workspacePath: null, baseResumePath: null, secondaryResumePaths: [], linkedinProfilePath: null, updatedAt: "" };
const LEFT_PANEL_MIN = 190;
const LEFT_PANEL_COLLAPSE_THRESHOLD = 120;
const LEFT_PANEL_MAX = 560;
const RIGHT_PANEL_MIN = 300;
const RIGHT_PANEL_MAX = 900;
const VIEWER_PANEL_MIN = 320;
type PromptRequest = { id: number; text: string; label: string };
type JobWorkspaceTab = "overview" | "application" | "interview" | "files";
type JobLocation = { kind: "job"; jobId: string; tab: JobWorkspaceTab; roundId?: string };
type WorkspaceLocation =
  | { kind: "jobs-home" }
  | JobLocation
  | { kind: "document"; relativePath: string; jobId: string | null; anchor?: string; returnTo: JobLocation | { kind: "jobs-home" } };

const JOB_FAVORITES_KEY = "sensei-job-favorites";

function storedFavoriteJobIds(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(JOB_FAVORITES_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function storedPanelNumber(key: string, fallback: number): number {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function storedPanelOpen(key: string): boolean {
  return window.localStorage.getItem(key) !== "closed";
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("interviewWorkspace") === "1") return <InterviewWorkspaceStandalone jobId={params.get("jobId") ?? ""} roundId={params.get("roundId") ?? ""} />;
  return <WorkspaceApp />;
}

function WorkspaceApp() {
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [baseResume, setBaseResume] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobFolderSummary[]>([]);
  const [selectedCareerPaths, setSelectedCareerPaths] = useState<string[]>([]);
  const [selectedJobFiles, setSelectedJobFiles] = useState<string[]>([]);
  const [selectionInitialized, setSelectionInitialized] = useState(false);
  const [jobTree, setJobTree] = useState<FileTreeNode[]>([]);
  const [contextManifest, setContextManifest] = useState<ContextManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resumeSettings, setResumeSettings] = useState<Settings>(emptySettings);
  const [candidateProfile, setCandidateProfile] = useState<CandidateProfile | null>(null);
  const [interviewOverview, setInterviewOverview] = useState<InterviewOverview | null>(null);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [applicationStatus, setApplicationStatus] = useState<ApplicationStatus | null>(null);
  const [applicationLoading, setApplicationLoading] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => window.localStorage.getItem("sensei-theme-v2") === "dark" ? "dark" : "light");
  const [navigatorSection, setNavigatorSection] = useState<"jobs" | "context">("jobs");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => storedPanelNumber("sensei-left-panel-width", 260));
  const [rightPanelWidth, setRightPanelWidth] = useState(() => storedPanelNumber("sensei-right-panel-width", 430));
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => storedPanelOpen("sensei-left-panel-state"));
  const [rightPanelOpen, setRightPanelOpen] = useState(() => storedPanelOpen("sensei-right-panel-state"));
  const [searchOpen, setSearchOpen] = useState(false);
  const [treeRevealPath, setTreeRevealPath] = useState<string | null>(null);
  const [promptRequest, setPromptRequest] = useState<PromptRequest | null>(null);
  const promptRequestId = useRef(0);
  const [navigationHistory, setNavigationHistory] = useState<WorkspaceLocation[]>([{ kind: "jobs-home" }]);
  const [navigationIndex, setNavigationIndex] = useState(0);
  const previewRequestId = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("sensei-theme", theme);
    window.localStorage.setItem("sensei-theme-v2", theme);
  }, [theme]);
  useEffect(() => { window.localStorage.setItem("sensei-left-panel-width", String(leftPanelWidth)); }, [leftPanelWidth]);
  useEffect(() => { window.localStorage.setItem("sensei-right-panel-width", String(rightPanelWidth)); }, [rightPanelWidth]);
  useEffect(() => { window.localStorage.setItem("sensei-left-panel-state", leftPanelOpen ? "open" : "closed"); }, [leftPanelOpen]);
  useEffect(() => { window.localStorage.setItem("sensei-right-panel-state", rightPanelOpen ? "open" : "closed"); }, [rightPanelOpen]);
  useEffect(() => {
    const toggleSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", toggleSearch);
    return () => window.removeEventListener("keydown", toggleSearch);
  }, []);
  useEffect(() => {
    const navigateWithKeyboard = (event: KeyboardEvent) => {
      const back = (event.altKey && event.key === "ArrowLeft") || ((event.metaKey || event.ctrlKey) && event.key === "[");
      const forward = (event.altKey && event.key === "ArrowRight") || ((event.metaKey || event.ctrlKey) && event.key === "]");
      if (!back && !forward) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      navigateHistory(back ? -1 : 1);
    };
    window.addEventListener("keydown", navigateWithKeyboard);
    return () => window.removeEventListener("keydown", navigateWithKeyboard);
  }, [navigationHistory, navigationIndex, editorDirty]);

  function panelMaximum(side: "left" | "right"): number {
    const oppositeWidth = side === "left"
      ? (rightPanelOpen ? rightPanelWidth : 0)
      : (leftPanelOpen ? leftPanelWidth : 0);
    const minimum = side === "left" ? LEFT_PANEL_MIN : RIGHT_PANEL_MIN;
    const hardMaximum = side === "left" ? LEFT_PANEL_MAX : RIGHT_PANEL_MAX;
    return Math.max(minimum, Math.min(hardMaximum, window.innerWidth - oppositeWidth - VIEWER_PANEL_MIN - 16));
  }

  function setPanelWidth(side: "left" | "right", width: number) {
    const minimum = side === "left" ? LEFT_PANEL_MIN : RIGHT_PANEL_MIN;
    const next = Math.round(Math.max(minimum, Math.min(panelMaximum(side), width)));
    if (side === "left") setLeftPanelWidth(next);
    else setRightPanelWidth(next);
  }

  function beginPanelResize(side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftPanelWidth : rightPanelWidth;
    const move = (pointerEvent: PointerEvent) => {
      const delta = pointerEvent.clientX - startX;
      if (side === "left" && startWidth + delta <= LEFT_PANEL_COLLAPSE_THRESHOLD) {
        setLeftPanelOpen(false);
        return;
      }
      setPanelWidth(side, startWidth + (side === "left" ? delta : -delta));
    };
    const finish = () => {
      document.body.classList.remove("is-resizing-panels");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    document.body.classList.add("is-resizing-panels");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function resizePanelWithKeyboard(side: "left" | "right", event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const width = side === "left" ? leftPanelWidth : rightPanelWidth;
    setPanelWidth(side, width + direction * (side === "left" ? 20 : -20));
  }

  async function refresh(silent = false) {
    if (!silent) { setLoading(true); setError(null); }
    try {
      const summary = await window.sensei.workspace.getSummary();
      setWorkspace(summary);
      if (summary.status === "ready") {
        const [nextTree, nextBase, nextJobs, nextJobTree, nextSettings, nextProfile] = await Promise.all([window.sensei.files.listTree(), window.sensei.files.getBaseResume(), window.sensei.jobs.list(), window.sensei.jobs.listTree(), window.sensei.settings.get(), window.sensei.profile.get()]);
        setTree(nextTree);
        setBaseResume(nextBase);
        setResumeSettings(nextSettings);
        setJobs(nextJobs);
        setJobTree(nextJobTree);
        setCandidateProfile(nextProfile);
        const defaultCareerPaths = selectionInitialized ? selectedCareerPaths : [...filePaths(nextTree).filter((path) => path.startsWith("context/structured/") && path !== "context/structured/README.md"), ...[nextSettings.baseResumePath, ...nextSettings.secondaryResumePaths, nextSettings.linkedinProfilePath].filter((path): path is string => Boolean(path))];
        if (!selectionInitialized) { setSelectedCareerPaths(defaultCareerPaths); setSelectionInitialized(true); }
        if (nextBase) {
          setContextManifest(await window.sensei.context.getManifest({ careerPaths: defaultCareerPaths, structuredPaths: defaultCareerPaths.filter((path) => path.startsWith("context/structured/")), broadPaths: defaultCareerPaths.filter((path) => path.startsWith("context/broad/")), jobPaths: selectionInitialized ? selectedJobFiles : [], jobIds: [] }));
        } else {
          setContextManifest(null);
        }
      }
    } catch (caught) { if (!silent) setError(messageOf(caught, "Unable to read the workspace.")); }
    finally { if (!silent) setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    return window.sensei.workspace.onChanged(() => { void refresh(true); });
  }, [selectionInitialized, selectedCareerPaths, selectedJobFiles]);

  useEffect(() => {
    if (!editorDirty) return;
    const warnBeforeClosing = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeClosing);
    return () => window.removeEventListener("beforeunload", warnBeforeClosing);
  }, [editorDirty]);

  async function applyLocation(location: WorkspaceLocation) {
    if (location.kind === "document") {
      const requestId = ++previewRequestId.current;
      setSelectedPath(location.relativePath);
      setActiveJobId(location.jobId);
      setError(null);
      try {
        const nextPreview = await window.sensei.files.preview(location.relativePath);
        if (requestId === previewRequestId.current) setPreview(nextPreview);
      } catch (caught) {
        if (requestId === previewRequestId.current) {
          setPreview(null);
          setError(messageOf(caught, "Unable to preview that file."));
        }
      }
      return;
    }
    previewRequestId.current += 1;
    setSelectedPath(null);
    setPreview(null);
    setActiveJobId(location.kind === "job" ? location.jobId : null);
    setError(null);
  }

  function pushLocation(location: WorkspaceLocation) {
    setNavigationHistory((current) => [...current.slice(0, navigationIndex + 1), location].slice(-60));
    setNavigationIndex((current) => Math.min(current + 1, 59));
    void applyLocation(location);
  }

  function replaceLocation(location: WorkspaceLocation) {
    setNavigationHistory((current) => current.map((entry, index) => index === navigationIndex ? location : entry));
    void applyLocation(location);
  }

  function currentReturnLocation(jobId: string | null): JobLocation | { kind: "jobs-home" } {
    const current = navigationHistory[navigationIndex];
    if (current?.kind === "job") return current;
    if (current?.kind === "document") return current.returnTo;
    return jobId ? { kind: "job", jobId, tab: "overview" } : { kind: "jobs-home" };
  }

  async function selectFile(relativePath: string, anchor?: string) {
    if (relativePath === selectedPath && preview) return;
    if (editorDirty && !window.confirm("Discard your unsaved Markdown changes?")) return;
    setEditorDirty(false);
    const jobId = relativePath.match(/^jobs\/([^/]+)/)?.[1] ?? null;
    pushLocation({ kind: "document", relativePath, jobId, anchor, returnTo: currentReturnLocation(jobId) });
  }

  function closeDocument() {
    if (editorDirty && !window.confirm("Discard your unsaved Markdown changes?")) return;
    setEditorDirty(false);
    const current = navigationHistory[navigationIndex];
    if (current?.kind === "document") {
      const nextHistory = navigationHistory.map((entry, index) => index === navigationIndex ? current.returnTo : entry);
      setNavigationHistory(nextHistory);
      void applyLocation(current.returnTo);
    }
  }

  function navigateHistory(direction: -1 | 1) {
    if (editorDirty && !window.confirm("Discard your unsaved Markdown changes?")) return;
    const nextIndex = navigationIndex + direction;
    const next = navigationHistory[nextIndex];
    if (!next) return;
    setEditorDirty(false);
    setNavigationIndex(nextIndex);
    void applyLocation(next);
  }

  function openSearchResult(result: SearchResult) {
    if (!result.relativePath) return;
    if (result.jobId) setActiveJobId(result.jobId);
    setTreeRevealPath(result.relativePath);
    void selectFile(result.relativePath);
  }

  function openJob(jobId: string) {
    if (editorDirty && !window.confirm("Discard your unsaved Markdown changes?")) return;
    setEditorDirty(false);
    setNavigatorSection("jobs");
    pushLocation({ kind: "job", jobId, tab: "overview" });
  }

  function showJobsHome() {
    if (editorDirty && !window.confirm("Discard your unsaved Markdown changes?")) return;
    setEditorDirty(false);
    setNavigatorSection("jobs");
    pushLocation({ kind: "jobs-home" });
  }

  function openJobView(jobId: string, tab: JobWorkspaceTab, roundId?: string) {
    const current = navigationHistory[navigationIndex];
    if (current?.kind === "job" && current.jobId === jobId && current.tab === tab && current.roundId === roundId) return;
    pushLocation({ kind: "job", jobId, tab, roundId });
  }

  function insertJobPrompt(action: JobAction) {
    promptRequestId.current += 1;
    setRightPanelOpen(true);
    setPromptRequest({ id: promptRequestId.current, text: action.prompt, label: action.label });
  }

  async function updateContext(careerPaths: string[], jobPaths: string[]) {
    setError(null);
    try {
      setContextManifest(await window.sensei.terminal.setContext({
        careerPaths,
        structuredPaths: careerPaths.filter((path) => path.startsWith("context/structured/")),
        broadPaths: careerPaths.filter((path) => path.startsWith("context/broad/")),
        jobPaths,
        jobIds: [],
      }));
    }
    catch (caught) { setError(messageOf(caught, "Unable to update terminal context.")); }
  }

  async function togglePath(path: string, checked: boolean) {
    const isJobPath = path.startsWith("jobs/");
    const sourceTree = isJobPath ? jobTree : tree;
    const node = findNode(sourceTree, path);
    const paths = (node ? filePaths([node]) : [path]).filter((candidate) => candidate !== "context/denylist.md");
    const setter = isJobPath ? setSelectedJobFiles : setSelectedCareerPaths;
    const current = isJobPath ? selectedJobFiles : selectedCareerPaths;
    const next = checked ? [...new Set([...current, ...paths])] : current.filter((value) => !paths.includes(value));
    setter(next);
    await updateContext(isJobPath ? selectedCareerPaths : next, isJobPath ? next : selectedJobFiles);
  }

  async function chooseResume(role: "base" | "secondary") {
    setError(null);
    try {
      const nextSettings = await window.sensei.settings.chooseResume(role);
      setResumeSettings(nextSettings);
      setBaseResume(nextSettings.baseResumePath);
      const nextCareerPaths = [...new Set([...selectedCareerPaths, nextSettings.baseResumePath, ...nextSettings.secondaryResumePaths]
        .filter((path): path is string => Boolean(path)))];
      setSelectedCareerPaths(nextCareerPaths);
      await updateContext(nextCareerPaths, selectedJobFiles);
      await refresh();
    } catch (caught) { setError(messageOf(caught, "Unable to update resume sources.")); }
  }

  async function removeSecondary(path: string) {
    if (!window.confirm(`Remove ${path} from secondary resumes?\n\nThe source file will not be deleted.`)) return;
    setError(null);
    try {
      const nextSettings = await window.sensei.settings.removeSecondary(path);
      setResumeSettings(nextSettings);
      const nextCareerPaths = selectedCareerPaths.filter((candidate) => candidate !== path);
      setSelectedCareerPaths(nextCareerPaths);
      await updateContext(nextCareerPaths, selectedJobFiles);
      await refresh();
    } catch (caught) { setError(messageOf(caught, "Unable to remove the secondary resume.")); }
  }

  async function deletePath(path: string) {
    if (!window.confirm(`Move ${path} to Trash?\n\nYou can recover it from your system Trash or Recycle Bin.`)) return;
    setError(null);
    try {
      const deletedPrefix = `${path}/`;
      const nextCareerPaths = selectedCareerPaths.filter((candidate) => candidate !== path && !candidate.startsWith(deletedPrefix));
      const nextJobFiles = selectedJobFiles.filter((candidate) => candidate !== path && !candidate.startsWith(deletedPrefix));
      await window.sensei.files.deletePath(path);
      if (selectedPath === path || selectedPath?.startsWith(deletedPrefix)) { setSelectedPath(null); setPreview(null); setEditorDirty(false); }
      setSelectedCareerPaths(nextCareerPaths);
      setSelectedJobFiles(nextJobFiles);
      await refresh();
      await updateContext(nextCareerPaths, nextJobFiles);
    } catch (caught) { setError(messageOf(caught, "Unable to move that file or folder to Trash.")); }
  }

  async function markdownSaved(nextPreview: FilePreview) {
    setPreview(nextPreview);
    setEditorDirty(false);
    const [nextTree, nextJobTree] = await Promise.all([window.sensei.files.listTree(), window.sensei.jobs.listTree()]);
    setTree(nextTree);
    setJobTree(nextJobTree);
    await updateContext(selectedCareerPaths, selectedJobFiles);
  }

  const configured = workspace.status === "ready" && Boolean(workspace.path);
  const needsSetup = configured && (!workspace.hasCandidateProfile || !workspace.hasBaseResume);
  const activeJobIds = contextManifest?.selectedJobIds ?? [];
  const activeJobs = activeJobIds.map((id) => jobs.find((job) => job.id === id)).filter((job): job is JobFolderSummary => Boolean(job));
  const viewedPath = preview?.relativePath ?? selectedPath;
  const viewedJobId = viewedPath?.match(/^jobs\/([^/]+)/)?.[1] ?? activeJobId;
  const viewedJob = viewedJobId ? jobs.find((job) => job.id === viewedJobId) ?? null : null;
  const viewedCompany = preview?.jobCompany ?? viewedJob?.company ?? null;
  useEffect(() => {
    let cancelled = false;
    setInterviewOverview(null);
    if (!viewedJobId) { setInterviewLoading(false); return; }
    setInterviewLoading(true);
    void window.sensei.interviews.getOverview(viewedJobId)
      .then((overview) => { if (!cancelled) setInterviewOverview(overview); })
      .catch(() => { if (!cancelled) setInterviewOverview(null); })
      .finally(() => { if (!cancelled) setInterviewLoading(false); });
    return () => { cancelled = true; };
  }, [viewedJobId, jobTree]);
  useEffect(() => {
    let cancelled = false;
    setApplicationStatus(null);
    if (!viewedJobId) { setApplicationLoading(false); return; }
    setApplicationLoading(true);
    void window.sensei.jobs.getApplicationStatus(viewedJobId)
      .then((status) => { if (!cancelled) setApplicationStatus(status); })
      .catch(() => { if (!cancelled) setApplicationStatus(null); })
      .finally(() => { if (!cancelled) setApplicationLoading(false); });
    return () => { cancelled = true; };
  }, [viewedJobId, jobTree]);
  const activeContextTitle = activeJobs.length === 0 ? "Career context only" : `Career + ${activeJobs.length} job${activeJobs.length === 1 ? "" : "s"}`;
  const sourceCount = [...(contextManifest?.selectedStructuredPaths ?? []), ...(contextManifest?.selectedBroadPaths ?? [])]
    .filter((path) => !path.startsWith("context/structured/company/") && !path.startsWith("context/broad/company/")).length;
  const activeContextDetail = configured
    ? `${sourceCount} source${sourceCount === 1 ? "" : "s"}${activeJobs.length > 0 ? ` · ${activeJobs.map((job) => job.title ?? job.company ?? "Job workspace").join(", ")}` : ""} · Terminal: ${workspaceLabel(workspace.path)}/`
    : "Open the local workspace to begin";
  const actionTargetJob = viewedJob ?? (activeJobs.length === 1 ? activeJobs[0] : null);
  const currentLocation = navigationHistory[navigationIndex] ?? { kind: "jobs-home" as const };
  const jobActions = buildJobActions(
    actionTargetJob,
    actionTargetJob?.id === viewedJobId ? interviewOverview : null,
    actionTargetJob?.id === viewedJobId ? applicationStatus : null,
  );
  const paletteActions: PaletteAction[] = [
    ...jobActions.map((action) => ({
      id: `job-action:${action.id}`,
      title: action.label,
      subtitle: `${action.company} · Insert into Command Center`,
      keywords: `${action.group} ${action.prompt}`,
      run: () => insertJobPrompt(action),
    })),
    {
      id: "toggle-files",
      title: leftPanelOpen ? "Collapse navigation" : "Expand navigation",
      subtitle: "Adjust the integrated workspace navigator",
      keywords: "files navigation context jobs",
      run: () => setLeftPanelOpen((open) => !open),
    },
    {
      id: "toggle-terminal",
      title: rightPanelOpen ? "Hide Command Center" : "Show Command Center",
      subtitle: "Adjust workspace panels",
      keywords: "terminal codex antigravity command center",
      run: () => setRightPanelOpen((open) => !open),
    },
    {
      id: "rescan-workspace",
      title: "Rescan workspace",
      subtitle: "Refresh local files and search index",
      keywords: "reload refresh files jobs context",
      run: () => void refresh(),
    },
  ];
  const panelLayoutStyle = {
    "--left-panel-width": `${leftPanelOpen ? leftPanelWidth : 0}px`,
    "--left-resizer-width": leftPanelOpen ? "7px" : "0px",
    "--right-panel-width": `${rightPanelOpen ? rightPanelWidth : 0}px`,
    "--right-resizer-width": rightPanelOpen ? "7px" : "0px",
  } as CSSProperties;
  return <main className="app-shell">
    <header className="topbar">
      <div className="wordmark"><span className="wordmark-mark">S</span><span>Sensei</span></div>
      <nav className="history-controls" aria-label="Workspace history">
        <button aria-label="Go back" title="Back" disabled={navigationIndex === 0} onClick={() => navigateHistory(-1)}>←</button>
        <button aria-label="Go forward" title="Forward" disabled={navigationIndex >= navigationHistory.length - 1} onClick={() => navigateHistory(1)}>→</button>
      </nav>
      <button className="home-button" aria-label="Go to Home" title="Home" onClick={showJobsHome}>⌂<span>Home</span></button>
      <div className="topbar-context" title={activeContextDetail}><span className="eyebrow">ACTIVE CONTEXT</span><strong>{configured ? activeContextTitle : "No active workspace"}</strong><span>{activeContextDetail}</span></div>
      <div className="topbar-company" aria-live="polite" title={viewedCompany ?? undefined}>{viewedCompany ?? ""}</div>
      <div className="panel-visibility-controls" aria-label="Workspace panels">
        <button className={leftPanelOpen ? "is-active" : ""} aria-pressed={leftPanelOpen} onClick={() => setLeftPanelOpen((open) => !open)}>Navigation</button>
        <button className={rightPanelOpen ? "is-active" : ""} aria-pressed={rightPanelOpen} onClick={() => setRightPanelOpen((open) => !open)}>Terminal</button>
      </div>
      <div className="topbar-status"><span className={`status-dot ${configured ? "is-ready" : ""}`} />{configured ? "Workspace ready" : "Choose a workspace"}</div>
      {configured && <button className="topbar-button search-trigger" onClick={() => setSearchOpen(true)}><span aria-hidden="true">⌕</span>Search <kbd>Ctrl/⌘ K</kbd></button>}
      {configured && <button className="topbar-button" onClick={() => void refresh()}>Rescan</button>}
      <button className="theme-toggle" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><span aria-hidden="true">{theme === "dark" ? "☼" : "◐"}</span>{theme === "dark" ? "Day" : "Night"}</button>
    </header>
    <SearchPalette open={searchOpen} actions={paletteActions} onClose={() => setSearchOpen(false)} onOpenResult={openSearchResult} />
    <section className="workspace-grid" style={panelLayoutStyle}>
      <section className={`workspace-main ${leftPanelOpen ? "" : "is-navigation-compact"}`}>
        <aside className={`workspace-navigator ${leftPanelOpen ? "is-open" : "is-closed"}`} aria-label="Workspace navigation" aria-hidden={!leftPanelOpen}>
          {leftPanelOpen && <div className="navigator-content">
            <div className="navigator-heading"><div><span className="eyebrow">WORKSPACE</span><strong>{navigatorSection === "jobs" ? "Jobs" : "Career context"}</strong></div><span className="count">{navigatorSection === "jobs" ? jobs.length : selectedCareerPaths.length}</span></div>
            <div className="navigator-switcher" role="tablist" aria-label="Workspace navigation sections">
              <button role="tab" aria-selected={navigatorSection === "jobs"} className={navigatorSection === "jobs" ? "is-active" : ""} onClick={() => setNavigatorSection("jobs")}>Jobs</button>
              <button role="tab" aria-selected={navigatorSection === "context"} className={navigatorSection === "context" ? "is-active" : ""} onClick={() => setNavigatorSection("context")}>Context</button>
            </div>
            <div className="tree-scroll">
              {navigatorSection === "context" ? <>
                <ResumeSources settings={resumeSettings} selectedPath={selectedPath} onSelect={selectFile} onChoose={chooseResume} onRemoveSecondary={removeSecondary} />
                {tree.length ? tree.map((node) => <TreeNode key={node.relativePath} node={node} selectedPath={selectedPath} baseResume={baseResume} onSelect={selectFile} selectedPaths={selectedCareerPaths} onTogglePath={togglePath} onDelete={deletePath} revealPath={treeRevealPath} />) : <p className="empty-small">No career context folders found.</p>}
              </> : <>
                <button className="all-jobs-button" onClick={showJobsHome}><span>All jobs</span><small>{jobs.length}</small></button>
                <button className={`scope-clear ${selectedJobFiles.length ? "" : "is-active"}`} onClick={() => { setSelectedJobFiles([]); void updateContext(selectedCareerPaths, []); }}>Career context only</button>
                {jobTree.length ? jobTree.map((node) => <TreeNode key={node.relativePath} node={node} selectedPath={selectedPath} baseResume={baseResume} onSelect={selectFile} selectedPaths={selectedJobFiles} onTogglePath={togglePath} onDelete={deletePath} revealPath={treeRevealPath} />) : <p className="empty-small">No job folders yet.</p>}
              </>}
            </div>
          </div>}
        </aside>
        <div className={`panel-resizer is-left ${leftPanelOpen ? "" : "is-collapsed"}`} role="separator" aria-label="Resize workspace navigation" aria-orientation="vertical" aria-valuemin={LEFT_PANEL_MIN} aria-valuemax={panelMaximum("left")} aria-valuenow={leftPanelWidth} tabIndex={leftPanelOpen ? 0 : -1} onPointerDown={(event) => beginPanelResize("left", event)} onKeyDown={(event) => resizePanelWithKeyboard("left", event)} />
        <section className="viewer-panel">
          {needsSetup ? <GetStarted workspace={workspace} profile={candidateProfile} settings={resumeSettings} onProfileCreated={async (profile) => { setCandidateProfile(profile); await refresh(); }} onChooseBase={() => void chooseResume("base")} /> : preview ? <>
            <div className="viewer-header"><div><div className="eyebrow">DOCUMENT VIEWER</div><h1>{preview.name}</h1></div><div className="viewer-header-actions"><span className={`label ${preview.canPreview ? "source" : "muted"}`}>{preview.fileType.toUpperCase()}</span><button className="viewer-close" aria-label="Close document" title="Close document" onClick={closeDocument}>×</button></div></div>
            <DocumentView key={`${preview.relativePath}:${currentLocation.kind === "document" ? currentLocation.anchor ?? "" : ""}`} preview={preview} isBaseResume={preview.relativePath === baseResume} focusAnchor={currentLocation.kind === "document" ? currentLocation.anchor : undefined} onExported={() => void refresh()} onDirtyChange={setEditorDirty} onSaved={markdownSaved} />
          </> : viewedJobId && viewedJob ? <JobWorkspaceDashboard job={viewedJob} status={applicationStatus} applicationLoading={applicationLoading} overview={interviewOverview} interviewLoading={interviewLoading} jobTree={jobTree} onStatus={setApplicationStatus} onSelect={selectFile} activeTab={currentLocation.kind === "job" && currentLocation.jobId === viewedJob.id ? currentLocation.tab : "overview"} activeRoundId={currentLocation.kind === "job" && currentLocation.jobId === viewedJob.id ? currentLocation.roundId : undefined} onNavigate={openJobView} /> : <JobsHome jobs={jobs} onOpenJob={openJob} onOpenJobView={openJobView} onOpenEvaluation={(jobId) => void selectFile(`jobs/${jobId}/evaluation.md`)} onMoveToTrash={(jobId) => deletePath(`jobs/${jobId}`)} />}
          {loading && <div className="viewer-state">Reading local workspace…</div>}
          {error && <p className="error-copy viewer-error">{error}</p>}
        </section>
      </section>
      <div className={`panel-resizer is-right ${rightPanelOpen ? "" : "is-collapsed"}`} role="separator" aria-label="Resize terminal panel" aria-orientation="vertical" aria-valuemin={RIGHT_PANEL_MIN} aria-valuemax={panelMaximum("right")} aria-valuenow={rightPanelWidth} tabIndex={rightPanelOpen ? 0 : -1} onPointerDown={(event) => beginPanelResize("right", event)} onKeyDown={(event) => resizePanelWithKeyboard("right", event)} />
      <TerminalPanel cwd={workspace.repositoryRoot || workspace.path} selectedJobFiles={selectedJobFiles} selectedCareerPaths={selectedCareerPaths} theme={theme} visible={rightPanelOpen && !needsSetup} onClose={() => setRightPanelOpen(false)} jobActions={jobActions} promptRequest={promptRequest} onPromptHandled={(id) => setPromptRequest((request) => request?.id === id ? null : request)} onInsertPrompt={insertJobPrompt} />
    </section>
    <footer className="statusbar"><span><i className="status-dot is-ready" />Local-only</span><span>Career sources stay read-only</span><span className="statusbar-right">{configured ? `${workspace.contextFileCount} context files · ${workspace.jobCount} job folders` : "No workspace selected"}</span></footer>
  </main>;
}

function GetStarted({ workspace, profile, settings, onProfileCreated, onChooseBase }: { workspace: WorkspaceSummary; profile: CandidateProfile | null; settings: Settings; onProfileCreated: (profile: CandidateProfile) => Promise<void>; onChooseBase: () => void }) {
  const [fullName, setFullName] = useState("");
  const [artifactPrefix, setArtifactPrefix] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");
  function updateName(value: string) {
    setFullName(value);
    if (!artifactPrefix) setArtifactPrefix(value.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
  }
  async function createProfile() {
    if (!fullName.trim() || !artifactPrefix.trim()) return;
    setState("saving");
    setMessage("");
    try {
      const next = await window.sensei.profile.create({ fullName, artifactPrefix });
      await onProfileCreated(next);
      setState("idle");
    } catch (caught) {
      setState("error");
      setMessage(messageOf(caught, "Unable to create the local candidate profile."));
    }
  }
  const steps = [
    ["Local workspace", Boolean(workspace.path), workspace.path || "Created automatically on first launch"],
    ["Candidate profile", Boolean(profile), profile ? `${profile.identity.fullName} · ${profile.identity.artifactPrefix}` : "Add your name and artifact prefix"],
    ["Base resume", Boolean(settings.baseResumePath && workspace.hasBaseResume), settings.baseResumePath ?? "Choose a Markdown, PDF, or DOCX resume"],
    ["Career context", workspace.contextFileCount > 0, workspace.contextFileCount ? `${workspace.contextFileCount} local files` : "Add files under data/context"],
    ["Agy terminal", workspace.agyAvailable, workspace.agyAvailable ? "Agy found on PATH" : "Install Agy or add it to PATH"],
  ] as const;
  return <section className="get-started">
    <div className="get-started-copy"><span className="eyebrow">PRIVATE LOCAL SETUP</span><h1>Get JobSensei ready</h1><p>Your workspace stays in <code>data/</code>. Resume and context files are never committed by the public repository.</p></div>
    <div className="get-started-grid">
      <ol>{steps.map(([label, complete, detail], index) => <li className={complete ? "is-complete" : ""} key={label}><span>{complete ? "✓" : index + 1}</span><div><strong>{label}</strong><small>{detail}</small></div></li>)}</ol>
      <div className="setup-card">
        {!profile ? <><h2>Create your candidate profile</h2><p>This stores identity and preferences locally. Career claims continue to come from your selected context files.</p><label>Full name<input value={fullName} onChange={(event) => updateName(event.target.value)} placeholder="Alex Morgan" /></label><label>Artifact prefix<input value={artifactPrefix} onChange={(event) => setArtifactPrefix(event.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} placeholder="Alex_Morgan" /></label><button disabled={!fullName.trim() || !artifactPrefix.trim() || state === "saving"} onClick={() => void createProfile()}>{state === "saving" ? "Creating…" : "Create local profile"}</button></> : !workspace.hasBaseResume ? <><h2>Select a base resume</h2><p>The base resume protects identity, chronology, section order, and presentation. Career context remains the factual authority.</p><button onClick={onChooseBase}>Choose base resume</button></> : <><h2>Setup complete</h2><p>Open the Command Center and run Agy from the repository root. Your active workspace remains <code>data/</code>.</p></>}
        {message && <p className="inline-error" role="alert">{message}</p>}
      </div>
    </div>
  </section>;
}

function JobsHome({ jobs, onOpenJob, onOpenJobView, onOpenEvaluation, onMoveToTrash }: { jobs: JobFolderSummary[]; onOpenJob: (jobId: string) => void; onOpenJobView: (jobId: string, tab: JobWorkspaceTab, roundId?: string) => void; onOpenEvaluation: (jobId: string) => void; onMoveToTrash: (jobId: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "interviewing" | "review" | "favorites">("all");
  const [favorites, setFavorites] = useState<Set<string>>(storedFavoriteJobIds);
  const [sort, setSort] = useState<"added" | "company" | "company-desc" | "role">(() => {
    const stored = window.localStorage.getItem("sensei-jobs-sort");
    const normalized = stored === "updated" ? "added" : stored;
    return ["added", "company", "company-desc", "role"].includes(normalized ?? "") ? normalized as "added" | "company" | "company-desc" | "role" : "added";
  });
  const [view, setView] = useState<"cards" | "table">("cards");
  useEffect(() => { window.localStorage.setItem("sensei-jobs-sort", sort); }, [sort]);
  useEffect(() => { window.localStorage.setItem(JOB_FAVORITES_KEY, JSON.stringify([...favorites])); }, [favorites]);
  function toggleFavorite(jobId: string) {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }
  const visibleJobs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = jobs.filter((job) => {
      const stage = job.applicationStage?.toLowerCase() ?? "";
      const matchesQuery = !normalized || `${job.company ?? ""} ${job.title ?? ""} ${job.name} ${stage} ${job.interviewRoundLabel ?? ""}`.toLowerCase().includes(normalized);
      const matchesFilter = filter === "all"
        || (filter === "interviewing" && Boolean(job.interviewRoundLabel))
        || (filter === "review" && /review|pending|stale|invalid/.test(stage))
        || (filter === "favorites" && favorites.has(job.id));
      return matchesQuery && matchesFilter;
    });
    const text = (value: string | null | undefined, fallback: string) => (value ?? fallback).toLowerCase();
    return [...filtered].sort((a, b) => {
      if (sort === "added") return Date.parse(b.createdAt) - Date.parse(a.createdAt) || text(a.company, displayJobName(a.name)).localeCompare(text(b.company, displayJobName(b.name)));
      if (sort === "company") return text(a.company, displayJobName(a.name)).localeCompare(text(b.company, displayJobName(b.name)));
      if (sort === "company-desc") return text(b.company, displayJobName(b.name)).localeCompare(text(a.company, displayJobName(a.name)));
      if (sort === "role") return text(a.title, "").localeCompare(text(b.title, ""));
      return text(a.applicationStage, "workspace").localeCompare(text(b.applicationStage, "workspace"));
    });
  }, [jobs, query, filter, sort, favorites]);
  return <section className="jobs-home">
    <header className="page-hero"><div><span className="eyebrow">JOB WORKSPACES</span><h1>Jobs</h1><p>Find an application, open its interview preparation, or return to recently updated material.</p></div><div className="page-count"><strong>{visibleJobs.length}</strong><span>of {jobs.length} jobs</span></div></header>
    <div className="jobs-toolbar">
      <label className="workspace-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, role, stage, or interview…" aria-label="Search jobs" /></label>
      <div className="jobs-filter" role="tablist" aria-label="Filter jobs">{(["all", "interviewing", "review", "favorites"] as const).map((value) => <button role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} key={value} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "review" ? "Needs review" : value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <label className="jobs-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort jobs"><option value="added">Recently added</option><option value="company">Company A-Z</option><option value="company-desc">Company Z-A</option><option value="role">Role A-Z</option></select></label>
      <div className="view-switcher" aria-label="Job display"><button className={view === "cards" ? "is-active" : ""} aria-pressed={view === "cards"} onClick={() => setView("cards")}>Cards</button><button className={view === "table" ? "is-active" : ""} aria-pressed={view === "table"} onClick={() => setView("table")}>Table</button></div>
    </div>
    {visibleJobs.length ? view === "cards"
      ? <div className="job-card-grid">{visibleJobs.map((job) => <JobCard key={job.id} job={job} favorite={favorites.has(job.id)} onToggleFavorite={() => toggleFavorite(job.id)} onOpen={() => onOpenJob(job.id)} onOpenView={(tab) => onOpenJobView(job.id, tab)} onOpenEvaluation={() => onOpenEvaluation(job.id)} onMoveToTrash={() => onMoveToTrash(job.id)} />)}</div>
      : <div className="jobs-table-wrap"><table className="jobs-table"><thead><tr><th>Company</th><th>Role</th><th>Stage</th><th>Interview</th><th>Rating</th><th>Added</th></tr></thead><tbody>{visibleJobs.map((job) => <tr key={job.id} tabIndex={0} onClick={() => onOpenJob(job.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpenJob(job.id); }}><td><strong>{job.company ?? displayJobName(job.name)}</strong></td><td>{job.title ?? "Role not recorded"}</td><td><StatusPill value={job.applicationStage ?? "Workspace"} /></td><td>{job.interviewRoundLabel ?? "Not prepared"}</td><td>{job.rating === null ? "Not rated" : `${job.rating.toFixed(1)} / 5`}</td><td>{formatJobDate(job.createdAt)}</td></tr>)}</tbody></table></div>
      : <div className="dashboard-empty"><h2>No jobs match this view</h2><p>Adjust the search or status filter to see more workspaces.</p></div>}
  </section>;
}

function JobCard({ job, favorite, onToggleFavorite, onOpen, onOpenView, onOpenEvaluation, onMoveToTrash }: { job: JobFolderSummary; favorite: boolean; onToggleFavorite: () => void; onOpen: () => void; onOpenView: (tab: JobWorkspaceTab) => void; onOpenEvaluation: () => void; onMoveToTrash: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const initials = (job.company ?? displayJobName(job.name)).split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); window.addEventListener("click", close); window.addEventListener("blur", close); return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); }; }, [menu]);
  const menuView = menu && createPortal(<div className="tree-context-menu job-card-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
    <button onClick={() => { setMenu(null); onOpen(); }}>Open workspace</button>
    <button onClick={() => { setMenu(null); onOpenEvaluation(); }}>Open evaluation</button>
    {job.interviewRoundLabel && <button onClick={() => { setMenu(null); onOpenView("interview"); }}>Open interview dashboard</button>}
    <button onClick={() => { setMenu(null); void window.sensei.app.copyText(job.relativePath); }}>Copy relative path</button>
    <button onClick={() => { setMenu(null); void window.sensei.files.reveal(job.relativePath); }}>Show in file manager</button>
    <button className="is-destructive" onClick={() => { setMenu(null); onMoveToTrash(); }}>Move job to Trash</button>
  </div>, document.body);
  return <article className="job-card" onClick={onOpen} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 280)) }); }}><div className="job-card-heading"><span className="company-mark">{initials || "J"}</span><div><h2>{job.company ?? displayJobName(job.name)}</h2><p>{job.title ?? "Role not recorded"}</p></div><span className="job-card-badges"><span className={`job-rating ${job.rating === null ? "is-missing" : ""}`}>{job.rating === null ? "Not rated" : job.rating.toFixed(1)}</span></span></div><dl><div><dt>Status</dt><dd><StatusPill value={job.applicationStage ?? "Workspace"} /></dd></div><div><dt>Interview</dt><dd>{job.interviewRoundLabel ?? "Not prepared"}</dd></div><div><dt>Added</dt><dd className="job-card-added"><span>{formatJobDate(job.createdAt)}</span><button className={`job-favorite ${favorite ? "is-favorite" : ""}`} aria-label={`${favorite ? "Remove" : "Add"} ${job.company ?? displayJobName(job.name)} ${favorite ? "from" : "to"} favorites`} aria-pressed={favorite} title={favorite ? "Remove from favorites" : "Add to favorites"} onClick={(event) => { event.stopPropagation(); onToggleFavorite(); }}>{favorite ? "★" : "☆"}</button></dd></div></dl><button onClick={(event) => { event.stopPropagation(); onOpen(); }}>Open workspace <span>→</span></button>{menuView}</article>;
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.replaceAll("_", " ");
  const tone = /interview|ready|validated|applied/i.test(value) ? "positive" : /review|pending|stale|invalid/i.test(value) ? "warning" : "neutral";
  return <span className={`status-pill is-${tone}`}>{normalized}</span>;
}

function JobWorkspaceDashboard({ job, status, applicationLoading, overview, interviewLoading, jobTree, onStatus, onSelect, activeTab, activeRoundId, onNavigate }: { job: JobFolderSummary; status: ApplicationStatus | null; applicationLoading: boolean; overview: InterviewOverview | null; interviewLoading: boolean; jobTree: FileTreeNode[]; onStatus: (status: ApplicationStatus) => void; onSelect: (path: string, anchor?: string) => void; activeTab: JobWorkspaceTab; activeRoundId?: string; onNavigate: (jobId: string, tab: JobWorkspaceTab, roundId?: string) => void }) {
  const files = useMemo(() => {
    const root = findNode(jobTree, `jobs/${job.id}`);
    return root ? fileNodes([root]).filter((node) => !node.relativePath.includes("/.sensei/")) : [];
  }, [jobTree, job.id]);
  const applicationFiles = files.filter((file) => /evaluation|resume|cover_letter|original_jd/i.test(file.name));
  const resumeMarkdown = files.find((file) => /_Resume\.md$/i.test(file.name)) ?? files.find((file) => /resume\.md$/i.test(file.name));
  const coverLetterMarkdown = files.find((file) => file.name.toLowerCase() === "cover_letter.md");
  function navigateRound(roundId: string) {
    void window.sensei.interviews.setCurrentRound(job.id, roundId).catch(() => undefined);
    onNavigate(job.id, "interview", roundId);
  }
  return <section className="job-workspace-dashboard">
    <header className="page-hero job-hero"><div><span className="eyebrow">JOB WORKSPACE</span><h1>{job.company ?? displayJobName(job.name)}</h1><p>{job.title ?? "Role not recorded"}</p></div><div className="job-hero-status"><StatusPill value={job.interviewRoundLabel ? "Interviewing" : job.applicationStage ?? "Workspace"} />{job.rating !== null && <strong>{job.rating.toFixed(1)} <small>/ 5 fit</small></strong>}<JobPdfExportButton resumePath={resumeMarkdown?.relativePath ?? null} coverLetterPath={coverLetterMarkdown?.relativePath ?? null} /></div></header>
    <nav className="workspace-tabs" role="tablist" aria-label="Job workspace sections">{(["overview", "application", "interview", "files"] as JobWorkspaceTab[]).map((value) => <button key={value} role="tab" aria-selected={activeTab === value} className={activeTab === value ? "is-active" : ""} onClick={() => onNavigate(job.id, value, value === "interview" ? activeRoundId : undefined)}>{value[0].toUpperCase() + value.slice(1)}{value === "files" ? <span>{files.length}</span> : null}</button>)}</nav>
    {activeTab === "overview" && <div className="dashboard-stack"><ApplicationHealth job={job} files={applicationFiles} status={status} loading={applicationLoading} onStatus={onStatus} /><InterviewGuide jobId={job.id} overview={overview} loading={interviewLoading} activeRoundId={activeRoundId} onSelect={onSelect} onRoundChange={navigateRound} onOpenInterview={(roundId) => { navigateRound(roundId); }} /><CollapsibleDashboardSection eyebrow="QUICK ACCESS" title="Application material" count={`${applicationFiles.length} files`}><ArtifactTable files={applicationFiles.slice(0, 6)} onSelect={onSelect} empty="No application documents found." /></CollapsibleDashboardSection></div>}
    {activeTab === "application" && <div className="dashboard-stack"><ApplicationHealth job={job} files={applicationFiles} status={status} loading={applicationLoading} onStatus={onStatus} /><CollapsibleDashboardSection eyebrow="APPLICATION FILES" title="Review and submission material" count={`${applicationFiles.length} files`}><ArtifactTable files={applicationFiles} onSelect={onSelect} empty="No application documents found." /></CollapsibleDashboardSection></div>}
    {activeTab === "interview" && <InterviewDashboard job={job} overview={overview} loading={interviewLoading} onSelect={onSelect} initialRoundId={activeRoundId} onRoundChange={navigateRound} />}
    {activeTab === "files" && <CollapsibleDashboardSection eyebrow="ALL FILES" title={`${job.company ?? displayJobName(job.name)} workspace`} count={`${files.length} files`}><ArtifactTable files={files} onSelect={onSelect} empty="This job workspace is empty." /></CollapsibleDashboardSection>}
  </section>;
}

function JobPdfExportButton({ resumePath, coverLetterPath }: { resumePath: string | null; coverLetterPath: string | null }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [textSize, setTextSize] = useState<PdfTextSize>("auto");
  const missing = !resumePath || !coverLetterPath;
  async function exportApplicationPdfs() {
    if (missing || !resumePath || !coverLetterPath) return;
    setState("working");
    setMessage("");
    try {
      await window.sensei.files.exportMarkdownPdf(resumePath, textSize);
      await window.sensei.files.exportMarkdownPdf(coverLetterPath, textSize);
      setState("done");
      setMessage("Resume and cover letter PDFs saved");
    } catch (caught) {
      setState("error");
      setMessage(messageOf(caught, "PDF creation failed."));
    }
  }
  return <span className="job-pdf-export"><PdfTextSizeSelect value={textSize} onChange={setTextSize} disabled={state === "working"} /><button className="export-button" disabled={missing || state === "working"} title={missing ? "Both a resume Markdown file and cover_letter.md are required" : "Create PDFs for this job's resume and cover letter"} onClick={() => void exportApplicationPdfs()}>{state === "working" ? "Creating PDFs…" : "Create PDFs"}</button>{message && <small className={`export-message ${state === "error" ? "is-error" : ""}`} role="status">{message}</small>}</span>;
}

function CollapsibleDashboardSection({ eyebrow, title, count, children, open = true, tone = "default" }: { eyebrow: string; title: string; count?: string; children: React.ReactNode; open?: boolean; tone?: "default" | "warning" }) {
  return <details className={`dashboard-section dashboard-collapsible is-${tone}`} open={open}>
    <summary><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><span className="dashboard-section-meta">{count}<b aria-hidden="true">⌄</b></span></summary>
    <div className="dashboard-section-body">{children}</div>
  </details>;
}

function InterviewDashboard({ job, overview, loading, onSelect, initialRoundId, onRoundChange, focusMode = false }: { job: JobFolderSummary; overview: InterviewOverview | null; loading: boolean; onSelect: (path: string, anchor?: string) => void; initialRoundId?: string; onRoundChange?: (roundId: string) => void; focusMode?: boolean }) {
  const [selectedRoundId, setSelectedRoundId] = useState(initialRoundId ?? overview?.currentRoundId ?? overview?.rounds[0]?.id ?? "");
  const [refreshedOverview, setRefreshedOverview] = useState<InterviewOverview | null>(null);
  const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "refreshed" | "copied" | "error">("idle");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => { setRefreshedOverview(null); setSelectedRoundId(initialRoundId ?? overview?.currentRoundId ?? overview?.rounds[0]?.id ?? ""); }, [job.id, initialRoundId, overview?.currentRoundId]);
  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => { void window.sensei.search.query({ query, limit: 100 }).then((response) => { if (!cancelled) setResults(response.results.filter((result) => result.jobId === job.id)); }).catch(() => { if (!cancelled) setResults([]); }).finally(() => { if (!cancelled) setSearching(false); }); }, 140);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, job.id]);
  if (loading) return <div className="dashboard-loading">Reading interview preparation…</div>;
  const activeOverview = refreshedOverview ?? overview;
  if (!activeOverview?.rounds.length) return <div className="dashboard-empty"><h2>No interview preparation yet</h2><p>Use Job Actions to prepare the first recruiter or hiring-manager round.</p></div>;
  const round = activeOverview.rounds.find((candidate) => candidate.id === selectedRoundId) ?? activeOverview.rounds[0];
  const brief = round.dashboardBrief;
  const artifacts = Object.entries(round.artifactPaths).filter((entry): entry is [string, string] => Boolean(entry[1]));
  const grouped = [
    ["Questions", results.filter((result) => /question|prep/i.test(result.relativePath ?? ""))],
    ["Research", results.filter((result) => /research/i.test(result.relativePath ?? ""))],
    ["Challenges", results.filter((result) => /challenge|practice|lab/i.test(result.relativePath ?? ""))],
    ["Notes and transcripts", results.filter((result) => /note|transcript|debrief/i.test(result.relativePath ?? ""))],
    ["Other interview material", results.filter((result) => !/question|prep|research|challenge|practice|lab|note|transcript|debrief/i.test(result.relativePath ?? ""))],
  ] as Array<[string, SearchResult[]]>;
  function changeRound(roundId: string) {
    setSelectedRoundId(roundId);
    onRoundChange?.(roundId);
  }
  async function refreshFromFiles() {
    setRefreshState("refreshing");
    try {
      const next = await window.sensei.interviews.refreshDashboard(job.id);
      setRefreshedOverview(next);
      setRefreshState("refreshed");
    } catch { setRefreshState("error"); }
  }
  async function copyResearchPrompt() {
    const prompt = `Refresh ${job.company ?? job.id} ${round.label} interview dashboard using the JobSensei interview pipeline. Update prep, question bank, company research with cited current internet sources, and dashboardBrief references without changing application artifacts.`;
    try { await window.sensei.app.copyText(prompt); setRefreshState("copied"); }
    catch { setRefreshState("error"); }
  }
  const readiness = brief ? Math.min(100, Math.round((brief.availableArtifactCount / Math.max(brief.expectedArtifactCount, 1)) * 100)) : 0;
  const focusReferences = brief?.references.length ? brief.references : [...(brief?.quickAnswers ?? []), ...(brief?.priorityQuestions ?? []), ...(brief?.technicalTopics ?? []), ...(brief?.companyFacts ?? []), ...(brief?.questionsToAsk ?? []), ...(brief?.cautions ?? [])];
  return <section className={`interview-dashboard ${focusMode ? "is-focus-mode" : ""}`}>
    <div className="interview-dashboard-header"><div><span className="eyebrow">INTERVIEW DASHBOARD</span><h2>{round.label}</h2><p>{[round.interviewer, round.format].filter(Boolean).join(" · ") || "Preparation workspace"}</p></div><div className="interview-dashboard-actions"><label><span>Round</span><select value={round.id} onChange={(event) => changeRound(event.target.value)}>{activeOverview.rounds.map((candidate, index) => <option value={candidate.id} key={candidate.id}>Round {index + 1} · {candidate.label}</option>)}</select></label><button onClick={() => void refreshFromFiles()} disabled={refreshState === "refreshing"}>{refreshState === "refreshing" ? "Refreshing…" : refreshState === "refreshed" ? "Refreshed" : "Refresh from files"}</button><button onClick={() => void copyResearchPrompt()}>{refreshState === "copied" ? "Prompt copied" : "Update with research"}</button>{!focusMode && <button onClick={() => void window.sensei.interviews.openWorkspaceWindow(job.id, round.id)}>Focus mode</button>}</div></div>
    <div className="interview-readiness-grid" aria-label="Interview readiness summary">
      <span><small>PREPARATION</small><strong>{readiness}% ready</strong><em>{brief?.availableArtifactCount ?? artifacts.length} linked resources</em></span>
      <span><small>ROUND STATUS</small><strong>{round.status.replaceAll("_", " ")}</strong><em>{stageLabel(round.stage)}</em></span>
      <span><small>SCHEDULE</small><strong>{round.scheduledDate ?? "Not scheduled"}</strong><em>{round.format ?? "Format not recorded"}</em></span>
      <span><small>DEBRIEF</small><strong>{round.artifactPaths.debriefAnalysis ? "Analyzed" : round.debriefSourcePaths.length ? "Sources ready" : "Not linked"}</strong><em>{round.debriefSourcePaths.length} source file{round.debriefSourcePaths.length === 1 ? "" : "s"}</em></span>
    </div>
    {activeOverview.knownProcess.length > 0 && <div className="interview-process" aria-label="Known interview process"><span>PROCESS</span>{activeOverview.knownProcess.map((step, index) => <button type="button" className={step.stage === round.stage ? "is-current" : ""} key={`${step.stage}-${index}`} onClick={() => { const matching = activeOverview.rounds.find((candidate) => candidate.stage === step.stage); if (matching) changeRound(matching.id); }}><b>{index + 1}</b>{step.label}<small>{step.sourceType.replaceAll("_", " ")}</small></button>)}</div>}
    {focusMode && <section className="focus-reference-board" aria-label="Interview quick reference"><div className="focus-reference-heading"><div><span className="eyebrow">QUICK REFERENCE</span><h3>{focusReferences.length} prepared references</h3></div><span>{readiness}% ready</span></div><div className="focus-quick-grid">{focusReferences.map((item, index) => <button key={`${item.sourcePath}-${item.title}-${index}`} onClick={() => onSelect(item.sourcePath, item.anchor ?? item.title)}><small>{item.category.replaceAll("_", " ")}</small><strong>{item.title}</strong><p>{item.text}</p><em>Open source →</em></button>)}</div></section>}
    <label className="interview-query"><span aria-hidden="true">⌕</span><div><strong>Search interview material</strong><small>Questions, stories, research, challenges, notes, and transcripts</small></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try “Future-X”, “why this company”, or “API debugging”…" aria-label="Search this job's interview material" /></label>
    {!query.trim() ? <div className="interview-dashboard-stack">
      <CollapsibleDashboardSection eyebrow="READY ANSWERS" title="Career story and motivation" count={`${brief?.quickAnswers.length ?? 0} cues`} open={false}><InterviewBriefList items={brief?.quickAnswers ?? []} onSelect={onSelect} empty="Open prep to review your introduction, motivation, and career story." /></CollapsibleDashboardSection>
      <CollapsibleDashboardSection eyebrow="LIKELY QUESTIONS" title="Primary questions for this round" count={`${brief?.priorityQuestions.length ?? 0} prepared`} open={false}><InterviewBriefList items={brief?.priorityQuestions ?? []} onSelect={onSelect} empty="No primary questions could be summarized. Open the question bank directly." numbered /></CollapsibleDashboardSection>
      {Boolean(brief?.technicalTopics.length) && <CollapsibleDashboardSection eyebrow="TECHNICAL FOCUS" title="Concepts and scenarios to keep ready" count={`${brief?.technicalTopics.length ?? 0} topics`} open={false}><InterviewBriefList items={brief?.technicalTopics ?? []} onSelect={onSelect} empty="No technical topics linked." compact /></CollapsibleDashboardSection>}
      <div className="interview-dashboard-columns">
        <CollapsibleDashboardSection eyebrow="COMPANY CONTEXT" title="Facts worth remembering" count={`${brief?.companyFacts.length ?? 0} notes`} open={false}><InterviewBriefList items={brief?.companyFacts ?? []} onSelect={onSelect} empty="Open research for company and role context." compact /></CollapsibleDashboardSection>
        <CollapsibleDashboardSection eyebrow="REVERSE QUESTIONS" title="Questions to ask them" count={`${brief?.questionsToAsk.length ?? 0} questions`} open={false}><InterviewBriefList items={brief?.questionsToAsk ?? []} onSelect={onSelect} empty="Open the question bank for your prepared reverse questions." numbered compact /></CollapsibleDashboardSection>
      </div>
      {Boolean(brief?.cautions.length) && <CollapsibleDashboardSection eyebrow="TRUTH AND SCOPE" title="Claims to qualify or avoid" count={`${brief?.cautions.length ?? 0} cautions`} open={false} tone="warning"><InterviewBriefList items={brief?.cautions ?? []} onSelect={onSelect} empty="No cautions were extracted." compact /></CollapsibleDashboardSection>}
      <CollapsibleDashboardSection eyebrow="ROUND LIBRARY" title="Preparation sources" count={`${artifacts.length} linked files`} open={false}><div className="interview-source-grid">{artifacts.map(([kind, path]) => <button key={path} onClick={() => onSelect(path)}><span>{artifactLabel(kind)}</span><strong>{path.split("/").at(-1)}</strong><small>{path}</small><em>Open →</em></button>)}</div>{!artifacts.length && <p className="dashboard-empty-copy">No files are linked to this round.</p>}</CollapsibleDashboardSection>
    </div> : <div className="interview-results">{searching && <p>Searching this job…</p>}{!searching && results.length === 0 && <div className="dashboard-empty"><h2>No matching interview notes</h2><p>Try a shorter term or search the full workspace with ⌘K.</p></div>}{grouped.map(([label, group]) => group.length ? <section key={label}><h3>{label}<span>{group.length}</span></h3>{group.map((result) => <button key={result.id} onClick={() => result.relativePath && onSelect(result.relativePath)}><strong>{result.title}</strong><small>{result.relativePath}</small>{result.excerpt && <p>{result.excerpt}</p>}</button>)}</section> : null)}</div>}
  </section>;
}

function InterviewBriefList({ items, onSelect, empty, numbered = false, compact = false }: { items: InterviewDashboardItem[]; onSelect: (path: string, anchor?: string) => void; empty: string; numbered?: boolean; compact?: boolean }) {
  if (!items.length) return <p className="dashboard-empty-copy">{empty}</p>;
  return <div className={`interview-brief-list ${compact ? "is-compact" : ""}`}>{items.map((item, index) => <article key={`${item.sourcePath}-${item.title}-${index}`}><span className="interview-brief-index">{numbered ? index + 1 : "•"}</span><div><h3>{item.title}</h3><p>{item.text}</p><button onClick={() => onSelect(item.sourcePath, item.anchor ?? item.title)}>Jump to source</button></div></article>)}</div>;
}

function ArtifactTable({ files, onSelect, empty }: { files: FileTreeNode[]; onSelect: (path: string) => void; empty: string }) {
  if (!files.length) return <p className="dashboard-empty-copy">{empty}</p>;
  return <div className="artifact-table" role="table" aria-label="Workspace files"><div className="artifact-table-row is-heading" role="row"><span role="columnheader">Document</span><span role="columnheader">Type</span><span role="columnheader">Updated</span><span /></div>{files.map((file) => <button className="artifact-table-row" role="row" key={file.relativePath} onClick={() => onSelect(file.relativePath)}><span role="cell"><strong>{displayJobName(file.name.replace(/\.[^.]+$/, ""))}</strong><small>{file.relativePath}</small></span><span role="cell">{fileTypeLabel(file)}</span><span role="cell">{file.modifiedAt ? formatRelativeDate(file.modifiedAt) : "—"}</span><span role="cell">Open →</span></button>)}</div>;
}

function fileTypeLabel(file: FileTreeNode): string {
  if (file.name.toLowerCase().endsWith(".md")) return "Markdown";
  return file.fileType === "docx" ? "Document" : file.fileType ? file.fileType.toUpperCase() : "File";
}

function displayJobName(value: string): string {
  return value.replaceAll(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function formatJobDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function formatEmailDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ApplicationHealth({ job, files, status, loading, onStatus }: { job: JobFolderSummary; files: FileTreeNode[]; status: ApplicationStatus | null; loading: boolean; onStatus: (status: ApplicationStatus) => void }) {
  const jobId = job.id;
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState("");
  const [lastReport, setLastReport] = useState<ApplicationValidationReport | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  useEffect(() => {
    setMessage("");
    setLastReport(null);
    setIssuesOpen(false);
  }, [jobId]);
  async function validate() {
    setValidating(true);
    setMessage("");
    try {
      const report = await window.sensei.jobs.validateApplication(jobId);
      setLastReport(report);
      setIssuesOpen(report.issues.length > 0);
      onStatus(await window.sensei.jobs.getApplicationStatus(jobId));
      const errors = report.issues.filter((issue) => issue.severity === "error").length;
      const warnings = report.issues.filter((issue) => issue.severity === "warning").length;
      setMessage(report.status === "passed" ? `Application is reviewable${warnings ? ` with ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.` : `${errors} error${errors === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"}.`);
    } catch (caught) {
      setMessage(messageOf(caught, "Validation could not run."));
    } finally {
      setValidating(false);
    }
  }
  if (loading) return <section className="application-health is-loading"><span>Reading application health…</span></section>;
  if (!status) return null;
  const issues = lastReport?.issues ?? status.validation?.issues ?? [];
  const footprint = status.footprint;
  const hasEvaluation = files.some((file) => file.name.toLowerCase() === "evaluation.md");
  const hasResume = files.some((file) => /resume\.md$/i.test(file.name));
  const hasCoverLetter = files.some((file) => file.name.toLowerCase() === "cover_letter.md");
  const recommendedAction = !hasEvaluation ? "Review the saved job description" : !hasResume || !hasCoverLetter ? "Finish application drafts" : status.state === "validated" ? "Review and export submission PDFs" : "Review the generated application and warnings";
  const validationLabel = validating
    ? "Validating…"
    : lastReport === null
      ? "Validate application"
      : lastReport.status !== "passed"
        ? "Needs review"
        : lastReport.issues.some((issue) => issue.severity === "warning")
          ? "Review warnings"
          : "Validated";
  return <section className={`application-health is-${status.state}`} aria-label="Application health">
    <div className="application-health-heading">
      <div><span className="eyebrow">APPLICATION HEALTH</span><strong>{status.state.replaceAll("_", " ")}</strong></div>
      <button className={lastReport ? `is-${lastReport.status}` : ""} disabled={validating} onClick={() => void validate()}>{validationLabel}</button>
    </div>
    <div className="application-rating-summary">
      <div className="application-score"><span>EVIDENCE-CALIBRATED FIT</span><strong>{job.rating === null ? "—" : job.rating.toFixed(1)}<small>{job.rating === null ? "Not recorded" : " / 5"}</small></strong><em>{job.ratingDecision ?? "Direct 100% · strong transferable 75% · adjacent 55%"}</em></div>
      <div className="application-next-action"><span>NEXT RECOMMENDED ACTION</span><strong>{recommendedAction}</strong><small>{job.ratingConfidence ? `Confidence: ${job.ratingConfidence}` : "Based on the saved evaluation and artifact state"}</small></div>
    </div>
    <div className="application-document-status" aria-label="Application documents">
      <span className={hasEvaluation ? "is-ready" : ""}><b>{hasEvaluation ? "✓" : "○"}</b> Evaluation</span>
      <span className={hasResume ? "is-ready" : ""}><b>{hasResume ? "✓" : "○"}</b> Resume</span>
      <span className={hasCoverLetter ? "is-ready" : ""}><b>{hasCoverLetter ? "✓" : "○"}</b> Cover letter</span>
    </div>
    <div className="application-health-facts">
      <span><small>SNAPSHOT</small>{status.snapshotConsistent ? "Pinned" : "Mismatch"}</span>
      <span><small>MANIFEST</small>{status.manifestCurrent ? "Current" : "Stale"}</span>
      <span><small>BASE RESUME</small>{footprint ? `${footprint.format.toUpperCase()} · ${footprint.status}` : "Not profiled"}</span>
      <span><small>TEMPLATE LOCK</small>{status.templateIntegrity.replaceAll("_", " ")}</span>
      <span><small>RESUME DENSITY</small>{status.resumeBulletCount === null ? "Not drafted" : `${status.resumeBulletCount} bullets · ${status.currentEmployerBulletCount ?? 0} current role`}</span>
      <span><small>RECENT WORK</small>{status.recentCurrentEmployerBulletCount === null ? "Not audited" : `${status.recentCurrentEmployerBulletCount} evidence-backed`}</span>
      <span><small>WORD TARGET</small>{footprint && footprint.targetWordMin !== null && footprint.targetWordMax !== null ? `${footprint.targetWordMin}-${footprint.targetWordMax}` : "Unavailable"}</span>
    </div>
    {(() => {
      const report = lastReport ?? status.validation;
      const ats = report?.ats;
      const keywordClasses = report?.keywordClasses ?? [];
      if (!ats && keywordClasses.length === 0) return null;
      const supported = keywordClasses.filter((item) => item.classification === "supported").length;
      const transferable = keywordClasses.filter((item) => item.classification === "transferable").length;
      const unsupported = keywordClasses.filter((item) => item.classification === "unsupported").length;
      return <div className="application-health-facts application-ats-facts">
        {ats && <span><small>ATS PDF CHECK</small>{ats.status === "passed" ? "Readable · fields found" : ats.status === "not_exported" ? "Not exported" : ats.status === "unavailable" ? "Unavailable" : `${ats.missingFields.length} fields to review`}</span>}
        {keywordClasses.length > 0 && <span><small>KEYWORD CLASS</small>{supported} supported · {transferable} transferable · {unsupported} unsupported</span>}
      </div>;
    })()}
    {(lastReport?.ats?.missingFields.length ?? 0) > 0 && <p className="application-health-message">ATS fields to review: {lastReport?.ats?.missingFields.join(", ")}</p>}
    {(job.ratingHighlights.length > 0 || job.ratingGaps.length > 0) && <details className="application-fit-details"><summary>Why this rating <span>{job.ratingHighlights.length} strengths · {job.ratingGaps.length} gaps</span></summary><div><section><h3>Strongest alignment</h3>{job.ratingHighlights.length ? <ul>{job.ratingHighlights.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No direct-match summary was found.</p>}</section><section><h3>Gaps and risks</h3>{job.ratingGaps.length ? <ul>{job.ratingGaps.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No material gaps were listed.</p>}</section></div></details>}
    {issues.length > 0 && <details className="application-issues" open={issuesOpen} onToggle={(event) => setIssuesOpen(event.currentTarget.open)}><summary>{issues.filter((issue) => issue.severity === "error").length} errors · {issues.filter((issue) => issue.severity === "warning").length} warnings</summary>{issues.map((issue, index) => <div className={`application-issue is-${issue.severity}`} key={`${issue.code}-${issue.artifact}-${index}`}><strong>{issue.severity === "warning" ? "Warning" : "Needs review"}</strong><span>{issue.code} · {issue.artifact}</span><p>{issue.message}</p>{issue.explanation && <div className="application-issue-explanation"><span><b>Sentence</b>{issue.explanation.sentence ?? "Unavailable"}</span><span><b>Source</b>{issue.explanation.sources.length ? issue.explanation.sources.map((source) => <span className="application-issue-source" key={`${source.evidenceId}-${source.sourcePath}`}><code>{source.evidenceId}</code> · <code>{source.sourcePath}</code><em>{source.claim}</em></span>) : "Unavailable"}</span></div>}<small>{issue.repairHint}</small></div>)}</details>}
    {message && <p className="application-health-message" role="status" aria-live="polite">{message}</p>}
  </section>;
}

function InterviewGuide({ jobId, overview, loading, activeRoundId, onSelect, onRoundChange, onOpenInterview }: { jobId: string; overview: InterviewOverview | null; loading: boolean; activeRoundId?: string; onSelect: (path: string) => void; onRoundChange: (roundId: string) => void; onOpenInterview: (roundId: string) => void }) {
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const [selectedRoundId, setSelectedRoundId] = useState(activeRoundId ?? overview?.currentRoundId ?? overview?.rounds.at(-1)?.id ?? "");
  useEffect(() => setSelectedRoundId(activeRoundId ?? overview?.currentRoundId ?? overview?.rounds.at(-1)?.id ?? ""), [jobId, activeRoundId, overview?.currentRoundId]);
  if (loading) return <section className="interview-guide is-loading"><span>Reading interview status…</span></section>;
  if (!overview || !overview.rounds.length) return null;
  const current = overview.rounds.find((round) => round.id === selectedRoundId) ?? overview.rounds.find((round) => round.id === overview.currentRoundId) ?? overview.rounds.at(-1)!;
  const currentIndex = Math.max(0, overview.rounds.findIndex((round) => round.id === current.id));
  const next = overview.knownProcess.find((step) => !overview.rounds.some((round) => round.stage === step.stage && round.sequence > current.sequence));
  const company = promptCompany(overview.company ?? overview.jobId);
  const prompts = [
    ...(current.debriefSourcePaths.length && !current.artifactPaths.debriefAnalysis ? [`${company} debrief`] : []),
    ...(next ? [`Prepare ${company} ${stageLabel(next.stage).toLowerCase()} interview`] : []),
    `Start ${company} ${stageLabel(current.stage).toLowerCase()} mock`,
  ];
  const artifacts = Object.entries(current.artifactPaths).filter((entry): entry is [string, string] => Boolean(entry[1]));
  async function copyPrompt(prompt: string) {
    setCopyError("");
    try {
      await window.sensei.app.copyText(prompt);
      setCopied(prompt);
      window.setTimeout(() => setCopied((value) => value === prompt ? "" : value), 1800);
    } catch (caught) {
      setCopyError(messageOf(caught, "The prompt could not be copied."));
    }
  }
  return <section className="interview-guide" aria-label="Interview workspace">
    <div className="interview-guide-heading"><div><span className="eyebrow">INTERVIEW WORKSPACE</span><strong>Round {current.sequence} · {current.label}</strong></div><span className={`round-status is-${current.status}`}>{current.status.replaceAll("_", " ")}</span></div>
    <div className="interview-round-navigator" aria-label="Interview round selector">
      <div className="interview-round-navigator-label"><span className="eyebrow">ACTIVE ROUND</span><small>{currentIndex + 1} OF {overview.rounds.length}</small></div>
      <button className="round-nav-arrow" type="button" aria-label="Previous interview round" disabled={currentIndex === 0} onClick={() => { const roundId = overview.rounds[currentIndex - 1]?.id ?? current.id; setSelectedRoundId(roundId); onRoundChange(roundId); }}>‹</button>
      <label className="interview-round-select"><span className="sr-only">Select interview round</span><select value={current.id} onChange={(event) => { setSelectedRoundId(event.target.value); onRoundChange(event.target.value); }}>{overview.rounds.map((round, index) => <option key={round.id} value={round.id}>Round {index + 1} · {round.label}</option>)}</select><span className="round-nav-stage">{stageLabel(current.stage)}</span></label>
      <button className="round-nav-arrow" type="button" aria-label="Next interview round" disabled={currentIndex === overview.rounds.length - 1} onClick={() => { const roundId = overview.rounds[currentIndex + 1]?.id ?? current.id; setSelectedRoundId(roundId); onRoundChange(roundId); }}>›</button>
    </div>
    <div className="interview-facts">
      <span><small>STAGE</small>{stageLabel(current.stage)}</span>
      <span><small>INTERVIEWER</small>{current.interviewer ?? "Not specified"}</span>
      <span><small>DATE / FORMAT</small>{[current.scheduledDate, current.format].filter(Boolean).join(" · ") || "Not specified"}</span>
      <span><small>DEBRIEF</small>{current.artifactPaths.debriefAnalysis ? "Analyzed" : current.debriefSourcePaths.length ? `${current.debriefSourcePaths.length} source file${current.debriefSourcePaths.length === 1 ? "" : "s"} ready` : "Not linked"}</span>
    </div>
    {next && <p className="interview-next"><span>KNOWN NEXT ROUND</span><strong>{next.label}{next.interviewer ? ` · ${next.interviewer}` : ""}</strong><small>{next.sourceType.replaceAll("_", " ")}</small></p>}
    <div className="interview-guide-actions">
      {artifacts.map(([name, path]) => <button key={path} onClick={() => onSelect(path)}>{artifactLabel(name)}</button>)}
      {prompts.map((prompt) => <span className="interview-prompt-pair" key={prompt}><button className="prompt-shortcut" onClick={() => void copyPrompt(prompt)} title={`Copy: ${prompt}`}>{copied === prompt ? "Copied" : prompt}</button></span>)}
      <button className="open-interview-dashboard" onClick={() => onOpenInterview(current.id)}>Open interview workspace</button>
    </div>
    {copyError && <p className="inline-error" role="alert">{copyError}</p>}
    {overview.isLegacy && <p className="legacy-note">Legacy interview files are shown without moving or rewriting them.</p>}
  </section>;
}

function InterviewWorkspaceStandalone({ jobId, roundId }: { jobId: string; roundId: string }) {
  const [overview, setOverview] = useState<InterviewOverview | null>(null);
  const [job, setJob] = useState<JobFolderSummary | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [activeRoundId, setActiveRoundId] = useState(roundId);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(() => window.localStorage.getItem("sensei-theme-v2") === "dark" ? "dark" : "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("sensei-theme-v2", theme);
  }, [theme]);

  useEffect(() => {
    if (!jobId || !roundId) { setError("A job and interview round are required."); return; }
    void Promise.all([window.sensei.interviews.getOverview(jobId), window.sensei.jobs.list()])
      .then(([nextOverview, jobs]) => {
        setOverview(nextOverview);
        setJob(jobs.find((candidate) => candidate.id === jobId) ?? null);
        if (!nextOverview?.rounds.some((round) => round.id === roundId)) setError("The selected interview round could not be found.");
      })
      .catch((caught) => setError(messageOf(caught, "Unable to load the interview workspace.")));
  }, [jobId, roundId]);

  const activeRound = overview?.rounds.find((round) => round.id === activeRoundId) ?? overview?.rounds[0] ?? null;
  async function selectDocument(path: string) {
    try { setError(""); setPreview(await window.sensei.files.preview(path)); }
    catch (caught) { setError(messageOf(caught, "Unable to open that interview document.")); }
  }

  return <main className="standalone-shell">
    <header className="topbar standalone-topbar"><div className="wordmark"><span className="wordmark-mark">S</span><span>Sensei</span></div><nav className="focus-navigation" aria-label="Interview workspace navigation"><button onClick={() => setPreview(null)} disabled={!preview}>Dashboard</button></nav><div className="standalone-title"><span className="eyebrow">INTERVIEW WORKSPACE</span><strong>{job?.company ?? overview?.company ?? displayJobName(jobId)}</strong><small>{activeRound?.label ?? job?.title ?? "Interview preparation"}</small></div><button className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Day" : "Night"}</button></header>
    <section className="standalone-workspace">{error && <p className="inline-error">{error}</p>}{job && overview && activeRound ? preview ? <section className="viewer-panel standalone-document"><div className="viewer-header"><div><span className="eyebrow">INTERVIEW MATERIAL</span><h1>{preview.name}</h1></div><div className="viewer-header-actions"><span className="label source">{preview.fileType.toUpperCase()}</span><button className="viewer-close" onClick={() => setPreview(null)} aria-label="Return to interview dashboard">×</button></div></div><DocumentView preview={preview} isBaseResume={false} onExported={() => undefined} onDirtyChange={() => undefined} onSaved={async (saved) => setPreview(saved)} /></section> : <InterviewDashboard job={job} overview={overview} loading={false} onSelect={(path) => void selectDocument(path)} initialRoundId={activeRound.id} onRoundChange={setActiveRoundId} focusMode /> : !error && <p className="dashboard-loading">Loading interview workspace…</p>}</section>
  </main>;
}

function artifactLabel(name: string): string {
  if (name === "questionBank") return "Question bank";
  if (name === "challengeBrief") return "Challenge brief";
  if (name === "practiceLabs") return "Practice labs";
  if (name === "debriefAnalysis") return "Debrief analysis";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function promptCompany(company: string): string {
  return company.replace(/,\s*(inc|llc|ltd)\.?$/i, "").trim();
}

function stageLabel(stage: InterviewRound["stage"]): string {
  return {
    recruiter_screen: "Recruiter screen",
    hiring_manager: "Hiring manager",
    technical: "Technical interview",
    technical_challenge: "Technical challenge",
    take_home: "Take-home exercise",
    onsite: "Onsite interview",
    executive: "Executive interview",
    unknown: "Interview",
  }[stage];
}

function ResumeSources({ settings, selectedPath, onSelect, onChoose, onRemoveSecondary }: { settings: Settings; selectedPath: string | null; onSelect: (path: string) => void; onChoose: (role: "base" | "secondary") => void; onRemoveSecondary: (path: string) => void }) {
  const secondary = settings.secondaryResumePaths;
  return <section className="resume-sources"><div className="resume-heading"><span>RESUME SOURCES</span><span className="count">{(settings.baseResumePath ? 1 : 0) + secondary.length}</span></div><div className="resume-row-label"><span>BASE RESUME</span><button className="mini-button" onClick={() => onChoose("base")}>Change</button></div>{settings.baseResumePath ? <button className={`resume-file ${selectedPath === settings.baseResumePath ? "is-selected" : ""}`} onClick={() => onSelect(settings.baseResumePath!)}><span className="file-icon">{settings.baseResumePath.endsWith("docx") ? "DOC" : "PDF"}</span><span className="tree-name">{settings.baseResumePath.split("/").pop()}</span><span className="base-mark">BASE</span></button> : <p className="empty-small">No base resume selected.</p>}<div className="resume-row-label"><span>SECONDARY RESUMES</span><button className="mini-button" onClick={() => onChoose("secondary")}>Add</button></div>{secondary.length ? secondary.map((path) => <div className="resume-file-row" key={path}><button className={`resume-file ${selectedPath === path ? "is-selected" : ""}`} onClick={() => onSelect(path)}><span className="file-icon">{path.endsWith("docx") ? "DOC" : "PDF"}</span><span className="tree-name">{path.split("/").pop()}</span></button><button className="remove-button" aria-label={`Remove ${path.split("/").pop()}`} title="Remove secondary resume" onClick={() => onRemoveSecondary(path)}>×</button></div>) : <p className="empty-small">Older resumes add historical support.</p>}<div className="resume-row-label education-label"><span>LINKEDIN PROFILE</span></div><p className="resume-note">Education and additional career context</p></section>;
}

function TreeNode({ node, selectedPath, baseResume, onSelect, depth = 0, selectedPaths, onTogglePath, onDelete, revealPath: highlightedPath }: { node: FileTreeNode; selectedPath: string | null; baseResume: string | null; onSelect: (path: string) => void; depth?: number; selectedPaths: string[]; onTogglePath: (path: string, checked: boolean) => void; onDelete: (path: string) => void; revealPath: string | null }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isPolicy = node.relativePath === "context/denylist.md";
  const descendants = filePaths([node]).filter((path) => path !== "context/denylist.md");
  const selectedCount = descendants.filter((path) => selectedPaths.includes(path)).length;
  const checked = isPolicy || (descendants.length > 0 && selectedCount === descendants.length);
  useEffect(() => { if (inputRef.current) inputRef.current.indeterminate = selectedCount > 0 && !checked; }, [selectedCount, checked]);
  useEffect(() => {
    if (node.kind === "directory" && highlightedPath && (highlightedPath === node.relativePath || highlightedPath.startsWith(`${node.relativePath}/`))) setOpen(true);
  }, [node.kind, node.relativePath, highlightedPath]);
  const canDelete = node.relativePath.includes("/");
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); window.addEventListener("click", close); window.addEventListener("blur", close); return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); }; }, [menu]);
  const openMenu = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 260)) }); };
  const closeMenu = () => setMenu(null);
  const copyPath = () => { void window.sensei.app.copyText(node.relativePath).catch(() => undefined); closeMenu(); };
  const revealPath = () => { void window.sensei.files.reveal(node.relativePath).catch(() => undefined); closeMenu(); };
  const toggleContext = () => { void onTogglePath(node.relativePath, !checked); closeMenu(); };
  const menuView = menu && createPortal(<div className="tree-context-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
    {node.kind === "directory" ? <button onClick={() => { setOpen((current) => !current); closeMenu(); }}>{open ? "Collapse folder" : "Expand folder"}</button> : <button onClick={() => { onSelect(node.relativePath); closeMenu(); }}>Open / Preview</button>}
    <button onClick={copyPath}>Copy relative path</button>
    <button onClick={revealPath}>Show in file manager</button>
    {!isPolicy && <button onClick={toggleContext}>{checked ? "Remove from terminal context" : "Add to terminal context"}</button>}
    {canDelete && <button className="is-destructive" onClick={() => { closeMenu(); onDelete(node.relativePath); }}>Move {node.kind === "directory" ? "folder" : "file"} to Trash</button>}
  </div>, document.body);
  if (node.kind === "directory") return <div className="tree-group" onContextMenu={openMenu}><div className="tree-directory-row"><input ref={inputRef} className="context-check" type="checkbox" aria-label={`Include ${node.displayName ?? node.name} in terminal context`} checked={checked} onChange={(event) => onTogglePath(node.relativePath, event.target.checked)} /><button className="tree-directory" style={{ paddingLeft: `${12 + depth * 13}px` }} onClick={() => setOpen(!open)}><span className="tree-chevron">{open ? "▾" : "▸"}</span><span className="tree-directory-copy"><b>{node.displayName ?? node.name}</b>{node.subtitle && <em>{node.subtitle}</em>}</span>{node.rating !== undefined && <span className="tree-rating">{node.rating === null ? "—" : `${node.rating.toFixed(1)}/5`}</span>}<small>{node.children?.length ?? 0}</small></button></div>{open && node.children?.map((child) => <TreeNode key={child.relativePath} node={child} selectedPath={selectedPath} baseResume={baseResume} onSelect={onSelect} depth={depth + 1} selectedPaths={selectedPaths} onTogglePath={onTogglePath} onDelete={onDelete} revealPath={highlightedPath} />)}{menuView}</div>;
  return <div className="tree-file-row" onContextMenu={openMenu}><button className={`tree-file ${selectedPath === node.relativePath ? "is-selected" : ""}`} style={{ paddingLeft: `${26 + depth * 13}px` }} onClick={() => onSelect(node.relativePath)}><input ref={inputRef} className="context-check" type="checkbox" aria-label={isPolicy ? `${node.name} is always enforced` : `Include ${node.name} in terminal context`} checked={checked} disabled={isPolicy} onClick={(event) => event.stopPropagation()} onChange={(event) => onTogglePath(node.relativePath, event.target.checked)} /><span className="file-icon">{node.fileType === "pdf" ? "PDF" : node.fileType === "docx" ? "DOC" : node.fileType === "text" || node.fileType === "json" || node.fileType === "rtf" ? "TXT" : "FILE"}</span><span className="tree-name" title={node.name}>{node.name}</span>{isPolicy && <span className="base-mark" title="Always-enforced career claim policy">POLICY</span>}{node.relativePath === baseResume && <span className="base-mark" title="Configured base resume">BASE</span>}</button>{menuView}</div>;
}

function DocumentView({ preview, isBaseResume, focusAnchor, onExported, onDirtyChange, onSaved }: { preview: FilePreview; isBaseResume: boolean; focusAnchor?: string; onExported: () => void; onDirtyChange: (dirty: boolean) => void; onSaved: (preview: FilePreview) => Promise<void> }) {
  if (!preview.canPreview) return <div className="unsupported-state"><div className="file-badge">{preview.fileType.toUpperCase()}</div><h2>Preview unavailable</h2><p>{preview.message}</p><div className="file-meta"><span>{formatBytes(preview.sizeBytes)}</span><span>Modified {new Date(preview.modifiedAt).toLocaleString()}</span></div>{isBaseResume && <span className="label verified">CONFIGURED BASE RESUME</span>}</div>;
  if (preview.contentType === "data-url" && preview.dataUrl) return preview.fileType === "pdf" ? <PdfDocument preview={preview} /> : <div className="image-document"><img src={preview.dataUrl} alt={preview.name} /></div>;
  if (preview.contentType === "html" && preview.content) return <article className="document rich-document"><div className="document-meta"><span>{preview.relativePath}</span><span>{formatBytes(preview.sizeBytes)} · {new Date(preview.modifiedAt).toLocaleDateString()}</span>{isBaseResume && <span className="label verified">CONFIGURED BASE RESUME</span>}</div><div dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.content) }} />{preview.message && <p className="preview-note">{preview.message}</p>}</article>;
  const challengePractice = preview.name === "practice_labs.json" ? parseChallengePractice(preview.content) : null;
  if (challengePractice) return <ChallengePracticeDocument preview={preview} practice={challengePractice} focusAnchor={focusAnchor} />;
  const isMarkdown = preview.name.toLowerCase().endsWith(".md");
  if (isMarkdown) return <MarkdownDocument preview={preview} focusAnchor={focusAnchor} onExported={onExported} onDirtyChange={onDirtyChange} onSaved={onSaved} />;
  return <article className="document"><div className="document-meta"><span>{preview.relativePath}</span><span>{formatBytes(preview.sizeBytes)} · {new Date(preview.modifiedAt).toLocaleDateString()}</span>{isBaseResume && <span className="label verified">CONFIGURED BASE RESUME</span>}</div><pre>{preview.content}</pre></article>;
}

function ChallengePracticeDocument({ preview, practice, focusAnchor }: { preview: FilePreview; practice: ChallengePractice; focusAnchor?: string }) {
  const articleRef = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState<ChallengeFilter>("all");
  const [currentId, setCurrentId] = useState(practice.exercises[0]?.id ?? "");
  const [revealedHints, setRevealedHints] = useState<string[]>([]);
  const [solutionOpen, setSolutionOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const exercises = filterChallengeExercises(practice, filter);
  useEffect(() => {
    if (!focusAnchor) return;
    const target = practice.exercises.find((exercise) => exercise.id === focusAnchor || exercise.title === focusAnchor);
    if (target) { setFilter("all"); setCurrentId(target.id); }
  }, [focusAnchor, practice.exercises]);
  const current = exercises.find((exercise) => exercise.id === currentId) ?? exercises[0] ?? null;
  const currentIndex = current ? exercises.findIndex((exercise) => exercise.id === current.id) : -1;

  useEffect(() => {
    if (!exercises.some((exercise) => exercise.id === currentId)) setCurrentId(exercises[0]?.id ?? "");
  }, [filter, currentId, exercises]);

  useEffect(() => {
    setRevealedHints([]);
    setSolutionOpen(false);
  }, [current?.id]);

  useEffect(() => {
    const viewer = articleRef.current?.closest(".viewer-panel") as HTMLElement | null;
    if (!viewer) return;
    const sync = () => setShowBackToTop(viewer.scrollTop > 420);
    viewer.addEventListener("scroll", sync, { passive: true });
    sync();
    return () => viewer.removeEventListener("scroll", sync);
  }, []);

  function chooseExercise(id: string) {
    setCurrentId(id);
    const viewer = articleRef.current?.closest(".viewer-panel");
    viewer?.scrollTo({ top: Math.max(0, articleRef.current!.offsetTop - 18), behavior: "smooth" });
  }

  function step(direction: -1 | 1) {
    const next = exercises[Math.max(0, Math.min(exercises.length - 1, currentIndex + direction))];
    if (next) chooseExercise(next.id);
  }

  function resetReveals() {
    setRevealedHints([]);
    setSolutionOpen(false);
  }

  return <article ref={articleRef} className="document challenge-practice">
    <div className="document-meta">
      <span>{preview.relativePath}</span>
      <span>{formatBytes(preview.sizeBytes)} · {new Date(preview.modifiedAt).toLocaleDateString()}</span>
      <span className="label verified">PRACTICE MODE</span>
    </div>
    <header className="challenge-hero">
      <div><span className="eyebrow">TECHNICAL CHALLENGE</span><h2>{practice.title}</h2><p>{practice.company} · {practice.role}</p></div>
      <div className="challenge-mode"><small>ASSESSMENT MODE</small><strong>{practice.assessmentMode.replaceAll("_", " ")}</strong><span>{practice.sourceBasis.replaceAll("_", " ")}</span></div>
    </header>
    {!practice.realPromptSupplied && <p className="challenge-notice"><strong>Practice approximation.</strong> {practice.approximationNotice ?? "These exercises are based on the known process and role, not an employer-supplied assessment prompt."}</p>}
    <div className="challenge-toolbar">
      <div className="challenge-filters" aria-label="Filter challenge exercises">
        {([["all", "All"], ["coding", "Coding labs"], ["verbal", "Verbal scenarios"]] as Array<[ChallengeFilter, string]>).map(([value, label]) => <button key={value} className={filter === value ? "is-active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      <div className="challenge-navigation">
        <label><span>JUMP TO EXERCISE</span><select aria-label="Jump to challenge exercise" value={current?.id ?? ""} onChange={(event) => chooseExercise(event.target.value)}>{exercises.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.title}</option>)}</select></label>
        <div className="challenge-stepper">
          <button disabled={currentIndex <= 0} onClick={() => step(-1)} aria-label="Previous exercise">←</button>
          <span>{exercises.length ? `${currentIndex + 1} of ${exercises.length}` : "No exercises"}</span>
          <button disabled={currentIndex < 0 || currentIndex >= exercises.length - 1} onClick={() => step(1)} aria-label="Next exercise">→</button>
        </div>
        <button className="challenge-reset" disabled={!revealedHints.length && !solutionOpen} onClick={resetReveals}>Reset reveals</button>
      </div>
    </div>
    {current ? <ChallengeExerciseCard exercise={current} revealedHints={revealedHints} solutionOpen={solutionOpen} onRevealHint={(key) => setRevealedHints((currentHints) => currentHints.includes(key) ? currentHints.filter((item) => item !== key) : [...currentHints, key])} onToggleSolution={() => setSolutionOpen((open) => !open)} /> : <div className="viewer-state">No exercises match this filter.</div>}
    {showBackToTop && <button className="question-back-top challenge-back-top" onClick={() => articleRef.current?.closest(".viewer-panel")?.scrollTo({ top: 0, behavior: "smooth" })}>↑ Top</button>}
  </article>;
}

function ChallengeExerciseCard({ exercise, revealedHints, solutionOpen, onRevealHint, onToggleSolution }: { exercise: ChallengeExercise; revealedHints: string[]; solutionOpen: boolean; onRevealHint: (key: string) => void; onToggleSolution: () => void }) {
  return <section className="challenge-card">
    <div className="challenge-card-heading">
      <div><span className={`challenge-type is-${exercise.type}`}>{exercise.type === "coding" ? "CODING / IMPLEMENTATION" : "VERBAL SCENARIO"}</span><h3>{exercise.title}</h3></div>
      <div className="challenge-card-meta"><span>{exercise.difficulty}</span><strong>{exercise.timeboxMinutes} min</strong></div>
    </div>
    <p className="challenge-relevance"><strong>Why this fits the role</strong>{exercise.jobRelevance}</p>
    <ChallengeSection title="Challenge" content={exercise.prompt} />
    {exercise.starterContext && <ChallengeSection title={exercise.type === "coding" ? "Starter context" : "Answer setup"} content={exercise.starterContext} code={exercise.type === "coding"} />}
    <ChallengeList title="Requirements" items={exercise.requirements} />
    {exercise.expectedOutput && <ChallengeSection title="Expected output" content={exercise.expectedOutput} />}
    <ChallengeList title="Acceptance tests" items={exercise.acceptanceTests} />
    <div className="challenge-reveals">
      <h4>Progressive help</h4>
      {exercise.hints.map((hint, index) => {
        const key = `${exercise.id}-hint-${index}`;
        const open = revealedHints.includes(key);
        return <div className="challenge-reveal" key={key}><button aria-expanded={open} onClick={() => onRevealHint(key)}><span>{open ? "Hide" : "Reveal"} hint {index + 1}</span><span>{open ? "−" : "+"}</span></button>{open && <div className="challenge-reveal-content" dangerouslySetInnerHTML={{ __html: markdownHtml(hint) }} />}</div>;
      })}
      <div className="challenge-reveal is-solution"><button aria-expanded={solutionOpen} onClick={onToggleSolution}><span>{solutionOpen ? "Hide solution" : "Show solution"}</span><span>{solutionOpen ? "−" : "+"}</span></button>{solutionOpen && <div className="challenge-reveal-content"><div dangerouslySetInnerHTML={{ __html: markdownHtml(exercise.solution) }} /><h5>Why it works</h5><div dangerouslySetInnerHTML={{ __html: markdownHtml(exercise.explanation) }} /></div>}</div>
    </div>
    <div className="challenge-review-grid">
      <ChallengeList title="What the interviewer evaluates" items={exercise.evaluationCriteria} />
      <ChallengeList title="Common mistakes" items={exercise.commonMistakes} />
      <ChallengeList title="Likely follow-ups" items={exercise.followUpProbes} />
    </div>
    <div className="challenge-score"><h4>Self-scoring rubric</h4>{exercise.scoringRubric.map((item) => <div key={item.criterion}><strong>{item.points} pts</strong><span>{item.criterion}</span><p>{item.strongPerformance}</p></div>)}</div>
  </section>;
}

function ChallengeSection({ title, content, code = false }: { title: string; content: string; code?: boolean }) {
  const codeLanguage = inferCodeLanguage(content);
  return <section className="challenge-section"><h4>{title}</h4>{code
    ? <div dangerouslySetInnerHTML={{ __html: markdownHtml(`\`\`\`${codeLanguage}\n${content}\n\`\`\``) }} />
    : <div dangerouslySetInnerHTML={{ __html: markdownHtml(content) }} />}</section>;
}

function ChallengeList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="challenge-section"><h4>{title}</h4><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

function MarkdownDocument({ preview, focusAnchor, onExported, onDirtyChange, onSaved }: { preview: FilePreview; focusAnchor?: string; onExported: () => void; onDirtyChange: (dirty: boolean) => void; onSaved: (preview: FilePreview) => Promise<void> }) {
  const articleRef = useRef<HTMLElement>(null);
  const initialContent = preview.content ?? "";
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [baseline, setBaseline] = useState(initialContent);
  const [draft, setDraft] = useState(initialContent);
  const [expectedModifiedAt, setExpectedModifiedAt] = useState(preview.modifiedAt);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [questionFilter, setQuestionFilter] = useState<QuestionFilter>("all");
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [backButtonPosition, setBackButtonPosition] = useState<{ left: number; top: number } | null>(null);
  const editable = /^(jobs|debrief|resumes)\//.test(preview.relativePath);
  const isQuestionBank = preview.name === "question_bank.md";
  const isEvaluation = preview.name.toLowerCase() === "evaluation.md";
  const dirty = draft !== baseline;
  const canExport = /_Resume\.md$/i.test(preview.name) || preview.name === "cover_letter.md" || preview.name === "submission_checklist.md" || (preview.relativePath.startsWith("resumes/") && preview.name.toLowerCase().endsWith(".md"));
  const visibleMarkdown = isQuestionBank ? filterQuestionBank(draft, questionFilter) : draft;
  const questions = isQuestionBank ? parseQuestionBank(visibleMarkdown) : [];
  const questionKey = questions.map((question) => question.id).join("|");

  useEffect(() => {
    if (!focusAnchor || mode !== "view" || !articleRef.current) return;
    const normalized = focusAnchor.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54);
    const target = articleRef.current.querySelector<HTMLElement>(`#question-${normalized}, #question-${normalized}-1, #heading-${normalized}`);
    const viewer = articleRef.current.closest(".viewer-panel") as HTMLElement | null;
    if (!target || !viewer) return;
    window.requestAnimationFrame(() => {
      const top = viewer.scrollTop + target.getBoundingClientRect().top - viewer.getBoundingClientRect().top - 92;
      viewer.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      target.classList.add("is-question-target");
      window.setTimeout(() => target.classList.remove("is-question-target"), 1300);
    });
  }, [focusAnchor, mode, questionKey]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  async function save() {
    if (!editable || !dirty || state === "saving") return;
    setState("saving");
    setMessage("");
    let saved: FilePreview;
    try {
      if (typeof window.sensei.files.saveMarkdown !== "function") throw new Error("The editor bridge is out of date. Fully quit Sensei and run npm run dev again.");
      saved = await window.sensei.files.saveMarkdown({ relativePath: preview.relativePath, content: draft, expectedContent: baseline, expectedModifiedAt });
      const content = saved.content ?? draft;
      setBaseline(content);
      setDraft(content);
      setExpectedModifiedAt(saved.modifiedAt);
      setState("saved");
      setMessage("Saved locally");
    } catch (caught) {
      setState("error");
      setMessage(messageOf(caught, "Unable to save this Markdown file."));
      return;
    }
    try { await onSaved(saved); }
    catch { setMessage("Saved locally. Rescan to refresh the sidebar."); }
  }

  async function reloadFromDisk() {
    if (dirty && !window.confirm("Discard your unsaved changes and reload this file?")) return;
    try {
      const latest = await window.sensei.files.preview(preview.relativePath);
      const content = latest.content ?? "";
      setBaseline(content);
      setDraft(content);
      setExpectedModifiedAt(latest.modifiedAt);
      setState("idle");
      setMessage("");
      await onSaved(latest);
    } catch (caught) {
      setState("error");
      setMessage(messageOf(caught, "Unable to reload this Markdown file."));
    }
  }

  useEffect(() => {
    if (mode !== "edit") return;
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  });

  useEffect(() => {
    if (!isQuestionBank || mode !== "view" || !articleRef.current) {
      setBackButtonPosition(null);
      return;
    }
    const viewer = articleRef.current.closest(".viewer-panel") as HTMLElement | null;
    if (!viewer) return;
    const syncNavigation = () => {
      const viewerRect = viewer.getBoundingClientRect();
      setBackButtonPosition(viewer.scrollTop > 420 ? { left: viewerRect.right - 82, top: viewerRect.bottom - 56 } : null);
      const threshold = viewerRect.top + 145;
      let active = questions[0]?.id ?? null;
      for (const question of questions) {
        const element = articleRef.current?.querySelector<HTMLElement>(`#${question.id}`);
        if (element && element.getBoundingClientRect().top <= threshold) active = question.id;
      }
      setCurrentQuestionId((current) => current === active ? current : active);
    };
    const observer = new ResizeObserver(syncNavigation);
    observer.observe(viewer);
    viewer.addEventListener("scroll", syncNavigation, { passive: true });
    window.addEventListener("resize", syncNavigation);
    syncNavigation();
    return () => {
      observer.disconnect();
      viewer.removeEventListener("scroll", syncNavigation);
      window.removeEventListener("resize", syncNavigation);
    };
  }, [isQuestionBank, mode, questionKey]);

  function jumpToQuestion(questionId: string) {
    const article = articleRef.current;
    const viewer = article?.closest(".viewer-panel") as HTMLElement | null;
    const target = article?.querySelector<HTMLElement>(`#${questionId}`);
    if (!article || !viewer || !target) return;
    const toolbarHeight = article.querySelector<HTMLElement>(".question-toolbar")?.offsetHeight ?? 72;
    const top = viewer.scrollTop + target.getBoundingClientRect().top - viewer.getBoundingClientRect().top - toolbarHeight - 18;
    viewer.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    setCurrentQuestionId(questionId);
    target.classList.add("is-question-target");
    window.setTimeout(() => target.classList.remove("is-question-target"), 1100);
  }

  function stepQuestion(direction: -1 | 1) {
    if (!questions.length) return;
    const currentIndex = Math.max(0, questions.findIndex((question) => question.id === currentQuestionId));
    const nextIndex = Math.max(0, Math.min(questions.length - 1, currentIndex + direction));
    jumpToQuestion(questions[nextIndex].id);
  }

  function backToTop() {
    const viewer = articleRef.current?.closest(".viewer-panel");
    viewer?.scrollTo({ top: 0, behavior: "smooth" });
  }

  return <article ref={articleRef} className={`document markdown-document markdown-workspace ${isQuestionBank ? "question-bank-document" : ""}`}>
    <div className="document-meta">
      <span>{preview.relativePath}</span>
      <span>{formatBytes(new Blob([draft]).size)} · {new Date(expectedModifiedAt).toLocaleDateString()}</span>
      <span className={`edit-status ${dirty ? "is-dirty" : ""}`}>{dirty ? "Unsaved changes" : state === "saved" ? "Saved" : editable ? "Local artifact" : "Source locked"}</span>
      <span className="markdown-actions">
        {editable && <button className={`editor-button ${mode === "edit" ? "is-active" : ""}`} onClick={() => setMode(mode === "view" ? "edit" : "view")}>{mode === "view" ? "Edit Markdown" : "View document"}</button>}
        {mode === "edit" && <button className="editor-button" disabled={!dirty || state === "saving"} onClick={() => void save()}>{state === "saving" ? "Saving…" : "Save"}</button>}
        {mode === "edit" && <button className="editor-button" onClick={() => void reloadFromDisk()}>Reload</button>}
        {mode === "view" && canExport && <MarkdownExportButton relativePath={preview.relativePath} onExported={onExported} />}
      </span>
    </div>
    {message && <p className={`editor-message ${state === "error" ? "is-error" : ""}`} role="status">{message}</p>}
    {mode === "view" && isQuestionBank && <QuestionBankToolbar value={questionFilter} onChange={setQuestionFilter} questions={questions} currentQuestionId={currentQuestionId} onJump={jumpToQuestion} onStep={stepQuestion} />}
    {mode === "edit"
      ? <div className="markdown-editor-grid"><div className="editor-pane"><div className="editor-pane-title">MARKDOWN <span>CTRL/⌘ S TO SAVE</span></div><textarea aria-label={`Edit ${preview.name}`} value={draft} spellCheck="true" onChange={(event) => { setDraft(event.target.value); setState("idle"); setMessage(""); }} /></div><div className="editor-preview"><div className="editor-pane-title">LIVE PREVIEW</div><div dangerouslySetInnerHTML={{ __html: markdownHtml(draft) }} /></div></div>
      : isEvaluation
        ? <EvaluationDocument markdown={visibleMarkdown} />
        : <div className={isQuestionBank ? "question-bank-content" : undefined} dangerouslySetInnerHTML={{ __html: markdownHtml(visibleMarkdown, questions) }} />}
    {isQuestionBank && backButtonPosition && createPortal(<button className="question-back-top" style={backButtonPosition} onClick={backToTop} aria-label="Back to top of question bank">↑ Top</button>, document.body)}
  </article>;
}

function EvaluationDocument({ markdown }: { markdown: string }) {
  const requirements = parseEvaluationRequirements(markdown);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  if (!requirements.length) return <div dangerouslySetInnerHTML={{ __html: markdownHtml(markdown) }} />;
  const score = evaluationLabel(markdown, /(?:Weighted Fit Score|Total\s*\/\s*Final Score)/i) ?? "Not recorded";
  const recommendation = evaluationLabel(markdown, /Apply Recommendation/i) ?? evaluationLabel(markdown, /Gate Status/i) ?? "Review the evidence breakdown";
  const confidence = evaluationLabel(markdown, /Fit Confidence/i) ?? "Not recorded";
  const insightSections = [
    ["Direct matches", /Direct Matches/i],
    ["Transferable evidence", /Transferable Evidence/i],
    ["Gaps and risks", /(?:Important Gaps|Gaps and Risks|Hard Blockers)/i],
    ["Tailoring rationale", /Tailoring Rationale/i],
  ] as const;
  const insights = insightSections
    .map(([title, pattern]) => ({ title, content: evaluationSection(markdown, pattern) }))
    .filter((section) => section.content);
  const audit = /<!-- jobsensei-application-audit:start -->([\s\S]*?)<!-- jobsensei-application-audit:end -->/i.exec(markdown)?.[1]?.trim() ?? "";
  const categories = Object.keys(evaluationCategoryLabels).map((category) => {
    const rows = requirements.filter((row) => row.category === category);
    const available = rows.reduce((sum, row) => sum + row.weight, 0);
    const earned = rows.reduce((sum, row) => sum + row.weight * (evaluationCredits[row.classification] ?? 0), 0);
    return { category, rows, available, earned };
  }).filter((group) => group.rows.length);
  const narrative = markdown
    .replace(/###\s+Requirement Scoring\s*\n[\s\S]*?(?=\n#{1,3}\s+|<!-- jobsensei-application-audit:start -->|$)/i, "")
    .replace(/<!-- jobsensei-application-audit:start -->[\s\S]*?<!-- jobsensei-application-audit:end -->/i, "")
    .trim();
  const activeCategory = openCategory ?? categories[0]?.category ?? null;
  function openCategoryDetails(category: string) {
    setOpenCategory(category);
    window.requestAnimationFrame(() => document.getElementById(`evaluation-category-${category}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }
  return <div className="evaluation-document">
    <section className="evaluation-summary" aria-label="Evaluation summary">
      <div className="evaluation-score-card"><span>FIT SCORE</span><strong>{score.replace(/^.*?(\d(?:\.\d+)?\s*\/\s*5).*$/i, "$1")}</strong><small>Direct 100% · strong 75% · adjacent 55%</small></div>
      <div><span>APPLY RECOMMENDATION</span><strong>{recommendation}</strong></div>
      <div><span>CONFIDENCE</span><strong>{confidence}</strong></div>
    </section>
    <section className="evaluation-category-section">
      <div className="evaluation-section-heading"><div><span className="eyebrow">CATEGORY COVERAGE</span><h2>Where the score comes from</h2></div><small>{requirements.length} scored requirements</small></div>
      <div className="evaluation-category-grid">{categories.map((group) => {
        const percent = group.available ? Math.round(group.earned / group.available * 100) : 0;
        return <button className={`evaluation-category-card ${activeCategory === group.category ? "is-active" : ""}`} type="button" key={group.category} aria-controls={`evaluation-category-${group.category}`} aria-expanded={activeCategory === group.category} onClick={() => openCategoryDetails(group.category)}><span>{evaluationCategoryLabels[group.category]}</span><strong>{group.earned.toFixed(1)} <small>/ {group.available}%</small></strong><span className="evaluation-category-bar" aria-label={`${percent}% credit`}><i style={{ width: `${percent}%` }} /></span><small>{percent}% of available credit · View requirements</small></button>;
      })}</div>
    </section>
    {insights.length > 0 && <section className="evaluation-insights"><div className="evaluation-section-heading"><div><span className="eyebrow">DECISION CONTEXT</span><h2>What matters most</h2></div></div><div>{insights.map((section) => <article key={section.title}><h3>{section.title}</h3><div dangerouslySetInnerHTML={{ __html: markdownHtml(section.content) }} /></article>)}</div></section>}
    <section className="evaluation-requirements">
      <div className="evaluation-section-heading"><div><span className="eyebrow">REQUIREMENT BREAKDOWN</span><h2>Evidence by requirement</h2></div><small>Open a category to inspect its evidence</small></div>
      {categories.map((group) => <details id={`evaluation-category-${group.category}`} key={group.category} open={activeCategory === group.category} onToggle={(event) => { if (event.currentTarget.open) setOpenCategory(group.category); }}><summary><span>{evaluationCategoryLabels[group.category]}</span><small>{group.rows.length} requirements · {group.earned.toFixed(1)} / {group.available}%</small></summary><div className="evaluation-requirement-list">{group.rows.map((row, rowIndex) => <article className="evaluation-requirement" key={`${row.requirement}-${rowIndex}`}><div><span className={`evaluation-classification is-${row.classification}`}>{row.classification.replaceAll("_", " ")}</span>{row.material && <span className="evaluation-material">Material</span>}<strong>{row.requirement}</strong></div><dl><div><dt>Weight</dt><dd>{row.weight}%</dd></div><div><dt>Evidence</dt><dd><code>{row.evidence || "No eligible evidence"}</code></dd></div></dl></article>)}</div></details>)}
    </section>
    {audit && <details className="evaluation-audit"><summary><span>Application audits and review warnings</span><small>Resume, cover letter, and grounding details</small></summary><div dangerouslySetInnerHTML={{ __html: markdownHtml(audit) }} /></details>}
    <details className="evaluation-source-notes"><summary>Full evaluation notes</summary><div dangerouslySetInnerHTML={{ __html: markdownHtml(narrative) }} /></details>
  </div>;
}

type QuestionFilter = "all" | "primary" | "followups" | "later" | "ask";

function QuestionBankToolbar({ value, onChange, questions, currentQuestionId, onJump, onStep }: { value: QuestionFilter; onChange: (value: QuestionFilter) => void; questions: QuestionEntry[]; currentQuestionId: string | null; onJump: (questionId: string) => void; onStep: (direction: -1 | 1) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const options: Array<[QuestionFilter, string]> = [["all", "All"], ["primary", "Primary"], ["followups", "Follow-ups"], ["later", "Later round"], ["ask", "Questions to ask"]];
  const normalizedQuery = query.trim().toLowerCase();
  const matches = questions.filter((question) => !normalizedQuery || `${question.text} ${question.section}`.toLowerCase().includes(normalizedQuery));
  const currentIndex = questions.findIndex((question) => question.id === currentQuestionId);
  function choose(question: QuestionEntry) {
    onJump(question.id);
    setQuery("");
    setOpen(false);
  }
  return <div className="question-toolbar">
    <div className="question-filters" aria-label="Filter interview questions">{options.map(([id, label]) => <button key={id} className={value === id ? "is-active" : ""} aria-pressed={value === id} onClick={() => { onChange(id); setQuery(""); setOpen(false); }}>{label}</button>)}</div>
    <div className="question-navigation">
      <div className="question-jump" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
        <input
          aria-label="Jump to an interview question"
          aria-autocomplete="list"
          aria-controls="question-jump-results"
          aria-expanded={open}
          placeholder="Jump to question…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.max(0, Math.min(matches.length - 1, index + 1))); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
            if (event.key === "Enter" && open && matches[activeIndex]) { event.preventDefault(); choose(matches[activeIndex]); }
            if (event.key === "Escape") setOpen(false);
          }}
        />
        {open && <div className="question-jump-results" id="question-jump-results" role="listbox">
          {matches.length === 0 && <span className="question-jump-empty">No matching questions</span>}
          {matches.map((question, index) => <div key={question.id}>
            {(index === 0 || matches[index - 1].section !== question.section) && <span className="question-result-section">{question.section}</span>}
            <button className={index === activeIndex ? "is-active" : ""} role="option" aria-selected={question.id === currentQuestionId} title={question.text} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(question)}>{question.text}</button>
          </div>)}
        </div>}
      </div>
      <div className="question-stepper">
        <button disabled={currentIndex <= 0} onClick={() => onStep(-1)} aria-label="Previous question">←</button>
        <span>{questions.length ? `Question ${Math.max(0, currentIndex) + 1} of ${questions.length}` : "No questions"}</span>
        <button disabled={currentIndex < 0 || currentIndex >= questions.length - 1} onClick={() => onStep(1)} aria-label="Next question">→</button>
      </div>
    </div>
  </div>;
}

function filterQuestionBank(markdown: string, filter: QuestionFilter): string {
  if (filter === "all") return markdown;
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const preamble: string[] = [];
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      current = { heading: heading[1].toLowerCase(), lines: [line] };
      sections.push(current);
    } else if (current) current.lines.push(line);
    else preamble.push(line);
  }
  const matches = (heading: string): boolean => {
    if (filter === "primary") return /primary for this round|recruiter|hiring.manager|customer.facing|behavioral/.test(heading);
    if (filter === "followups") return /follow.?up/.test(heading);
    if (filter === "later") return /secondary|later.round|technical|domain/.test(heading);
    return /questions to ask|reverse/.test(heading);
  };
  const selected = sections.filter((section) => matches(section.heading));
  if (!selected.length) return `${preamble.join("\n")}\n\n## No matching section\n\nThis legacy question bank does not label questions for this filter.`;
  return [...preamble, ...selected.flatMap((section) => ["", ...section.lines])].join("\n");
}

function PdfTextSizeSelect({ value, onChange, disabled }: { value: PdfTextSize; onChange: (value: PdfTextSize) => void; disabled: boolean }) {
  return <label className="pdf-text-size"><span>PDF text</span><select aria-label="PDF text size" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as PdfTextSize)}><option value="auto">Auto fit</option><option value="large">5% larger</option><option value="largest">10% larger</option></select></label>;
}

function MarkdownExportButton({ relativePath, onExported }: { relativePath: string; onExported: () => void }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "warning" | "error">("idle");
  const [message, setMessage] = useState("");
  const [textSize, setTextSize] = useState<PdfTextSize>("auto");
  async function exportPdf() {
    setState("working");
    try {
      const result = await window.sensei.files.exportMarkdownPdf(relativePath, textSize);
      const pageUse = result.pageFillRatio === null ? "" : `, ${Math.round(result.pageFillRatio * 100)}% page use`;
      setState(result.validationStatus === "warning" ? "warning" : "done");
      setMessage(`Saved ${result.relativePath} (${result.pageCount} page${result.pageCount === 1 ? "" : "s"}${pageUse})`);
      onExported();
    } catch (caught) {
      setState("error");
      setMessage(messageOf(caught, "PDF export failed."));
    }
  }
  return <span className="markdown-actions"><PdfTextSizeSelect value={textSize} onChange={setTextSize} disabled={state === "working"} /><button className="export-button" disabled={state === "working"} onClick={() => void exportPdf()}>{state === "working" ? "Creating PDF…" : "Approve & Export PDF"}</button>{message && <span className={`export-message ${state === "error" ? "is-error" : ""}`} title={message}>{state === "done" ? "PDF saved" : state === "warning" ? "PDF saved - review 2 pages" : message}</span>}</span>;
}

function PdfDocument({ preview }: { preview: FilePreview }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!hostRef.current || !preview.dataUrl) return;
    hostRef.current.replaceChildren();
    const bytes = Uint8Array.from(atob(preview.dataUrl.split(",")[1] ?? ""), (char) => char.charCodeAt(0));
    void pdfjsLib.getDocument({ data: bytes }).promise.then(async (pdf: any) => {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (cancelled || !hostRef.current) return;
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.25 });
        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page";
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        hostRef.current.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
      }
    }).catch((caught: unknown) => { if (!cancelled) setError(messageOf(caught, "Unable to render this PDF.")); });
    return () => { cancelled = true; };
  }, [preview.dataUrl]);
  return <div className="pdf-document">{error ? <div className="unsupported-state"><h2>PDF preview unavailable</h2><p>{error}</p></div> : <div className="pdf-pages" ref={hostRef} />}</div>;
}

function TerminalPanel({ cwd, selectedJobFiles, selectedCareerPaths, theme, visible, onClose, jobActions, promptRequest, onPromptHandled, onInsertPrompt }: { cwd: string; selectedJobFiles: string[]; selectedCareerPaths: string[]; theme: "dark" | "light"; visible: boolean; onClose: () => void; jobActions: JobAction[]; promptRequest: PromptRequest | null; onPromptHandled: (id: number) => void; onInsertPrompt: (action: JobAction) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState("Starting terminal…");
  const [terminalReady, setTerminalReady] = useState(false);
  const terminalReadyRef = useRef(false);
  const [promptNotice, setPromptNotice] = useState("");
  const handledPromptId = useRef(0);

  useEffect(() => {
    if (!hostRef.current) return;
    if (!window.sensei?.terminal) {
      setStatus("Terminal bridge unavailable; restart the app.");
      return;
    }
    const terminal = new Terminal({ cursorBlink: true, convertEol: true, fontFamily: "DM Mono, monospace", fontSize: 12, theme: terminalTheme(theme), scrollback: 4000 });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    const focusTerminal = () => terminal.focus();
    hostRef.current.addEventListener("click", focusTerminal);
    terminalRef.current = terminal;
    fitRef.current = fit;
    const removeData = window.sensei.terminal.onData((data) => terminal.write(data));
    const removeExit = window.sensei.terminal.onExit((code) => setStatus(`Terminal exited (${code})`));
    let resizeFrame: number | null = null;
    let lastSize = "";
    const resize = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        try {
          if (!terminalReadyRef.current || !hostRef.current || hostRef.current.clientWidth < 2 || hostRef.current.clientHeight < 2 || !terminal.element) return;
          fit.fit();
          terminal.refresh(0, Math.max(0, terminal.rows - 1));
          const size = `${terminal.cols}x${terminal.rows}`;
          if (terminal.cols >= 2 && terminal.rows >= 2 && terminal.cols <= 500 && terminal.rows <= 200 && size !== lastSize) {
            lastSize = size;
            void window.sensei.terminal.resize({ cols: terminal.cols, rows: terminal.rows }).catch(() => undefined);
          }
        } catch { /* The panel can be between layout states during window resize. */ }
      });
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(hostRef.current);
    window.addEventListener("resize", resize);
    terminal.onData((data) => void window.sensei.terminal.write(data));
    terminalReadyRef.current = false;
    setTerminalReady(false);
    void window.sensei.terminal.start({}).then(({ cwd: startedCwd }) => { terminalReadyRef.current = true; setStatus(`${startedCwd} · context-aware`); setTerminalReady(true); resize(); terminal.focus(); }).catch((caught: unknown) => { terminalReadyRef.current = false; setTerminalReady(false); setStatus(messageOf(caught, "Terminal failed to start")); });
    const initialResize = window.setTimeout(resize, 80);
    return () => { terminalReadyRef.current = false; resizeObserver.disconnect(); window.removeEventListener("resize", resize); hostRef.current?.removeEventListener("click", focusTerminal); window.clearTimeout(initialResize); if (resizeFrame !== null) cancelAnimationFrame(resizeFrame); removeData(); removeExit(); void window.sensei.terminal.stop(); terminal.dispose(); terminalRef.current = null; fitRef.current = null; };
  }, [cwd]);

  useEffect(() => { if (terminalRef.current) terminalRef.current.options.theme = terminalTheme(theme); }, [theme]);

  useEffect(() => {
    if (!visible) return;
    const resizeTimer = window.setTimeout(() => {
      const terminal = terminalRef.current;
      try {
        if (!terminalReadyRef.current || !terminal?.element) return;
        fitRef.current?.fit();
        if (terminal && terminal.cols >= 2 && terminal.rows >= 2 && terminal.cols <= 500 && terminal.rows <= 200) {
          terminal.refresh(0, Math.max(0, terminal.rows - 1));
          void window.sensei.terminal.resize({ cols: terminal.cols, rows: terminal.rows }).catch(() => undefined);
        }
      } catch { /* The panel may still be settling after it is reopened. */ }
    }, 60);
    return () => window.clearTimeout(resizeTimer);
  }, [visible]);

  useEffect(() => {
    if (!visible || !terminalReady || !promptRequest || handledPromptId.current === promptRequest.id) return;
    handledPromptId.current = promptRequest.id;
    void window.sensei.terminal.insertPrompt(promptRequest.text)
      .then(() => {
        setPromptNotice(`Prompt ready: ${promptRequest.label} · Press Enter to run`);
        terminalRef.current?.focus();
        window.setTimeout(() => setPromptNotice(""), 4500);
      })
      .catch((caught: unknown) => setPromptNotice(messageOf(caught, "Unable to insert that prompt.")))
      .finally(() => onPromptHandled(promptRequest.id));
  }, [visible, terminalReady, promptRequest?.id]);

  useEffect(() => {
    if (!cwd) return;
    void window.sensei.terminal.setContext({ careerPaths: selectedCareerPaths, structuredPaths: selectedCareerPaths.filter((path) => path.startsWith("context/structured/")), broadPaths: selectedCareerPaths.filter((path) => path.startsWith("context/broad/")), jobPaths: selectedJobFiles, jobIds: [] })
      .then((manifest) => setStatus(`${cwd} · ${manifest.scope} context ready`))
      .catch(() => setStatus(`${cwd} · context update failed`));
  }, [cwd, selectedCareerPaths.join(","), selectedJobFiles.join(",")]);

  return <aside className={`terminal-panel ${visible ? "" : "is-collapsed"}`}><div className="terminal-header"><div><div className="eyebrow">COMMAND CENTER</div></div><div className="terminal-header-actions"><JobActionsMenu actions={jobActions} onInsert={onInsertPrompt} /><button className="terminal-action" onClick={() => void window.sensei.terminal.restart()}>Restart</button><button className="terminal-action" aria-label="Hide terminal panel" onClick={onClose}>Hide</button></div></div><div className="terminal-host" ref={hostRef} /><div className="terminal-status"><span className="status-dot is-ready" /><span>{promptNotice || status}</span></div></aside>;
}

function JobActionsMenu({ actions, onInsert }: { actions: JobAction[]; onInsert: (action: JobAction) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const recommended = actions.find((action) => action.recommended) ?? actions[0] ?? null;
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", escape); };
  }, [open]);
  function insert(action: JobAction) {
    onInsert(action);
    setOpen(false);
  }
  const groups: JobAction["group"][] = ["Recommended", "Interview", "Application"];
  return <div className="job-actions" ref={rootRef}>
    <div className="job-actions-split">
      <button className="terminal-action job-actions-primary" disabled={!recommended} title={recommended ? `Insert without running: ${recommended.prompt}` : "View a job or select one job to enable actions"} onClick={() => recommended && insert(recommended)}>Job Actions</button>
      <button className="terminal-action job-actions-toggle" disabled={!actions.length} aria-haspopup="menu" aria-expanded={open} aria-label="Show Job Actions" onClick={() => setOpen((value) => !value)}>▾</button>
    </div>
    {open && <div className="job-actions-menu" role="menu">{groups.map((group) => {
      const grouped = actions.filter((action) => action.group === group);
      if (!grouped.length) return null;
      return <section key={group}><span>{group}</span>{grouped.map((action) => <button key={action.id} role="menuitem" onClick={() => insert(action)}><strong>{action.label}</strong><small>{action.company} · inserts only</small></button>)}</section>;
    })}</div>}
  </div>;
}

function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function messageOf(caught: unknown, fallback: string): string { return caught instanceof Error ? caught.message : fallback; }
function cleanLiveAnswer(value: string): string {
  return value.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").replace(/^\s*(?:analysis|reasoning|thinking)\s*:\s*/i, "").replace(/^\s*(?:here(?:'s| is) (?:a|the) )?suggested answer\s*:\s*/i, "");
}
function workspaceLabel(path: string): string { return path.split("/").filter(Boolean).pop() ?? "data"; }
function filePaths(nodes: FileTreeNode[]): string[] { return nodes.flatMap((node) => node.kind === "directory" ? filePaths(node.children ?? []) : [node.relativePath]); }
function fileNodes(nodes: FileTreeNode[]): FileTreeNode[] { return nodes.flatMap((node) => node.kind === "directory" ? fileNodes(node.children ?? []) : [node]); }
function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | null { for (const node of nodes) { if (node.relativePath === path) return node; const found = node.children ? findNode(node.children, path) : null; if (found) return found; } return null; }
function terminalTheme(_theme: "dark" | "light") { return { background: "#0b0f0d", foreground: "#e4ece3", cursor: "#b5db63", selectionBackground: "#354b35", black: "#172019", brightBlack: "#718073", green: "#a7d66b", brightGreen: "#c7ed89" }; }
function sanitizeHtml(value: string): string {
  const document = new DOMParser().parseFromString(value, "text/html");
  document.querySelectorAll("script, iframe, object, embed, link, style").forEach((element) => element.remove());
  document.querySelectorAll("*").forEach((element) => [...element.attributes].forEach((attribute) => { if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name); }));
  return document.body.innerHTML;
}

function normalizedCodeLanguage(value: string): string {
  const language = value.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const aliases: Record<string, string> = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", sh: "bash", shell: "bash", zsh: "bash", yml: "yaml", ps1: "powershell" };
  return (aliases[language] ?? language) || "text";
}

function inferCodeLanguage(value: string): string {
  if (/\b(?:interface|type)\s+[A-Z]|\b(?:const|let)\s+\w+\s*(?::[^=]+)?=|=>/.test(value)) return "typescript";
  if (/^\s*(?:def|from|import)\s+/m.test(value)) return "python";
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/i.test(value)) return "sql";
  if (/\b(?:param|Write-Host|Get-ChildItem|New-Item)\b|\$[A-Za-z][\w-]*/.test(value)) return "powershell";
  if (/^\s*(?:#!.*(?:ba|z|k)?sh|export\s+|(?:npm|git|curl|rg)\s+)/m.test(value)) return "bash";
  return "text";
}

function highlightCode(value: string, language: string, escape: (value: string) => string): string {
  const keywords: Record<string, string[]> = {
    javascript: ["const", "let", "var", "function", "return", "async", "await", "if", "else", "for", "while", "class", "new", "import", "export", "from", "try", "catch", "throw"],
    typescript: ["const", "let", "function", "return", "async", "await", "if", "else", "for", "interface", "type", "class", "new", "import", "export", "from", "extends", "implements"],
    python: ["def", "return", "async", "await", "if", "elif", "else", "for", "while", "class", "import", "from", "try", "except", "raise", "with", "as", "in"],
    bash: ["if", "then", "else", "fi", "for", "do", "done", "case", "esac", "function", "export"],
    powershell: ["function", "param", "if", "else", "foreach", "return", "throw", "try", "catch", "switch"],
    sql: ["select", "from", "where", "join", "on", "group", "by", "order", "insert", "update", "delete", "create", "table", "as", "and", "or"],
  };
  const keywordSet = new Set((keywords[language] ?? []).map((keyword) => keyword.toLowerCase()));
  const tokenPattern = /(\/\/[^\n]*|#[^\n]*|--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  let output = "";
  let cursor = 0;
  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    const token = match[0];
    output += escape(value.slice(cursor, index));
    const lower = token.toLowerCase();
    const tokenClass = /^(?:\/\/|#|--)/.test(token) ? "comment" : /^["'`]/.test(token) ? "string" : /^\d/.test(token) ? "number" : keywordSet.has(lower) ? "keyword" : "identifier";
    output += `<span class="syntax-${tokenClass}">${escape(token)}</span>`;
    cursor = index + token.length;
  }
  return output + escape(value.slice(cursor));
}

function markdownHtml(markdown: string, questionEntries: QuestionEntry[] = []): string {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const inline = (value: string) => escape(value).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  const output: string[] = [];
  let list: "ul" | "ol" | null = null;
  let code = false;
  let codeLanguage = "text";
  let codeLines: string[] = [];
  const closeList = () => { if (list) { output.push(`</${list}>`); list = null; } };
  const questionIds = new Map(questionEntries.map((question) => [question.lineIndex, question.id]));
  for (const [lineIndex, line] of markdown.replaceAll("\r\n", "\n").split("\n").entries()) {
    if (line.trim().startsWith("```")) { if (code) { const codeValue = codeLines.join("\n"); output.push(`<div class="code-block language-${codeLanguage}"><div class="code-block-heading"><span>${escape(codeLanguage)}</span></div><pre><code>${highlightCode(codeValue, codeLanguage, escape)}</code></pre></div>`); codeLines = []; code = false; codeLanguage = "text"; } else { closeList(); code = true; codeLanguage = normalizedCodeLanguage(line.trim().slice(3)); } continue; }
    if (code) { codeLines.push(line); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const questionId = questionIds.get(lineIndex);
    const headingId = heading ? `heading-${heading[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54)}` : null;
    const anchorId = questionId ?? headingId;
    const anchor = anchorId ? ` id="${anchorId}" class="question-anchor"` : "";
    if (heading) { closeList(); output.push(`<h${heading[1].length}${anchor}>${inline(heading[2])}</h${heading[1].length}>`); }
    else if (bullet || numbered) { const next = bullet ? "ul" : "ol"; if (list !== next) { closeList(); list = next; output.push(`<${list}>`); } output.push(`<li${anchor}>${inline((bullet ?? numbered)![1])}</li>`); }
    else if (/^\s*>\s?/.test(line)) { closeList(); output.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ""))}</blockquote>`); }
    else if (!line.trim()) closeList();
    else { closeList(); output.push(`<p>${inline(line)}</p>`); }
  }
  if (code) { const codeValue = codeLines.join("\n"); output.push(`<div class="code-block language-${codeLanguage}"><div class="code-block-heading"><span>${escape(codeLanguage)}</span></div><pre><code>${highlightCode(codeValue, codeLanguage, escape)}</code></pre></div>`); }
  closeList();
  return sanitizeHtml(output.join("\n"));
}
