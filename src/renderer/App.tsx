import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { DEFAULT_PDF_TEXT_SIZE, INTERVIEW_ROUNDS, OUTCOME_RESULTS, TRACKER_STATUSES, type InterviewEvent, type InterviewRoundKind, type JobOutcome, type JobQueue, type JobTrackerUpdate, type RunStatus, type TrackerStatus } from "../shared/schemas";
import { advanceQueue, agyReadiness, newQueueItem, promptForItem } from "../shared/job-queue";
import { jobsToCsv } from "../shared/jobs-csv";
import { STALE_DAYS, TRACKER_LABELS, effectiveAppliedAt, effectiveStatus, followUpDays, reachedInterview, staleApplications } from "../shared/tracker";
import { FIT_GATE, FIT_CLASSIFICATION_CREDIT } from "../shared/fit-credit";
import { computeLearnings, STAGE_LABELS } from "../shared/learnings";
import type { Readiness, ReadinessItem } from "../shared/readiness";
import type { ContentReviewInfo, RecordingInfo } from "../shared/schemas";
import type { ApplicationStatus, ApplicationValidationReport, CandidateProfile, ChallengeExercise, ChallengePractice, ContextManifest, FilePreview, FileTreeNode, InterviewOverview, JobFolderSummary, PdfTextSize, SearchResult, Settings, WorkspaceSummary, QuestionsState } from "../shared/schemas";
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
import { SubTabPanel, SubTabs } from "./SubTabs";
import { JobSearchView } from "./JobSearchView";
import { logisticsUpdate, parseNames, readLogistics, readStoryFields, storyUpdate, type StoryFields } from "../shared/profile-fields";
import type { InterviewLogistics } from "../shared/schemas";
import { autoDraftPicks, searchProgressText, type SearchRun, type SearchStatus } from "../shared/job-search";
import { storyTitles } from "./interview-cards";

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
type PageLocation = { kind: "jobs-home" } | { kind: "search-home" } | { kind: "interviews-home" } | { kind: "context-home" } | { kind: "setup-home" };
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [jobsStatusGroup, setJobsStatusGroup] = useState<string | null>(null);
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null);
  const [notificationsOn, setNotificationsOn] = useState(() => { try { return window.localStorage.getItem("sensei-notifications") !== "off"; } catch { return true; } });
  useEffect(() => { try { window.localStorage.setItem("sensei-notifications", notificationsOn ? "on" : "off"); } catch { /* storage unavailable */ } }, [notificationsOn]);
  const [jobQueue, setJobQueue] = useState<JobQueue>({ autoRun: true, items: [] });
  const [agyReady, setAgyReady] = useState(false);
  const queueRef = useRef(jobQueue);
  useEffect(() => { if (workspace.status === "ready") void window.sensei.queue.get().then((queue) => { queueRef.current = queue; setJobQueue(queue); }).catch(() => undefined); }, [workspace.status]);
  async function saveQueue(next: JobQueue) {
    queueRef.current = next;
    setJobQueue(next);
    try { const saved = await window.sensei.queue.save(next); queueRef.current = saved; setJobQueue(saved); }
    catch (caught) { setError(messageOf(caught, "Unable to save the job queue.")); }
  }
  const [companyAsk, setCompanyAsk] = useState<{ title: string | null; resolve: (company: string | null) => void } | null>(null);
  /** Asks which company a pasted posting is for; null when the user skips. */
  const askCompany = (title: string | null) => new Promise<string | null>((resolve) => setCompanyAsk({ title, resolve }));
  const runningItem = jobQueue.items.find((item) => item.status === "running");
  const busyJobLabel = runningItem ? runningItem.label ?? runningItem.url ?? "a queued job" : null;
  /**
   * Adds a job to the queue: a link, or a pasted JD saved under the new item's ID. Returns how many
   * jobs are ahead of it. A paste that is not a job description throws (the caller decides what to do).
   */
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  // The first-run flow is finished once (per computer); existing workspaces with jobs never see it.
  const [onboardingDone, setOnboardingDone] = useState(() => { try { return window.localStorage.getItem("sensei-onboarding-done") === "1"; } catch { return false; } });
  function finishOnboarding(destination: "jobs" | "context") {
    setOnboardingDone(true);
    try { window.localStorage.setItem("sensei-onboarding-done", "1"); } catch { /* storage unavailable */ }
    showPage(destination === "context" ? "context-home" : "jobs-home");
  }
  async function loadReadiness() { try { const next = await window.sensei.setup.readiness(); setReadiness(next); return next; } catch { return null; } }
  async function queueJob(input: { kind: "link"; url: string } | { kind: "paste"; text: string; note?: string } | { kind: "found"; id: string; auto?: boolean }, manual: boolean): Promise<number> {
    // The app says what setup is missing before a job reaches Agy (electron/setup-readiness.ts owns the rules).
    const ready = await loadReadiness();
    if (ready && !ready.ready) throw new Error(`${ready.blocker} Open Setup in the sidebar.`);
    // Links are fetched here, by the app: Agy's sandbox has no network. The saved posting is queued like a paste,
    // and a page that can't be read is reported now instead of stalling the queue.
    const item = newQueueItem({ kind: "paste", label: null, note: input.kind === "paste" ? input.note : null }, new Date(), manual);
    if (input.kind === "found") {
      // A Job Search match: its posting is already saved and cleaned, so it is copied to the queue without a fetch.
      item.label = await window.sensei.jobSearch.stage(input.id, item.id, input.auto === true);
    } else if (input.kind === "link") {
      const meta = await window.sensei.jobs.stageLink(input.url, item.id);
      item.url = input.url;
      item.label = [meta.company, meta.title].filter(Boolean).join(", ") || input.url;
    } else {
      let meta = await window.sensei.jobs.stagePastedJd(input.text, item.id);
      // Without a title label, a JD usually starts with the role name.
      const firstLine = input.text.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean)?.slice(0, 80) ?? null;
      // A paste that never names the employer: ask, so the job is never named after a team or business unit.
      if (!meta.company) {
        const company = await askCompany(meta.title ?? firstLine);
        if (company) meta = await window.sensei.jobs.setStagedCompany(item.id, company);
      }
      item.label = [meta.company, meta.title ?? firstLine].filter(Boolean).join(", ") || null;
    }
    const current = queueRef.current;
    const ahead = current.items.filter((candidate) => candidate.status === "queued" || candidate.status === "running").length;
    // The queue holds 50 items: make room by dropping the oldest finished ones.
    const finished = current.items.filter((candidate) => candidate.status === "done");
    const overflow = Math.max(0, current.items.length + 1 - 50);
    const dropped = new Set(finished.slice(0, overflow).map((candidate) => candidate.id));
    await saveQueue({ ...current, items: [...current.items.filter((candidate) => !dropped.has(candidate.id)), item] });
    return ahead;
  }
  // Finished queue items leave the queue; the job itself is on the Jobs page (and a notification said so).
  useEffect(() => {
    if (jobQueue.items.some((item) => item.status === "done")) void saveQueue({ ...jobQueue, items: jobQueue.items.filter((item) => item.status !== "done") });
  }, [jobQueue]);
  // Queue runner: while links wait or run, check the latest run every 5 seconds; send the next link when Agy is idle.
  const queueActivity = jobQueue.items.map((item) => item.status).join(",");
  useEffect(() => {
    if (!jobQueue.items.some((item) => item.status === "queued" || item.status === "running")) return;
    let cancelled = false;
    const tick = async () => {
      const terminalState = await window.sensei.terminal.status().catch(() => null);
      const latest = lastRunRef.current;
      if (cancelled) return;
      const before = queueRef.current;
      const ready = terminalState ? agyReadiness(terminalState, Date.now()) : false;
      setAgyReady(ready);
      const { queue, send } = advanceQueue(before, latest, Date.now(), ready);
      for (const item of queue.items) {
        const was = before.items.find((candidate) => candidate.id === item.id)?.status;
        if (was === "running" && item.status === "done") notify("Application drafted", latest?.label ?? item.label ?? item.url ?? "");
        if (was === "running" && item.status === "needs_attention") notify("A queued job needs attention", item.label ?? item.url ?? "");
      }
      if (before.items.some((item) => item.status === "running") && !queue.items.some((item) => item.status === "queued" || item.status === "running")) {
        notify("Job queue finished", `${queue.items.filter((item) => item.status === "done").length} drafted, ${queue.items.filter((item) => item.status === "needs_attention").length} need attention`);
      }
      if (JSON.stringify(queue) !== JSON.stringify(queueRef.current)) await saveQueue(queue);
      if (send) { setRightPanelOpen(true); await window.sensei.terminal.write(`${promptForItem(send)}\r`); }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [jobQueue.autoRun, queueActivity]);
  // Run watcher: the main process pushes the latest run when it changes (one watcher for the whole app). Here the app
  // notifies when a run finishes and starts written answers, even with the Agy panel closed.
  const [latestRun, setLatestRun] = useState<RunStatus | null>(null);
  const lastRunRef = useRef<RunStatus | null>(null);
  const askedQuestions = useRef(new Set<string>());
  const onRunRef = useRef<(run: RunStatus | null) => void>(() => undefined);
  onRunRef.current = (run) => {
    const previous = lastRunRef.current;
    lastRunRef.current = run;
    setLatestRun(run);
    // An application run starts the background answers for its posting's written questions as soon as the run's
    // snapshot exists (the evidence the answers need). Once per job: main skips jobs that already have answers.
    if (run?.kind === "application" && run.jobId && (run.state === "running" || Date.now() - Date.parse(run.at) < 15 * 60_000) && !askedQuestions.current.has(run.jobId)) {
      askedQuestions.current.add(run.jobId);
      void window.sensei.questions.auto(run.jobId).catch(() => undefined);
    }
    if (previous?.state === "running" && run && run.state !== "running" && previous.kind === run.kind && previous.jobId === run.jobId) {
      notify(`${RUN_KIND_LABEL[run.kind]} finished`, `${run.label}: ${RUN_STATE_LABEL[run.state]}`);
    }
  };
  useEffect(() => {
    if (workspace.status !== "ready") return;
    void window.sensei.runs.latest().then((run) => onRunRef.current(run)).catch(() => undefined);
    return window.sensei.runs.onChanged((run) => onRunRef.current(run));
  }, [workspace.status]);
  // Once a day: follow-ups due. Once per launch: a newer release.
  useEffect(() => {
    if (!jobs.length) return;
    const today = new Date().toISOString().slice(0, 10);
    let last: string | null = null;
    try { last = window.localStorage.getItem("sensei-followups-notified"); } catch { last = null; }
    if (last === today) return;
    const due = jobs.filter((job) => { const days = followUpDays(job.tracker); return days !== null && days <= 0 && ["applied", "interviewing", "offer", "saved"].includes(effectiveStatus(job)); });
    if (due.length) notify(`${due.length} follow-up${due.length === 1 ? "" : "s"} due`, due.slice(0, 3).map((job) => job.company ?? displayJobName(job.name)).join(", "));
    try { window.localStorage.setItem("sensei-followups-notified", today); } catch { /* storage unavailable */ }
    // Once a week: applications with no reply after 30 days.
    let lastNudge = 0;
    try { lastNudge = Date.parse(window.localStorage.getItem("sensei-stale-nudged") ?? "") || 0; } catch { lastNudge = 0; }
    if (Date.now() - lastNudge > 7 * 86_400_000) {
      const stale = staleApplications(jobs);
      if (stale.length) notify(`${stale.length} application${stale.length === 1 ? " has" : "s have"} had no reply for ${STALE_DAYS}+ days`, "Open Jobs to mark them as rejected in one step.");
      try { window.localStorage.setItem("sensei-stale-nudged", new Date().toISOString()); } catch { /* storage unavailable */ }
    }
  }, [jobs.length > 0]);
  useEffect(() => { if (workspace.status === "ready") void window.sensei.app.checkUpdate().then(setUpdate).catch(() => undefined); }, [workspace.status]);
  // Keyboard shortcuts (the "?" panel lists them). Ignored while typing or when a dialog is open.
  const goPrefix = useRef(0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "j") { event.preventDefault(); setRightPanelOpen((open) => !open); return; }
      if (mod && event.key === ",") { event.preventDefault(); setSettingsModalOpen(true); return; }
      if (mod || event.altKey || document.querySelector("[aria-modal='true']")) return;
      if (event.key === "?") { event.preventDefault(); setShortcutsOpen(true); return; }
      if (event.key === "g") { goPrefix.current = Date.now(); return; }
      if (Date.now() - goPrefix.current < 1200) {
        goPrefix.current = 0;
        const page = ({ j: "jobs-home", i: "interviews-home", c: "context-home" } as const)[event.key as "j" | "i" | "c"];
        if (page) { event.preventDefault(); showPage(page); }
        return;
      }
      const location = navigationHistory[navigationIndex];
      const job = location?.kind === "job" ? jobs.find((candidate) => candidate.id === location.jobId) : null;
      if (!job) return;
      if (event.key === "[" || event.key === "]") {
        const index = jobs.findIndex((candidate) => candidate.id === job.id);
        const next = jobs[index + (event.key === "]" ? 1 : -1)];
        if (next) { event.preventDefault(); openJob(next.id); }
      } else if (/^[1-6]$/.test(event.key)) {
        event.preventDefault();
        void updateTracker(job.id, { status: TRACKER_STATUSES[Number(event.key) - 1]! });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // A file dropped outside a drop area would make the window open that file in place of the app; ignore it.
  useEffect(() => {
    const ignore = (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); };
    window.addEventListener("dragover", ignore);
    window.addEventListener("drop", ignore);
    return () => { window.removeEventListener("dragover", ignore); window.removeEventListener("drop", ignore); };
  }, []);
  // New career files since the user last reviewed Career context (first run: everything counts as seen).
  const [knownContext, setKnownContext] = useState<string[] | null>(() => { try { const raw = window.localStorage.getItem("sensei-known-context"); return raw ? JSON.parse(raw) as string[] : null; } catch { return null; } });
  const contextFiles = filePaths(tree).filter((path) => path.startsWith("context/"));
  const newContextFiles = knownContext ? contextFiles.filter((path) => !knownContext.includes(path)) : [];
  function markContextReviewed() {
    setKnownContext(contextFiles);
    try { window.localStorage.setItem("sensei-known-context", JSON.stringify(contextFiles)); } catch { /* storage unavailable */ }
  }
  useEffect(() => { if (knownContext === null && contextFiles.length) markContextReviewed(); }, [knownContext === null, contextFiles.length]);
  const [storyBankPath, setStoryBankPath] = useState<string | null>(null);
  // Recordings in debrief/ the app hasn't imported yet (electron/content-refresh.ts), for the Interviews badge.
  const [newRecordings, setNewRecordings] = useState(0);
  // Job Search runs in the main process; the app hears its progress and result on every page.
  const [searchStatus, setSearchStatus] = useState<SearchStatus>({ running: false, source: null, progress: null, startedAt: null });
  const [searchNew, setSearchNew] = useState(0);
  const searchFinishedRef = useRef<(run: SearchRun | null) => void>(() => undefined);
  const loadRecordings = () => window.sensei.content.recordings().then(({ recordings }) => { setNewRecordings(recordings.filter((recording) => recording.state === "new" || recording.state === "changed").length); }).catch(() => undefined);
  useEffect(() => { if (workspace.status === "ready") void loadRecordings(); }, [workspace.status, tree]);
  // Setup readiness follows the workspace, profile, settings, and files; while a required step is missing it is
  // checked again every 15 seconds (for example, Agy finishing its sign-in in the panel).
  useEffect(() => { if (workspace.status === "ready") void loadReadiness(); }, [workspace, candidateProfile, resumeSettings, tree, settingsModalOpen]);
  useEffect(() => {
    if (workspace.status !== "ready" || readiness?.ready) return;
    const timer = window.setInterval(() => void loadReadiness(), 15_000);
    return () => window.clearInterval(timer);
  }, [workspace.status, readiness?.ready]);
  useEffect(() => { if (workspace.status === "ready") void window.sensei.profile.preview().then((preview) => setStoryBankPath(preview.storyBankPath)).catch(() => undefined); }, [workspace.status, jobTree]);
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

  async function refresh(silent = false, changedPaths: string[] = []) {
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
        // A change inside job folders the context does not use cannot change the manifest.
        const jobFilesOnly = changedPaths.length > 0 && changedPaths.every((path) => path.startsWith("jobs/") && !selectedJobFiles.includes(path));
        if (nextBase && !(jobFilesOnly && selectionInitialized)) {
          setContextManifest(await window.sensei.context.getManifest({ careerPaths: defaultCareerPaths, structuredPaths: defaultCareerPaths.filter((path) => path.startsWith("context/structured/")), broadPaths: defaultCareerPaths.filter((path) => path.startsWith("context/broad/")), jobPaths: selectionInitialized ? selectedJobFiles : [], jobIds: [] }));
        } else if (!nextBase) {
          setContextManifest(null);
        }
      }
    } catch (caught) { if (!silent) setError(messageOf(caught, "Unable to read the workspace.")); }
    finally { if (!silent) setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    return window.sensei.workspace.onChanged((paths) => { void refresh(true, paths); });
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
    if (current?.kind === "job" || current?.kind === "search-home" || current?.kind === "interviews-home" || current?.kind === "context-home" || current?.kind === "setup-home") return current;
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

  async function updateTracker(jobId: string, update: JobTrackerUpdate, options: { quiet?: boolean } = {}) {
    setError(null);
    try {
      const job = jobs.find((candidate) => candidate.id === jobId);
      const previousStatus = job ? effectiveStatus(job) : null;
      // The first save keeps the derived status and applied date, so editing a note never resets a job to Saved.
      const seeded: JobTrackerUpdate = job && !job.tracker ? { status: effectiveStatus(job), appliedAt: effectiveAppliedAt(job), ...update } : update;
      const tracker = await window.sensei.jobs.updateTracker(jobId, seeded);
      setJobs((current) => current.map((job) => job.id === jobId ? { ...job, tracker } : job));
      if (!options.quiet && job && update.status && previousStatus && update.status !== previousStatus) {
        showToast(`${job.company ?? displayJobName(job.name)}: ${TRACKER_LABELS[update.status]}`, () => void updateTracker(jobId, { status: previousStatus }, { quiet: true }));
      }
    } catch (caught) { setError(messageOf(caught, "Unable to save the job status.")); }
  }

  function showToast(message: string, undo?: () => void) {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, undo }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), undo ? 8000 : 5000);
  }

  // When a run finishes: say what it found, then queue strong matches only if the user turned auto-draft on.
  searchFinishedRef.current = (run) => {
    void (async () => {
      if (!run) { showToast("The job search stopped unexpectedly."); return; }
      const current = await window.sensei.jobSearch.get().catch(() => null);
      if (!current) return;
      const picks = run.status === "done" ? autoDraftPicks(current.state, current.settings) : [];
      let sent = 0;
      for (const item of picks) { try { await queueJob({ kind: "found", id: item.id, auto: true }, false); sent += 1; } catch { break; } }
      setSearchNew(current.state.items.filter((item) => item.status === "new").length - sent);
      notify(run.status === "failed" ? "Job search didn't finish" : "Job search finished", run.status === "failed" ? run.error ?? "" : `${run.added} new match${run.added === 1 ? "" : "es"}${sent ? `; ${sent} sent for drafts` : ""}. Open Job Search to see them.`);
    })();
  };
  // A scheduled search (app closed or in the background) writes its matches to disk and marks strong ones for drafts.
  // The app checks on start, on focus, and every minute: it shows the new count and queues the marked drafts.
  const pendingBusy = useRef(false);
  async function pickUpScheduled() {
    const current = await window.sensei.jobSearch.get().catch(() => null);
    if (!current) return;
    setSearchStatus((status) => status.running && !status.scheduled ? status : current.status);
    setSearchNew(current.state.items.filter((item) => item.status === "new").length);
    if (!current.state.pendingDrafts.length || pendingBusy.current) return;
    pendingBusy.current = true;
    try {
      const done: string[] = [];
      for (const id of current.state.pendingDrafts) {
        const item = current.state.items.find((candidate) => candidate.id === id);
        if (item?.status === "new") { try { await queueJob({ kind: "found", id, auto: true }, false); } catch { break; } }
        done.push(id);
      }
      if (done.length) {
        await window.sensei.jobSearch.clearPending(done);
        showToast(`Sent ${done.length} strong match${done.length === 1 ? "" : "es"} from the scheduled search for drafts.`);
      }
    } finally { pendingBusy.current = false; }
  }
  useEffect(() => {
    const onFocus = () => void pickUpScheduled();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void pickUpScheduled(), 60_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [workspace?.path]);
  useEffect(() => {
    void pickUpScheduled();
    const offStatus = window.sensei.jobSearch.onStatus(setSearchStatus);
    const offFinished = window.sensei.jobSearch.onFinished((run) => searchFinishedRef.current(run));
    const offUpdated = window.sensei.jobSearch.onUpdated((state) => setSearchNew(state.items.filter((item) => item.status === "new").length));
    const offRated = window.sensei.jobSearch.onRated((message) => notify("Light rating finished", message));
    return () => { offStatus(); offFinished(); offUpdated(); offRated(); };
  }, [workspace?.path]);

  useEffect(() => {
    const onAnnounce = (event: Event) => showToast(String((event as CustomEvent).detail ?? ""));
    window.addEventListener("sensei-announce", onAnnounce);
    return () => window.removeEventListener("sensei-announce", onAnnounce);
  }, []);

  /** A desktop notification when the window is in the background; a toast when it is in front. */
  function notify(title: string, body: string) {
    if (!notificationsOn) return;
    if (document.hasFocus()) { showToast(`${title}. ${body}`); return; }
    try { new Notification(title, { body, silent: false }); } catch { showToast(`${title}. ${body}`); }
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

  async function chooseResume(role: "base" | "secondary" | "linkedin") {
    setError(null);
    try {
      const nextSettings = await window.sensei.settings.chooseResume(role);
      setResumeSettings(nextSettings);
      setBaseResume(nextSettings.baseResumePath);
      const nextCareerPaths = [...new Set([...selectedCareerPaths, nextSettings.baseResumePath, ...nextSettings.secondaryResumePaths, nextSettings.linkedinProfilePath]
        .filter((path): path is string => Boolean(path)))];
      setSelectedCareerPaths(nextCareerPaths);
      await updateContext(nextCareerPaths, selectedJobFiles);
      await refresh();
    } catch (caught) { setError(messageOf(caught, "Unable to update resume sources.")); }
  }

  /** What each Setup action does in the app (Setup page and the first-run flow). */
  function runSetupAction(action: ReadinessItem["action"]) {
    if (action === "resume" || action === "other-resumes") void chooseResume(action === "resume" ? "base" : "secondary").then(() => loadReadiness());
    else if (action === "agy") setRightPanelOpen(true);
    else if (action === "context") showPage("context-home");
    else if (action === "folder") void window.sensei.files.reveal("").catch(() => undefined);
    else if (action !== "none") setSettingsModalOpen(true);
  }

  /** Files added from the app are copied into context, checked for Agy, and not flagged as "new" (the user just chose them). */
  async function addContextFiles(kind: "structured" | "broad", paths?: string[]) {
    setError(null);
    try {
      const result = paths ? await window.sensei.context.importPaths(paths, kind) : await window.sensei.context.addFiles(kind);
      if (!result.added.length && !result.skipped.length) return;
      const nextCareerPaths = [...new Set([...selectedCareerPaths, ...result.added])];
      setSelectedCareerPaths(nextCareerPaths);
      await refresh();
      await updateContext(nextCareerPaths, selectedJobFiles);
      const seen = [...new Set([...(knownContext ?? []), ...result.added])];
      setKnownContext(seen);
      try { window.localStorage.setItem("sensei-known-context", JSON.stringify(seen)); } catch { /* storage unavailable */ }
      const copied = result.added.length - result.skipped.filter((item) => item.reason.startsWith("already added")).length;
      const skipped = result.skipped.filter((item) => !item.reason.startsWith("already added"));
      showToast([copied ? `Added ${plural(copied, "file")}, checked for Agy` : "", skipped.length ? `Skipped ${skipped.map((item) => `${item.name} (${item.reason})`).join("; ")}` : ""].filter(Boolean).join(". ") || "Those files were already in context");
      void loadReadiness();
    } catch (caught) { setError(messageOf(caught, "Unable to add those files.")); }
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
  const resumeReady = readiness ? readiness.items.find((item) => item.id === "resume")?.state === "done" : workspace.hasBaseResume;
  const needsSetup = configured && (!workspace.hasCandidateProfile || !resumeReady || (!onboardingDone && workspace.jobCount === 0));
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
  const recentForStatus = recentJobIds.slice(0, 3).map((id) => jobs.find((job) => job.id === id)).filter((job): job is JobFolderSummary => Boolean(job) && job!.id !== viewedJob?.id);
  const paletteActions: PaletteAction[] = [
    { id: "go-jobs", title: "Go to Jobs", subtitle: "All jobs, the queue, and the status strip", keywords: "home list cards", shortcut: "g j", run: () => showPage("jobs-home") },
    { id: "go-interviews", title: "Go to Interviews", subtitle: "Every job with interview prep", keywords: "rounds prep", shortcut: "g i", run: () => showPage("interviews-home") },
    { id: "go-context", title: "Go to Career context", subtitle: "Resumes and sources Agy reads", keywords: "files sources resume", shortcut: "g c", run: () => showPage("context-home") },
    ...[["interviewing", "Interviewing"], ["applied", "Applied"], ["offer", "Offer"], ["closed", "Closed"], ["saved", "Saved"]].map(([group, label]) => ({ id: `filter:${group}`, title: `Show ${label.toLowerCase()} jobs`, subtitle: "Filter the Jobs page by status", keywords: `status:${group} filter`, run: () => { setJobsStatusGroup(group!); showPage("jobs-home"); } })),
    ...recentForStatus.flatMap((job) => TRACKER_STATUSES.filter((status) => status !== effectiveStatus(job)).map((status) => ({ id: `tracker:${job.id}:${status}`, title: `Mark ${job.company ?? displayJobName(job.name)} as ${TRACKER_LABELS[status].toLowerCase()}`, subtitle: job.title ?? "Recent job", keywords: `status ${status}`, run: () => void updateTracker(job.id, { status }) }))),
    { id: "export-csv", title: "Export all jobs to CSV", subtitle: "Save a spreadsheet of every job", keywords: "csv excel spreadsheet download", run: () => void window.sensei.jobs.exportCsv(jobsToCsv(jobs)).then((path) => { if (path) showToast(`Saved ${jobs.length} jobs to ${path.split(/[\\/]/).pop()}`); }) },
    { id: "queue-toggle", title: jobQueue.autoRun ? "Pause the job queue" : "Resume the job queue", subtitle: `${jobQueue.items.filter((item) => item.status === "queued").length} waiting`, keywords: "queue links automatic", run: () => void saveQueue({ ...jobQueue, autoRun: !jobQueue.autoRun }) },
    { id: "notifications", title: notificationsOn ? "Turn notifications off" : "Turn notifications on", subtitle: "Run finished, queue done, follow-ups due", keywords: "alerts notify", run: () => setNotificationsOn((on) => !on) },
    { id: "shortcuts", title: "Show keyboard shortcuts", subtitle: "Every shortcut in one list", keywords: "keys help", shortcut: "?", run: () => setShortcutsOpen(true) },
    ...(viewedJob ? TRACKER_STATUSES.filter((status) => status !== effectiveStatus(viewedJob)).map((status) => ({
      id: `tracker:${status}`,
      title: `Mark as ${TRACKER_LABELS[status].toLowerCase()}`,
      subtitle: `${viewedJob.company ?? displayJobName(viewedJob.name)}, ${viewedJob.title ?? "this job"}`,
      keywords: `status tracker ${status}`,
      shortcut: String(TRACKER_STATUSES.indexOf(status) + 1),
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
      shortcut: IS_MAC ? "⌘J" : "Ctrl J",
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
      shortcut: IS_MAC ? "⌘," : "Ctrl ,",
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
        <li><button aria-current={activePage === "search-home" ? "page" : undefined} onClick={() => showPage("search-home")}><NavIcon name="search" />Job Search{searchStatus.running ? <span className="side-due" title={searchProgressText(searchStatus)}>Searching…</span> : searchNew > 0 && <span className="side-count" title={`${searchNew} new match${searchNew === 1 ? "" : "es"}`}>{searchNew}</span>}</button></li>
        <li><button aria-current={activePage === "interviews-home" ? "page" : undefined} onClick={() => showPage("interviews-home")}><NavIcon name="interviews" />Interviews{interviewingJobs.length > 0 && <span className="side-count">{interviewingJobs.length}</span>}{newRecordings > 0 && <span className="side-due" title={`${newRecordings} new recording${newRecordings === 1 ? "" : "s"} to import`}>{newRecordings} new</span>}</button></li>
        <li><button aria-current={activePage === "setup-home" ? "page" : undefined} onClick={() => showPage("setup-home")}><NavIcon name="setup" />Setup{readiness && <span className={readiness.ready ? "side-count" : "side-due"} title={readiness.ready ? "Everything required is done" : "A required step is missing"}>{readiness.done} of {readiness.total}</span>}</button></li>
        <li><button aria-current={activePage === "context-home" ? "page" : undefined} onClick={() => showPage("context-home")}><NavIcon name="context" />Career context{newContextFiles.length > 0 && <span className="side-due" title={`${newContextFiles.length} new file${newContextFiles.length === 1 ? "" : "s"} to review`}>{newContextFiles.length} new</span>}<span className="side-count">{sourceCount}</span></button></li>
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
        {!leftPanelOpen && <button className="topbar-home" aria-label="Sensei: all jobs" title="All jobs" onClick={showJobsHome}><span className="wordmark-mark" aria-hidden="true">S</span></button>}
        <button className="topbar-icon" aria-label={leftPanelOpen ? "Hide sidebar" : "Show sidebar"} aria-pressed={leftPanelOpen} title={leftPanelOpen ? "Hide sidebar" : "Show sidebar"} onClick={() => setLeftPanelOpen((open) => !open)}><NavIcon name="sidebar" /></button>
        <nav className="history-controls" aria-label="History">
          <button aria-label="Go back" title="Back" disabled={navigationIndex === 0} onClick={() => navigateHistory(-1)}><span aria-hidden="true">‹</span></button>
          <button aria-label="Go forward" title="Forward" disabled={navigationIndex >= navigationHistory.length - 1} onClick={() => navigateHistory(1)}><span aria-hidden="true">›</span></button>
        </nav>
        {configured && <button className="search-trigger" onClick={() => setSearchOpen(true)}><span>Search jobs, files, and actions</span><kbd>{IS_MAC ? "⌘K" : "Ctrl K"}</kbd></button>}
        <span className="topbar-spacer" />
        {update && <button className="update-pill" onClick={() => void window.sensei.app.openRelease(update.url)} title="Open the release page to download it">Version {update.version} is available</button>}
        <button className="topbar-toggle" aria-pressed={rightPanelOpen} title={`Agy terminal. Context: ${activeContextDetail}`} onClick={() => setRightPanelOpen((open) => !open)}><span className={`status-dot ${configured ? "is-ready" : ""}`} aria-hidden="true" />Agy</button>
        <TopbarMenu
          theme={theme}
          onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
          navigationOpen={leftPanelOpen}
          onToggleNavigation={() => setLeftPanelOpen((open) => !open)}
          onRescan={configured ? () => void refresh() : null}
          notificationsOn={notificationsOn}
          onToggleNotifications={() => setNotificationsOn((on) => { if (!on) void Notification.requestPermission?.(); return !on; })}
          onShowShortcuts={() => setShortcutsOpen(true)}
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
        {needsSetup ? <Onboarding workspace={workspace} profile={candidateProfile} readiness={readiness} onProfileCreated={async (profile) => { setCandidateProfile(profile); await refresh(); await loadReadiness(); }} onProfileSaved={(next) => { if (next) setCandidateProfile(next); }} onChooseBase={async () => { await chooseResume("base"); await loadReadiness(); }} onOpenAgy={() => setRightPanelOpen(true)} onRefresh={() => void loadReadiness()} onAction={runSetupAction} onFinish={finishOnboarding} /> : preview ? <>
          <div className="viewer-header"><div><h1>{preview.name}</h1>{preview.jobCompany && <p className="viewer-subtitle">{[preview.jobCompany, preview.jobTitle].filter(Boolean).join(", ")}</p>}</div><div className="viewer-header-actions"><span className={`label ${preview.canPreview ? "source" : "muted"}`}>{preview.fileType.toUpperCase()}</span><button className="btn-quiet" onClick={closeDocument}>Close</button></div></div>
          <DocumentView key={`${preview.relativePath}:${currentLocation.kind === "document" ? currentLocation.anchor ?? "" : ""}`} preview={preview} isBaseResume={preview.relativePath === baseResume} focusAnchor={currentLocation.kind === "document" ? currentLocation.anchor : undefined} onExported={() => void refresh()} onDirtyChange={setEditorDirty} onSaved={markdownSaved} />
        </> : currentLocation.kind === "job" && viewedJob ? <JobWorkspaceDashboard job={viewedJob} status={applicationStatus} applicationLoading={applicationLoading} overview={interviewOverview} interviewLoading={interviewLoading} jobTree={jobTree} jobActions={jobActions} onStatus={setApplicationStatus} onSelect={selectFile} activeTab={currentLocation.tab} activeRoundId={currentLocation.roundId} onNavigate={openJobView} onInsertPrompt={insertJobPrompt} onUpdateTracker={(update) => updateTracker(viewedJob.id, update)} />
          : currentLocation.kind === "search-home" ? <JobSearchView status={searchStatus} onQueueFound={(id, auto) => queueJob({ kind: "found", id, auto }, !auto)} onOpenJob={openJob} onToast={showToast} />
          : currentLocation.kind === "interviews-home" ? <InterviewsHome jobs={interviewingJobs} allJobs={jobs} newRecordings={newRecordings} onRecordingsChanged={() => void loadRecordings()} onSendPrompt={insertJobPrompt} onOpenFile={(path) => void selectFile(path)} onOpen={(jobId, roundId) => openJobView(jobId, "interview", roundId)} />
          : currentLocation.kind === "setup-home" ? <SetupHome readiness={readiness} profile={candidateProfile} onProfileSaved={(next) => { if (next) setCandidateProfile(next); }} onRefresh={() => void loadReadiness()} onAction={runSetupAction} onReveal={(path) => void window.sensei.files.reveal(path).catch(() => undefined)} onAddLinkedin={() => void chooseResume("linkedin").then(() => loadReadiness())} />
          : currentLocation.kind === "context-home" ? <ContextHome
            onOpen={(path) => void selectFile(path)}
            notice={newContextFiles.length > 0 && <section className="context-block new-files" aria-labelledby="new-files-title">
              <h2 id="new-files-title">New since you last looked</h2>
              <p>Check each one, then tick it below if Agy should use it as evidence.</p>
              <ul>{newContextFiles.map((path) => <li key={path}><button className="btn-link" onClick={() => void selectFile(path)}>{path.replace(/^context\//, "")}</button>{selectedCareerPaths.includes(path) ? <span className="doc-state is-ready">Used by Agy</span> : <span className="doc-state">Not used yet</span>}</li>)}</ul>
              <button className="btn-quiet" onClick={markContextReviewed}>Mark as reviewed</button>
            </section>}
            resumes={<section className="context-block"><h2>Resumes</h2><ResumeSources settings={resumeSettings} selectedPath={selectedPath} onSelect={selectFile} onChoose={chooseResume} onRemoveSecondary={removeSecondary} /></section>}
            sources={<section className="context-block"><h2>Career sources</h2><p>Checked files are what Agy reads as facts about you. Structured files are the strongest evidence.</p><ContextAdder onAdd={(kind, paths) => void addContextFiles(kind, paths)} onReveal={() => void window.sensei.files.reveal("context").catch(() => undefined)} /><div className="context-tree">{tree.length ? tree.map((node) => <TreeNode key={node.relativePath} node={node} selectedPath={selectedPath} baseResume={baseResume} onSelect={selectFile} selectedPaths={selectedCareerPaths} onTogglePath={togglePath} onDelete={deletePath} revealPath={treeRevealPath} />) : <p className="empty-small">No career context folders found.</p>}</div></section>}
            jobFiles={<section className="context-block"><h2>Job files in context</h2><p>Add a job's files when you want Agy to use them outside that job, for example an earlier letter that worked well.</p><button className="btn-link" onClick={() => { setSelectedJobFiles([]); void updateContext(selectedCareerPaths, []); }} disabled={!selectedJobFiles.length}>Clear job files ({selectedJobFiles.length})</button><div className="context-tree">{jobTree.length ? jobTree.map((node) => <TreeNode key={node.relativePath} node={node} selectedPath={selectedPath} baseResume={baseResume} onSelect={selectFile} selectedPaths={selectedJobFiles} onTogglePath={togglePath} onDelete={deletePath} revealPath={treeRevealPath} />) : <p className="empty-small">No job folders yet.</p>}</div></section>}
          />
          : <JobsHome jobs={jobs} onOpenJob={openJob} onOpenJobView={openJobView} onOpenEvaluation={(jobId) => void selectFile(`jobs/${jobId}/evaluation.md`)} onMoveToTrash={(jobId) => deletePath(`jobs/${jobId}`)} onUpdateTracker={updateTracker} onToast={showToast} statusGroup={jobsStatusGroup} onStatusGroup={setJobsStatusGroup} queue={jobQueue} agyReady={agyReady} onOpenAgy={() => setRightPanelOpen(true)} onSaveQueue={(next) => void saveQueue(next)} onQueueJob={queueJob} setup={<SetupLine readiness={readiness} onOpen={() => showPage("setup-home")} />} />}
        {loading && <div className="viewer-state">Reading local workspace…</div>}
        {error && <p className="error-copy viewer-error">{error}</p>}
      </section>
    </div>
    <div className={`panel-resizer is-right ${rightPanelOpen ? "" : "is-collapsed"}`} role="separator" aria-label="Resize terminal panel" aria-orientation="vertical" aria-valuemin={RIGHT_PANEL_MIN} aria-valuemax={panelMaximum("right")} aria-valuenow={rightPanelWidth} tabIndex={rightPanelOpen ? 0 : -1} onPointerDown={(event) => beginPanelResize("right", event)} onKeyDown={(event) => resizePanelWithKeyboard("right", event)} />
    <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    {shortcutsOpen && <ShortcutsPanel onClose={() => setShortcutsOpen(false)} />}
    {companyAsk && <CompanyDialog title={companyAsk.title} onDone={(company) => { companyAsk.resolve(company); setCompanyAsk(null); }} />}
    <TerminalPanel latestRun={latestRun} onQueueJob={queueJob} busyLabel={busyJobLabel} cwd={workspace.repositoryRoot || workspace.path} selectedJobFiles={selectedJobFiles} selectedCareerPaths={selectedCareerPaths} theme={theme} visible={rightPanelOpen && !needsSetup} onClose={() => setRightPanelOpen(false)} jobActions={jobActions} promptRequest={promptRequest} onPromptHandled={(id) => setPromptRequest((request) => request?.id === id ? null : request)} onInsertPrompt={insertJobPrompt} onOpenRun={(run) => { if (run.jobId && jobs.some((job) => job.id === run.jobId)) openJobView(run.jobId, run.kind === "interview" ? "interview" : "application", run.roundId ?? undefined); }} />
  </main>;
}

function NavIcon({ name }: { name: "jobs" | "search" | "interviews" | "context" | "settings" | "sidebar" | "setup" }) {
  const paths: Record<typeof name, string> = {
    jobs: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
    search: "M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M15.5 15.5L20 20",
    interviews: "M5 5h14v10H9l-4 4z M8.5 9.5h7 M8.5 12h4",
    context: "M5 4h10l4 4v12H5z M15 4v4h4 M8 12h8 M8 16h6",
    settings: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1",
    sidebar: "M4 5h16v14H4z M9 5v14",
    setup: "M5 6h14 M5 12h14 M5 18h14 M8 4v4 M15 10v4 M10 16v4",
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

type Toast = { id: number; message: string; undo?: () => void };

/** Short confirmations with Undo, announced to screen readers. */
function ToastRegion({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return <div className="toast-region" role="status" aria-live="polite">
    {toasts.map((toast) => <div key={toast.id} className="toast">
      <span>{toast.message}</span>
      {toast.undo && <button className="btn-link" onClick={() => { toast.undo!(); onDismiss(toast.id); }}>Undo</button>}
      <button className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>×</button>
    </div>)}
  </div>;
}

const SHORTCUTS: Array<[string, string]> = [
  ["⌘K or Ctrl K", "Search jobs, files, and actions"],
  ["g then j / i / c", "Go to Jobs, Interviews, or Career context"],
  ["[ and ]", "Previous or next job (on a job page)"],
  ["1 – 6", "Set the open job to Saved, Applied, Interviewing, Offer, Rejected, Withdrawn"],
  ["⌘J or Ctrl J", "Show or hide Agy"],
  ["⌘, or Ctrl ,", "Settings"],
  ["Alt ← / Alt →", "Back or forward"],
  ["/ and L", "Interview tab: search the round, start live mode"],
  ["?", "This list"],
];

function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const opener = document.activeElement as HTMLElement | null; ref.current?.focus(); return () => opener?.focus?.(); }, []);
  return <div className="search-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="shortcuts-panel" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" tabIndex={-1} ref={ref} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <header><h2 id="shortcuts-title">Keyboard shortcuts</h2><button className="btn-quiet" onClick={onClose}>Close</button></header>
      <dl>{SHORTCUTS.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>)}</dl>
    </div>
  </div>;
}

const HEALTH_GROUPS: Array<{ id: string; title: string; help: string; match: (job: JobFolderSummary) => boolean }> = [
  { id: "tracking", title: "Interviews not recorded", help: "Prep exists or the job reached interviews, but the real interviews and how it ended aren't recorded. This feeds Learnings.", match: (job) => job.health?.tracking === "missing" || job.health?.tracking === "partial" },
  { id: "evaluation-missing", title: "Not rated", help: "No evaluation yet. Send the job to Agy.", match: (job) => job.health?.evaluation === "missing" || job.health?.evaluation === "partial" },
  { id: "evaluation-older", title: "Rated in an older format", help: "The score doesn't rate the posting's own requirements as the app reads them now. A fresh run replaces it.", match: (job) => job.health?.evaluation === "older" },
  { id: "documents", title: "Drafts missing", help: "Rated above the gate, but the resume or cover letter is missing.", match: (job) => job.health?.documents === "missing" || job.health?.documents === "partial" },
  { id: "posting", title: "Posting incomplete", help: "No saved posting, or a posting with no requirement sections.", match: (job) => job.health?.posting === "missing" || job.health?.posting === "partial" },
];

/** Data health: which jobs have gaps in their data, grouped by what's missing, each with the way to fill it. */
function DataHealthPanel({ jobs, onOpenJob, onClose }: { jobs: JobFolderSummary[]; onOpenJob: (jobId: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const opener = document.activeElement as HTMLElement | null; ref.current?.focus(); return () => opener?.focus?.(); }, []);
  const complete = jobs.filter((job) => !HEALTH_GROUPS.some((group) => group.match(job))).length;
  return <div className="search-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="shortcuts-panel health-panel" role="dialog" aria-modal="true" aria-labelledby="health-title" tabIndex={-1} ref={ref} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <header><h2 id="health-title">Data health</h2><button className="btn-quiet" onClick={onClose}>Close</button></header>
      <p className="muted">{complete} of {plural(jobs.length, "job")} have complete data.</p>
      {HEALTH_GROUPS.map((group) => {
        const matching = jobs.filter(group.match);
        if (!matching.length) return null;
        return <details key={group.id} className="health-group" open={group.id === "tracking"}>
          <summary><strong>{group.title}</strong> <span>{matching.length}</span></summary>
          <p className="muted">{group.help}</p>
          <ul>{matching.map((job) => <li key={job.id}><button className="btn-link" onClick={() => { onClose(); onOpenJob(job.id); }}>{job.company ?? displayJobName(job.name)}{job.title ? `, ${job.title}` : ""}</button> <span className="muted">{TRACKER_LABELS[effectiveStatus(job)]}</span></li>)}</ul>
        </details>;
      })}
    </div>
  </div>;
}

/** Settings menu in the top bar: theme, navigation, rescan, and Settings. Keyboard: arrows move, Escape closes. */
function TopbarMenu({ theme, onToggleTheme, navigationOpen, onToggleNavigation, onRescan, onOpenSettings, notificationsOn, onToggleNotifications, onShowShortcuts, note }: { theme: "dark" | "light"; onToggleTheme: () => void; navigationOpen: boolean; onToggleNavigation: () => void; onRescan: (() => void) | null; onOpenSettings: (() => void) | null; notificationsOn: boolean; onToggleNotifications: () => void; onShowShortcuts: () => void; note: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = [
    { label: theme === "dark" ? "Use light theme" : "Use dark theme", run: onToggleTheme },
    { label: navigationOpen ? "Hide sidebar" : "Show sidebar", run: onToggleNavigation },
    { label: notificationsOn ? "Turn notifications off" : "Turn notifications on", run: onToggleNotifications },
    { label: "Keyboard shortcuts  ?", run: onShowShortcuts },
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

type OnboardingStep = "profile" | "resume" | "agy" | "better";
const ONBOARDING_STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: "profile", label: "Your name" },
  { id: "resume", label: "Base resume" },
  { id: "agy", label: "Agy" },
  { id: "better", label: "Make it better" },
];

/**
 * First run: the required steps one at a time, each done inside the app (name, base resume, Agy), then the
 * recommended steps with Skip, ending on adding the first job. Readiness (electron/setup-readiness.ts) decides
 * when each step is done; this screen never keeps its own copy of those rules.
 */
function Onboarding({ workspace, profile, readiness, onProfileCreated, onProfileSaved, onChooseBase, onOpenAgy, onRefresh, onAction, onFinish }: { workspace: WorkspaceSummary; profile: CandidateProfile | null; readiness: Readiness | null; onProfileCreated: (profile: CandidateProfile) => Promise<void>; onProfileSaved: (profile: CandidateProfile | null) => void; onChooseBase: () => Promise<void>; onOpenAgy: () => void; onRefresh: () => void; onAction: (action: ReadinessItem["action"]) => void; onFinish: (destination: "jobs" | "context") => void }) {
  const [editing, setEditing] = useState<ReadinessItem["action"] | null>(null);
  const item = (id: string) => readiness?.items.find((entry) => entry.id === id) ?? null;
  const resume = item("resume");
  const agy = item("agy");
  const [step, setStep] = useState<OnboardingStep>("profile");
  // The starting step is chosen once the profile and readiness have loaded: the first one not done yet.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !readiness) return;
    started.current = true;
    setStep(!profile ? "profile" : resume?.state !== "done" ? "resume" : "agy");
  }, [readiness, profile]);
  const [fullName, setFullName] = useState("");
  const [artifactPrefix, setArtifactPrefix] = useState("");
  const [state, setState] = useState<"idle" | "saving">("idle");
  const [message, setMessage] = useState("");
  // On the Agy step, check every 3 seconds so the step turns green soon after sign-in.
  useEffect(() => {
    if (step !== "agy" || agy?.state === "done") return;
    const timer = window.setInterval(onRefresh, 3000);
    return () => window.clearInterval(timer);
  }, [step, agy?.state]);
  // Move back to an earlier step if its requirement stops being met (for example, the resume file was removed).
  useEffect(() => { if (started.current && !profile && step !== "profile") setStep("profile"); }, [profile, step]);
  function updateName(value: string) {
    setFullName(value);
    if (!artifactPrefix) setArtifactPrefix(value.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
  }
  async function createProfile() {
    if (!fullName.trim() || !artifactPrefix.trim()) return;
    setState("saving");
    setMessage("");
    try {
      await onProfileCreated(await window.sensei.profile.create({ fullName, artifactPrefix }));
      setStep("resume");
    } catch (caught) {
      setMessage(messageOf(caught, "Unable to save your name."));
    } finally { setState("idle"); }
  }
  async function chooseResume() {
    setState("saving");
    try { await onChooseBase(); } finally { setState("idle"); }
  }
  const current = ONBOARDING_STEPS.findIndex((entry) => entry.id === step);
  const recommended = (readiness?.items ?? []).filter((entry) => entry.level === "recommended" && entry.state !== "later");
  return <section className="get-started onboarding" aria-labelledby="onboarding-title">
    <div className="get-started-copy">
      <h1 id="onboarding-title">Get JobSensei ready</h1>
      <p>A few steps, all inside the app. Your files stay on this computer, in your workspace folder; nothing is uploaded except what Agy reads to draft for you.</p>
    </div>
    <ol className="onboarding-steps" aria-label="Setup steps">{ONBOARDING_STEPS.map((entry, index) => <li key={entry.id} className={index < current ? "is-complete" : index === current ? "is-current" : ""} aria-current={index === current ? "step" : undefined}><span>{index < current ? "✓" : index + 1}</span>{entry.label}</li>)}</ol>
    <div className="setup-card onboarding-card">
      {step === "profile" && profile && <>
        <h2>Your name</h2>
        <p>Saved as <strong>{profile.identity.fullName}</strong>; your files start with <code>{profile.identity.artifactPrefix}</code>. You can change it later in Settings.</p>
        <div className="onboarding-actions"><button className="btn-primary" onClick={() => setStep(resume?.state === "done" ? "agy" : "resume")}>Continue</button></div>
      </>}
      {step === "profile" && !profile && <>
        <h2>Your name</h2>
        <p>It goes on every resume and cover letter. The file prefix names your files, like <code>{artifactPrefix || "Alex_Morgan"}_Resume.md</code>.</p>
        <label>Full name<input autoFocus value={fullName} onChange={(event) => updateName(event.target.value)} placeholder="Alex Morgan" /></label>
        <label>File prefix<input value={artifactPrefix} onChange={(event) => setArtifactPrefix(event.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} placeholder="Alex_Morgan" /></label>
        <div className="onboarding-actions"><button className="btn-primary" disabled={!fullName.trim() || !artifactPrefix.trim() || state === "saving"} onClick={() => void createProfile()}>{state === "saving" ? "Saving…" : "Continue"}</button></div>
      </>}
      {step === "resume" && <>
        <h2>Your base resume</h2>
        <p>Choose your best resume as a Word (.docx) or Markdown (.md) file. Every tailored resume keeps its layout, order, and dates. A PDF works only when its Word or Markdown version is in the same folder.</p>
        {resume && resume.state !== "missing" && <div className={`onboarding-result is-${resume.state}`} role="status">
          <strong>{resume.state === "done" ? "Here is what JobSensei read" : "This resume can't be used yet"}</strong>
          <p>{resume.detail}</p>
          {resume.lines.length > 0 && <ul>{resume.lines.map((line) => <li key={line}>{line}</li>)}</ul>}
        </div>}
        <div className="onboarding-actions">
          {resume?.state === "done" && <button className="btn-primary" onClick={() => setStep("agy")}>Looks right</button>}
          <button className={resume?.state === "done" ? "btn-quiet" : "btn-primary"} disabled={state === "saving"} onClick={() => void chooseResume()}>{resume?.state === "missing" || !resume ? "Choose your resume" : "Choose another"}</button>
        </div>
      </>}
      {step === "agy" && <>
        <h2>Sign in to Agy</h2>
        <p>Agy writes your drafts and interview prep. JobSensei gives Agy its own private home, so you sign in once here, even if you use Agy elsewhere.</p>
        <div className={`onboarding-result is-${agy?.state === "done" ? "done" : agy?.state === "problem" ? "problem" : "missing"}`} role="status">
          <strong>{agy?.state === "done" ? "Agy is signed in" : agy?.state === "problem" ? "Agy is waiting for you" : "Not signed in yet"}</strong>
          <p>{agy?.state === "done" ? "You're ready to add jobs." : agy?.detail ?? "Checking…"}</p>
        </div>
        <div className="onboarding-actions">
          {agy?.state === "done" ? <button className="btn-primary" onClick={() => setStep("better")}>Continue</button> : <>
            <button className="btn-primary" disabled={!workspace.agyAvailable} onClick={onOpenAgy}>Open Agy and sign in</button>
            <button className="btn-link" onClick={() => setStep("better")}>Do this later</button>
          </>}
        </div>
        {agy?.state !== "done" && <p className="muted onboarding-note">This page checks again every few seconds. Jobs you add before signing in wait in the queue.</p>}
      </>}
      {step === "better" && <>
        <h2>Make your drafts better</h2>
        <p>None of these are required. Each one makes resumes, letters, or interview prep more yours. You can do them any time from Setup in the sidebar.</p>
        <ul className="onboarding-better">{recommended.map((entry) => <li key={entry.id} className={`is-${entry.state}`}>
          <span className="setup-state">{entry.state === "done" ? "Done" : "To do"}</span>
          <div><strong>{entry.title}</strong><small>{entry.improves}</small></div>
          {entry.state !== "done" && entry.action !== "none" && editing !== entry.action && <button className="btn-quiet" onClick={() => INLINE_SETUP.has(entry.action) ? setEditing(entry.action) : entry.action === "context" ? onFinish("context") : onAction(entry.action)}>{INLINE_SETUP.has(entry.action) ? "Fill in" : entry.action === "context" ? "Add files" : ACTION_LABEL[entry.action] ?? "Open"}</button>}
          {editing === entry.action && <div className="setup-row-editor"><SetupEditor action={entry.action} profile={profile} onSaved={(next) => { onProfileSaved(next); onRefresh(); }} onClose={() => setEditing(null)} /></div>}
        </li>)}</ul>
        <div className="onboarding-actions"><button className="btn-primary" onClick={() => onFinish("jobs")}>Add your first job</button></div>
      </>}
      {message && <p className="inline-error" role="alert">{message}</p>}
    </div>
    {current > 0 && <button className="btn-link onboarding-back" onClick={() => setStep(ONBOARDING_STEPS[current - 1]!.id)}>Back</button>}
  </section>;
}

type JobsFilter = "all" | "active" | "interviewing" | "follow-up" | "review" | "favorites";
type JobsView = "list" | "cards";
type JobsTab = "active" | "interviewing" | "offer" | "reached" | "applied" | "saved" | "closed" | "all";
/** Status subtabs on the Jobs page; Active is the default. */
const JOB_TABS: Array<{ id: JobsTab; label: string; statuses: TrackerStatus[] | null }> = [
  { id: "active", label: "Active", statuses: ["saved", "applied", "interviewing", "offer"] },
  { id: "interviewing", label: "Interviewing", statuses: ["interviewing"] },
  { id: "offer", label: "Offer", statuses: ["offer"] },
  // Every job that got to an interview, whatever its status now (open or closed).
  { id: "reached", label: "Went to interview", statuses: null },
  { id: "applied", label: "Applied", statuses: ["applied"] },
  { id: "saved", label: "Saved", statuses: ["saved"] },
  { id: "closed", label: "Closed", statuses: ["rejected", "withdrawn"] },
  { id: "all", label: "All", statuses: null },
];
const ACTIVE_STATUSES: TrackerStatus[] = ["saved", "applied", "interviewing", "offer"];

function JobsHome({ jobs, onOpenJob, onOpenJobView, onOpenEvaluation, onMoveToTrash, onUpdateTracker, onToast, statusGroup, onStatusGroup: setStatusGroup, queue, agyReady, onOpenAgy, onSaveQueue, onQueueJob, setup }: { agyReady: boolean; onOpenAgy: () => void; onToast: (message: string, undo?: () => void) => void; statusGroup: string | null; onStatusGroup: (group: string | null) => void; queue: JobQueue; onSaveQueue: (queue: JobQueue) => void; onQueueJob: QueueJob; setup: React.ReactNode; jobs: JobFolderSummary[]; onOpenJob: (jobId: string) => void; onOpenJobView: (jobId: string, tab: JobWorkspaceTab, roundId?: string) => void; onOpenEvaluation: (jobId: string) => void; onMoveToTrash: (jobId: string) => void; onUpdateTracker: (jobId: string, update: JobTrackerUpdate, options?: { quiet?: boolean }) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<JobsFilter>("all");
  const [exported, setExported] = useState("");
  const [closing, setClosing] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(storedFavoriteJobIds);
  const [sort, setSort] = useState<"added" | "company" | "role" | "follow-up" | "fit">(() => {
    const stored = window.localStorage.getItem("sensei-jobs-sort");
    return ["added", "company", "role", "follow-up", "fit"].includes(stored ?? "") ? stored as "added" : "added";
  });
  const [view, setView] = useState<JobsView>(() => {
    const stored = window.localStorage.getItem("sensei-jobs-view");
    return stored === "list" ? "list" : "cards";
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
  const tab: JobsTab = JOB_TABS.some((candidate) => candidate.id === statusGroup) ? statusGroup as JobsTab : "active";
  const inTab = (job: JobFolderSummary, value: JobsTab) => { if (value === "reached") return reachedInterview(job); const statuses = JOB_TABS.find((candidate) => candidate.id === value)!.statuses; return !statuses || statuses.includes(effectiveStatus(job)); };
  const filterCounts = Object.fromEntries((["all", "active", "interviewing", "follow-up", "review", "favorites"] as JobsFilter[]).map((value) => [value, jobs.filter((job) => matches(job, value)).length])) as Record<JobsFilter, number>;
  const visibleJobs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const text = (value: string | null | undefined, fallback: string) => (value ?? fallback).toLowerCase();
    return jobs
      .filter((job) => matches(job, filter) && inTab(job, tab) && (!normalized || `${job.company ?? ""} ${job.title ?? ""} ${job.name} ${job.location ?? ""} ${effectiveStatus(job)} ${job.interviewRoundLabel ?? ""} ${job.tracker?.notes ?? ""}`.toLowerCase().includes(normalized)))
      .sort((a, b) => {
        if (sort === "company") return text(a.company, displayJobName(a.name)).localeCompare(text(b.company, displayJobName(b.name)));
        if (sort === "role") return text(a.title, "").localeCompare(text(b.title, ""));
        if (sort === "fit") return (b.rating ?? -1) - (a.rating ?? -1);
        if (sort === "follow-up") return (followUpDays(a.tracker) ?? 9999) - (followUpDays(b.tracker) ?? 9999);
        return Date.parse(b.createdAt) - Date.parse(a.createdAt) || text(a.company, displayJobName(a.name)).localeCompare(text(b.company, displayJobName(b.name)));
      });
  }, [jobs, query, filter, sort, favorites, tab]);
  const stale = staleApplications(jobs);
  async function closeStale() {
    if (!window.confirm(`Mark ${stale.length} application${stale.length === 1 ? "" : "s"} with no reply after ${STALE_DAYS} days as rejected? You can change any of them back later.`)) return;
    setClosing(true);
    const closed = [...stale];
    try { for (const job of closed) await onUpdateTracker(job.id, { status: "rejected" }, { quiet: true }); } finally { setClosing(false); }
    onToast(`Marked ${closed.length} application${closed.length === 1 ? "" : "s"} as rejected`, () => void (async () => { for (const job of closed) await onUpdateTracker(job.id, { status: "applied" }, { quiet: true }); })());
  }
  // Multi-select: click toggles, Shift-click selects the range from the last click, Escape leaves select mode.
  const visibleIds = visibleJobs.map((job) => job.id);
  useEffect(() => { setSelected((current) => { const next = new Set([...current].filter((id) => visibleIds.includes(id))); return next.size === current.size ? current : next; }); }, [visibleIds.join("|")]);
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("[aria-modal='true']")) { setSelecting(false); setSelected(new Set()); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);
  function toggleSelected(jobId: string, event?: { shiftKey?: boolean }) {
    setSelecting(true);
    setSelected((current) => {
      const next = new Set(current);
      if (event?.shiftKey && anchor && visibleIds.includes(anchor)) {
        const [from, to] = [visibleIds.indexOf(anchor), visibleIds.indexOf(jobId)].sort((a, b) => a - b);
        for (const id of visibleIds.slice(from, to + 1)) next.add(id);
      } else if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
    setAnchor(jobId);
  }
  function exitSelect() { setSelecting(false); setSelected(new Set()); setAnchor(null); }
  async function setSelectedStatus(status: TrackerStatus) {
    const chosen = jobs.filter((job) => selected.has(job.id) && effectiveStatus(job) !== status);
    if (!chosen.length) return;
    const before = chosen.map((job) => ({ id: job.id, status: effectiveStatus(job) }));
    setBulkBusy(true);
    try { for (const job of chosen) await onUpdateTracker(job.id, { status }, { quiet: true }); } finally { setBulkBusy(false); }
    onToast(`Marked ${plural(chosen.length, "job")} as ${TRACKER_LABELS[status].toLowerCase()}`, () => void (async () => { for (const item of before) await onUpdateTracker(item.id, { status: item.status }, { quiet: true }); })());
    exitSelect();
  }
  const menuHandlers = (job: JobFolderSummary): JobMenuHandlers => ({ onOpen: () => onOpenJob(job.id), onOpenEvaluation: () => onOpenEvaluation(job.id), onOpenInterview: job.interviewRoundLabel ? () => onOpenJobView(job.id, "interview") : null, onMoveToTrash: () => onMoveToTrash(job.id), onSetStatus: (status) => void onUpdateTracker(job.id, { status }) });
  const filterLabels: Record<JobsFilter, string> = { all: "All", active: "Active", interviewing: "Interviewing", "follow-up": "Follow-up due", review: "Needs review", favorites: "Favorites" };
  const renderJobs = (list: JobFolderSummary[]) => view === "cards" ? <div className="job-card-grid">{list.map((job) => <JobCard key={job.id} job={job} favorite={favorites.has(job.id)} onToggleFavorite={() => toggleFavorite(job.id)} handlers={menuHandlers(job)} selecting={selecting} selected={selected.has(job.id)} onSelect={(event) => toggleSelected(job.id, event as { shiftKey?: boolean })} />)}</div>
      : <div className="jobs-table-wrap"><table className="jobs-table"><thead><tr>{selecting && <th scope="col"><span className="sr-only">Selected</span></th>}<th scope="col">Role</th><th scope="col">Fit</th><th scope="col">Status</th><th scope="col">Interview</th><th scope="col">Next</th><th scope="col" className="col-added">Added</th><th scope="col"><span className="sr-only">Favorite and actions</span></th></tr></thead><tbody>{list.map((job) => <tr key={job.id} tabIndex={0} className={selected.has(job.id) ? "is-selected" : undefined} aria-selected={selecting ? selected.has(job.id) : undefined} onClick={(event) => { if (selecting || event.metaKey || event.ctrlKey) toggleSelected(job.id, event); else onOpenJob(job.id); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); if (selecting) toggleSelected(job.id, event); else onOpenJob(job.id); } }}>{selecting && <td><input type="checkbox" className="job-select" checked={selected.has(job.id)} aria-label={`Select ${job.company ?? displayJobName(job.name)}, ${job.title ?? "role"}`} onClick={(event) => event.stopPropagation()} onChange={(event) => toggleSelected(job.id, { shiftKey: (event.nativeEvent as globalThis.MouseEvent).shiftKey })} /></td>}<td className="jobs-role"><strong>{job.company ?? displayJobName(job.name)}</strong><span>{job.title ?? "Role not recorded"}</span></td><td><FitBadge rating={job.rating} /></td><td><TrackerPill status={effectiveStatus(job)} /></td><td>{job.interviewRoundLabel ? <button className="btn-link" onClick={(event) => { event.stopPropagation(); onOpenJobView(job.id, "interview"); }}>{job.interviewRoundLabel}</button> : <span className="muted">None</span>}</td><td><NextBadge job={job} /></td><td className="tabular muted col-added">{formatJobDate(job.createdAt)}</td><td><button className={`job-favorite ${favorites.has(job.id) ? "is-favorite" : ""}`} aria-pressed={favorites.has(job.id)} aria-label={`Favorite ${job.company ?? displayJobName(job.name)}, ${job.title ?? "role"}`} onClick={(event) => { event.stopPropagation(); toggleFavorite(job.id); }}>{favorites.has(job.id) ? "★" : "☆"}</button><JobMenuButton job={job} handlers={menuHandlers(job)} /></td></tr>)}</tbody></table></div>;
  return <section className="jobs-home">
    <header className="page-head"><div><h1>Jobs</h1><p>{visibleJobs.length === jobs.length ? `${jobs.length} job${jobs.length === 1 ? "" : "s"}` : `${visibleJobs.length} of ${jobs.length} jobs shown`}. Open one to see its application and interview prep.</p></div></header>
    <JobQueueBox queue={queue} jobs={jobs} agyReady={agyReady} onOpenAgy={onOpenAgy} onSave={onSaveQueue} onQueueJob={onQueueJob} onOpenJob={onOpenJob} />
    {setup}
    <SubTabs<JobsTab>
      idPrefix="jobs"
      label="Jobs by status"
      value={tab}
      onChange={(next) => setStatusGroup(next)}
      tabs={JOB_TABS.filter((candidate) => candidate.id !== "offer" || jobs.some((job) => inTab(job, "offer"))).map((candidate) => ({ id: candidate.id, label: candidate.label, count: jobs.filter((job) => inTab(job, candidate.id)).length }))}
    />
    <SubTabPanel idPrefix="jobs" value={tab}>
    <div className="jobs-toolbar">
      <label className="workspace-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search jobs…" aria-label="Search jobs" /></label>
      {(["follow-up", "review", "favorites"] as JobsFilter[]).filter((value) => filterCounts[value] > 0 || filter === value).map((value) => <button key={value} className="filter-toggle" aria-pressed={filter === value} onClick={() => setFilter(filter === value ? "all" : value)}>{filterLabels[value]}<span>{filterCounts[value]}</span></button>)}
      <label className="jobs-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort jobs"><option value="added">Recently added</option><option value="follow-up">Follow-up date</option><option value="fit">Best fit</option><option value="company">Company A-Z</option><option value="role">Role A-Z</option></select></label>
      <button className="filter-toggle" aria-pressed={selecting} title="Select several jobs to change their status at once (or Cmd/Ctrl-click a job)" onClick={() => selecting ? exitSelect() : setSelecting(true)}>{selecting ? "Done" : "Select"}</button>
      <div className="segmented" role="group" aria-label="Layout">{(["cards", "list"] as JobsView[]).map((value) => <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <details className="jobs-more">
        <summary aria-label="More job actions">⋯</summary>
        <div className="jobs-more-menu">
          <button className="menu-item" disabled={!visibleJobs.length} title="Export the jobs shown to a spreadsheet" onClick={() => void window.sensei.jobs.exportCsv(jobsToCsv(visibleJobs)).then((path) => setExported(path ? `Saved ${visibleJobs.length} job${visibleJobs.length === 1 ? "" : "s"} to ${path.split(/[\\/]/).pop()}` : "")).catch(() => setExported("Export failed."))}>Export these jobs to CSV</button>
          <button className="menu-item" onClick={(event) => { (event.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); setHealthOpen(true); }}>Data health</button>
          {stale.length > 0 && <button className="menu-item" disabled={closing} onClick={() => void closeStale()}>{closing ? "Closing…" : `Mark ${stale.length} with no reply for ${STALE_DAYS}+ days as rejected`}</button>}
        </div>
      </details>
    </div>
    {exported && <p className="export-note" role="status">{exported}</p>}
    {selecting && <div className="select-bar" role="toolbar" aria-label="Selected jobs">
      <strong aria-live="polite">{selected.size ? `${plural(selected.size, "job")} selected` : "Click jobs to select them"}</strong>
      <button className="btn-link" onClick={() => setSelected(new Set(visibleIds))}>Select all {visibleIds.length} shown</button>
      {selected.size > 0 && <button className="btn-link" onClick={() => setSelected(new Set())}>Clear</button>}
      <span className="select-bar-actions">
        <span className="muted">Mark as</span>
        {TRACKER_STATUSES.map((status) => <button key={status} className="btn-quiet" disabled={!selected.size || bulkBusy} onClick={() => void setSelectedStatus(status)}>{TRACKER_LABELS[status]}</button>)}
      </span>
    </div>}
    {healthOpen && <DataHealthPanel jobs={jobs} onOpenJob={onOpenJob} onClose={() => setHealthOpen(false)} />}
    {!visibleJobs.length ? <div className="dashboard-empty"><h2>No jobs match this view</h2><p>Clear the search or pick another tab.</p></div>
      : tab === "closed" ? <>
        <section className="jobs-group" aria-labelledby="closed-reached"><h2 id="closed-reached">Reached interviews <span>{visibleJobs.filter(reachedInterview).length}</span></h2><p>Jobs that got to at least one interview: the ones worth a debrief.</p>{visibleJobs.some(reachedInterview) ? renderJobs(visibleJobs.filter(reachedInterview)) : <p className="muted">None yet.</p>}</section>
        <details className="jobs-group"><summary><h2>No interview <span>{visibleJobs.filter((job) => !reachedInterview(job)).length}</span></h2></summary>{renderJobs(visibleJobs.filter((job) => !reachedInterview(job)))}</details>
      </>
      : renderJobs(visibleJobs)}
    </SubTabPanel>
  </section>;
}

/** One line on the Jobs page while setup isn't complete: what is missing, and a link to Setup. */
function SetupLine({ readiness, onOpen }: { readiness: Readiness | null; onOpen: () => void }) {
  if (!readiness) return null;
  const recommended = readiness.items.filter((item) => item.level === "recommended" && item.state === "missing").length;
  if (readiness.ready && !recommended) return null;
  return <section className={`setup-banner${readiness.ready ? "" : " is-blocking"}`} aria-labelledby="setup-banner-title">
    <strong id="setup-banner-title">{readiness.ready ? "Make your drafts better" : "Finish setup before adding jobs"}</strong>
    <span>{readiness.ready ? `${plural(recommended, "recommended step")} left: ${readiness.items.filter((item) => item.level === "recommended" && item.state === "missing").map((item) => item.title.charAt(0).toLowerCase() + item.title.slice(1)).slice(0, 3).join("; ")}${recommended > 3 ? ", …" : ""}.` : readiness.blocker}</span>
    <button className="btn-link" onClick={onOpen}>Open Setup</button>
  </section>;
}

/** Setup items that are filled in right in the row instead of in Settings. */
const INLINE_SETUP: ReadonlySet<ReadinessItem["action"]> = new Set(["story", "logistics", "private-names", "voice"]);
const VOICE_TEMPLATE = [
  "# Application voice profile",
  "- Plain words and short sentences; no buzzwords.",
  "- Sound like a person explaining their own work to a colleague.",
  "- Lead with what you did, then why it mattered.",
  "- Warm and direct: confident, without overselling.",
  "",
].join("\n");

/**
 * A small editor for one Setup item, saved straight to the profile (or the voice file). Each field says where it is
 * used, so nothing is filled in without the user knowing why.
 */
function SetupEditor({ action, profile, onSaved, onClose }: { action: ReadinessItem["action"]; profile: CandidateProfile | null; onSaved: (profile: CandidateProfile | null) => void; onClose: () => void }) {
  // The same reading and saving as Settings (src/shared/profile-fields.ts owns both).
  const logistics = readLogistics(profile);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...readStoryFields(profile),
    ...logistics,
    names: (profile?.truth.confidentialNames ?? []).join("\n"),
    voice: "",
  }));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const voicePath = profile?.sources.applicationVoicePath ?? "context/application_voice_profile.md";
  useEffect(() => {
    if (action !== "voice") return;
    void window.sensei.files.preview(voicePath).then((preview) => setValues((current) => ({ ...current, voice: preview.content?.trim() ? preview.content : VOICE_TEMPLATE }))).catch(() => setValues((current) => ({ ...current, voice: VOICE_TEMPLATE })));
  }, [action, voicePath]);
  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));
  async function save() {
    if (!profile && action !== "voice") return;
    setSaving(true);
    setProblem("");
    try {
      let next: CandidateProfile | null = profile;
      if (action === "story") {
        const story = storyUpdate(values as unknown as StoryFields);
        next = await window.sensei.profile.updateDetails({ transitionSummary: story.transitionSummary });
        next = await window.sensei.profile.updatePreferences({ ...next.preferences, coverLetter: { ...next.preferences.coverLetter, narrativePillars: story.narrativePillars } });
      } else if (action === "logistics") {
        next = await window.sensei.profile.updateDetails({ interviewLogistics: logisticsUpdate(values as unknown as InterviewLogistics) });
      } else if (action === "private-names") {
        next = await window.sensei.profile.updateDetails({ confidentialNames: parseNames(values.names!) });
      } else if (action === "voice") {
        await window.sensei.profile.saveVoice(values.voice!);
      }
      onSaved(next);
      onClose();
    } catch (caught) {
      setProblem(messageOf(caught, "Couldn't save that."));
    } finally { setSaving(false); }
  }
  const field = (key: string, label: string, hint: string, multiline = false) => <label key={key} className="setup-field"><span>{label}</span>
    {multiline ? <textarea rows={2} value={values[key]} onChange={set(key)} placeholder={hint} /> : <input value={values[key]} onChange={set(key)} placeholder={hint} />}
  </label>;
  return <div className="setup-editor">
    {action === "story" && <>
      <p className="muted">Used for cover letters, so they're about you and your path. Your own words; a sentence or two each is enough.</p>
      {field("transitionSummary", "Career direction", "Where your career has been and where you're heading.", true)}
      {field("turningPoints", "Why you made your key moves", "What made you change roles or step outside your comfort zone?", true)}
      {field("workingStyle", "How you work when things go wrong", "How you handle a stuck customer, a failing project, or friction.", true)}
      {field("personalValues", "Who you are beyond the job", "What you care about, as a person.", true)}
    </>}
    {action === "logistics" && <>
      <p className="muted">Used word for word in interview prep and application answers. Leave a field empty if you'd rather not say; it's flagged, never guessed.</p>
      {field("location", "Where you live or will work", "e.g. Denver, CO; open to relocating")}
      {field("workAuthorization", "Work authorization", "e.g. US citizen; no sponsorship needed")}
      {field("compensation", "Pay target", "e.g. $120,000–$140,000 base")}
      {field("noticePeriod", "Start date or notice", "e.g. two weeks' notice")}
      {field("workArrangement", "Work setup you want", "e.g. hybrid or on-site, up to 3 days")}
    </>}
    {action === "private-names" && <>
      <p className="muted">Clients, partners, or projects that must never appear in a resume or cover letter. One per line. Drafts describe them generically instead ("a global retail client").</p>
      <label className="setup-field"><span>Names to keep private</span><textarea rows={4} value={values.names} onChange={set("names")} placeholder={"Orbit Health\nProject Falcon"} /></label>
    </>}
    {action === "voice" && <>
      <p className="muted">A few lines about how you sound. Agy reads them before every letter and answer. Edit the starting lines so they sound like you.</p>
      <label className="setup-field"><span>{voicePath}</span><textarea rows={8} value={values.voice} onChange={set("voice")} /></label>
    </>}
    {problem && <p className="inline-error" role="alert">{problem}</p>}
    <div className="onboarding-actions"><button className="btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button><button className="btn-quiet" onClick={onClose}>Cancel</button></div>
  </div>;
}

const READINESS_STATE: Record<ReadinessItem["state"], string> = { done: "Done", missing: "To do", problem: "Needs a fix", later: "Comes later" };
const ACTION_LABEL: Partial<Record<ReadinessItem["action"], string>> = { profile: "Open Settings", resume: "Choose resume", agy: "Open Agy", context: "Open Career context", story: "Open Settings", logistics: "Open Settings", "private-names": "Open Settings", "other-resumes": "Add a resume", voice: "Open Settings" };

/** Setup: what JobSensei needs (required) and what makes it better (recommended), each with how to do it in the app. */
function SetupHome({ readiness, profile, onProfileSaved, onRefresh, onAction, onReveal, onAddLinkedin }: { readiness: Readiness | null; profile: CandidateProfile | null; onProfileSaved: (profile: CandidateProfile | null) => void; onRefresh: () => void; onAction: (action: ReadinessItem["action"]) => void; onReveal: (path: string) => void; onAddLinkedin: () => void }) {
  useEffect(() => { onRefresh(); }, []);
  const [editing, setEditing] = useState<ReadinessItem["action"] | null>(null);
  if (!readiness) return <section className="setup-home"><p className="muted">Checking your setup…</p></section>;
  const row = (item: ReadinessItem) => <li key={item.id} className={`setup-row is-${item.state}`}>
    <span className="setup-state">{READINESS_STATE[item.state]}</span>
    <div className="setup-text"><strong>{item.title}</strong><p>{item.detail}</p>{item.lines.length > 0 && <ul className="setup-lines">{item.lines.map((line) => <li key={line}>{line}</li>)}</ul>}<small>{item.improves}</small></div>
    <span className="setup-actions">
      {INLINE_SETUP.has(item.action) ? editing !== item.action && <button className={item.state === "done" ? "btn-link" : "btn-quiet"} onClick={() => setEditing(item.action)}>{item.state === "done" ? "Edit" : "Fill in"}</button>
        : item.state !== "done" && item.action !== "none" && ACTION_LABEL[item.action] && <button className={item.level === "required" ? "btn-primary" : "btn-quiet"} onClick={() => onAction(item.action)}>{ACTION_LABEL[item.action]}</button>}
      {item.action === "other-resumes" && <button className="btn-quiet" onClick={onAddLinkedin}>Add LinkedIn export</button>}
      {item.path && <button className="btn-link" onClick={() => onReveal(item.path!)}>Show in {navigator.platform.startsWith("Win") ? "Explorer" : "Finder"}</button>}
    </span>
    {editing === item.action && <div className="setup-row-editor"><SetupEditor action={item.action} profile={profile} onSaved={(next) => { onProfileSaved(next); onRefresh(); }} onClose={() => setEditing(null)} /></div>}
  </li>;
  return <section className="setup-home">
    <header className="page-head"><div><h1>Setup</h1><p>{readiness.ready ? "JobSensei has what it needs. The recommended steps make drafts and interview prep better." : "Finish the required steps so JobSensei can send jobs to Agy."} <button className="btn-link" onClick={onRefresh}>Check again</button> · <button className="btn-link" onClick={() => onReveal("")}>Open your workspace folder</button></p></div></header>
    <section className="iv-section"><h2>Required</h2><ol className="setup-list">{readiness.items.filter((item) => item.level === "required").map(row)}</ol></section>
    <section className="iv-section"><h2>Recommended</h2><ol className="setup-list">{readiness.items.filter((item) => item.level === "recommended").map(row)}</ol></section>
  </section>;
}

const QUEUE_LABEL: Record<JobQueue["items"][number]["status"], string> = { queued: "Waiting", running: "Running in Agy", done: "Done", needs_attention: "Needs attention" };

/** Job links waiting for Agy. With "Run automatically" on, the next link is sent (and run) when Agy is idle. */
type QueueJob = (input: { kind: "link"; url: string } | { kind: "paste"; text: string; note?: string }, manual: boolean) => Promise<number>;

function JobQueueBox({ queue, jobs, agyReady, onOpenAgy, onSave, onQueueJob, onOpenJob }: { queue: JobQueue; jobs: JobFolderSummary[]; agyReady: boolean; onOpenAgy: () => void; onSave: (queue: JobQueue) => void; onQueueJob: QueueJob; onOpenJob: (jobId: string) => void }) {
  const [input, setInput] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const value = input.trim();
  const isLink = /^https?:\/\/[^\s]+$/i.test(value);
  const duplicate = isLink && queue.items.some((item) => item.url === value && item.status !== "done");
  const valid = !adding && !duplicate && (isLink ? value.length <= 400 : value.length >= 400);
  const update = (id: string, patch: Partial<JobQueue["items"][number]>) => onSave({ ...queue, items: queue.items.map((item) => item.id === id ? { ...item, ...patch } : item) });
  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setAdding(true);
    setProblem(null);
    try {
      await onQueueJob(isLink ? { kind: "link", url: value } : { kind: "paste", text: value }, false);
      setInput("");
    } catch (caught) {
      setProblem(messageOf(caught, "That doesn't look like a job description."));
    } finally {
      setAdding(false);
    }
  }
  // Finished items leave the queue (the app prunes them); only waiting, running, and stuck items show.
  const visible = queue.items.filter((item) => item.status !== "done");
  const waiting = queue.items.filter((item) => item.status === "queued").length;
  const QUEUE_LIST = <>
    {visible.length > 0 && <ol className="queue-list" aria-label="Job queue">{visible.map((item) => {
      const job = item.jobId ? jobs.find((candidate) => candidate.id === item.jobId) : null;
      return <li key={item.id} className={`queue-item is-${item.status}`}>
        <span className="queue-state">{QUEUE_LABEL[item.status]}</span>
        <span className="queue-url">{job ? `${job.company ?? displayJobName(job.name)}, ${job.title ?? "role"}` : item.label ?? item.url ?? "Pasted job description"}</span>
        <span className="queue-actions">
          {item.status === "done" && job && <button className="btn-link" onClick={() => onOpenJob(job.id)}>Open job</button>}
          {item.status === "needs_attention" && <button className="btn-link" onClick={() => update(item.id, { status: "queued", sentAt: null, finishedAt: null })}>Try again</button>}
          {item.status !== "running" && <button className="btn-link" onClick={() => onSave({ ...queue, items: queue.items.filter((candidate) => candidate.id !== item.id) })}>Remove</button>}
          {item.status === "running" && <button className="btn-link" onClick={() => update(item.id, { status: "needs_attention", finishedAt: new Date().toISOString() })}>Stop waiting</button>}
        </span>
      </li>;
    })}</ol>}
  </>;
  return <section className="job-queue" aria-labelledby="job-queue-title">
    <form className="add-job" onSubmit={add}>
      <label htmlFor="add-job-url" id="job-queue-title">Add jobs</label>
      <textarea id="add-job-url" rows={isLink || !value ? 1 : 4} value={input} onChange={(event) => { setInput(event.target.value); setProblem(null); }} placeholder="Paste a job link or description" aria-describedby="add-job-help" />
      <button className="btn-primary" disabled={!valid}>Add to queue</button>
      <p id="add-job-help">{problem ?? (duplicate ? "That link is already in the queue." : value && !isLink && value.length < 400 ? "Paste the whole job description, or just its link." : <>Agy runs one job at a time: it reads the posting, scores your fit, and drafts the resume and cover letter.</>)}</p>
      <label className="queue-auto"><input type="checkbox" checked={queue.autoRun} onChange={(event) => onSave({ ...queue, autoRun: event.target.checked })} /> Run automatically when Agy is free</label>
    </form>
    {QUEUE_LIST}
    {queue.autoRun && waiting > 0 && !agyReady && !queue.items.some((item) => item.status === "running") && <p className="queue-wait">{waiting} waiting for Agy. The queue starts by itself once Agy is open and signed in. <button className="btn-link" onClick={onOpenAgy}>Open Agy</button></p>}
    {!queue.autoRun && waiting > 0 && <button className="btn-quiet" onClick={() => onSave({ ...queue, autoRun: true })}>Start the queue ({waiting})</button>}
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

type JobMenuHandlers = { onOpen: () => void; onOpenEvaluation: () => void; onOpenInterview: (() => void) | null; onMoveToTrash: () => void; onSetStatus: (status: TrackerStatus) => void };

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
  // Keep the whole menu on screen: measure it, then shift it up if it would run past the bottom.
  const [menuHeight, setMenuHeight] = useState(460);
  useLayoutEffect(() => { if (ref.current) setMenuHeight(ref.current.offsetHeight); }, []);
  return createPortal(<div ref={ref} role="menu" aria-label={`Actions for ${job.company ?? displayJobName(job.name)}`} className="tree-context-menu job-card-menu" style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 240)), top: Math.max(8, Math.min(at.y, window.innerHeight - menuHeight - 8)), maxHeight: window.innerHeight - 16, overflowY: "auto" }}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }}>
    <p className="job-menu-label" id={`job-menu-status-${job.id}`}>Status</p>
    <div role="group" aria-labelledby={`job-menu-status-${job.id}`} className="job-menu-status">{TRACKER_STATUSES.map((status) => { const current = effectiveStatus(job) === status; return <button key={status} role="menuitemradio" aria-checked={current} className={current ? "is-current" : ""} onClick={() => run(() => { if (!current) handlers.onSetStatus(status); })}><span aria-hidden="true">{current ? "✓" : ""}</span>{TRACKER_LABELS[status]}</button>; })}</div>
    <hr />
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

function JobCard({ job, favorite, onToggleFavorite, handlers, selecting = false, selected = false, onSelect }: { job: JobFolderSummary; favorite: boolean; onToggleFavorite: () => void; handlers: JobMenuHandlers; selecting?: boolean; selected?: boolean; onSelect?: (event: MouseEvent | React.KeyboardEvent, force?: boolean) => void }) {
  // In select mode a click toggles the card; Cmd/Ctrl-click starts selecting from any card.
  const onOpen = handlers.onOpen;
  const onCardClick = (event: MouseEvent) => { if (selecting || event.metaKey || event.ctrlKey) { event.preventDefault(); onSelect?.(event); } else onOpen(); };
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const initials = (job.company ?? displayJobName(job.name)).split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return <article className={`job-card${selecting ? " is-selecting" : ""}${selected ? " is-selected" : ""}`} aria-selected={selecting ? selected : undefined} onClick={onCardClick} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); }}><div className="job-card-heading">{selecting ? <input type="checkbox" className="job-select" checked={selected} aria-label={`Select ${job.company ?? displayJobName(job.name)}, ${job.title ?? "role"}`} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelect?.(event as unknown as MouseEvent)} /> : <span className="company-mark">{initials || "J"}</span>}<div><h2>{job.company ?? displayJobName(job.name)}</h2><p>{job.title ?? "Role not recorded"}</p></div><span className="job-card-badges"><FitBadge rating={job.rating} /><JobMenuButton job={job} handlers={handlers} /></span></div><dl><div><dt>Status</dt><dd><TrackerPill status={effectiveStatus(job)} /></dd></div><div><dt>Interview</dt><dd>{job.interviewRoundLabel ?? "Not prepared"}</dd></div><div><dt>Added</dt><dd className="job-card-added"><span>{formatJobDate(job.createdAt)}</span><button className={`job-favorite ${favorite ? "is-favorite" : ""}`} aria-label={`${favorite ? "Remove" : "Add"} ${job.company ?? displayJobName(job.name)} ${favorite ? "from" : "to"} favorites`} aria-pressed={favorite} title={favorite ? "Remove from favorites" : "Add to favorites"} onClick={(event) => { event.stopPropagation(); onToggleFavorite(); }}>{favorite ? "★" : "☆"}</button></dd></div></dl>{!selecting && <button onClick={(event) => { event.stopPropagation(); onOpen(); }}>Open job</button>}{menu && <JobMenu job={job} at={menu} handlers={handlers} onClose={() => setMenu(null)} />}</article>;
}

function StatusPill({ value }: { value: string }) {
  const spaced = value.replaceAll("_", " ");
  const normalized = spaced.charAt(0).toUpperCase() + spaced.slice(1);
  const tone = /interview|ready|validated|applied/i.test(value) ? "positive" : /review|pending|stale|invalid/i.test(value) ? "warning" : "neutral";
  return <span className={`status-pill is-${tone}`}>{normalized}</span>;
}

function FitBadge({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="fit-badge is-none">—</span>;
  const tone = rating >= 4 ? "high" : rating >= FIT_GATE ? "mid" : "low";
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
    <label className="tracker-notes"><span>Notes</span><textarea rows={1} value={notes} placeholder="Recruiter name, referral, what they said…" onChange={(event) => setNotes(event.target.value)} onBlur={() => { if (notes !== (tracker?.notes ?? "")) void onUpdate({ notes }); }} /></label>
    {history.length > 0 && <details className="must-group"><summary>History ({tracker?.history.length ?? history.length})</summary><ol className="tracker-history" aria-label="Status history">{history.map((event) => <li key={event.at}><TrackerPill status={event.status} /><span className="muted">{new Date(event.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></li>)}</ol></details>}
  </section>;
}

function InterviewsHome({ jobs, allJobs, newRecordings, onRecordingsChanged, onSendPrompt, onOpen, onOpenFile }: { jobs: JobFolderSummary[]; allJobs: JobFolderSummary[]; newRecordings: number; onRecordingsChanged: () => void; onSendPrompt: (action: Pick<JobAction, "prompt" | "label">) => void; onOpen: (jobId: string, roundId?: string) => void; onOpenFile: (path: string) => void }) {
  const [view, setView] = useState<"active" | "past" | "learnings" | "content">("active");
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
  const closed = (job: JobFolderSummary) => ["rejected", "withdrawn"].includes(effectiveStatus(job));
  const renderRows = (list: typeof rows) => <>
    {list.length > 0 && <ul className="interview-rows">{list.map(({ job, overview, round }) => <li key={job.id} className={["rejected", "withdrawn"].includes(effectiveStatus(job)) ? "is-closed" : ""}>
      <button className="interview-row" onClick={() => onOpen(job.id, round?.id)}>
        <span className="interview-row-main"><strong>{job.company ?? displayJobName(job.name)}</strong><span>{job.title ?? "Role not recorded"}</span></span>
        <TrackerPill status={effectiveStatus(job)} />
        <span className="interview-row-round"><strong>{round?.label ?? job.interviewRoundLabel}</strong><span>{round ? (round.scheduledDate ?? (round.status === "prep_ready" ? "Prep ready" : round.status.replace("_", " "))) : "Loading…"}</span></span>
        <span className="interview-row-steps" aria-label={`${overview?.rounds.length ?? 0} rounds`}>{(overview?.rounds ?? []).map((candidate) => <i key={candidate.id} className={`is-${candidate.status} ${candidate.id === round?.id ? "is-current" : ""}`} />)}</span>
      </button>
    </li>)}</ul>}
    {!list.length && <p className="doc-inline-empty">Nothing here.</p>}
  </>;
  return <section className="jobs-home">
    <header className="page-head"><div><h1>Interviews</h1><p>{jobs.length ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} with interview prep. Open one to practice its current round.` : "No interview prep yet. Open a job and prepare its first round when you get the call."}</p></div></header>
    <SubTabs<"active" | "past" | "learnings" | "content">
      idPrefix="ivhome"
      label="Interviews"
      value={view}
      onChange={setView}
      tabs={[{ id: "active", label: "Active", count: rows.filter((row) => !closed(row.job)).length }, { id: "past", label: "Past", count: rows.filter((row) => closed(row.job)).length }, { id: "learnings", label: "Learnings" }, { id: "content", label: "Your content", count: newRecordings || null }]}
    />
    <SubTabPanel idPrefix="ivhome" value={view}>
      {view === "active" && renderRows(rows.filter((row) => !closed(row.job)))}
      {view === "past" && renderRows(rows.filter((row) => closed(row.job)))}
      {view === "learnings" && <LearningsView jobs={allJobs} overviews={overviews} onOpenFile={onOpenFile} />}
      {view === "content" && <YourContent jobs={allJobs} onSendPrompt={onSendPrompt} onChanged={onRecordingsChanged} onOpenFile={onOpenFile} />}
    </SubTabPanel>
  </section>;
}

/**
 * What the search so far says: how far applications got, whether fit predicted interviews, the questions asked most
 * (role memory), delivery fixes, and which stories the prep used most. Computed from the workspace; nothing is saved.
 */
function LearningsView({ jobs, overviews, onOpenFile }: { jobs: JobFolderSummary[]; overviews: Record<string, InterviewOverview | null>; onOpenFile: (path: string) => void }) {
  const [texts, setTexts] = useState<{ memory: string; voice: string; banks: string[]; stories: Record<string, string> }>({ memory: "", voice: "", banks: [], stories: {} });
  const [memoryPath, setMemoryPath] = useState<string | null>(null);
  const bankPaths = useMemo(() => Object.values(overviews).flatMap((overview) => overview?.rounds.map((round) => round.artifactPaths.questionBank).filter((path): path is string => Boolean(path)) ?? []), [overviews]);
  useEffect(() => {
    let cancelled = false;
    const read = (path: string) => window.sensei.files.preview(path).then((preview) => preview.content ?? "").catch(() => "");
    // Role memory files are listed in the index (one per role family); their patterns are combined here.
    const memoryPaths = read("debrief/interview-memory/role-index.json").then((raw) => { try { return ((JSON.parse(raw) as { roles?: Array<{ path?: string }> }).roles ?? []).map((role) => role.path).filter((path): path is string => Boolean(path)); } catch { return []; } });
    void Promise.all([memoryPaths.then((paths) => Promise.all(paths.map(read))), read("profile/interview_voice.md"), Promise.all(bankPaths.map(read)), read("profile/story_bank.md")])
      .then(([memories, voice, banks, stories]) => { if (!cancelled) setTexts({ memory: memories.join("\n\n"), voice, banks, stories: storyTitles(stories) }); });
    void memoryPaths.then((paths) => { if (!cancelled) setMemoryPath(paths[0] ?? null); });
    return () => { cancelled = true; };
  }, [bankPaths.join("|")]);
  const learn = useMemo(() => computeLearnings(jobs), [jobs]);
  const percent = (part: number, whole: number) => whole ? ` · ${Math.round((part / whole) * 100)}%` : "";
  const money = (value: number | null) => value === null ? "—" : `$${Math.round(value / 1000)}k`;
  const storyCounts = new Map<string, number>();
  for (const bank of texts.banks) for (const match of bank.matchAll(/\*\*(?:Proof|Real example|Closest real experience):?\*\*:?[^\n]*/gi)) for (const id of new Set(match[0].match(/\bS\d{1,2}\b/g) ?? [])) storyCounts.set(id, (storyCounts.get(id) ?? 0) + 1);
  const section = (markdown: string, heading: RegExp) => { const lines = markdown.split("\n"); const start = lines.findIndex((line) => /^##\s/.test(line) && heading.test(line)); if (start < 0) return ""; const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line)); return lines.slice(start + 1, end < 0 ? undefined : end).join("\n"); };
  const fixes = section(texts.voice, /delivery fixes/i).split("\n").filter((line) => /^\s*-\s/.test(line)).map((line) => { const [fix, , , status] = line.replace(/^\s*-\s*/, "").split(/\s+—\s+/); return { fix: fix ?? line, status: (status ?? "").replace(/^Status\s*/i, "") }; });
  const recruiterQuestions = section(texts.memory, /^##\s*recruiter/i);
  const managerQuestions = section(texts.memory, /hiring manager/i);
  return <div className="learnings">
    {learn.unrecorded > 0 && <p className="learn-note" role="status">{plural(learn.unrecorded, "job")} with interview prep {learn.unrecorded === 1 ? "has" : "have"} no recorded interviews yet, so {learn.unrecorded === 1 ? "it isn't" : "they aren't"} counted below. Record them in each job's "What happened?" (Jobs ⋯ → Data health lists them).</p>}
    <section className="iv-section">
      <h3>How far applications got</h3>
      <p className="learn-note">Real interviews only, as recorded in each job. Prep alone doesn't count.</p>
      <dl className="learn-stats">
        <div><dt>Applied</dt><dd className="tabular">{learn.applied}</dd></div>
        <div><dt>Got an interview</dt><dd className="tabular">{learn.interviewed}<small>{percent(learn.interviewed, learn.applied)}</small></dd></div>
        {learn.funnel.filter((row) => row.stage !== "recruiter").map((row) => <div key={row.stage}><dt>Reached {STAGE_LABELS[row.stage].toLowerCase()}</dt><dd className="tabular">{row.count}<small>{percent(row.count, learn.interviewed)}</small></dd></div>)}
      </dl>
    </section>
    <section className="iv-section">
      <h3>Did fit predict how far you got?</h3>
      <table className="learn-table"><thead><tr><th>Furthest stage</th><th>Jobs</th><th>Average fit</th></tr></thead>
        <tbody>{learn.fitByStage.map((row) => <tr key={row.stage}><td>{STAGE_LABELS[row.stage]}</td><td className="tabular">{row.jobs}</td><td className="tabular">{row.averageFit?.toFixed(2) ?? "—"}</td></tr>)}</tbody></table>
    </section>
    {(learn.bySetup.length > 0 || learn.pay.interviewed !== null) && <section className="iv-section">
      <h3>Which jobs gave interviews</h3>
      <table className="learn-table"><thead><tr><th>Jobs</th><th>Applied</th><th>Got an interview</th></tr></thead>
        <tbody>{learn.bySetup.map((row) => <tr key={row.label}><td>{row.label}</td><td className="tabular">{row.applied}</td><td className="tabular">{row.interviewed}{percent(row.interviewed, row.applied)}</td></tr>)}</tbody></table>
      <p className="learn-note">Median posted pay: <strong className="tabular">{money(learn.pay.interviewed)}</strong> for jobs with an interview, <strong className="tabular">{money(learn.pay.notInterviewed)}</strong> for the rest.</p>
    </section>}
    {learn.gapTerms.length > 0 && <section className="iv-section">
      <h3>Gaps in applications that got no interview</h3>
      <p className="learn-note">Tools the posting asked for that your evidence didn't cover, counted per job.</p>
      <ul className="learn-fixes">{learn.gapTerms.map((row) => <li key={row.term}><span>{row.term}</span><small>{row.noInterview} with no interview · {row.interviewed} with one</small></li>)}</ul>
    </section>}
    {learn.reasons.length > 0 && <section className="iv-section">
      <h3>Why it ended, in your words</h3>
      <ul className="learn-fixes">{learn.reasons.map((row) => <li key={row.jobId}><span>{row.company}: {row.reason}</span><small>{row.stage}</small></li>)}</ul>
    </section>}
    <section className="iv-section">
      <h3>Questions asked most</h3>
      <div className="learn-columns">
        <div><h4>Recruiter</h4><div className="iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(recruiterQuestions.split("\n").slice(0, 10).join("\n"), [], { readable: true }) }} /></div>
        <div><h4>Hiring manager</h4><div className="iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(managerQuestions.split("\n").slice(0, 8).join("\n"), [], { readable: true }) }} /></div>
      </div>
      {memoryPath && <button className="btn-link" onClick={() => onOpenFile(memoryPath)}>All patterns and interviewer feedback</button>}
    </section>
    {fixes.length > 0 && <section className="iv-section">
      <h3>Delivery fixes</h3>
      <ul className="learn-fixes">{fixes.map((item) => <li key={item.fix}><span>{item.fix}</span><small>{item.status || "no status"}</small></li>)}</ul>
      <button className="btn-link" onClick={() => onOpenFile("profile/interview_voice.md")}>Open interview voice</button>
    </section>}
    {storyCounts.size > 0 && <section className="iv-section">
      <h3>Stories used most in prep</h3>
      <ul className="learn-fixes">{[...storyCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => <li key={id}><span>{id}{texts.stories[id] ? ` · ${texts.stories[id]}` : ""}</span><small>{count} card{count === 1 ? "" : "s"}</small></li>)}</ul>
    </section>}
  </div>;
}

const RECORDING_STATE: Record<RecordingInfo["state"], string> = { new: "New", changed: "Fuller version", imported: "Imported", duplicate: "Duplicate", skipped: "Skipped" };
const CONTENT_SOURCES: Array<{ path: string; title: string; what: string }> = [
  { path: "profile/story_bank.md", title: "Story bank", what: "Your best real examples; each prep round uses different ones." },
  { path: "profile/interview_voice.md", title: "Interview voice", what: "Your phrases, how you structure answers, and the delivery fixes you're working on." },
  { path: "debrief/interview-memory", title: "Role memory", what: "Questions asked most in each round, practical formats, and interviewer feedback." },
  { path: "context/structured/interview-stories.md", title: "Interview stories", what: "Work stories you told in interviews, usable as career evidence once checked in Career context." },
];

/**
 * What Agy uses for interview prep, and the recordings that haven't reached it yet. "Update" sends Agy only the new
 * recordings; afterwards the app compares the content with its backup, puts back anything removed without a better
 * replacement, and shows what changed.
 */
function YourContent({ jobs, onSendPrompt, onChanged, onOpenFile }: { jobs: JobFolderSummary[]; onSendPrompt: (action: Pick<JobAction, "prompt" | "label">) => void; onChanged: () => void; onOpenFile: (path: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof window.sensei.content.recordings>> | null>(null);
  const [review, setReview] = useState<ContentReviewInfo | null>(null);
  const [keepOld, setKeepOld] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = () => window.sensei.content.recordings().then(setData).catch((caught) => setMessage(messageOf(caught, "Couldn't read your recordings.")));
  useEffect(() => { void load(); }, []);
  const jobName = (id: string | null) => { const job = id ? jobs.find((candidate) => candidate.id === id) : null; return job ? `${job.company ?? displayJobName(job.name)}${job.title ? `, ${job.title}` : ""}` : null; };
  const waiting = (data?.recordings ?? []).filter((recording) => recording.state === "new" || recording.state === "changed");
  const flagged = (data?.recordings ?? []).filter((recording) => recording.state === "duplicate");
  async function run(task: () => Promise<void>, failure: string) {
    setBusy(true); setMessage("");
    try { await task(); } catch (caught) { setMessage(messageOf(caught, failure)); } finally { setBusy(false); await load(); onChanged(); }
  }
  const start = () => run(async () => { const prompt = await window.sensei.content.startUpdate(); onSendPrompt({ prompt, label: "Import new recordings" }); }, "Couldn't start the update.");
  const check = () => run(async () => { setReview(await window.sensei.content.reviewUpdate()); setKeepOld(new Set()); }, "Couldn't check the update.");
  const finish = () => run(async () => { const { restored } = await window.sensei.content.finishUpdate([...keepOld]); setReview(null); setMessage(restored ? `Update saved. ${plural(restored, "item")} removed without a better replacement ${restored === 1 ? "was" : "were"} put back.` : "Update saved."); }, "Couldn't finish the update.");
  const undo = () => run(async () => { await window.sensei.content.undoUpdate(); setReview(null); setMessage("The update was undone; your content is back as it was."); }, "Couldn't undo the update.");
  const snippet = (text: string) => text.replace(/^#+\s*|^\s*[-*]\s+|^\|\s*/gm, "").replace(/\s+/g, " ").slice(0, 140);
  return <div className="your-content">
    <section className="iv-section">
      <h3>New recordings</h3>
      <p className="learn-note">Transcripts and notes in your <code>debrief</code> folder that Agy hasn't read yet. An update reads only these, plus the content below, so old recordings are never read again.</p>
      {data?.pending ? <div className="onboarding-result" role="status">
        <strong>Update in progress</strong>
        <p>Agy is importing {plural(data.pending.recordings.length, "recording")} (started {new Date(data.pending.startedAt).toLocaleString()}). Confirm its proposals in the Agy panel; once it has saved, review the changes here.</p>
        <div className="onboarding-actions"><button className="btn-primary" disabled={busy} onClick={() => void check()}>Review changes</button><button className="btn-quiet" disabled={busy} onClick={() => void undo()}>Undo the update</button></div>
      </div> : <>
        {waiting.length ? <ul className="recording-list">{waiting.map((recording) => <li key={recording.path}>
          <span className="setup-state">{RECORDING_STATE[recording.state]}</span>
          <span><strong>{recording.path.replace(/^debrief\//, "")}</strong><small>{jobName(recording.jobId) ?? "Job not matched: Agy will ask which job it was"}</small></span>
          <button className="btn-link" onClick={() => onOpenFile(recording.path)}>Open</button>
          <button className="btn-link" disabled={busy} onClick={() => void run(() => window.sensei.content.skip([recording.path]), "Couldn't skip it.")}>Skip</button>
        </li>)}</ul> : <p className="muted">No new recordings. Add transcripts to <code>debrief/&lt;company&gt;/</code> and they'll show up here.</p>}
        {flagged.length > 0 && <p className="learn-note">{flagged.map((recording) => `${recording.path.replace(/^debrief\//, "")} is an exact copy of ${recording.duplicateOf?.replace(/^debrief\//, "")}`).join("; ")}. Copies are never imported twice; if one is filed under the wrong company, move or delete it.</p>}
        <div className="onboarding-actions"><button className="btn-primary" disabled={busy || !waiting.length} onClick={() => void start()}>{waiting.length ? `Update from ${plural(waiting.length, "new recording")}` : "Nothing new to update"}</button></div>
      </>}
      {message && <p role="status" className="export-note">{message}</p>}
    </section>
    {review && <section className="iv-section content-review" aria-label="What the update changed">
      <h3>What the update changed</h3>
      {!review.changeListFound && <p className="learn-note">Agy didn't write its change list, so anything removed or shortened will be put back.</p>}
      <p>{plural(review.added.length, "addition")} · {plural(review.upgraded.length, "upgrade")} · {plural(review.replaced.length, "replacement")}{review.lost.length ? ` · ${plural(review.lost.length, "item")} removed without a replacement (will be put back)` : ""}</p>
      {review.added.length > 0 && <details><summary>Added</summary><ul>{review.added.slice(0, 30).map((item) => <li key={item.file + item.key}>{snippet(item.text)} <small className="muted">{item.file}</small></li>)}</ul></details>}
      {review.upgraded.length > 0 && <details><summary>Upgraded</summary><ul>{review.upgraded.map(({ after }) => <li key={after.file + after.key}>{snippet(after.text)} <small className="muted">{after.file}</small></li>)}</ul></details>}
      {review.replaced.length > 0 && <div><h4>Replaced by something better</h4><ul className="content-replaced">{review.replaced.map((entry) => { const id = `${entry.before.file}#${entry.before.key}`; return <li key={id}>
        <span><s>{snippet(entry.before.text)}</s> → {snippet(entry.replacement)}{entry.why && <small className="muted"> ({entry.why})</small>}</span>
        <label><input type="checkbox" checked={keepOld.has(id)} onChange={(event) => setKeepOld((current) => { const next = new Set(current); if (event.target.checked) next.add(id); else next.delete(id); return next; })} /> Keep the old version too</label>
      </li>; })}</ul></div>}
      {review.lost.length > 0 && <details open><summary>Removed without a replacement (will be put back)</summary><ul>{review.lost.map(({ before }) => <li key={before.file + before.key}>{snippet(before.text)} <small className="muted">{before.file}</small></li>)}</ul></details>}
      <div className="onboarding-actions"><button className="btn-primary" disabled={busy} onClick={() => void finish()}>Save the update</button><button className="btn-quiet" disabled={busy} onClick={() => void undo()}>Undo everything</button></div>
    </section>}
    <section className="iv-section">
      <h3>What Agy uses for interview prep</h3>
      <ul className="recording-list">{CONTENT_SOURCES.map((source) => <li key={source.path}>
        <span className="setup-state">{source.path.endsWith(".md") ? "File" : "Folder"}</span>
        <span><strong>{source.title}</strong><small>{source.what}</small></span>
        {source.path.endsWith(".md") ? <button className="btn-link" onClick={() => onOpenFile(source.path)}>Open</button> : <button className="btn-link" onClick={() => void window.sensei.files.reveal(source.path).catch(() => undefined)}>Show</button>}
      </li>)}</ul>
    </section>
  </div>;
}

type ContextView = "sources" | "resumes" | "jobs" | "stories" | "voice";

/** Career context: subtabs for sources, resumes, job files, and the profile's story bank and interview voice. */
/**
 * Add career files from the app: pick a kind, then Add files or drop files here. Copies go to context/structured
 * (work records: projects, results, reviews) or context/broad (notes, old letters, anything else) and are checked for Agy.
 */
function ContextAdder({ onAdd, onReveal }: { onAdd: (kind: "structured" | "broad", paths?: string[]) => void; onReveal: () => void }) {
  const [kind, setKind] = useState<"structured" | "broad">("structured");
  const [over, setOver] = useState(false);
  const help = { structured: "Work records: projects, results, performance reviews, a list of what you did at each job. The strongest evidence.", broad: "Notes and other documents: old cover letters, LinkedIn posts, project write-ups. Used for background and voice." } as const;
  return <div className={`context-add${over ? " is-over" : ""}`}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setOver(true); } }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => {
      event.preventDefault();
      setOver(false);
      const paths = [...event.dataTransfer.files].map((file) => window.sensei.files.pathForFile(file)).filter(Boolean);
      if (paths.length) onAdd(kind, paths);
    }}>
    <div className="segmented" role="group" aria-label="Kind of file">
      <button aria-pressed={kind === "structured"} onClick={() => setKind("structured")}>Work records</button>
      <button aria-pressed={kind === "broad"} onClick={() => setKind("broad")}>Notes and documents</button>
    </div>
    <p>{help[kind]}</p>
    <div className="context-add-actions">
      <button className="btn-primary" onClick={() => onAdd(kind)}>Add files</button>
      <span className="muted">or drop files here (Word, PDF, Markdown, text). Copies are added and checked for Agy; your originals stay where they are.</span>
      <button className="btn-link" onClick={onReveal}>Show the context folder</button>
    </div>
  </div>;
}

function ContextHome({ notice, sources, resumes, jobFiles, onOpen }: { notice: React.ReactNode; sources: React.ReactNode; resumes: React.ReactNode; jobFiles: React.ReactNode; onOpen: (path: string) => void }) {
  const [view, setView] = useState<ContextView>("sources");
  return <section className="jobs-home context-home">
    <header className="page-head"><div><h1>Career context</h1><p>The sources Agy treats as facts about you. Source files are only read, never changed.</p></div></header>
    {notice}
    <SubTabs<ContextView>
      idPrefix="ctx"
      label="Career context sections"
      value={view}
      onChange={setView}
      tabs={[{ id: "sources", label: "Sources" }, { id: "resumes", label: "Resumes" }, { id: "jobs", label: "Job files" }, { id: "stories", label: "Story bank" }, { id: "voice", label: "Interview voice" }]}
    />
    <SubTabPanel idPrefix="ctx" value={view}>
      {view === "sources" && sources}
      {view === "resumes" && resumes}
      {view === "jobs" && jobFiles}
      {view === "stories" && <DocInline path="profile/story_bank.md" label="story bank (it is made on your first interview prep)" />}
      {view === "voice" && <DocInline path="profile/interview_voice.md" label="interview voice (it is made when you import an interview)" />}
    </SubTabPanel>
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
  // After a run: the most important warnings from the last check, errors first.
  const allIssues = status?.validation?.issues ?? [];
  const reviewIssues = [...allIssues].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).slice(0, 4);
  function navigateRound(roundId: string) {
    void window.sensei.interviews.setCurrentRound(job.id, roundId).catch(() => undefined);
    onNavigate(job.id, "interview", roundId);
  }
  const tabs: Array<[JobWorkspaceTab, string, number | null]> = [["overview", "Overview", null], ["application", "Application", null], ["interview", "Interview", rounds.length || null], ["files", "Files", files.length]];
  const [appView, setAppView] = useState<ApplicationView>("resume");
  useEffect(() => { setAppView("resume"); }, [job.id]);
  function openChecks() { setAppView("checks"); onNavigate(job.id, "application"); }
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
    </header>
    <div className="workspace-tabs-row">
      <nav className="workspace-tabs" role="tablist" aria-label="Job sections">{tabs.map(([value, label, count]) => <button key={value} role="tab" aria-selected={activeTab === value} className={activeTab === value ? "is-active" : ""} onClick={() => onNavigate(job.id, value, value === "interview" ? activeRoundId : undefined)}>{label}{count !== null && <span>{count}</span>}</button>)}</nav>
      <div className="job-head-actions">
        {jobDescription && <button className="btn-quiet" onClick={() => onSelect(jobDescription.relativePath)}>Job posting</button>}
        <JobPdfExportButton resumePath={resumeMarkdown?.relativePath ?? null} coverLetterPath={coverLetterMarkdown?.relativePath ?? null} />
      </div>
    </div>
    {activeTab === "overview" && <div className="job-overview">
      {next && trackerStatus !== "rejected" && trackerStatus !== "withdrawn" && <section className="next-bar" aria-label="Next step">
        <span className="next-bar-label">Next</span>
        <strong className="next-bar-title" title={`Sends this request to Agy for ${job.company ?? displayJobName(job.name)}, ${job.title ?? "this job"}.`}>{next.label}</strong>
        <button className="btn-primary" onClick={() => onInsertPrompt(next)}>Send to Agy</button>
        {more.length > 0 && <details className="jobs-more next-bar-more"><summary aria-label="Other next steps">More</summary><div className="jobs-more-menu">{more.slice(0, 6).map((action) => <button key={action.id} className="menu-item" onClick={() => onInsertPrompt(action)}>{action.label}</button>)}</div></details>}
      </section>}
      {(trackerStatus === "rejected" || trackerStatus === "withdrawn" || trackerStatus === "interviewing" || trackerStatus === "offer") && <DebriefPanel job={job} closed={trackerStatus === "rejected" || trackerStatus === "withdrawn"} onUpdateTracker={onUpdateTracker} onInsertPrompt={onInsertPrompt} />}
      {reviewIssues.length > 0 && <p className="review-line" role="status">
        <span className={`review-kind ${allIssues.some((issue) => issue.severity === "error") ? "is-error" : ""}`}>{allIssues.some((issue) => issue.severity === "error") ? "Fix" : "Check"}</span>
        <span>{plural(allIssues.length, "thing")} to look at before you send, from the last check.</span>
        <button className="btn-link" onClick={openChecks}>Review</button>
      </p>}
      <div className="overview-cols">
        <div className="overview-col">
          <RolePanel job={job} />
        </div>
        <div className="overview-col">
          <section className="overview-panel">
            <h2>Fit</h2>
            {job.rating === null ? <p className="muted">Not rated yet. Ask Agy to evaluate this job.</p> : <>
              <p className="fit-score"><strong className="tabular">{job.rating.toFixed(1)}</strong> of 5{job.ratingConfidence ? `, ${job.ratingConfidence} confidence` : ""}{evaluation && <> · <button className="btn-link" onClick={() => onSelect(evaluation.relativePath)}>evaluation</button></>}</p>
              <div className="fit-bar" aria-hidden="true"><span style={{ width: `${(job.rating / 5) * 100}%` }} /></div>
              {job.stretch && <StretchSummary stretch={job.stretch} />}
              <MustHaveGroups mustHaves={job.mustHaves} gaps={job.requirementGaps.length ? job.requirementGaps : job.ratingGaps.filter((item) => !/^none\b/i.test(item)).map((item) => item.replace(/^(?:must|req):\d+\s*/i, ""))} />
              {job.mustHaves.length === 0 && job.ratingHighlights.length > 0 && <details className="must-group is-met"><summary>Strengths ({job.ratingHighlights.length})</summary><ul>{job.ratingHighlights.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul></details>}
            </>}
          </section>
          <section className="overview-panel">
            <h2>Interviews</h2>
            {interviewLoading ? <p className="muted">Reading rounds…</p> : rounds.length ? <ol className="round-list">{rounds.map((round) => <li key={round.id}><button className="btn-link" onClick={() => navigateRound(round.id)}>{round.label}</button><span className={`round-state is-${round.status}`}>{round.scheduledDate ?? round.status.replace("_", " ")}</span></li>)}</ol> : <p className="muted">No rounds yet.</p>}
          </section>
          <TrackerPanel job={job} onUpdate={onUpdateTracker} />
        </div>
      </div>
    </div>}
    {activeTab === "application" && <>
      <SubTabs<ApplicationView>
        idPrefix="app"
        label="Application documents"
        value={appView}
        onChange={setAppView}
        tabs={[
          { id: "resume", label: "Resume", disabled: !resumeMarkdown },
          { id: "letter", label: "Cover letter", disabled: !coverLetterMarkdown },
          { id: "questions", label: "Questions" },
          { id: "evaluation", label: "Evaluation", disabled: !evaluation },
          { id: "checks", label: "Checks" },
        ]}
      />
      <SubTabPanel idPrefix="app" value={appView}>
        {appView === "resume" && <DocInline path={resumeMarkdown?.relativePath ?? null} label="resume" />}
        {appView === "letter" && <DocInline path={coverLetterMarkdown?.relativePath ?? null} label="cover letter" />}
        {appView === "questions" && <QuestionsPanel jobId={job.id} />}
        {appView === "evaluation" && <DocInline path={evaluation?.relativePath ?? null} label="evaluation" />}
        {appView === "checks" && <div className="dashboard-stack"><ApplicationHealth job={job} files={applicationFiles} status={status} loading={applicationLoading} onStatus={onStatus} /><section className="context-block"><h2>Application files</h2><ArtifactTable files={applicationFiles} onSelect={onSelect} empty="No application documents found." /></section></div>}
      </SubTabPanel>
    </>}
    {activeTab === "interview" && <InterviewView job={job} overview={overview} loading={interviewLoading} initialRoundId={activeRoundId} onRoundChange={navigateRound} onOpenFile={(path) => onSelect(path)} onInsertPrompt={(text, label) => onInsertPrompt({ prompt: text, label })} />}
    {activeTab === "files" && <FilesTab files={files} onSelect={onSelect} />}
  </section>;
}

type ApplicationView = "resume" | "letter" | "questions" | "evaluation" | "checks";

/** The answers file's sections ("### question" then the answer), so edits made in the file are what's shown and copied. */
function answerSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = markdown.replace(/\r\n?/g, "\n").split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const [label, ...body] = part.split("\n");
    sections.set(label!.trim().toLowerCase(), body.join("\n").trim());
  }
  return sections;
}

/**
 * Written questions from the posting's application form (or pasted here), answered by a background Agy that never
 * touches the terminal. Agy skips logistics and questions nothing real can answer (shown greyed, with "Answer
 * anyway"); write-yourself questions get notes only.
 */
function QuestionsPanel({ jobId }: { jobId: string }) {
  const [state, setState] = useState<QuestionsState | null>(null);
  const [running, setRunning] = useState(false);
  const [file, setFile] = useState<Map<string, string>>(new Map());
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState("");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const answersPath = `jobs/${jobId}/application_answers.md`;
  const readFile = () => void window.sensei.files.preview(answersPath).then((preview) => setFile(answerSections(preview.content ?? ""))).catch(() => setFile(new Map()));
  useEffect(() => {
    let cancelled = false;
    setState(null); setDraft(""); setProblem(""); setEditing(false);
    setFile(new Map());
    void window.sensei.questions.get(jobId).then((result) => {
      if (cancelled) return;
      setState(result.state);
      setRunning(result.running || result.state?.status === "reading" || result.state?.status === "answering");
      // The answers file exists only once something was answered; don't ask for it before.
      if (result.state?.answers.length) readFile();
    });
    const stop = window.sensei.questions.onUpdated((updatedJob, next) => {
      if (updatedJob !== jobId) return;
      setState(next);
      setRunning(next.status === "reading" || next.status === "answering");
      if ((next.status === "done" || next.status === "failed") && next.answers.length) readFile();
    });
    return () => { cancelled = true; stop(); };
  }, [jobId]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  async function submit() {
    if (!draft.trim() || running) return;
    setProblem("");
    try {
      await window.sensei.questions.ask(jobId, draft);
      setDraft("");
      setRunning(true);
    } catch (caught) {
      setProblem(messageOf(caught, "Those questions couldn't be sent."));
    }
  }
  function copy(id: string, text: string) {
    void navigator.clipboard.writeText(text).then(() => { setCopied(id); window.setTimeout(() => setCopied((current) => current === id ? null : current), 1500); });
  }
  const elapsed = state?.startedAt ? Math.max(0, Math.round((now - Date.parse(state.startedAt)) / 1000)) : 0;
  const timer = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const pending = state?.questions.filter((question) => !state.answers.some((answer) => answer.id === question.id)).length ?? 0;
  const status = !state ? null
    : state.status === "reading" ? <>Reading the application form… <span className="tabular">{timer}</span></>
    : state.status === "answering" ? <>Answering {pending || state.questions.length} question{(pending || state.questions.length) === 1 ? "" : "s"}… <span className="tabular">{timer}</span></>
    : state.status === "done" ? <>{state.message ?? <>Answered in {state.durationSeconds ?? 0} s{state.source === "posting" && state.sourceUrl ? " from the posting's application form" : ""}.</>}</>
    : state.status === "failed" ? <>Couldn't answer: {state.message} <button className="btn-link" onClick={() => void window.sensei.questions.retry(jobId).then(() => setRunning(true))}>Retry</button></>
    : <>{state.message}</>;
  if (editing) return <div className="questions-panel">
    <div className="questions-status"><button className="btn-link" onClick={() => { setEditing(false); readFile(); }}>Done editing</button></div>
    <DocInline path={answersPath} label="answers" />
  </div>;
  return <div className="questions-panel">
    {status && <p className={`questions-status is-${state!.status}`} role="status" aria-live="polite">{running && <span className="run-dot" aria-hidden="true" />}{status}</p>}
    {!state && <p className="doc-inline-empty">Written questions from the application form appear here during the application run (Greenhouse, Ashby, and Lever links). For other jobs, paste the questions below.</p>}
    {state && state.questions.length > 0 && <ol className="question-list">{state.questions.map((question) => {
      const answer = state.answers.find((candidate) => candidate.id === question.id);
      const skipped = answer?.decision === "skip";
      const saved = file.get(question.label.toLowerCase());
      const fileBody = saved && saved !== "_No answer yet._" && !saved.startsWith("_Skipped") ? saved : undefined;
      const text = question.writeYourself || skipped ? null : fileBody ?? answer?.text ?? null;
      const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
      const ids = [...(answer?.storyIds ?? []), ...(answer?.evidenceIds ?? [])];
      const limit = question.sentenceLimit ? `${question.sentenceLimit} sentences` : question.wordLimit ? `${question.wordLimit} words` : null;
      return <li key={question.id} className={`question-card ${question.writeYourself ? "is-yourself" : ""} ${skipped ? "is-skipped" : ""}`}>
        <div className="question-head">
          <h3>{question.label}</h3>
          {question.writeYourself && <span className="fit-chip is-learnable">Write yourself</span>}
          {skipped && <span className="fit-chip">Skipped</span>}
        </div>
        {question.writeYourself
          ? <div className="question-notes"><p>The employer asks you to write this one. Notes to draw from:</p><ul>{(answer?.notes ?? []).map((note) => <li key={note}>{note}</li>)}</ul></div>
          : skipped ? <p className="question-skip">{answer?.reason ?? "Not a question to answer here."} <button className="btn-link" disabled={running} onClick={() => void window.sensei.questions.answerAnyway(jobId, question.id).then(() => setRunning(true))}>Answer anyway</button></p>
          : text ? <div className="question-answer iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(text, [], { readable: true }) }} />
          : <p className="doc-inline-empty">{running ? "Answering…" : "No answer yet."}</p>}
        {!skipped && <div className="question-meta">
          {text && <span className={`tabular ${question.wordLimit && words > question.wordLimit ? "is-over" : ""}`}>{words} words{limit ? ` · limit ${limit}` : ""}</span>}
          {ids.length > 0 && <span className="evid" title={ids.join(", ")}>Evidence ⓘ</span>}
          {text && <button className="btn-quiet" onClick={() => copy(question.id, text)}>{copied === question.id ? "Copied" : "Copy"}</button>}
        </div>}
        {(answer?.issues ?? []).map((issue) => <p key={issue} className="question-issue">⚠ {issue}</p>)}
      </li>;
    })}</ol>}
    {state && state.answers.length > 0 && <button className="btn-link" onClick={() => setEditing(true)}>Edit answers</button>}
    <form className="question-paste" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor={`questions-${jobId}`}>Paste questions</label>
      <textarea id={`questions-${jobId}`} rows={3} value={draft} disabled={running} placeholder="One question per line (or separated by blank lines). Enter to answer, Shift+Enter for a new line." onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
      <div className="question-paste-row"><span>{problem || "Answered in the background from your evidence, stories, and the posting; logistics questions are skipped. The terminal is not used."}</span><button className="btn-primary" disabled={running || !draft.trim()}>Answer</button></div>
    </form>
  </div>;
}

/** Asks which company a pasted posting is for, when the paste never names it. */
function CompanyDialog({ title, onDone }: { title: string | null; onDone: (company: string | null) => void }) {
  const [value, setValue] = useState("");
  return <div className="search-overlay" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") onDone(null); }}>
    <form className="company-dialog" role="dialog" aria-modal="true" aria-labelledby="company-dialog-title" onSubmit={(event) => { event.preventDefault(); onDone(value.trim() || null); }}>
      <h2 id="company-dialog-title">Which company is this?</h2>
      <p>The pasted posting{title ? <> for <strong>{title}</strong></> : null} doesn't name the employer. A team or business unit isn't the company.</p>
      <input autoFocus value={value} placeholder="Company name" aria-label="Company name" onChange={(event) => setValue(event.target.value)} />
      <div className="company-dialog-actions">
        <button type="button" className="btn-quiet" onClick={() => onDone(null)}>Skip</button>
        <button className="btn-primary" disabled={!value.trim()}>Add job</button>
      </div>
    </form>
  </div>;
}

/** A job's files in three groups: the application, interview prep, and everything else. */
function FilesTab({ files, onSelect }: { files: FileTreeNode[]; onSelect: (path: string) => void }) {
  const [view, setView] = useState<"application" | "interview" | "other">("application");
  const group = (file: FileTreeNode) => file.relativePath.includes("/interviews/") ? "interview" : /evaluation|resume|cover_letter|original_jd/i.test(file.name) ? "application" : "other";
  const shown = files.filter((file) => group(file) === view);
  return <>
    <SubTabs<"application" | "interview" | "other">
      idPrefix="files"
      label="Job files"
      value={view}
      onChange={setView}
      tabs={(["application", "interview", "other"] as const).map((id) => ({ id, label: id === "application" ? "Application" : id === "interview" ? "Interview" : "Other", count: files.filter((file) => group(file) === id).length }))}
    />
    <SubTabPanel idPrefix="files" value={view}><section className="context-block"><ArtifactTable files={shown} onSelect={onSelect} empty="No files in this group." /></section></SubTabPanel>
  </>;
}

/** What the job is: research summary or responsibilities, company line, and the facts (computed in role-facts.ts). */
function RolePanel({ job }: { job: JobFolderSummary }) {
  const role = job.role;
  if (!role) return null;
  const points = role.summary.length ? role.summary : role.responsibilities;
  // Pay, work setup, and experience always show: a value, or "Not in the posting" (never a silent gap).
  const notStated = <span className="role-missing">Not in the posting</span>;
  const facts = ([
    ["Pay", role.pay ?? notStated],
    ["Work", role.workArrangement ?? job.location ?? notStated],
    ["Experience", role.experience ?? notStated],
    ["Level", role.seniority ? role.seniority[0]!.toUpperCase() + role.seniority.slice(1) : null],
    ["Travel", role.travel],
    ["Authorization", role.workAuthorization],
    ["Must-haves", role.requiredCount ? `${role.requiredCount} in the posting` : null],
    ["Tools", role.tools.length ? role.tools.slice(0, 8).join(", ") : null],
    ["Posting", role.source ? <a href={role.source} title={role.source}>{role.source.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</a> : null],
  ] as Array<[string, React.ReactNode]>).filter((entry) => Boolean(entry[1]));
  return <section className="overview-panel role-panel">
    <h2>Role</h2>
    {role.company && <p className="role-company">{role.company}</p>}
    {points.length > 0 && <ul className="role-points">{points.slice(0, 2).map((point) => <li key={point}>{point}</li>)}</ul>}
    {points.length > 2 && <details className="must-group"><summary>{points.length - 2} more</summary><ul>{points.slice(2).map((point) => <li key={point}>{point}</li>)}</ul></details>}
    {facts.length > 0 && <dl className="role-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    {role.process.length > 0 && <details className="must-group"><summary>Interview process</summary><ul>{role.process.map((step) => <li key={step}>{step}</li>)}</ul></details>}
  </section>;
}

const ROUND_LABELS: Record<InterviewRoundKind, string> = { recruiter: "Recruiter", hiring_manager: "Hiring manager", practical: "Practical", final: "Final panel", other: "Other" };
const RESULT_LABELS: Record<NonNullable<JobOutcome["result"]>, string> = { rejected: "Rejected", withdrew: "I withdrew", no_reply: "No reply", offer: "Offer", accepted: "Accepted", declined: "Declined the offer" };

/**
 * What happened with a job, for learning: the real interviews (prep alone never counts) and, once closed, how it ended
 * and why. Saved in the tracker (`interviews`, `outcome`); an older "Outcome: …" note is read once and moved over.
 */
function DebriefPanel({ job, closed, onUpdateTracker, onInsertPrompt }: { job: JobFolderSummary; closed: boolean; onUpdateTracker: (update: JobTrackerUpdate) => Promise<void>; onInsertPrompt: (action: Pick<JobAction, "prompt" | "label">) => void }) {
  const notes = job.tracker?.notes ?? "";
  const interviews = job.tracker?.interviews ?? [];
  const legacyReason = /^Outcome: (.*)$/m.exec(notes)?.[1] ?? "";
  const outcome = job.tracker?.outcome ?? null;
  const savedReason = outcome?.reason || legacyReason;
  const [reason, setReason] = useState(savedReason);
  const nextRound = INTERVIEW_ROUNDS.find((round) => round !== "other" && !interviews.some((event) => event.round === round)) ?? "other";
  const [round, setRound] = useState<InterviewRoundKind>(nextRound);
  const [date, setDate] = useState("");
  useEffect(() => { setReason(savedReason); }, [job.id, savedReason]);
  useEffect(() => { setRound(nextRound); setDate(""); }, [job.id, interviews.length]);
  const furthestOf = (events: InterviewEvent[]): JobOutcome["stageReached"] => events.map((event) => event.round).filter((value) => value !== "other").sort((x, y) => INTERVIEW_ROUNDS.indexOf(y) - INTERVIEW_ROUNDS.indexOf(x))[0] ?? (events.length ? "other" : "applied");
  const furthest = furthestOf(interviews);
  const status = effectiveStatus(job);
  const defaultResult: JobOutcome["result"] = status === "withdrawn" ? "withdrew" : status === "rejected" ? "rejected" : status === "offer" ? "offer" : null;
  function saveOutcome(change: Partial<JobOutcome>) {
    const next: JobOutcome = { stageReached: furthest, result: outcome?.result ?? defaultResult, reason: savedReason, date: outcome?.date ?? null, ...change };
    const update: JobTrackerUpdate = { outcome: next };
    if (legacyReason) update.notes = notes.replace(/^Outcome: .*$\n?/m, "").trim();
    void onUpdateTracker(update);
  }
  function addInterview() {
    const event: InterviewEvent = { round, date: date || null, note: "", source: "user" };
    const events = [...interviews, event];
    void onUpdateTracker({ interviews: events, ...(outcome ? { outcome: { ...outcome, stageReached: furthestOf(events) } } : {}) });
  }
  const company = job.company ?? displayJobName(job.name);
  const prepared = job.interviewRoundCount ?? 0;
  return <section className="debrief-panel" aria-labelledby="debrief-title">
    <h2 id="debrief-title">What happened? <small>{interviews.length ? `${plural(interviews.length, "interview")} recorded` : prepared ? `Prep for ${plural(prepared, "round")}; record the interviews you actually had` : "Record any interviews you had"}</small></h2>
    {interviews.length > 0 && <ul className="interview-events">{interviews.map((event, index) => <li key={`${event.round}-${index}`}>
      <span>{ROUND_LABELS[event.round]}</span>{event.date && <span className="muted">{event.date}</span>}
      <button className="btn-link" aria-label={`Remove the ${ROUND_LABELS[event.round].toLowerCase()} interview`} onClick={() => void onUpdateTracker({ interviews: interviews.filter((_, other) => other !== index) })}>Remove</button>
    </li>)}</ul>}
    <div className="interview-add">
      <label><span>Interview</span><select value={round} onChange={(event) => setRound(event.target.value as InterviewRoundKind)}>{INTERVIEW_ROUNDS.map((value) => <option key={value} value={value}>{ROUND_LABELS[value]}</option>)}</select></label>
      <label><span>Date (optional)</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <button className="btn-quiet" onClick={addInterview}>Add interview</button>
    </div>
    {closed && <div className="outcome-fields">
      <label><span>Result</span><select value={outcome?.result ?? defaultResult ?? ""} onChange={(event) => saveOutcome({ result: (event.target.value || null) as JobOutcome["result"] })}>
        <option value="">Not set</option>{OUTCOME_RESULTS.map((value) => <option key={value} value={value}>{RESULT_LABELS[value]}</option>)}
      </select></label>
      <label className="outcome-reason"><span>Why it ended, in your words</span><input value={reason} placeholder="e.g. wanted deeper Kubernetes experience" onChange={(event) => setReason(event.target.value)} onBlur={() => { if (reason.trim() !== savedReason || legacyReason) saveOutcome({ reason: reason.trim() }); }} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} /></label>
    </div>}
    {interviews.length > 0 && <button className="btn-link" onClick={() => onInsertPrompt({ prompt: `${company} debrief (job: ${job.id})`, label: "Debrief this interview" })}>Ask Agy to debrief</button>}
  </section>;
}

/**
 * A document shown in place, with the full document view: read it, or press Edit Markdown to change it right here.
 * The file is reread each time the subtab opens, and a save updates the view, so it never shows stale text.
 */
function DocInline({ path, label }: { path: string | null; label: string }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setFailed(false);
    if (!path) return;
    void window.sensei.files.preview(path).then((next) => { if (!cancelled) setPreview(next); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path]);
  if (!path) return <p className="doc-inline-empty">No {label} yet. Ask Agy to draft the application.</p>;
  if (failed) return <p className="doc-inline-empty">The {label} could not be read.</p>;
  if (!preview || preview.relativePath !== path) return <p className="doc-inline-empty">Reading the {label}…</p>;
  return <div className="doc-inline"><DocumentView key={`${preview.relativePath}:${preview.modifiedAt}`} preview={preview} isBaseResume={false} onExported={() => undefined} onDirtyChange={() => undefined} onSaved={async (saved) => setPreview(saved)} /></div>;
}

const STRETCH_LABEL = { low: "Low", medium: "Medium", high: "High" } as const;
const STRETCH_LEVEL = ["As evidence", "Reworded", "Framed stronger", "Not supported"] as const;

/** How far the drafts reach past the evidence: shown beside fit, never part of it. */
function StretchSummary({ stretch }: { stretch: NonNullable<JobFolderSummary["stretch"]> }) {
  return <details className={`stretch-summary is-${stretch.level}`}>
    <summary><span className="stretch-label">Stretch: {STRETCH_LABEL[stretch.level]}</span><span className="muted"> · {stretch.tailoredPercent}% of the resume tailored</span></summary>
    <p className="muted">How far the resume and letter reach past your evidence. {stretch.counts.unsupported} not supported, {stretch.counts.framed} framed stronger, {stretch.counts.reworded} reworded, {stretch.counts.asEvidence} as the evidence says.</p>
    {stretch.top.length > 0 && <ul className="stretch-lines">{stretch.top.map((line) => <li key={line.text}><span className="stretch-tag">{STRETCH_LEVEL[line.level]}</span> {line.text.replace(/[*_`]/g, "")}<span className="muted"> ({line.artifact === "resume" ? "resume" : "letter"}) {line.reason}</span></li>)}</ul>}
  </details>;
}

/** The posting's required items as rated, grouped so blockers and learnable gaps are seen first. */
/** Must-haves as one line, with the groups (blockers, to learn, gaps, met) folded away until opened. */
function MustHaveGroups({ mustHaves, gaps = [] }: { mustHaves: JobFolderSummary["mustHaves"]; gaps?: string[] }) {
  if (!mustHaves.length && !gaps.length) return null;
  const groups: Array<[string, "blocker" | "learnable" | "met"]> = [["Blockers", "blocker"], ["To learn", "learnable"], ["Met", "met"]];
  const met = mustHaves.filter((item) => item.status === "met").length;
  return <div className="must-haves">
    {mustHaves.length > 0 && <p className="must-line"><strong>Must-haves</strong> {met} of {mustHaves.length} met{mustHaves.some((item) => item.status === "blocker") ? " · has a blocker" : ""}</p>}
    {groups.map(([label, status]) => {
      const items = mustHaves.filter((item) => item.status === status);
      return items.length > 0 && <details key={status} className={`must-group is-${status}`} open={status === "blocker"}>
        <summary>{label} ({items.length})</summary>
        <ul>{items.map((item) => <li key={item.requirement}>{item.requirement}</li>)}</ul>
      </details>;
    })}
    {gaps.length > 0 && <details className="must-group is-gap"><summary>Gaps ({gaps.length})</summary><ul>{gaps.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul></details>}
  </div>;
}

/** A result for a page the user may have left: shown in place while it's open, as an app toast once it's gone. */
function useAnnounce() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return (message: string) => { if (!mounted.current) window.dispatchEvent(new CustomEvent("sensei-announce", { detail: message })); };
}

function JobPdfExportButton({ resumePath, coverLetterPath }: { resumePath: string | null; coverLetterPath: string | null }) {
  const announce = useAnnounce();
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
      announce(`Resume and cover letter PDFs saved (${resumePath.split("/")[1] ?? "job"}).`);
    } catch (caught) {
      setState("error");
      setMessage(messageOf(caught, "PDF creation failed."));
      announce(`PDF creation failed: ${messageOf(caught, "unknown error")}`);
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
    {issues.length > 0 && <details className="application-issues" open={issuesOpen} onToggle={(event) => setIssuesOpen(event.currentTarget.open)}><summary>{plural(issues.filter((issue) => issue.severity === "error").length, "error")} and {plural(issues.filter((issue) => issue.severity === "warning").length, "warning")} from the last check</summary>{issues.map((issue, index) => <div className={`application-issue is-${issue.severity}`} key={`${issue.code}-${issue.artifact}-${index}`}><strong>{issue.severity === "warning" ? "Warning" : "Needs review"}</strong><span>{issue.code} · {issue.artifact}</span><p>{issue.message}</p>{issue.explanation && <div className="application-issue-explanation"><span><b>Sentence</b>{issue.explanation.sentence ?? "Unavailable"}</span><span><b>Source</b>{issue.explanation.sources.length ? issue.explanation.sources.map((source, sourceIndex) => <span className="application-issue-source" key={`${source.evidenceId}-${sourceIndex}`}><code>{source.evidenceId}</code> · <code>{source.sourcePath}</code><em>{source.claim}</em></span>) : "Unavailable"}</span></div>}<small>{issue.repairHint}</small></div>)}</details>}
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
  const announce = useAnnounce();
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
      announce(`PDF saved: ${result.relativePath}${result.validationStatus === "warning" ? " (review: 2 pages)" : ""}.`);
      onExported();
    } catch (caught) {
      setState("error");
      setMessage(messageOf(caught, "PDF export failed."));
      announce(`PDF export failed: ${messageOf(caught, "unknown error")}`);
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

const RUN_KIND_LABEL: Record<RunStatus["kind"], string> = { fetch: "Job posting read", application: "Application", interview: "Interview prep" };
const RUN_STATE_LABEL: Record<RunStatus["state"], string> = { running: "Running", passed: "Passed", warnings: "Passed with warnings", failed: "Needs fixes" };

/** The latest pipeline run, refreshed every few seconds while the Agy panel is open. */
function RunStatusBar({ run, onOpen }: { run: RunStatus | null; onOpen: (run: RunStatus) => void }) {
  // The run comes from the app's one run watcher; only the elapsed time ticks here, and only while a run is going.
  const [now, setNow] = useState(Date.now());
  const running = run?.state === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!run) return null;
  const elapsed = Math.max(0, Math.round((now - Date.parse(run.at)) / 1000));
  const duration = run.state === "running" ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` : run.durationSeconds !== null ? `${run.durationSeconds}s` : null;
  const when = run.state === "running" ? null : formatRelativeDate(run.at);
  return <section className={`run-status is-${run.state}`} aria-label="Latest run" aria-live="polite">
    <div className="run-status-line">
      <span className="run-dot" aria-hidden="true" />
      <strong>{RUN_KIND_LABEL[run.kind]}</strong>
      <span className="run-label">{run.label}</span>
      {run.jobId && run.kind !== "fetch" && <button className="btn-link" onClick={() => onOpen(run)}>Open</button>}
    </div>
    <p className="run-status-meta">{[RUN_STATE_LABEL[run.state], duration, run.fitScore !== null ? `fit ${run.fitScore.toFixed(1)}` : null, run.gate, when].filter(Boolean).join(", ")}</p>
    {run.issues.length > 0 && <details className="run-issues"><summary>{run.issues.length === 1 ? "1 issue" : `Top ${run.issues.length} issues`}</summary><ul>{run.issues.map((issue, index) => <li key={`${issue.code}-${index}`} className={`is-${issue.severity}`}><code>{issue.code}</code> {issue.message}</li>)}</ul></details>}
  </section>;
}

function TerminalPanel({ latestRun, cwd, selectedJobFiles, selectedCareerPaths, theme, visible, onClose, jobActions, promptRequest, onPromptHandled, onInsertPrompt, onOpenRun, onQueueJob, busyLabel }: { latestRun: RunStatus | null; onOpenRun: (run: RunStatus) => void; onQueueJob: QueueJob; busyLabel: string | null; cwd: string; selectedJobFiles: string[]; selectedCareerPaths: string[]; theme: "dark" | "light"; visible: boolean; onClose: () => void; jobActions: JobAction[]; promptRequest: PromptRequest | null; onPromptHandled: (id: number) => void; onInsertPrompt: (action: JobAction) => void }) {
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
    if (attachedPaste) {
      // A long paste that is not a job description goes to Agy as one bracketed paste.
      void window.sensei.terminal.write(`\x1b[200~${payload.replace(/\x1b\[20[01]~/g, "")}\x1b[201~`)
        .then(() => window.setTimeout(() => void window.sensei.terminal.write("\r"), 80));
    } else {
      void window.sensei.terminal.write(payload.endsWith("\n") ? payload : `${payload}\r`);
    }
  };

  /** Sends a message to Agy, after asking first if a queued job is running (a new message would interrupt it). */
  const sendToAgy = (text: string, label?: string, attachedPaste?: PastedBlock) => {
    if (busyLabel && !window.confirm(`Agy is working on ${busyLabel}. Send this now? It interrupts that run. Choose Cancel to keep your message and send it when the run is done.`)) {
      setChatInput(text);
      if (attachedPaste) setPastedAttachment(attachedPaste);
      return;
    }
    executeCommand(text, label, attachedPaste);
  };

  /**
   * A pasted JD or a bare job link goes to the job queue, so it never replaces a job that is running.
   * A long paste that is not a job description is sent to Agy as before.
   */
  const queueFromChat = async (text: string, attachedPaste?: PastedBlock) => {
    let ahead: number;
    try {
      ahead = await onQueueJob(attachedPaste ? { kind: "paste", text: attachedPaste.content, note: text } : { kind: "link", url: text }, true);
    } catch (caught) {
      // A link the app couldn't read: say why and ask for a paste (Agy can't fetch it either).
      if (!attachedPaste) {
        const now = Date.now();
        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        setChatEntries((prev) => [...prev,
          { id: `user-${now}`, sender: "user", content: text, timestamp: time },
          { id: `queue-failed-${now}`, sender: "system", title: "Couldn't add this job", content: messageOf(caught, "This posting couldn't be read. Paste the job description instead."), timestamp: time },
        ]);
        return;
      }
      sendToAgy(text, undefined, attachedPaste);
      return;
    }
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const now = Date.now();
    setChatEntries((prev) => [...prev,
      { id: `user-${now}`, sender: "user", content: text, pastedBlock: attachedPaste, timestamp: time },
      { id: `queued-${now}`, sender: "system", title: "Added to the job queue", content: ahead ? `${ahead} ${ahead === 1 ? "job is" : "jobs are"} ahead of it. Agy starts it when the current run finishes.` : "Agy starts it as soon as it is free.", timestamp: time },
    ]);
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
    if (pasteToSend || /^https?:\/\/\S+$/i.test(prompt)) void queueFromChat(prompt, pasteToSend);
    else sendToAgy(prompt);
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
      sendToAgy(promptRequest.text, promptRequest.label);
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

      {visible && <RunStatusBar run={latestRun} onOpen={onOpenRun} />}
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
                      onClick={() => sendToAgy(action.prompt, action.label)}
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
    {open && <div className="job-actions-menu" role="menu" aria-label={`Actions for ${actions[0]?.company ?? "this job"}`}>{actions[0] && <p className="job-actions-for">For {actions[0].company} <code>(job: {actions[0].jobId})</code></p>}{groups.map((group) => {
      const grouped = actions.filter((action) => action.group === group);
      if (!grouped.length) return null;
      return <section key={group}><span>{group}</span>{grouped.map((action) => <button key={action.id} role="menuitem" onClick={() => insert(action)}><strong>{action.label}</strong><small>Inserts the request; you press Enter to run it</small></button>)}</section>;
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
