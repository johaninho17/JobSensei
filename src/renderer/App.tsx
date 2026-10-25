import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { DEFAULT_PDF_TEXT_SIZE, TRACKER_STATUSES, type JobTrackerUpdate, type TrackerStatus } from "../shared/schemas";
import { TRACKER_LABELS, effectiveAppliedAt, effectiveStatus, followUpDays } from "../shared/tracker";
import { FIT_CLASSIFICATION_CREDIT } from "../shared/fit-credit";
import type { ApplicationStatus, ApplicationValidationReport, CandidateProfile, ChallengeExercise, ChallengePractice, ContextManifest, FilePreview, FileTreeNode, InterviewOverview, JobFolderSummary, PdfTextSize, SearchResult, Settings, WorkspaceSummary } from "../shared/schemas";
// pdfjs-dist ships the browser runtime without declarations for this subpath.
// @ts-expect-error The Vite browser bundle is intentionally imported directly.
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { filterChallengeExercises, parseChallengePractice, type ChallengeFilter } from "./challenge-practice";
import { buildJobActions, type JobAction } from "./job-actions";
import { evaluationCategoryLabels, evaluationCredits, evaluationLabel, evaluationSection, parseEvaluationRequirements } from "./evaluation-model";
import { parseQuestionBank, type QuestionEntry } from "./question-navigation";
import { inferCodeLanguage, markdownHtml, sanitizeHtml } from "./markdown";
import { SearchPalette, type PaletteAction } from "./SearchPalette";
import { SettingsModal } from "./SettingsModal";
import { InterviewView, LiveWindow } from "./InterviewView";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const emptyWorkspace: WorkspaceSummary = { path: "", repositoryRoot: "", status: "unconfigured", contextFileCount: 0, jobCount: 0, hasIndex: false, hasCandidateProfile: false, hasBaseResume: false, agyAvailable: false, warnings: [] };
const emptySettings: Settings = { schemaVersion: 1, workspacePath: null, baseResumePath: null, secondaryResumePaths: [], linkedinProfilePath: null, updatedAt: "" };
const LEFT_PANEL_MIN = 190;
const IS_MAC = /mac/i.test(navigator.platform);
const LEFT_PANEL_COLLAPSE_THRESHOLD = 120;
const LEFT_PANEL_MAX = 560;
const RIGHT_PANEL_MIN = 300;
const RIGHT_PANEL_MAX = 900;
const VIEWER_PANEL_MIN = 320;
type PromptRequest = { id: number; text: string; label: string };
type JobWorkspaceTab = "overview" | "application" | "interview" | "files";
type JobLocation = { kind: "job"; jobId: string; tab: JobWorkspaceTab; roundId?: string };
type PageLocation = { kind: "jobs-home" } | { kind: "interviews-home" } | { kind: "context-home" };
type WorkspaceLocation =
  | PageLocation
  | JobLocation
  | { kind: "document"; relativePath: string; jobId: string | null; anchor?: string; returnTo: JobLocation | PageLocation };

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
  if (params.get("interviewWorkspace") === "1" && params.get("live") === "1") return <LiveWindow jobId={params.get("jobId") ?? ""} roundId={params.get("roundId") ?? ""} />;
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
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => storedPanelNumber("sensei-left-panel-width", 260));
  const [rightPanelWidth, setRightPanelWidth] = useState(() => storedPanelNumber("sensei-right-panel-width", 430));
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => storedPanelOpen("sensei-left-panel-state"));
  const [rightPanelOpen, setRightPanelOpen] = useState(() => storedPanelOpen("sensei-right-panel-state"));
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [treeRevealPath, setTreeRevealPath] = useState<string | null>(null);
  const [promptRequest, setPromptRequest] = useState<PromptRequest | null>(null);
  const promptRequestId = useRef(0);
  const [recentJobIds, setRecentJobIds] = useState<string[]>(() => { try { return JSON.parse(window.localStorage.getItem("sensei-recent-jobs") ?? "[]") as string[]; } catch { return []; } });
  useEffect(() => {
    if (!activeJobId) return;
    setRecentJobIds((current) => {
      const next = [activeJobId, ...current.filter((id) => id !== activeJobId)].slice(0, 8);
      try { window.localStorage.setItem("sensei-recent-jobs", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [activeJobId]);
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


  function currentReturnLocation(jobId: string | null): JobLocation | PageLocation {
    const current = navigationHistory[navigationIndex];
    if (current?.kind === "job" || current?.kind === "interviews-home" || current?.kind === "context-home") return current;
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
    pushLocation({ kind: "job", jobId, tab: "overview" });
  }

  function showPage(kind: PageLocation["kind"]) {
    if (editorDirty && !window.confirm("Discard your unsaved Markdown changes?")) return;
    setEditorDirty(false);
    if (currentLocation.kind === kind) return;
    pushLocation({ kind });
  }
  function showJobsHome() { showPage("jobs-home"); }

  function openJobView(jobId: string, tab: JobWorkspaceTab, roundId?: string) {
    const current = navigationHistory[navigationIndex];
    if (current?.kind === "job" && current.jobId === jobId && current.tab === tab && current.roundId === roundId) return;
    pushLocation({ kind: "job", jobId, tab, roundId });
  }

  function insertJobPrompt(action: Pick<JobAction, "prompt" | "label">) {
    promptRequestId.current += 1;
    setRightPanelOpen(true);
    setPromptRequest({ id: promptRequestId.current, text: action.prompt, label: action.label });
  }

  async function updateTracker(jobId: string, update: JobTrackerUpdate) {
    setError(null);
    try {
      const job = jobs.find((candidate) => candidate.id === jobId);
      // The first save keeps the derived status and applied date, so editing a note never resets a job to Saved.
      const seeded: JobTrackerUpdate = job && !job.tracker ? { status: effectiveStatus(job), appliedAt: effectiveAppliedAt(job), ...update } : update;
      const tracker = await window.sensei.jobs.updateTracker(jobId, seeded);
      setJobs((current) => current.map((job) => job.id === jobId ? { ...job, tracker } : job));
    } catch (caught) { setError(messageOf(caught, "Unable to save the job status.")); }
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
    ...(viewedJob ? TRACKER_STATUSES.filter((status) => status !== effectiveStatus(viewedJob)).map((status) => ({
      id: `tracker:${status}`,
      title: `Mark as ${TRACKER_LABELS[status].toLowerCase()}`,
      subtitle: `${viewedJob.company ?? displayJobName(viewedJob.name)}, ${viewedJob.title ?? "this job"}`,
      keywords: `status tracker ${status}`,
      run: () => void updateTracker(viewedJob.id, { status }),
    })) : []),
    ...jobActions.map((action) => ({
      id: `job-action:${action.id}`,
      title: action.label,
      subtitle: `${action.company} · Insert into Command Center`,
      keywords: `${action.group} ${action.prompt}${action.id === "team-panel-interview" ? " final panel executive panel" : ""}`,
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
    {
      id: "open-settings",
      title: "Preferences & Voice Settings",
      subtitle: "Customize tone, resume tailoring, reusable bullets, and identity",
      keywords: "settings preferences tone voice bullets summary",
      run: () => setSettingsModalOpen(true),
    },
  ];
  const recentJobs = recentJobIds.map((id) => jobs.find((job) => job.id === id)).filter((job): job is JobFolderSummary => Boolean(job)).slice(0, 6);
  const interviewingJobs = jobs.filter((job) => job.interviewRoundLabel);
  const followUpsDue = jobs.filter((job) => { const days = followUpDays(job.tracker); return days !== null && days <= 0 && !["rejected", "withdrawn"].includes(effectiveStatus(job)); }).length;
  const activePage = currentLocation.kind === "document" ? currentLocation.returnTo.kind : currentLocation.kind;
  const shellStyle = {
    "--right-panel-width": `${rightPanelOpen ? rightPanelWidth : 0}px`,
    "--right-resizer-width": rightPanelOpen ? "7px" : "0px",
  } as CSSProperties;
  return <main className={`shell ${leftPanelOpen ? "" : "is-sidebar-closed"}`} style={shellStyle}>
    <nav className="app-sidebar" aria-label="Main" aria-hidden={!leftPanelOpen}>
      <button className="wordmark" aria-label="Sensei: all jobs" onClick={showJobsHome}><span className="wordmark-mark" aria-hidden="true">S</span><span>Sensei</span></button>
      <ul className="side-nav">
        <li><button aria-current={activePage === "jobs-home" ? "page" : undefined} onClick={() => showPage("jobs-home")}><NavIcon name="jobs" />Jobs{followUpsDue > 0 && <span className="side-due" title={`${followUpsDue} follow-up${followUpsDue === 1 ? "" : "s"} due`}>{followUpsDue} due</span>}<span className="side-count">{jobs.length}</span></button></li>
        <li><button aria-current={activePage === "interviews-home" ? "page" : undefined} onClick={() => showPage("interviews-home")}><NavIcon name="interviews" />Interviews{interviewingJobs.length > 0 && <span className="side-count">{interviewingJobs.length}</span>}</button></li>
        <li><button aria-current={activePage === "context-home" ? "page" : undefined} onClick={() => showPage("context-home")}><NavIcon name="context" />Career context<span className="side-count">{sourceCount}</span></button></li>
      </ul>
      {recentJobs.length > 0 && <section className="side-recent" aria-labelledby="side-recent-title">
        <h2 id="side-recent-title">Recent jobs</h2>
        <ul>{recentJobs.map((job) => <li key={job.id}><button aria-current={activePage === "job" && viewedJobId === job.id ? "page" : undefined} onClick={() => openJob(job.id)}><strong>{job.company ?? displayJobName(job.name)}</strong><small>{job.title ?? "Role not recorded"}</small></button></li>)}</ul>
      </section>}
      <div className="side-foot">
        <button onClick={() => setSettingsModalOpen(true)} disabled={!configured}><NavIcon name="settings" />Settings</button>
      </div>
    </nav>
    <div className="shell-main">
      <header className="topbar">
        <button className="topbar-icon" aria-label={leftPanelOpen ? "Hide sidebar" : "Show sidebar"} aria-pressed={leftPanelOpen} title={leftPanelOpen ? "Hide sidebar" : "Show sidebar"} onClick={() => setLeftPanelOpen((open) => !open)}><NavIcon name="sidebar" /></button>
        <nav className="history-controls" aria-label="History">
          <button aria-label="Go back" title="Back" disabled={navigationIndex === 0} onClick={() => navigateHistory(-1)}><span aria-hidden="true">‹</span></button>
          <button aria-label="Go forward" title="Forward" disabled={navigationIndex >= navigationHistory.length - 1} onClick={() => navigateHistory(1)}><span aria-hidden="true">›</span></button>
        </nav>
        {configured && <button className="search-trigger" onClick={() => setSearchOpen(true)}><span>Search jobs, files, and actions</span><kbd>{IS_MAC ? "⌘K" : "Ctrl K"}</kbd></button>}
        <span className="topbar-spacer" />
        <button className="topbar-toggle" aria-pressed={rightPanelOpen} title={`Agy terminal. Context: ${activeContextDetail}`} onClick={() => setRightPanelOpen((open) => !open)}><span className={`status-dot ${configured ? "is-ready" : ""}`} aria-hidden="true" />Agy</button>
        <TopbarMenu
          theme={theme}
          onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
          navigationOpen={leftPanelOpen}
          onToggleNavigation={() => setLeftPanelOpen((open) => !open)}
          onRescan={configured ? () => void refresh() : null}
          onOpenSettings={configured ? () => setSettingsModalOpen(true) : null}
          note={configured ? `${workspace.contextFileCount} context files and ${workspace.jobCount} job folders. Everything stays on this computer; career sources are never changed.` : "No workspace selected."}
        />
      </header>
      <SearchPalette open={searchOpen} actions={paletteActions} onClose={() => setSearchOpen(false)} onOpenResult={openSearchResult} />
      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        profile={candidateProfile}
        settings={resumeSettings}
        onProfileUpdated={(updated) => setCandidateProfile(updated)}
        onSettingsUpdated={(updated) => setResumeSettings(updated)}
      />
      <section className="viewer-panel">
        {needsSetup ? <GetStarted workspace={workspace} profile={candidateProfile} settings={resumeSettings} onProfileCreated={async (profile) => { setCandidateProfile(profile); await refresh(); }} onChooseBase={() => void chooseResume("base")} /> : preview ? <>
          <div className="viewer-header"><div><h1>{preview.name}</h1>{preview.jobCompany && <p className="viewer-subtitle">{[preview.jobCompany, preview.jobTitle].filter(Boolean).join(", ")}</p>}</div><div className="viewer-header-actions"><span className={`label ${preview.canPreview ? "source" : "muted"}`}>{preview.fileType.toUpperCase()}</span><button className="btn-quiet" onClick={closeDocument}>Close</button></div></div>
          <DocumentView key={`${preview.relativePath}:${currentLocation.kind === "document" ? currentLocation.anchor ?? "" : ""}`} preview={preview} isBaseResume={preview.relativePath === baseResume} focusAnchor={currentLocation.kind === "document" ? currentLocation.anchor : undefined} onExported={() => void refresh()} onDirtyChange={setEditorDirty} onSaved={markdownSaved} />
        </> : currentLocation.kind === "job" && viewedJob ? <JobWorkspaceDashboard job={viewedJob} status={applicationStatus} applicationLoading={applicationLoading} overview={interviewOverview} interviewLoading={interviewLoading} jobTree={jobTree} jobActions={jobActions} onStatus={setApplicationStatus} onSelect={selectFile} activeTab={currentLocation.tab} activeRoundId={currentLocation.roundId} onNavigate={openJobView} onInsertPrompt={insertJobPrompt} onUpdateTracker={(update) => updateTracker(viewedJob.id, update)} />
          : currentLocation.kind === "interviews-home" ? <InterviewsHome jobs={interviewingJobs} onOpen={(jobId, roundId) => openJobView(jobId, "interview", roundId)} />
          : currentLocation.kind === "context-home" ? <ContextHome>
            <section className="context-block"><h2>Resumes</h2><ResumeSources settings={resumeSettings} selectedPath={selectedPath} onSelect={selectFile} onChoose={chooseResume} onRemoveSecondary={removeSecondary} /></section>
            <section className="context-block"><h2>Career sources</h2><p>Checked files are what Agy reads as facts about you. Structured files are the strongest evidence.</p><div className="context-tree">{tree.length ? tree.map((node) => <TreeNode key={node.relativePath} node={node} selectedPath={selectedPath} baseResume={baseResume} onSelect={selectFile} selectedPaths={selectedCareerPaths} onTogglePath={togglePath} onDelete={deletePath} revealPath={treeRevealPath} />) : <p className="empty-small">No career context folders found.</p>}</div></section>
            <section className="context-block"><h2>Job files in context</h2><p>Add a job's files when you want Agy to use them outside that job, for example an earlier letter that worked well.</p><button className="btn-link" onClick={() => { setSelectedJobFiles([]); void updateContext(selectedCareerPaths, []); }} disabled={!selectedJobFiles.length}>Clear job files ({selectedJobFiles.length})</button><div className="context-tree">{jobTree.length ? jobTree.map((node) => <TreeNode key={node.relativePath} node={node} selectedPath={selectedPath} baseResume={baseResume} onSelect={selectFile} selectedPaths={selectedJobFiles} onTogglePath={togglePath} onDelete={deletePath} revealPath={treeRevealPath} />) : <p className="empty-small">No job folders yet.</p>}</div></section>
          </ContextHome>
          : <JobsHome jobs={jobs} onOpenJob={openJob} onOpenJobView={openJobView} onOpenEvaluation={(jobId) => void selectFile(`jobs/${jobId}/evaluation.md`)} onMoveToTrash={(jobId) => deletePath(`jobs/${jobId}`)} onUpdateTracker={updateTracker} />}
        {loading && <div className="viewer-state">Reading local workspace…</div>}
        {error && <p className="error-copy viewer-error">{error}</p>}
      </section>
    </div>
    <div className={`panel-resizer is-right ${rightPanelOpen ? "" : "is-collapsed"}`} role="separator" aria-label="Resize terminal panel" aria-orientation="vertical" aria-valuemin={RIGHT_PANEL_MIN} aria-valuemax={panelMaximum("right")} aria-valuenow={rightPanelWidth} tabIndex={rightPanelOpen ? 0 : -1} onPointerDown={(event) => beginPanelResize("right", event)} onKeyDown={(event) => resizePanelWithKeyboard("right", event)} />
    <TerminalPanel cwd={workspace.repositoryRoot || workspace.path} selectedJobFiles={selectedJobFiles} selectedCareerPaths={selectedCareerPaths} theme={theme} visible={rightPanelOpen && !needsSetup} onClose={() => setRightPanelOpen(false)} jobActions={jobActions} promptRequest={promptRequest} onPromptHandled={(id) => setPromptRequest((request) => request?.id === id ? null : request)} onInsertPrompt={insertJobPrompt} />
  </main>;
}

function NavIcon({ name }: { name: "jobs" | "interviews" | "context" | "settings" | "sidebar" }) {
  const paths: Record<typeof name, string> = {
    jobs: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
    interviews: "M5 5h14v10H9l-4 4z M8.5 9.5h7 M8.5 12h4",
    context: "M5 4h10l4 4v12H5z M15 4v4h4 M8 12h8 M8 16h6",
    settings: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1",
    sidebar: "M4 5h16v14H4z M9 5v14",
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Settings menu in the top bar: theme, navigation, rescan, and Settings. Keyboard: arrows move, Escape closes. */
function TopbarMenu({ theme, onToggleTheme, navigationOpen, onToggleNavigation, onRescan, onOpenSettings, note }: { theme: "dark" | "light"; onToggleTheme: () => void; navigationOpen: boolean; onToggleNavigation: () => void; onRescan: (() => void) | null; onOpenSettings: (() => void) | null; note: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = [
    { label: theme === "dark" ? "Use light theme" : "Use dark theme", run: onToggleTheme },
    { label: navigationOpen ? "Hide sidebar" : "Show sidebar", run: onToggleNavigation },
    ...(onRescan ? [{ label: "Rescan workspace", run: onRescan }] : []),
    ...(onOpenSettings ? [{ label: "Settings…", run: onOpenSettings }] : []),
  ];
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const close = (event: globalThis.MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }
  return <div className="topbar-menu" ref={rootRef} onKeyDown={onKeyDown}>
    <button ref={triggerRef} className="topbar-menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label="Settings menu" title="Settings menu" onClick={() => setOpen((value) => !value)}><span aria-hidden="true">⚙</span></button>
    {open && <div className="topbar-menu-list" role="menu" aria-label="Settings menu">
      {items.map((item) => <button key={item.label} role="menuitem" onClick={() => { setOpen(false); item.run(); }}>{item.label}</button>)}
      <p className="topbar-menu-note">{note}</p>
    </div>}
  </div>;
}

function GetStarted({ workspace, profile, settings, onProfileCreated, onChooseBase }: { workspace: WorkspaceSummary; profile: CandidateProfile | null; settings: Settings; onProfileCreated: (profile: CandidateProfile) => Promise<void>; onChooseBase: () => void }) {
  const [fullName, setFullName] = useState("");
  const [artifactPrefix, setArtifactPrefix] = useState("");
  const [turningPoints, setTurningPoints] = useState("");
  const [workingStyle, setWorkingStyle] = useState("");
  const [personalValues, setPersonalValues] = useState("");
  const [transitionSummary, setTransitionSummary] = useState("");
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
      const narrativePillars = (turningPoints.trim() || workingStyle.trim() || personalValues.trim())
        ? {
            turningPoints: turningPoints.trim(),
            workingStyle: workingStyle.trim(),
            personalValues: personalValues.trim(),
          }
        : undefined;
      const next = await window.sensei.profile.create({ fullName, artifactPrefix, narrativePillars, transitionSummary: transitionSummary.trim() || undefined });
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
    ["Agy terminal", workspace.agyAvailable, workspace.agyAvailable ? "Agy ready (offline bundled or installed)" : "Install Agy or add it to PATH"],
  ] as const;
  return <section className="get-started">
    <div className="get-started-copy"><span className="eyebrow">Private local setup</span><h1>Get JobSensei ready</h1><p>Your workspace stays in <code>data/</code>. Resume and context files are never committed by the public repository.</p></div>
    <div className="get-started-grid">
      <ol>{steps.map(([label, complete, detail], index) => <li className={complete ? "is-complete" : ""} key={label}><span>{complete ? "✓" : index + 1}</span><div><strong>{label}</strong><small>{detail}</small></div></li>)}</ol>
      <div className="setup-card">
        {!profile ? <>
          <h2>Create your candidate profile</h2>
          <p>This stores identity and preferences locally. Career claims continue to come from your selected context files.</p>
          <label>Full name<input value={fullName} onChange={(event) => updateName(event.target.value)} placeholder="Alex Morgan" /></label>
          <label>Artifact prefix<input value={artifactPrefix} onChange={(event) => setArtifactPrefix(event.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} placeholder="Alex_Morgan" /></label>
          <details className="setup-story-accordion">
            <summary>Career Story & Narrative Pillars (Optional)</summary>
            <p className="setup-story-hint">
              Answer these 3 questions now or edit them anytime in Settings. JobSensei uses them so your cover letters reflect your authentic journey instead of repeating the job description.
            </p>
            <label>
              Career direction
              <textarea
                rows={2}
                placeholder="One or two sentences: where your career has been and where you're heading."
                value={transitionSummary}
                onChange={(e) => setTransitionSummary(e.target.value)}
              />
            </label>
            <label>
              1. Career Transitions & Pivots
              <textarea
                rows={2}
                placeholder="Why did you make key career moves or step outside your comfort zone? What drives you?"
                value={turningPoints}
                onChange={(e) => setTurningPoints(e.target.value)}
              />
            </label>
            <label>
              2. Operating Style & Problem Ownership
              <textarea
                rows={2}
                placeholder="How do you handle client friction or technical problems? (e.g., take full ownership, understand their shoes, work it out directly)"
                value={workingStyle}
                onChange={(e) => setWorkingStyle(e.target.value)}
              />
            </label>
            <label>
              3. Fit as a Person & Core Values
              <textarea
                rows={2}
                placeholder="Who are you as a person beyond daily task descriptions?"
                value={personalValues}
                onChange={(e) => setPersonalValues(e.target.value)}
              />
            </label>
          </details>
          <button disabled={!fullName.trim() || !artifactPrefix.trim() || state === "saving"} onClick={() => void createProfile()}>{state === "saving" ? "Creating…" : "Create local profile"}</button>
        </> : !workspace.hasBaseResume ? <><h2>Select a base resume</h2><p>The base resume protects identity, chronology, section order, and presentation. Career context remains the factual authority.</p><button onClick={onChooseBase}>Choose base resume</button></> : <><h2>Setup complete</h2><p>Open the Command Center and run Agy from the repository root. Your active workspace remains <code>data/</code>.</p></>}
        {message && <p className="inline-error" role="alert">{message}</p>}
      </div>
    </div>
  </section>;
}

type JobsFilter = "all" | "active" | "interviewing" | "follow-up" | "review" | "favorites";
type JobsView = "list" | "board" | "cards";
const ACTIVE_STATUSES: TrackerStatus[] = ["saved", "applied", "interviewing", "offer"];

function JobsHome({ jobs, onOpenJob, onOpenJobView, onOpenEvaluation, onMoveToTrash, onUpdateTracker }: { jobs: JobFolderSummary[]; onOpenJob: (jobId: string) => void; onOpenJobView: (jobId: string, tab: JobWorkspaceTab, roundId?: string) => void; onOpenEvaluation: (jobId: string) => void; onMoveToTrash: (jobId: string) => void; onUpdateTracker: (jobId: string, update: JobTrackerUpdate) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<JobsFilter>("all");
  const [favorites, setFavorites] = useState<Set<string>>(storedFavoriteJobIds);
  const [sort, setSort] = useState<"added" | "company" | "role" | "follow-up" | "fit">(() => {
    const stored = window.localStorage.getItem("sensei-jobs-sort");
    return ["added", "company", "role", "follow-up", "fit"].includes(stored ?? "") ? stored as "added" : "added";
  });
  const [view, setView] = useState<JobsView>(() => {
    const stored = window.localStorage.getItem("sensei-jobs-view");
    return stored === "cards" || stored === "board" ? stored : "list";
  });
  useEffect(() => { window.localStorage.setItem("sensei-jobs-view", view); }, [view]);
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
  const matches = (job: JobFolderSummary, value: JobsFilter) => {
    const status = effectiveStatus(job);
    const due = followUpDays(job.tracker);
    return value === "all"
      || (value === "active" && ACTIVE_STATUSES.includes(status))
      || (value === "interviewing" && (status === "interviewing" || Boolean(job.interviewRoundLabel) && ACTIVE_STATUSES.includes(status)))
      || (value === "follow-up" && due !== null && due <= 0 && ACTIVE_STATUSES.includes(status))
      || (value === "review" && /review|pending|stale|invalid/.test(job.applicationStage?.toLowerCase() ?? ""))
      || (value === "favorites" && favorites.has(job.id));
  };
  const filterCounts = Object.fromEntries((["all", "active", "interviewing", "follow-up", "review", "favorites"] as JobsFilter[]).map((value) => [value, jobs.filter((job) => matches(job, value)).length])) as Record<JobsFilter, number>;
  const visibleJobs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const text = (value: string | null | undefined, fallback: string) => (value ?? fallback).toLowerCase();
    return jobs
      .filter((job) => matches(job, filter) && (!normalized || `${job.company ?? ""} ${job.title ?? ""} ${job.name} ${job.location ?? ""} ${effectiveStatus(job)} ${job.interviewRoundLabel ?? ""} ${job.tracker?.notes ?? ""}`.toLowerCase().includes(normalized)))
      .sort((a, b) => {
        if (sort === "company") return text(a.company, displayJobName(a.name)).localeCompare(text(b.company, displayJobName(b.name)));
        if (sort === "role") return text(a.title, "").localeCompare(text(b.title, ""));
        if (sort === "fit") return (b.rating ?? -1) - (a.rating ?? -1);
        if (sort === "follow-up") return (followUpDays(a.tracker) ?? 9999) - (followUpDays(b.tracker) ?? 9999);
        return Date.parse(b.createdAt) - Date.parse(a.createdAt) || text(a.company, displayJobName(a.name)).localeCompare(text(b.company, displayJobName(b.name)));
      });
  }, [jobs, query, filter, sort, favorites]);
  const menuHandlers = (job: JobFolderSummary): JobMenuHandlers => ({ onOpen: () => onOpenJob(job.id), onOpenEvaluation: () => onOpenEvaluation(job.id), onOpenInterview: job.interviewRoundLabel ? () => onOpenJobView(job.id, "interview") : null, onMoveToTrash: () => onMoveToTrash(job.id) });
  const filterLabels: Record<JobsFilter, string> = { all: "All", active: "Active", interviewing: "Interviewing", "follow-up": "Follow-up due", review: "Needs review", favorites: "Favorites" };
  return <section className={`jobs-home ${view === "board" ? "is-board" : ""}`}>
    <header className="page-head"><div><h1>Jobs</h1><p>{visibleJobs.length === jobs.length ? `${jobs.length} job${jobs.length === 1 ? "" : "s"}` : `${visibleJobs.length} of ${jobs.length} jobs shown`}. {view === "board" ? "Drag a card to change its status, or use the status menu on the card." : "Open one to see its application and interview prep."}</p></div></header>
    <div className="jobs-toolbar">
      <label className="workspace-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, role, location, or notes…" aria-label="Search jobs" /></label>
      <div className="segmented" role="group" aria-label="Filter jobs">{(Object.keys(filterLabels) as JobsFilter[]).filter((value) => value === "all" || filterCounts[value] > 0 || filter === value).map((value) => <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value)}>{filterLabels[value]}<span>{filterCounts[value]}</span></button>)}</div>
      <label className="jobs-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort jobs"><option value="added">Recently added</option><option value="follow-up">Follow-up date</option><option value="fit">Best fit</option><option value="company">Company A-Z</option><option value="role">Role A-Z</option></select></label>
      <div className="segmented" role="group" aria-label="Layout">{(["list", "board", "cards"] as JobsView[]).map((value) => <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
    </div>
    {!visibleJobs.length ? <div className="dashboard-empty"><h2>No jobs match this view</h2><p>Clear the search or pick another filter.</p></div>
      : view === "board" ? <JobsBoard jobs={visibleJobs} onOpenJob={onOpenJob} onUpdateTracker={onUpdateTracker} menuHandlers={menuHandlers} />
      : view === "cards" ? <div className="job-card-grid">{visibleJobs.map((job) => <JobCard key={job.id} job={job} favorite={favorites.has(job.id)} onToggleFavorite={() => toggleFavorite(job.id)} onOpen={() => onOpenJob(job.id)} onOpenView={(tab) => onOpenJobView(job.id, tab)} onOpenEvaluation={() => onOpenEvaluation(job.id)} onMoveToTrash={() => onMoveToTrash(job.id)} />)}</div>
      : <div className="jobs-table-wrap"><table className="jobs-table"><thead><tr><th scope="col">Role</th><th scope="col">Fit</th><th scope="col">Status</th><th scope="col">Interview</th><th scope="col">Next</th><th scope="col">Added</th><th scope="col"><span className="sr-only">Favorite and actions</span></th></tr></thead><tbody>{visibleJobs.map((job) => <tr key={job.id} tabIndex={0} onClick={() => onOpenJob(job.id)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpenJob(job.id); } }}><td className="jobs-role"><strong>{job.company ?? displayJobName(job.name)}</strong><span>{job.title ?? "Role not recorded"}</span></td><td><FitBadge rating={job.rating} /></td><td><TrackerPill status={effectiveStatus(job)} /></td><td>{job.interviewRoundLabel ? <button className="btn-link" onClick={(event) => { event.stopPropagation(); onOpenJobView(job.id, "interview"); }}>{job.interviewRoundLabel}</button> : <span className="muted">None</span>}</td><td><NextBadge job={job} /></td><td className="tabular muted">{formatJobDate(job.createdAt)}</td><td><button className={`job-favorite ${favorites.has(job.id) ? "is-favorite" : ""}`} aria-pressed={favorites.has(job.id)} aria-label={`Favorite ${job.company ?? displayJobName(job.name)}, ${job.title ?? "role"}`} onClick={(event) => { event.stopPropagation(); toggleFavorite(job.id); }}>{favorites.has(job.id) ? "★" : "☆"}</button><JobMenuButton job={job} handlers={menuHandlers(job)} /></td></tr>)}</tbody></table></div>}
  </section>;
}

function TrackerPill({ status }: { status: TrackerStatus }) {
  return <span className={`tracker-pill is-${status}`}>{TRACKER_LABELS[status]}</span>;
}

/** Follow-up due, or the applied date, in plain words. */
function NextBadge({ job, quiet = false, due = false }: { job: JobFolderSummary; quiet?: boolean; due?: boolean }) {
  const days = followUpDays(job.tracker);
  const status = effectiveStatus(job);
  if (days !== null && ACTIVE_STATUSES.includes(status)) {
    const label = days < 0 ? `Follow up, ${-days} day${days === -1 ? "" : "s"} late` : days === 0 ? "Follow up today" : `Follow up in ${days} day${days === 1 ? "" : "s"}`;
    return <span className={`next-badge ${days <= 0 ? "is-due" : ""}`}>{label}</span>;
  }
  const appliedAt = effectiveAppliedAt(job);
  if (due) return null;
  if (appliedAt) return <span className="muted">Applied {formatTrackerDate(appliedAt)}</span>;
  return quiet ? null : <span className="muted">—</span>;
}

function formatTrackerDate(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const BOARD_COLUMNS: Array<{ id: string; label: string; statuses: TrackerStatus[]; drop: TrackerStatus }> = [
  { id: "saved", label: "Saved", statuses: ["saved"], drop: "saved" },
  { id: "applied", label: "Applied", statuses: ["applied"], drop: "applied" },
  { id: "interviewing", label: "Interviewing", statuses: ["interviewing"], drop: "interviewing" },
  { id: "offer", label: "Offer", statuses: ["offer"], drop: "offer" },
  { id: "closed", label: "Closed", statuses: ["rejected", "withdrawn"], drop: "rejected" },
];
const BOARD_PAGE = 8;

function JobsBoard({ jobs, onOpenJob, onUpdateTracker, menuHandlers }: { jobs: JobFolderSummary[]; onOpenJob: (jobId: string) => void; onUpdateTracker: (jobId: string, update: JobTrackerUpdate) => Promise<void>; menuHandlers: (job: JobFolderSummary) => JobMenuHandlers }) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  async function move(jobId: string, status: TrackerStatus) {
    setBusy(jobId);
    try { await onUpdateTracker(jobId, { status }); } finally { setBusy(null); }
  }
  // Due follow-ups first, then most recently added.
  const order = (a: JobFolderSummary, b: JobFolderSummary) => (followUpDays(a.tracker) ?? 9999) - (followUpDays(b.tracker) ?? 9999) || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return <div className="board" aria-label="Jobs by status">
    {BOARD_COLUMNS.map((column) => {
      const items = jobs.filter((job) => column.statuses.includes(effectiveStatus(job))).sort(order);
      const shown = expanded.has(column.id) ? items : items.slice(0, BOARD_PAGE);
      return <section key={column.id} className={`board-col is-${column.id} ${dragOver === column.id ? "is-over" : ""}`} aria-labelledby={`board-${column.id}`}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOver(column.id); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(null); }}
        onDrop={(event) => { event.preventDefault(); setDragOver(null); const jobId = event.dataTransfer.getData("text/sensei-job"); if (jobId) void move(jobId, column.drop); }}>
        <h2 id={`board-${column.id}`}><span>{column.label}</span><span>{items.length}</span></h2>
        <ul>{shown.map((job) => { const status = effectiveStatus(job); return <li key={job.id} className={`board-card ${busy === job.id ? "is-busy" : ""}`} draggable onDragStart={(event) => { event.dataTransfer.setData("text/sensei-job", job.id); event.dataTransfer.effectAllowed = "move"; }}>
          <button className="board-card-open" onClick={() => onOpenJob(job.id)}><strong>{job.company ?? displayJobName(job.name)}</strong><span>{job.title ?? "Role not recorded"}</span></button>
          <div className="board-card-meta"><FitBadge rating={job.rating} />{status === "withdrawn" && <TrackerPill status={status} />}<NextBadge job={job} quiet due /><label className="board-card-move"><span className="sr-only">Status for {job.company ?? displayJobName(job.name)}, {job.title ?? "role"}</span><select value={status} disabled={busy === job.id} onChange={(event) => void move(job.id, event.target.value as TrackerStatus)}>{TRACKER_STATUSES.map((value) => <option key={value} value={value}>{TRACKER_LABELS[value]}</option>)}</select></label><JobMenuButton job={job} handlers={menuHandlers(job)} /></div>
        </li>; })}</ul>
        {items.length > BOARD_PAGE && <button className="btn-link board-more" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(column.id)) next.delete(column.id); else next.add(column.id); return next; })}>{expanded.has(column.id) ? "Show fewer" : `Show ${items.length - BOARD_PAGE} more`}</button>}
        {!items.length && <p className="board-empty">Drop a job here</p>}
      </section>;
    })}
  </div>;
}

type JobMenuHandlers = { onOpen: () => void; onOpenEvaluation: () => void; onOpenInterview: (() => void) | null; onMoveToTrash: () => void };

/** The job actions menu, shared by the ⋯ button and right-click. Arrow keys move, Escape closes. */
function JobMenu({ job, at, handlers, onClose }: { job: JobFolderSummary; at: { x: number; y: number }; handlers: JobMenuHandlers; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: globalThis.MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", onClose);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("blur", onClose); };
  }, []);
  const run = (action: () => void) => { onClose(); action(); };
  return createPortal(<div ref={ref} role="menu" aria-label={`Actions for ${job.company ?? displayJobName(job.name)}`} className="tree-context-menu job-card-menu" style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 240)), top: Math.max(8, Math.min(at.y, window.innerHeight - 280)) }}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }}>
    <button role="menuitem" onClick={() => run(handlers.onOpen)}>Open job</button>
    <button role="menuitem" onClick={() => run(handlers.onOpenEvaluation)}>Open evaluation</button>
    {handlers.onOpenInterview && <button role="menuitem" onClick={() => run(handlers.onOpenInterview!)}>Open interview prep</button>}
    <button role="menuitem" onClick={() => run(() => void window.sensei.app.copyText(job.relativePath))}>Copy folder path</button>
    <button role="menuitem" onClick={() => run(() => void window.sensei.files.reveal(job.relativePath))}>Show in file manager</button>
    <button role="menuitem" className="is-destructive" onClick={() => run(handlers.onMoveToTrash)}>Move job to Trash</button>
  </div>, document.body);
}

function JobMenuButton({ job, handlers }: { job: JobFolderSummary; handlers: JobMenuHandlers }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={buttonRef} className="job-more" aria-haspopup="menu" aria-expanded={Boolean(at)} aria-label={`More actions for ${job.company ?? displayJobName(job.name)}, ${job.title ?? "role"}`} title="More actions"
      onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setAt(at ? null : { x: rect.right - 220, y: rect.bottom + 4 }); }}
      onKeyDown={(event) => event.stopPropagation()}><span aria-hidden="true">⋯</span></button>
    {at && <JobMenu job={job} at={at} handlers={handlers} onClose={() => { setAt(null); buttonRef.current?.focus(); }} />}
  </>;
}

function JobCard({ job, favorite, onToggleFavorite, onOpen, onOpenView, onOpenEvaluation, onMoveToTrash }: { job: JobFolderSummary; favorite: boolean; onToggleFavorite: () => void; onOpen: () => void; onOpenView: (tab: JobWorkspaceTab) => void; onOpenEvaluation: () => void; onMoveToTrash: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const initials = (job.company ?? displayJobName(job.name)).split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  const handlers: JobMenuHandlers = { onOpen, onOpenEvaluation, onOpenInterview: job.interviewRoundLabel ? () => onOpenView("interview") : null, onMoveToTrash };
  return <article className="job-card" onClick={onOpen} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); }}><div className="job-card-heading"><span className="company-mark">{initials || "J"}</span><div><h2>{job.company ?? displayJobName(job.name)}</h2><p>{job.title ?? "Role not recorded"}</p></div><span className="job-card-badges"><FitBadge rating={job.rating} /><JobMenuButton job={job} handlers={handlers} /></span></div><dl><div><dt>Status</dt><dd><TrackerPill status={effectiveStatus(job)} /></dd></div><div><dt>Interview</dt><dd>{job.interviewRoundLabel ?? "Not prepared"}</dd></div><div><dt>Added</dt><dd className="job-card-added"><span>{formatJobDate(job.createdAt)}</span><button className={`job-favorite ${favorite ? "is-favorite" : ""}`} aria-label={`${favorite ? "Remove" : "Add"} ${job.company ?? displayJobName(job.name)} ${favorite ? "from" : "to"} favorites`} aria-pressed={favorite} title={favorite ? "Remove from favorites" : "Add to favorites"} onClick={(event) => { event.stopPropagation(); onToggleFavorite(); }}>{favorite ? "★" : "☆"}</button></dd></div></dl><button onClick={(event) => { event.stopPropagation(); onOpen(); }}>Open job</button>{menu && <JobMenu job={job} at={menu} handlers={handlers} onClose={() => setMenu(null)} />}</article>;
}

function StatusPill({ value }: { value: string }) {
  const spaced = value.replaceAll("_", " ");
  const normalized = spaced.charAt(0).toUpperCase() + spaced.slice(1);
  const tone = /interview|ready|validated|applied/i.test(value) ? "positive" : /review|pending|stale|invalid/i.test(value) ? "warning" : "neutral";
  return <span className={`status-pill is-${tone}`}>{normalized}</span>;
}

function FitBadge({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="fit-badge is-none">—</span>;
  const tone = rating >= 4 ? "high" : rating >= 3.5 ? "mid" : "low";
  return <span className={`fit-badge is-${tone}`} title={`${rating.toFixed(1)} of 5 fit`}><span className="tabular">{rating.toFixed(1)}</span></span>;
}

function TrackerPanel({ job, onUpdate }: { job: JobFolderSummary; onUpdate: (update: JobTrackerUpdate) => Promise<void> }) {
  const tracker = job.tracker;
  const [notes, setNotes] = useState(tracker?.notes ?? "");
  useEffect(() => { setNotes(tracker?.notes ?? ""); }, [job.id, tracker?.notes]);
  const history = [...(tracker?.history ?? [])].reverse().slice(0, 4);
  return <section className="overview-panel tracker-panel">
    <h2>Tracking</h2>
    <div className="tracker-dates">
      <label><span>Applied</span><input type="date" value={effectiveAppliedAt(job) ?? ""} onChange={(event) => void onUpdate({ appliedAt: event.target.value || null })} /></label>
      <label><span>Follow up on</span><input type="date" value={tracker?.nextFollowUpAt ?? ""} onChange={(event) => void onUpdate({ nextFollowUpAt: event.target.value || null })} /></label>
    </div>
    <NextBadge job={job} />
    <label className="tracker-notes"><span>Notes</span><textarea rows={3} value={notes} placeholder="Recruiter name, referral, what they said…" onChange={(event) => setNotes(event.target.value)} onBlur={() => { if (notes !== (tracker?.notes ?? "")) void onUpdate({ notes }); }} /></label>
    {history.length > 0 && <ol className="tracker-history" aria-label="Status history">{history.map((event) => <li key={event.at}><TrackerPill status={event.status} /><span className="muted">{new Date(event.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></li>)}</ol>}
  </section>;
}

function InterviewsHome({ jobs, onOpen }: { jobs: JobFolderSummary[]; onOpen: (jobId: string, roundId?: string) => void }) {
  const [overviews, setOverviews] = useState<Record<string, InterviewOverview | null>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(jobs.map(async (job) => [job.id, await window.sensei.interviews.getOverview(job.id).catch(() => null)] as const))
      .then((entries) => { if (!cancelled) setOverviews(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [jobs]);
  const rows = jobs.map((job) => {
    const overview = overviews[job.id];
    const round = overview?.rounds.find((candidate) => candidate.id === overview.currentRoundId) ?? overview?.rounds.at(-1) ?? null;
    return { job, overview, round };
  }).sort((a, b) => Number(["rejected", "withdrawn"].includes(effectiveStatus(a.job))) - Number(["rejected", "withdrawn"].includes(effectiveStatus(b.job))) || (a.round?.scheduledDate ?? "9999").localeCompare(b.round?.scheduledDate ?? "9999") || Date.parse(b.job.modifiedAt) - Date.parse(a.job.modifiedAt));
  return <section className="jobs-home">
    <header className="page-head"><div><h1>Interviews</h1><p>{jobs.length ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} with interview prep. Open one to practice its current round.` : "No interview prep yet. Open a job and prepare its first round when you get the call."}</p></div></header>
    {rows.length > 0 && <ul className="interview-rows">{rows.map(({ job, overview, round }) => <li key={job.id} className={["rejected", "withdrawn"].includes(effectiveStatus(job)) ? "is-closed" : ""}>
      <button className="interview-row" onClick={() => onOpen(job.id, round?.id)}>
        <span className="interview-row-main"><strong>{job.company ?? displayJobName(job.name)}</strong><span>{job.title ?? "Role not recorded"}</span></span>
        <TrackerPill status={effectiveStatus(job)} />
        <span className="interview-row-round"><strong>{round?.label ?? job.interviewRoundLabel}</strong><span>{round ? (round.scheduledDate ?? (round.status === "prep_ready" ? "Prep ready" : round.status.replace("_", " "))) : "Loading…"}</span></span>
        <span className="interview-row-steps" aria-label={`${overview?.rounds.length ?? 0} rounds`}>{(overview?.rounds ?? []).map((candidate) => <i key={candidate.id} className={`is-${candidate.status} ${candidate.id === round?.id ? "is-current" : ""}`} />)}</span>
      </button>
    </li>)}</ul>}
  </section>;
}

function ContextHome({ children }: { children: React.ReactNode }) {
  return <section className="jobs-home context-home">
    <header className="page-head"><div><h1>Career context</h1><p>The sources Agy treats as facts about you. Source files are only read, never changed.</p></div></header>
    {children}
  </section>;
}

function JobWorkspaceDashboard({ job, status, applicationLoading, overview, interviewLoading, jobTree, jobActions, onStatus, onSelect, activeTab, activeRoundId, onNavigate, onInsertPrompt, onUpdateTracker }: { job: JobFolderSummary; status: ApplicationStatus | null; applicationLoading: boolean; overview: InterviewOverview | null; interviewLoading: boolean; jobTree: FileTreeNode[]; jobActions: JobAction[]; onStatus: (status: ApplicationStatus) => void; onSelect: (path: string, anchor?: string) => void; activeTab: JobWorkspaceTab; activeRoundId?: string; onNavigate: (jobId: string, tab: JobWorkspaceTab, roundId?: string) => void; onInsertPrompt: (action: Pick<JobAction, "prompt" | "label">) => void; onUpdateTracker: (update: JobTrackerUpdate) => Promise<void> }) {
  const trackerStatus = effectiveStatus(job);
  const files = useMemo(() => {
    const root = findNode(jobTree, `jobs/${job.id}`);
    return root ? fileNodes([root]).filter((node) => !node.relativePath.includes("/.sensei/")) : [];
  }, [jobTree, job.id]);
  const applicationFiles = files.filter((file) => /evaluation|resume|cover_letter|original_jd/i.test(file.name));
  const resumeMarkdown = files.find((file) => /_Resume\.md$/i.test(file.name)) ?? files.find((file) => /resume\.md$/i.test(file.name));
  const coverLetterMarkdown = files.find((file) => file.name.toLowerCase() === "cover_letter.md");
  const evaluation = files.find((file) => file.name.toLowerCase() === "evaluation.md");
  const jobDescription = files.find((file) => /^original_jd\./i.test(file.name));
  const rounds = overview?.rounds ?? [];
  const [next, ...more] = jobActions;
  function navigateRound(roundId: string) {
    void window.sensei.interviews.setCurrentRound(job.id, roundId).catch(() => undefined);
    onNavigate(job.id, "interview", roundId);
  }
  const tabs: Array<[JobWorkspaceTab, string, number | null]> = [["overview", "Overview", null], ["application", "Application", null], ["interview", "Interview", rounds.length || null], ["files", "Files", files.length]];
  const documents: Array<[string, FileTreeNode | undefined]> = [["Job description", jobDescription], ["Evaluation", evaluation], ["Resume", resumeMarkdown], ["Cover letter", coverLetterMarkdown]];
  return <section className="job-page">
    <header className="job-head">
      <div className="job-head-text">
        <p className="job-head-company">{job.company ?? displayJobName(job.name)}</p>
        <h1>{job.title ?? "Role not recorded"}</h1>
        <div className="job-head-meta">
          <label className={`tracker-select is-${trackerStatus}`}><span className="sr-only">Application status</span><select value={trackerStatus} onChange={(event) => void onUpdateTracker({ status: event.target.value as TrackerStatus })}>{TRACKER_STATUSES.map((value) => <option key={value} value={value}>{TRACKER_LABELS[value]}</option>)}</select></label>
          {job.applicationStage && <StatusPill value={job.applicationStage} />}
          {job.rating !== null && <span><strong className="tabular">{job.rating.toFixed(1)}</strong> of 5 fit</span>}
          {job.location && <span>{job.location}</span>}
          <span>Added {formatJobDate(job.createdAt)}</span>
        </div>
      </div>
      <div className="job-head-actions"><JobPdfExportButton resumePath={resumeMarkdown?.relativePath ?? null} coverLetterPath={coverLetterMarkdown?.relativePath ?? null} /></div>
    </header>
    <nav className="workspace-tabs" role="tablist" aria-label="Job sections">{tabs.map(([value, label, count]) => <button key={value} role="tab" aria-selected={activeTab === value} className={activeTab === value ? "is-active" : ""} onClick={() => onNavigate(job.id, value, value === "interview" ? activeRoundId : undefined)}>{label}{count !== null && <span>{count}</span>}</button>)}</nav>
    {activeTab === "overview" && <div className="job-overview">
      {next && <section className="next-step" aria-labelledby="next-step-title">
        <div><p className="next-step-label" id="next-step-title">Next step</p><h2>{next.label}</h2><p>Sends this request to Agy for {job.company ?? displayJobName(job.name)}, {job.title ?? "this job"}.</p></div>
        <div className="next-step-actions"><button className="btn-primary" onClick={() => onInsertPrompt(next)}>Send to Agy</button>{more.slice(0, 3).map((action) => <button key={action.id} className="btn-quiet" onClick={() => onInsertPrompt(action)}>{action.label}</button>)}</div>
      </section>}
      <div className="overview-grid">
        <section className="overview-panel">
          <h2>Fit</h2>
          {job.rating === null ? <p className="muted">Not rated yet. Ask Agy to evaluate this job.</p> : <>
            <p className="fit-score"><strong className="tabular">{job.rating.toFixed(1)}</strong> of 5{job.ratingDecision ? `, ${job.ratingDecision}` : ""}</p>
            <div className="fit-bar" aria-hidden="true"><span style={{ width: `${(job.rating / 5) * 100}%` }} /></div>
            {job.ratingHighlights.length > 0 && <><h3>Strengths</h3><ul className="tick-list is-good">{job.ratingHighlights.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul></>}
            {job.ratingGaps.some((item) => !/^none\b/i.test(item)) && <><h3>Gaps</h3><ul className="tick-list is-gap">{job.ratingGaps.filter((item) => !/^none\b/i.test(item)).slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul></>}
            {evaluation && <button className="btn-link" onClick={() => onSelect(evaluation.relativePath)}>Read the full evaluation</button>}
          </>}
        </section>
        <TrackerPanel job={job} onUpdate={onUpdateTracker} />
        <section className="overview-panel">
          <h2>Documents</h2>
          <ul className="doc-list">{documents.map(([label, file]) => <li key={label}>{file ? <button className="btn-link" onClick={() => onSelect(file.relativePath)}>{label}</button> : <span className="muted">{label}</span>}<span className={file ? "doc-state is-ready" : "doc-state"}>{file ? "Ready" : "Not yet"}</span></li>)}</ul>
          <button className="btn-link" onClick={() => onNavigate(job.id, "application")}>Check the application</button>
        </section>
        <section className="overview-panel">
          <h2>Interviews</h2>
          {interviewLoading ? <p className="muted">Reading rounds…</p> : rounds.length ? <ol className="round-list">{rounds.map((round) => <li key={round.id}><button className="btn-link" onClick={() => navigateRound(round.id)}>{round.label}</button><span className={`round-state is-${round.status}`}>{round.scheduledDate ?? round.status.replace("_", " ")}</span></li>)}</ol> : <p className="muted">No rounds yet. When you get an interview, prepare it from the Interview tab.</p>}
        </section>
      </div>
    </div>}
    {activeTab === "application" && <div className="dashboard-stack"><ApplicationHealth job={job} files={applicationFiles} status={status} loading={applicationLoading} onStatus={onStatus} /><section className="context-block"><h2>Application files</h2><ArtifactTable files={applicationFiles} onSelect={onSelect} empty="No application documents found." /></section></div>}
    {activeTab === "interview" && <InterviewView job={job} overview={overview} loading={interviewLoading} initialRoundId={activeRoundId} onRoundChange={navigateRound} onOpenFile={(path) => onSelect(path)} onInsertPrompt={(text, label) => onInsertPrompt({ prompt: text, label })} />}
    {activeTab === "files" && <section className="context-block"><h2>All files</h2><ArtifactTable files={files} onSelect={onSelect} empty="This job folder is empty." /></section>}
  </section>;
}

function JobPdfExportButton({ resumePath, coverLetterPath }: { resumePath: string | null; coverLetterPath: string | null }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [textSize, setTextSize] = useState<PdfTextSize>(DEFAULT_PDF_TEXT_SIZE);
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




function ArtifactTable({ files, onSelect, empty }: { files: FileTreeNode[]; onSelect: (path: string) => void; empty: string }) {
  if (!files.length) return <p className="dashboard-empty-copy">{empty}</p>;
  return <div className="artifact-table" role="table" aria-label="Workspace files"><div className="artifact-table-row is-heading" role="row"><span role="columnheader">Document</span><span role="columnheader">Type</span><span role="columnheader">Updated</span><span /></div>{files.map((file) => <button className="artifact-table-row" role="row" key={file.relativePath} onClick={() => onSelect(file.relativePath)}><span role="cell"><strong>{displayJobName(file.name.replace(/\.[^.]+$/, ""))}</strong><small>{file.relativePath}</small></span><span role="cell">{fileTypeLabel(file)}</span><span role="cell">{file.modifiedAt ? formatRelativeDate(file.modifiedAt) : "—"}</span><span role="cell">Open</span></button>)}</div>;
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
  const stateCopy: Record<ApplicationStatus["state"], string> = {
    not_started: "Not started. Ask Agy to evaluate this job first.",
    snapshot_ready: "Evidence gathered. Drafts are not written yet.",
    matched: "Evaluated. Drafts are not written yet.",
    drafted: "Drafted. Run a check before you send it.",
    validated: "Checked and ready to send.",
    stale: "Files changed since the last check. Run the check again.",
    invalid: "The last check found problems to fix.",
  };
  return <section className={`app-check is-${status.state}`} aria-label="Application check">
    <header className="app-check-head">
      <div><h2>Application check</h2><p>{stateCopy[status.state]}</p></div>
      <button className="btn-primary" disabled={validating} onClick={() => void validate()}>{validating ? "Checking…" : validationLabel === "Validate application" ? "Run check" : validationLabel}</button>
    </header>
    {message && <p className="app-check-message" role="status" aria-live="polite">{message}</p>}
    <ul className="app-check-docs" aria-label="Application documents">
      <li className={hasEvaluation ? "is-ready" : ""}><span aria-hidden="true">{hasEvaluation ? "✓" : "○"}</span>Evaluation</li>
      <li className={hasResume ? "is-ready" : ""}><span aria-hidden="true">{hasResume ? "✓" : "○"}</span>Resume</li>
      <li className={hasCoverLetter ? "is-ready" : ""}><span aria-hidden="true">{hasCoverLetter ? "✓" : "○"}</span>Cover letter</li>
    </ul>
    <p className="app-check-next"><strong>Next:</strong> {recommendedAction}.{job.rating !== null && <> Fit {job.rating.toFixed(1)} of 5{job.ratingConfidence ? `, ${job.ratingConfidence} confidence` : ""}.</>}</p>
    {issues.length > 0 && <details className="application-issues" open={issuesOpen} onToggle={(event) => setIssuesOpen(event.currentTarget.open)}><summary>{plural(issues.filter((issue) => issue.severity === "error").length, "error")} and {plural(issues.filter((issue) => issue.severity === "warning").length, "warning")} from the last check</summary>{issues.map((issue, index) => <div className={`application-issue is-${issue.severity}`} key={`${issue.code}-${issue.artifact}-${index}`}><strong>{issue.severity === "warning" ? "Warning" : "Needs review"}</strong><span>{issue.code} · {issue.artifact}</span><p>{issue.message}</p>{issue.explanation && <div className="application-issue-explanation"><span><b>Sentence</b>{issue.explanation.sentence ?? "Unavailable"}</span><span><b>Source</b>{issue.explanation.sources.length ? issue.explanation.sources.map((source) => <span className="application-issue-source" key={`${source.evidenceId}-${source.sourcePath}`}><code>{source.evidenceId}</code> · <code>{source.sourcePath}</code><em>{source.claim}</em></span>) : "Unavailable"}</span></div>}<small>{issue.repairHint}</small></div>)}</details>}
    {(job.ratingHighlights.length > 0 || job.ratingGaps.length > 0) && <details className="application-fit-details"><summary>Why this rating <span>{job.ratingHighlights.length} strengths · {job.ratingGaps.length} gaps</span></summary><div><section><h3>Strongest alignment</h3>{job.ratingHighlights.length ? <ul>{job.ratingHighlights.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No direct-match summary was found.</p>}</section><section><h3>Gaps and risks</h3>{job.ratingGaps.length ? <ul>{job.ratingGaps.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No material gaps were listed.</p>}</section></div></details>}
    {(lastReport?.ats?.missingFields.length ?? 0) > 0 && <p className="app-check-message">ATS fields to review: {lastReport?.ats?.missingFields.join(", ")}</p>}
    <details className="app-check-details"><summary>Pipeline details</summary>
    <div className="application-health-facts">
      <span><small>Snapshot</small>{status.snapshotConsistent ? "Pinned" : "Mismatch"}</span>
      <span><small>Manifest</small>{status.manifestCurrent ? "Current" : "Stale"}</span>
      <span><small>Base resume</small>{footprint ? `${footprint.format.toUpperCase()}, ${footprint.status}` : "Not profiled"}</span>
      <span><small>Template lock</small>{status.templateIntegrity.replaceAll("_", " ")}</span>
      <span><small>Resume density</small>{status.resumeBulletCount === null ? "Not drafted" : `${status.resumeBulletCount} bullets, ${status.currentEmployerBulletCount ?? 0} in current role`}</span>
      <span><small>Recent work</small>{status.recentCurrentEmployerBulletCount === null ? "Not audited" : `${status.recentCurrentEmployerBulletCount} evidence-backed`}</span>
      <span><small>Word target</small>{footprint && footprint.targetWordMin !== null && footprint.targetWordMax !== null ? `${footprint.targetWordMin}-${footprint.targetWordMax}` : "Unavailable"}</span>
      <span><small>Fit credit</small>{`Direct ${FIT_CLASSIFICATION_CREDIT.direct * 100}%, strong transferable ${FIT_CLASSIFICATION_CREDIT.strong_transferable * 100}%, adjacent ${FIT_CLASSIFICATION_CREDIT.adjacent_transferable * 100}%`}</span>
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
        {ats && <span><small>ATS PDF check</small>{ats.status === "passed" ? "Readable · fields found" : ats.status === "not_exported" ? "Not exported" : ats.status === "unavailable" ? "Unavailable" : `${ats.missingFields.length} fields to review`}</span>}
        {keywordClasses.length > 0 && <span><small>Keyword class</small>{supported} supported · {transferable} transferable · {unsupported} unsupported</span>}
      </div>;
    })()}
    </details>
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
    <header className="topbar standalone-topbar"><div className="wordmark"><span className="wordmark-mark">S</span><span>Sensei</span></div><nav className="focus-navigation" aria-label="Interview window"><button className="btn-quiet" onClick={() => setPreview(null)} disabled={!preview}>Back to questions</button></nav><div className="standalone-title"><strong>{job?.company ?? overview?.company ?? displayJobName(jobId)}</strong><small>{activeRound?.label ?? job?.title ?? "Interview preparation"}</small></div><button className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Day" : "Night"}</button></header>
    <section className="standalone-workspace">{error && <p className="inline-error">{error}</p>}{job && overview && activeRound ? preview ? <section className="viewer-panel standalone-document"><div className="viewer-header"><div><h1>{preview.name}</h1></div><div className="viewer-header-actions"><span className="label source">{preview.fileType.toUpperCase()}</span><button className="viewer-close" onClick={() => setPreview(null)} aria-label="Return to interview dashboard">×</button></div></div><DocumentView preview={preview} isBaseResume={false} onExported={() => undefined} onDirtyChange={() => undefined} onSaved={async (saved) => setPreview(saved)} /></section> : <InterviewView job={job} overview={overview} loading={false} initialRoundId={activeRound.id} standalone onRoundChange={setActiveRoundId} onOpenFile={(path) => void selectDocument(path)} /> : !error && <p className="dashboard-loading">Loading interview workspace…</p>}</section>
  </main>;
}




function ResumeSources({ settings, selectedPath, onSelect, onChoose, onRemoveSecondary }: { settings: Settings; selectedPath: string | null; onSelect: (path: string) => void; onChoose: (role: "base" | "secondary") => void; onRemoveSecondary: (path: string) => void }) {
  const secondary = settings.secondaryResumePaths;
  return <section className="resume-sources"><div className="resume-heading"><span>Resume sources</span><span className="count">{(settings.baseResumePath ? 1 : 0) + secondary.length}</span></div><div className="resume-row-label"><span>Base resume</span><button className="mini-button" onClick={() => onChoose("base")}>Change</button></div>{settings.baseResumePath ? <button className={`resume-file ${selectedPath === settings.baseResumePath ? "is-selected" : ""}`} onClick={() => onSelect(settings.baseResumePath!)}><span className="file-icon">{settings.baseResumePath.endsWith("docx") ? "DOC" : "PDF"}</span><span className="tree-name">{settings.baseResumePath.split("/").pop()}</span><span className="base-mark">Base</span></button> : <p className="empty-small">No base resume selected.</p>}<div className="resume-row-label"><span>Secondary resumes</span><button className="mini-button" onClick={() => onChoose("secondary")}>Add</button></div>{secondary.length ? secondary.map((path) => <div className="resume-file-row" key={path}><button className={`resume-file ${selectedPath === path ? "is-selected" : ""}`} onClick={() => onSelect(path)}><span className="file-icon">{path.endsWith("docx") ? "DOC" : "PDF"}</span><span className="tree-name">{path.split("/").pop()}</span></button><button className="remove-button" aria-label={`Remove ${path.split("/").pop()}`} title="Remove secondary resume" onClick={() => onRemoveSecondary(path)}>×</button></div>) : <p className="empty-small">Older resumes add historical support.</p>}<div className="resume-row-label education-label"><span>LinkedIn profile</span></div><p className="resume-note">Education and additional career context</p></section>;
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
  return <div className="tree-file-row" onContextMenu={openMenu}><button className={`tree-file ${selectedPath === node.relativePath ? "is-selected" : ""}`} style={{ paddingLeft: `${26 + depth * 13}px` }} onClick={() => onSelect(node.relativePath)}><input ref={inputRef} className="context-check" type="checkbox" aria-label={isPolicy ? `${node.name} is always enforced` : `Include ${node.name} in terminal context`} checked={checked} disabled={isPolicy} onClick={(event) => event.stopPropagation()} onChange={(event) => onTogglePath(node.relativePath, event.target.checked)} /><span className="file-icon">{node.fileType === "pdf" ? "PDF" : node.fileType === "docx" ? "DOC" : node.fileType === "text" || node.fileType === "json" || node.fileType === "rtf" ? "TXT" : "FILE"}</span><span className="tree-name" title={node.name}>{node.name}</span>{isPolicy && <span className="base-mark" title="Always-enforced career claim policy">Policy</span>}{node.relativePath === baseResume && <span className="base-mark" title="Configured base resume">Base</span>}</button>{menuView}</div>;
}

function DocumentView({ preview, isBaseResume, focusAnchor, onExported, onDirtyChange, onSaved }: { preview: FilePreview; isBaseResume: boolean; focusAnchor?: string; onExported: () => void; onDirtyChange: (dirty: boolean) => void; onSaved: (preview: FilePreview) => Promise<void> }) {
  if (!preview.canPreview) return <div className="unsupported-state"><div className="file-badge">{preview.fileType.toUpperCase()}</div><h2>Preview unavailable</h2><p>{preview.message}</p><div className="file-meta"><span>{formatBytes(preview.sizeBytes)}</span><span>Modified {new Date(preview.modifiedAt).toLocaleString()}</span></div>{isBaseResume && <span className="label verified">Configured base resume</span>}</div>;
  if (preview.contentType === "data-url" && preview.dataUrl) return preview.fileType === "pdf" ? <PdfDocument preview={preview} /> : <div className="image-document"><img src={preview.dataUrl} alt={preview.name} /></div>;
  if (preview.contentType === "html" && preview.content) return <article className="document rich-document"><div className="document-meta"><span>{preview.relativePath}</span><span>{formatBytes(preview.sizeBytes)} · {new Date(preview.modifiedAt).toLocaleDateString()}</span>{isBaseResume && <span className="label verified">Configured base resume</span>}</div><div dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.content) }} />{preview.message && <p className="preview-note">{preview.message}</p>}</article>;
  const challengePractice = preview.name === "practice_labs.json" ? parseChallengePractice(preview.content) : null;
  if (challengePractice) return <ChallengePracticeDocument preview={preview} practice={challengePractice} focusAnchor={focusAnchor} />;
  const isMarkdown = preview.name.toLowerCase().endsWith(".md");
  if (isMarkdown) return <MarkdownDocument preview={preview} focusAnchor={focusAnchor} onExported={onExported} onDirtyChange={onDirtyChange} onSaved={onSaved} />;
  return <article className="document"><div className="document-meta"><span>{preview.relativePath}</span><span>{formatBytes(preview.sizeBytes)} · {new Date(preview.modifiedAt).toLocaleDateString()}</span>{isBaseResume && <span className="label verified">Configured base resume</span>}</div><pre>{preview.content}</pre></article>;
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
      <span className="label verified">Practice mode</span>
    </div>
    <header className="challenge-hero">
      <div><span className="eyebrow">Technical challenge</span><h2>{practice.title}</h2><p>{practice.company} · {practice.role}</p></div>
      <div className="challenge-mode"><small>Assessment mode</small><strong>{practice.assessmentMode.replaceAll("_", " ")}</strong><span>{practice.sourceBasis.replaceAll("_", " ")}</span></div>
    </header>
    {!practice.realPromptSupplied && <p className="challenge-notice"><strong>Practice approximation.</strong> {practice.approximationNotice ?? "These exercises are based on the known process and role, not an employer-supplied assessment prompt."}</p>}
    <div className="challenge-toolbar">
      <div className="challenge-filters" aria-label="Filter challenge exercises">
        {([["all", "All"], ["coding", "Coding labs"], ["verbal", "Verbal scenarios"]] as Array<[ChallengeFilter, string]>).map(([value, label]) => <button key={value} className={filter === value ? "is-active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      <div className="challenge-navigation">
        <label><span>Jump to exercise</span><select aria-label="Jump to challenge exercise" value={current?.id ?? ""} onChange={(event) => chooseExercise(event.target.value)}>{exercises.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.title}</option>)}</select></label>
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
      <div><span className={`challenge-type is-${exercise.type}`}>{exercise.type === "coding" ? "Coding / implementation" : "Verbal scenario"}</span><h3>{exercise.title}</h3></div>
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
      ? <div className="markdown-editor-grid"><div className="editor-pane"><div className="editor-pane-title">Markdown <span>Ctrl/⌘ S to save</span></div><textarea aria-label={`Edit ${preview.name}`} value={draft} spellCheck="true" onChange={(event) => { setDraft(event.target.value); setState("idle"); setMessage(""); }} /></div><div className="editor-preview"><div className="editor-pane-title">Live preview</div><div dangerouslySetInnerHTML={{ __html: markdownHtml(draft) }} /></div></div>
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
      <div className="evaluation-score-card"><span>Fit score</span><strong>{score.replace(/^.*?(\d(?:\.\d+)?\s*\/\s*5).*$/i, "$1")}</strong><small>Direct 100% · strong 75% · adjacent 55%</small></div>
      <div><span>Apply recommendation</span><strong>{recommendation}</strong></div>
      <div><span>Confidence</span><strong>{confidence}</strong></div>
    </section>
    <section className="evaluation-category-section">
      <div className="evaluation-section-heading"><div><span className="eyebrow">Category coverage</span><h2>Where the score comes from</h2></div><small>{requirements.length} scored requirements</small></div>
      <div className="evaluation-category-grid">{categories.map((group) => {
        const percent = group.available ? Math.round(group.earned / group.available * 100) : 0;
        return <button className={`evaluation-category-card ${activeCategory === group.category ? "is-active" : ""}`} type="button" key={group.category} aria-controls={`evaluation-category-${group.category}`} aria-expanded={activeCategory === group.category} onClick={() => openCategoryDetails(group.category)}><span>{evaluationCategoryLabels[group.category]}</span><strong>{group.earned.toFixed(1)} <small>/ {group.available}%</small></strong><span className="evaluation-category-bar" aria-label={`${percent}% credit`}><i style={{ width: `${percent}%` }} /></span><small>{percent}% of available credit · View requirements</small></button>;
      })}</div>
    </section>
    {insights.length > 0 && <section className="evaluation-insights"><div className="evaluation-section-heading"><div><span className="eyebrow">Decision context</span><h2>What matters most</h2></div></div><div>{insights.map((section) => <article key={section.title}><h3>{section.title}</h3><div dangerouslySetInnerHTML={{ __html: markdownHtml(section.content) }} /></article>)}</div></section>}
    <section className="evaluation-requirements">
      <div className="evaluation-section-heading"><div><span className="eyebrow">Requirement breakdown</span><h2>Evidence by requirement</h2></div><small>Open a category to inspect its evidence</small></div>
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
    if (filter === "primary") return /primary(?:.*round)?|recruiter|hiring.manager|customer.facing|behavioral/i.test(heading);
    if (filter === "followups") return /follow.?up/i.test(heading);
    if (filter === "later") return /secondary|later.round|technical|domain/i.test(heading);
    return /questions to ask|reverse/i.test(heading);
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
  const [textSize, setTextSize] = useState<PdfTextSize>(DEFAULT_PDF_TEXT_SIZE);
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

type PastedBlock = {
  id: string;
  lineCount: number;
  byteCount: number;
  content: string;
  preview: string;
};

type ChatEntry = {
  id: string;
  sender: "user" | "assistant" | "system";
  title?: string;
  content: string;
  pastedBlock?: PastedBlock;
  steps?: string[];
  rawOutput?: string[];
  status?: "pending" | "running" | "success" | "error";
  startTime?: number;
  durationMs?: number;
  timestamp: string;
};

function stripAnsi(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][AB012]/g, "")
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r+/g, "\n");
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}.${tenths}s`;
}

function TerminalPanel({ cwd, selectedJobFiles, selectedCareerPaths, theme, visible, onClose, jobActions, promptRequest, onPromptHandled, onInsertPrompt }: { cwd: string; selectedJobFiles: string[]; selectedCareerPaths: string[]; theme: "dark" | "light"; visible: boolean; onClose: () => void; jobActions: JobAction[]; promptRequest: PromptRequest | null; onPromptHandled: (id: number) => void; onInsertPrompt: (action: JobAction) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState("Starting terminal…");
  const [terminalReady, setTerminalReady] = useState(false);
  const terminalReadyRef = useRef(false);
  const [agyActive, setAgyActive] = useState(false);
  const [promptNotice, setPromptNotice] = useState("");
  const handledPromptId = useRef(0);
  const [viewMode, setViewMode] = useState<"chat" | "console">("chat");
  const [chatInput, setChatInput] = useState("");
  const [pastedAttachment, setPastedAttachment] = useState<PastedBlock | null>(null);
  const [expandedPastes, setExpandedPastes] = useState<Record<string, boolean>>({});
  const [expandedRawLogs, setExpandedRawLogs] = useState<Record<string, boolean>>({});
  const [liveNow, setLiveNow] = useState(Date.now());
  const chatStreamRef = useRef<HTMLDivElement>(null);
  const activeAsstIdRef = useRef<string | null>(null);
  const quietTimerRef = useRef<number | null>(null);
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([
    {
      id: "welcome",
      sender: "system",
      title: "JobSensei Copilot",
      content: "Connected to local career evidence and job workspace. Paste a job description to screen and tailor your application, choose a recommended action, or enter a prompt below.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (activeAsstIdRef.current) {
        setLiveNow(Date.now());
      }
    }, 200);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 38), 160);
    textarea.style.height = `${nextHeight}px`;
  }, [chatInput]);

  const executeCommand = (text: string, label?: string, attachedPaste?: PastedBlock) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const now = Date.now();
    const userContent = label ? `⚡ ${label}` : text;
    const userMsg: ChatEntry = {
      id: `user-${now}`,
      sender: "user",
      content: userContent,
      pastedBlock: attachedPaste,
      timestamp: time,
    };

    let payload = text;
    if (attachedPaste) {
      payload = text.trim() ? `${text.trim()}\n${attachedPaste.content}` : attachedPaste.content;
    }

    const asstId = `asst-${now}`;
    activeAsstIdRef.current = asstId;
    const commandSummary = label || (text.trim() ? (text.length > 40 ? `${text.slice(0, 40)}…` : text) : (attachedPaste ? `Pasted JD (${attachedPaste.lineCount} lines)` : "Task"));

    const asstMsg: ChatEntry = {
      id: asstId,
      sender: "assistant",
      title: label || "Task execution",
      content: "",
      steps: [`Starting: ${commandSummary}…`],
      status: "running",
      startTime: now,
      timestamp: time,
    };

    setChatEntries((prev) => [...prev, userMsg, asstMsg]);
    void window.sensei.terminal.write(payload.endsWith("\n") ? payload : `${payload}\r`);
  };

  const handleChatSubmit = (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const prompt = chatInput.trim();
    if (!prompt && !pastedAttachment) return;
    const pasteToSend = pastedAttachment ?? undefined;
    setPastedAttachment(null);
    setChatInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    executeCommand(prompt, undefined, pasteToSend);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleChatSubmit();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData("text");
    if (!text) return;
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length >= 3 || text.length > 250) {
      event.preventDefault();
      const id = `paste-${Date.now()}`;
      const preview = lines.filter((l) => l.trim().length > 0).slice(0, 3).join("\n") || text.slice(0, 150);
      setPastedAttachment({
        id,
        lineCount: lines.length,
        byteCount: new Blob([text]).size,
        content: text,
        preview,
      });
    }
  };

  const handleClear = () => {
    if (viewMode === "chat") {
      setChatEntries([
        {
          id: `welcome-${Date.now()}`,
          sender: "system",
          title: "JobSensei Copilot",
          content: "Connected to local career evidence and job workspace. Paste a job description to screen and tailor your application, choose a recommended action, or enter a prompt below.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } else {
      terminalRef.current?.clear();
      void window.sensei.terminal.write("\x0c");
    }
  };

  const toggleExpandPaste = (id: string) => {
    setExpandedPastes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleExpandRaw = (id: string) => {
    setExpandedRawLogs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

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
    const removeData = window.sensei.terminal.onData((data) => {
      terminal.write(data);
      const clean = stripAnsi(data).trim();
      if (!clean) return;

      const rawLines = clean.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      const meaningfulLines = rawLines.filter((l) => l.length > 3 && !l.endsWith("%") && !l.endsWith("$") && !l.startsWith("]0;"));

      if (meaningfulLines.length && activeAsstIdRef.current) {
        const activeId = activeAsstIdRef.current;
        setChatEntries((prev) => prev.map((entry) => {
          if (entry.id !== activeId) return entry;
          const currentSteps = entry.steps ?? [];
          const newSteps = [...currentSteps];
          for (const line of meaningfulLines) {
            if (/(?:✓|done|complete|created|wrote|screening|snapshott|evaluat|prepar|finaliz|tailor|warn|error|building|analyz)/i.test(line)) {
              const stepText = line.replace(/^[✓\-*•→]\s*/, "");
              if (!newSteps.includes(stepText) && newSteps.length < 12) {
                newSteps.push(stepText);
              }
            }
          }
          const existingRaw = entry.rawOutput ?? [];
          const updatedRaw = [...existingRaw, ...meaningfulLines].slice(-60);
          const lastLine = meaningfulLines[meaningfulLines.length - 1];
          return {
            ...entry,
            steps: newSteps,
            rawOutput: updatedRaw,
            content: entry.content || (lastLine && !newSteps.includes(lastLine) ? lastLine : entry.content),
          };
        }));
      }

      if (quietTimerRef.current !== null) window.clearTimeout(quietTimerRef.current);
      quietTimerRef.current = window.setTimeout(() => {
        if (activeAsstIdRef.current) {
          const finishedId = activeAsstIdRef.current;
          const finishTime = Date.now();
          setChatEntries((prev) => prev.map((entry) => {
            if (entry.id === finishedId) {
              const duration = entry.startTime ? finishTime - entry.startTime : undefined;
              return { ...entry, status: "success", durationMs: duration };
            }
            return entry;
          }));
          activeAsstIdRef.current = null;
        }
      }, 2500);
    });
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
    void window.sensei.terminal.start({}).then(({ cwd: startedCwd, agyStarted }) => {
      terminalReadyRef.current = true;
      setAgyActive(Boolean(agyStarted));
      setStatus(`${startedCwd} · ${agyStarted ? "⚡ agy ready" : "shell ready"}`);
      setTerminalReady(true);
      resize();
      terminal.focus();
    }).catch((caught: unknown) => {
      terminalReadyRef.current = false;
      setTerminalReady(false);
      setStatus(messageOf(caught, "Terminal failed to start"));
    });
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
    if (viewMode === "chat" && chatStreamRef.current) {
      chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
    }
  }, [chatEntries, viewMode, expandedPastes, expandedRawLogs]);

  useEffect(() => {
    if (!visible || !terminalReady || !promptRequest || handledPromptId.current === promptRequest.id) return;
    handledPromptId.current = promptRequest.id;
    if (viewMode === "chat") {
      executeCommand(promptRequest.text, promptRequest.label);
      onPromptHandled(promptRequest.id);
    } else {
      void window.sensei.terminal.insertPrompt(promptRequest.text)
        .then(() => {
          setPromptNotice(`Prompt ready: ${promptRequest.label} · Press Enter to run`);
          terminalRef.current?.focus();
          window.setTimeout(() => setPromptNotice(""), 4500);
        })
        .catch((caught: unknown) => setPromptNotice(messageOf(caught, "Unable to insert that prompt.")))
        .finally(() => onPromptHandled(promptRequest.id));
    }
  }, [visible, terminalReady, promptRequest?.id, viewMode]);

  useEffect(() => {
    if (!cwd) return;
    void window.sensei.terminal.setContext({ careerPaths: selectedCareerPaths, structuredPaths: selectedCareerPaths.filter((path) => path.startsWith("context/structured/")), broadPaths: selectedCareerPaths.filter((path) => path.startsWith("context/broad/")), jobPaths: selectedJobFiles, jobIds: [] })
      .then((manifest) => setStatus(`${cwd} · ${manifest.scope} context ready`))
      .catch(() => setStatus(`${cwd} · context update failed`));
  }, [cwd, selectedCareerPaths.join(","), selectedJobFiles.join(",")]);

  return (
    <aside className={`terminal-panel ${visible ? "" : "is-collapsed"}`}>
      <div className="terminal-header">
        <div className="terminal-header-title-group">
          <div className="terminal-brand-badge">
            <div className="terminal-title">Agy</div>
            <span className={`terminal-engine-tag ${agyActive ? "is-agy" : "is-shell"}`}>
              {agyActive ? "⚡ agy" : "🐚 shell"}
            </span>
          </div>
          <div className="terminal-header-view-toggle" role="group" aria-label="Command center view mode">
            <button
              className={`view-toggle-btn ${viewMode === "chat" ? "is-active" : ""}`}
              onClick={() => setViewMode("chat")}
              type="button"
              aria-pressed={viewMode === "chat"}
            >
              💬 Chat
            </button>
            <button
              className={`view-toggle-btn ${viewMode === "console" ? "is-active" : ""}`}
              onClick={() => {
                setViewMode("console");
                window.setTimeout(() => fitRef.current?.fit(), 60);
              }}
              type="button"
              aria-pressed={viewMode === "console"}
            >
              🖥️ Console
            </button>
          </div>
        </div>
        <div className="terminal-header-actions">
          <JobActionsMenu actions={jobActions} onInsert={onInsertPrompt} />
          <button className="terminal-action" onClick={handleClear} title="Clear conversation or console output">Clear</button>
          <button className="terminal-action" onClick={() => void window.sensei.terminal.restart().then((res) => { if (res?.agyStarted !== undefined) setAgyActive(Boolean(res.agyStarted)); })} title="Restart session">Restart</button>
          <button className="terminal-action" aria-label="Hide terminal panel" onClick={onClose}>Hide</button>
        </div>
      </div>

      <div className="terminal-body">
        {viewMode === "chat" ? (
          <div className="chat-container">
            <div className="chat-stream" ref={chatStreamRef}>
              {chatEntries.map((entry) => (
                <div key={entry.id} className={`chat-bubble is-${entry.sender}`}>
                  <div className="chat-bubble-header">
                    <div className="chat-sender-group">
                      <span className="chat-sender-name">
                        {entry.sender === "user" ? "You" : entry.sender === "assistant" ? "Sensei Copilot" : "System"}
                      </span>
                      {entry.status === "running" && entry.startTime && (
                        <span className="chat-timer-badge is-running">
                          <span className="chat-pulse-dot" /> {formatDuration(liveNow - entry.startTime)}
                        </span>
                      )}
                      {entry.status === "success" && entry.durationMs !== undefined && (
                        <span className="chat-timer-badge is-completed">
                          ✓ {formatDuration(entry.durationMs)}
                        </span>
                      )}
                    </div>
                    <span className="chat-timestamp">{entry.timestamp}</span>
                  </div>
                  {entry.title && <div className="chat-bubble-title">{entry.title}</div>}
                  {entry.content && <div className="chat-bubble-content">{entry.content}</div>}
                  {entry.pastedBlock && (
                    <div className="chat-pasted-card">
                      <div className="chat-pasted-header">
                        <div className="chat-pasted-title-row">
                          <span className="chat-pasted-icon">📄</span>
                          <span className="chat-pasted-title">
                            Pasted text [lines 1–{entry.pastedBlock.lineCount} · {formatBytes(entry.pastedBlock.byteCount)}]
                          </span>
                        </div>
                        <button
                          type="button"
                          className="chat-pasted-toggle-btn"
                          onClick={() => toggleExpandPaste(entry.id)}
                        >
                          {expandedPastes[entry.id] ? "Collapse ▴" : "Preview ▾"}
                        </button>
                      </div>
                      {expandedPastes[entry.id] ? (
                        <pre className="chat-pasted-full-content">{entry.pastedBlock.content}</pre>
                      ) : (
                        <div className="chat-pasted-preview-snippet" onClick={() => toggleExpandPaste(entry.id)}>
                          <div className="chat-pasted-preview-text">{entry.pastedBlock.preview}</div>
                          <div className="chat-pasted-fade" />
                        </div>
                      )}
                    </div>
                  )}
                  {entry.steps && entry.steps.length > 0 && (
                    <div className="chat-steps">
                      {entry.steps.map((step, idx) => (
                        <div key={idx} className="chat-step-item">
                          <span className="chat-step-check">✓</span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {entry.status === "running" && (
                    <div className="chat-running-status">
                      <span className="chat-pulse-dot" /> Executing steps…
                    </div>
                  )}
                  {entry.rawOutput && entry.rawOutput.length > 0 && (
                    <div className="chat-raw-output-container">
                      <button
                        type="button"
                        className="chat-raw-toggle-btn"
                        onClick={() => toggleExpandRaw(entry.id)}
                      >
                        {expandedRawLogs[entry.id]
                          ? "Hide CLI log ▴"
                          : `Show CLI log (${entry.rawOutput.length} lines) ▾`}
                      </button>
                      {expandedRawLogs[entry.id] && (
                        <pre className="chat-raw-content">
                          {entry.rawOutput.join("\n")}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="chat-footer">
              {pastedAttachment && (
                <div className="chat-staged-attachment">
                  <div className="chat-staged-body">
                    <span className="chat-staged-icon">📄</span>
                    <div className="chat-staged-info">
                      <span className="chat-staged-label">
                        Pasted text [lines 1–{pastedAttachment.lineCount} · {formatBytes(pastedAttachment.byteCount)}]
                      </span>
                      <span className="chat-staged-snippet">{pastedAttachment.preview.replace(/\n/g, " · ").slice(0, 75)}…</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="chat-staged-remove"
                    onClick={() => setPastedAttachment(null)}
                    title="Remove pasted attachment"
                  >
                    ✕
                  </button>
                </div>
              )}
              {jobActions.length > 0 && (
                <div className="chat-quick-actions">
                  {jobActions.slice(0, 3).map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="chat-action-pill"
                      onClick={() => executeCommand(action.prompt, action.label)}
                      title={action.prompt}
                    >
                      ⚡ {action.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="chat-input-bar">
                <textarea
                  ref={textareaRef}
                  className="chat-textarea"
                  value={chatInput}
                  rows={1}
                  onChange={(e) => setChatInput(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    pastedAttachment
                      ? "Add prompt instruction or press Enter to run…"
                      : "Ask Sensei or paste a job description… (Shift+Enter for newline)"
                  }
                />
                <button
                  type="button"
                  className="chat-send-btn"
                  onClick={() => handleChatSubmit()}
                  disabled={!chatInput.trim() && !pastedAttachment}
                  aria-label="Send prompt"
                  title="Send (Enter)"
                >
                  ↑
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div
          className="terminal-host"
          ref={hostRef}
          style={{ display: viewMode === "console" ? "block" : "none" }}
        />
      </div>

      <div className="terminal-status">
        <span className={`status-dot ${terminalReady ? "is-ready" : ""}`} />
        <span>{promptNotice || status}</span>
      </div>
    </aside>
  );
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
function plural(count: number, noun: string): string { return `${count} ${noun}${count === 1 ? "" : "s"}`; }
function messageOf(caught: unknown, fallback: string): string { return caught instanceof Error ? caught.message : fallback; }
function workspaceLabel(path: string): string { return path.split("/").filter(Boolean).pop() ?? "data"; }
function filePaths(nodes: FileTreeNode[]): string[] { return nodes.flatMap((node) => node.kind === "directory" ? filePaths(node.children ?? []) : [node.relativePath]); }
function fileNodes(nodes: FileTreeNode[]): FileTreeNode[] { return nodes.flatMap((node) => node.kind === "directory" ? fileNodes(node.children ?? []) : [node]); }
function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | null { for (const node of nodes) { if (node.relativePath === path) return node; const found = node.children ? findNode(node.children, path) : null; if (found) return found; } return null; }
function terminalTheme(_theme: "dark" | "light") { return { background: "#0b0f0d", foreground: "#e4ece3", cursor: "#b5db63", selectionBackground: "#354b35", black: "#172019", brightBlack: "#718073", green: "#a7d66b", brightGreen: "#c7ed89" }; }
