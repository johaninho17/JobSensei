import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { TRACKER_STATUSES, type JobQueue, type JobTrackerUpdate, type RunStatus, type ApplicationStatus, type CandidateProfile, type ContextManifest, type FilePreview, type FileTreeNode, type InterviewOverview, type JobFolderSummary, type SearchResult, type Settings, type WorkspaceSummary } from "../shared/schemas";
import { advanceQueue, agyReadiness, newQueueItem, promptForItem } from "../shared/job-queue";
import { jobsToCsv } from "../shared/jobs-csv";
import { STALE_DAYS, TRACKER_LABELS, effectiveAppliedAt, effectiveStatus, readyToSend, followUpDays, staleApplications } from "../shared/tracker";
import { type Readiness, type ReadinessItem } from "../shared/readiness";
import { DRAFT_ACTION_ID, buildJobActions, type JobAction } from "./job-actions";
import { SearchPalette, type PaletteAction } from "./SearchPalette";
import { SettingsModal } from "./SettingsModal";
import { InterviewView, LiveWindow } from "./InterviewView";
import { BaseResumeTab, CandidateSettingsTab, ProfilePage } from "./CandidateProfile";
import { RecruiterSettingsDialog } from "./RecruiterSettings";
import { PostingsView } from "./Postings";
import { ReportsView } from "./Reports";
import { CandidateGate, CandidateResumeCard, CandidateSwitcher, RecruiterNotes } from "./Candidates";
import { PipelineView } from "./Pipeline";
import { type CandidatesState } from "../shared/candidates";
import { JobSearchView } from "./JobSearchView";
import { TodayView } from "./TodayView";
import { DocsView } from "./DocsView";
import { findDuplicateJob } from "../shared/job-organize";
import { autoDraftPicks, searchProgressText, type SearchRun, type SearchStatus } from "../shared/job-search";
import { IS_MAC, type JobWorkspaceTab, type PromptRequest, displayJobName, filePaths, findNode, messageOf, plural, workspaceLabel } from "./app-shared";
import { RUN_KIND_LABEL, RUN_STATE_LABEL, TerminalPanel } from "./TerminalPanel";
import { CSV_COLUMNS, JobsHome, SetupLine } from "./JobsHome";
import { ContextAdder, ContextHome, Onboarding, SetupHome } from "./SetupAndContext";
import { DocumentView } from "./Documents";
import { DocInline, JobWorkspaceDashboard } from "./JobWorkspace";
import { InterviewsHome } from "./InterviewsHome";

const emptyWorkspace: WorkspaceSummary = { path: "", repositoryRoot: "", status: "unconfigured", contextFileCount: 0, jobCount: 0, hasIndex: false, hasCandidateProfile: false, hasBaseResume: false, agyAvailable: false, warnings: [] };
const emptySettings: Settings = { schemaVersion: 1, workspacePath: null, baseResumePath: null, secondaryResumePaths: [], linkedinProfilePath: null, updatedAt: "" };
const LEFT_PANEL_MIN = 190;
const LEFT_PANEL_COLLAPSE_THRESHOLD = 120;
const LEFT_PANEL_MAX = 560;
const RIGHT_PANEL_MIN = 300;
const RIGHT_PANEL_MAX = 900;
const VIEWER_PANEL_MIN = 320;
type JobLocation = { kind: "job"; jobId: string; tab: JobWorkspaceTab; roundId?: string };
type PageLocation = { kind: "today-home" } | { kind: "jobs-home" } | { kind: "search-home"; focus?: string } | { kind: "interviews-home" } | { kind: "context-home" } | { kind: "setup-home" } | { kind: "pipeline-home" } | { kind: "docs-home" } | { kind: "postings-home" } | { kind: "reports-home" };
type WorkspaceLocation =
  | PageLocation
  | JobLocation
  | { kind: "document"; relativePath: string; jobId: string | null; anchor?: string; returnTo: JobLocation | PageLocation };

function storedPanelNumber(key: string, fallback: number): number {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function storedPanelOpen(key: string): boolean {
  return window.localStorage.getItem(key) !== "closed";
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  if (FEATURES.interviews && params.get("interviewWorkspace") === "1" && params.get("live") === "1") return <LiveWindow jobId={params.get("jobId") ?? ""} roundId={params.get("roundId") ?? ""} />;
  if (FEATURES.interviews && params.get("interviewWorkspace") === "1") return <InterviewWorkspaceStandalone jobId={params.get("jobId") ?? ""} roundId={params.get("roundId") ?? ""} />;
  // Recruiter Edition: the candidate list comes first; the workspace is the open candidate's folder.
  if (FEATURES.candidates) return <CandidateGate>{(candidates) => <WorkspaceApp candidates={candidates} />}</CandidateGate>;
  return <WorkspaceApp />;
}

function WorkspaceApp({ candidates }: { candidates?: CandidatesState }) {
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
  // The Recruiter Edition starts with the Agy chat hidden (it still runs); the queue and job pages show progress.
  const [rightPanelOpen, setRightPanelOpen] = useState(() => FEATURES.candidates ? window.localStorage.getItem("sensei-right-panel-state") === "open" : storedPanelOpen("sensei-right-panel-state"));
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
  /** A job the user already has (same posting link, or same company and title) is asked about before it is added again. */
  function confirmNotDuplicate(incoming: { url?: string | null; company?: string | null; title?: string | null }): boolean {
    const existing = findDuplicateJob(jobs, incoming);
    if (!existing) return true;
    return window.confirm(`You already have this job: ${[existing.company, existing.title].filter(Boolean).join(", ") || existing.name} (${TRACKER_LABELS[effectiveStatus(existing)].toLowerCase()}, added ${new Date(existing.createdAt).toLocaleDateString()}).\n\nAdd it again anyway?`);
  }
  async function queueJob(input: { kind: "link"; url: string; batch?: { index: number; size: number } } | { kind: "paste"; text: string; note?: string } | { kind: "found"; id: string; auto?: boolean } | { kind: "saved"; jobId: string }, manual: boolean): Promise<number> {
    // The app says what setup is missing before a job reaches Agy (electron/setup-readiness.ts owns the rules).
    const ready = await loadReadiness();
    if (ready && !ready.ready) throw new Error(`${ready.blocker} Open Setup in the sidebar.`);
    // Links are fetched here, by the app: Agy's sandbox has no network. The saved posting is queued like a paste,
    // and a page that can't be read is reported now instead of stalling the queue.
    const item = newQueueItem({ kind: "paste", label: null, note: input.kind === "paste" ? input.note : null }, new Date(), manual);
    if (input.kind === "saved") {
      // A saved job (posting only): its own posting goes to the queue and the drafts land in its folder.
      const meta = await window.sensei.jobs.stageSaved(input.jobId, item.id);
      item.label = [meta.company, meta.title].filter(Boolean).join(", ") || input.jobId;
    } else if (FEATURES.candidates && input.kind !== "found") {
      // Recruiter Edition: the posting is saved once in the library, then copied to each candidate chosen for it.
      let posting = input.kind === "link" ? await window.sensei.candidates.stageLink(input.url, item.id) : await window.sensei.candidates.stagePaste(input.text, item.id);
      if (!posting.company) {
        const firstLine = input.kind === "paste" ? input.text.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean)?.slice(0, 80) ?? null : null;
        const company = await askCompany(posting.title ?? firstLine);
        if (company) posting = await window.sensei.candidates.setPostingCompany(item.id, company);
      }
      // Inside a candidate, a job is for that candidate (plan Q4): no question. Sending one posting to several
      // candidates happens on the recruiter's Postings page.
      if (!candidates?.activeId) throw new Error("Open a candidate first, or add the posting on the Postings page.");
      const sent = await window.sensei.candidates.send(item.id, [candidates.activeId]);
      if (sent.queued.length) showToast(`Queued for ${plural(sent.queued.length, "other candidate")}; their jobs run after this candidate's queue`);
      if (sent.proposed.length) showToast(`Waiting for approval from ${plural(sent.proposed.length, "candidate")}; send them the shortlist from All candidates`);
      if (!sent.active) return 0;
      item.id = sent.active.pasteId;
      item.label = sent.active.label;
      item.url = input.kind === "link" ? input.url : null;
    } else if (input.kind === "found") {
      // A Job Search match: its posting is already saved and cleaned, so it is copied to the queue without a fetch.
      item.label = await window.sensei.jobSearch.stage(input.id, item.id, input.auto === true);
    } else if (input.kind === "link") {
      const meta = await window.sensei.jobs.stageLink(input.url, item.id);
      if (!confirmNotDuplicate({ url: input.url, company: meta.company, title: meta.title })) throw new Error("Not added: you already have this job.");
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
      if (!confirmNotDuplicate({ company: meta.company, title: meta.title ?? firstLine })) throw new Error("Not added: you already have this job.");
      item.label = [meta.company, meta.title ?? firstLine].filter(Boolean).join(", ") || null;
    }
    return addToQueue(item);
  }
  /** Adds a staged posting to this window's queue; returns how many jobs are ahead of it. */
  async function addToQueue(item: JobQueue["items"][number]): Promise<number> {
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
        // Recruiter Edition: move on to the next candidate with jobs waiting. Switching reloads the window, so their
        // jobs run in their own folder with their own Agy.
        if (FEATURES.candidates && !queue.items.some((item) => item.status === "needs_attention")) {
          const next = await window.sensei.candidates.nextQueued().catch(() => null);
          if (next) {
            await saveQueue(queue);
            notify("Moving to the next candidate", `${next.name}: ${plural(next.waiting, "job")} waiting`);
            try { await window.sensei.candidates.switchTo(next.id); window.location.reload(); return; } catch { /* stays on this candidate */ }
          }
        }
        notify("Job queue finished", `${queue.items.filter((item) => item.status === "done").length} drafted, ${queue.items.filter((item) => item.status === "needs_attention").length} need attention`);
      }
      if (JSON.stringify(queue) !== JSON.stringify(queueRef.current)) await saveQueue(queue);
      if (send) { if (!FEATURES.candidates) setRightPanelOpen(true); const text = promptForItem(send); await window.sensei.terminal.write(`${text}\r`); window.dispatchEvent(new CustomEvent("sensei-agy-sent", { detail: { text, label: send.label ?? send.url ?? "Queued job" } })); }
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
    if (FEATURES.applicationQuestions && run?.kind === "application" && run.jobId && (run.state === "running" || Date.now() - Date.parse(run.at) < 15 * 60_000) && !askedQuestions.current.has(run.jobId)) {
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
    if (!FEATURES.nudges || !jobs.length) return;
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
    if (FEATURES.nudges && Date.now() - lastNudge > 7 * 86_400_000) {
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
        const page = FEATURES.interviews || event.key !== "i" ? ({ ...(FEATURES.today ? { t: "today-home" } : {}), j: "jobs-home", i: "interviews-home", c: "context-home" } as Record<string, PageLocation["kind"]>)[event.key] : undefined;
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
  useEffect(() => { if (FEATURES.contentRefresh && workspace.status === "ready") void loadRecordings(); }, [workspace.status, tree]);
  // Setup readiness follows the workspace, profile, settings, and files; while a required step is missing it is
  // checked again every 15 seconds (for example, Agy finishing its sign-in in the panel).
  useEffect(() => { if (workspace.status === "ready") void loadReadiness(); }, [workspace, candidateProfile, resumeSettings, tree, settingsModalOpen]);
  useEffect(() => {
    if (workspace.status !== "ready" || readiness?.ready) return;
    const timer = window.setInterval(() => void loadReadiness(), 15_000);
    return () => window.clearInterval(timer);
  }, [workspace.status, readiness?.ready]);
  useEffect(() => { if (FEATURES.interviewProfile && workspace.status === "ready") void window.sensei.profile.preview().then((preview) => setStoryBankPath(preview.storyBankPath)).catch(() => undefined); }, [workspace.status, jobTree]);
  const [recentJobIds, setRecentJobIds] = useState<string[]>(() => { try { return JSON.parse(window.localStorage.getItem("sensei-recent-jobs") ?? "[]") as string[]; } catch { return []; } });
  useEffect(() => {
    if (!activeJobId) return;
    setRecentJobIds((current) => {
      const next = [activeJobId, ...current.filter((id) => id !== activeJobId)].slice(0, 8);
      try { window.localStorage.setItem("sensei-recent-jobs", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [activeJobId]);
  const [navigationHistory, setNavigationHistory] = useState<WorkspaceLocation[]>([{ kind: FEATURES.today ? "today-home" : "jobs-home" }]);
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
    if (current?.kind === "job" || current?.kind === "today-home" || current?.kind === "search-home" || current?.kind === "interviews-home" || current?.kind === "context-home" || current?.kind === "setup-home" || current?.kind === "pipeline-home" || current?.kind === "docs-home" || current?.kind === "postings-home" || current?.kind === "reports-home") return current;
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

  // Recruiter Edition: a job picked in the Pipeline for another candidate opens once that candidate has loaded.
  useEffect(() => {
    if (!FEATURES.candidates || !jobs.length) return;
    let pending: string | null = null;
    try { pending = window.sessionStorage.getItem("sensei-open-job"); window.sessionStorage.removeItem("sensei-open-job"); } catch { pending = null; }
    if (pending && jobs.some((job) => job.id === pending)) openJob(pending);
  }, [jobs.length > 0]);

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
  function showJobsHome() { showPage(FEATURES.today ? "today-home" : "jobs-home"); }

  function openJobView(jobId: string, tab: JobWorkspaceTab, roundId?: string) {
    const current = navigationHistory[navigationIndex];
    if (current?.kind === "job" && current.jobId === jobId && current.tab === tab && current.roundId === roundId) return;
    pushLocation({ kind: "job", jobId, tab, roundId });
  }

  function insertJobPrompt(action: Pick<JobAction, "prompt" | "label"> & Partial<Pick<JobAction, "id" | "jobId">>) {
    // Drafting a saved job is the app's own step: the job joins the queue (it never interrupts a running job).
    if (action.id === DRAFT_ACTION_ID && action.jobId) { void draftSavedJob(action.jobId); return; }
    promptRequestId.current += 1;
    setRightPanelOpen(true);
    setPromptRequest({ id: promptRequestId.current, text: action.prompt, label: action.label });
  }

  async function draftSavedJob(jobId: string): Promise<void> {
    setError(null);
    try {
      const ahead = await queueJob({ kind: "saved", jobId }, true);
      showToast(`Sent for drafts${ahead ? ` (${ahead} ahead in the queue)` : ""}.`);
    } catch (caught) { setError(messageOf(caught, "Unable to send this job for drafts.")); }
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
    if (!FEATURES.jobSearch) return;
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
    if (!FEATURES.jobSearch) return;
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
    if (!FEATURES.jobSearch) return;
    const onFocus = () => void pickUpScheduled();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void pickUpScheduled(), 60_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [workspace?.path]);
  useEffect(() => {
    if (!FEATURES.jobSearch) return;
    void pickUpScheduled();
    const offStatus = window.sensei.jobSearch.onStatus(setSearchStatus);
    const offFinished = window.sensei.jobSearch.onFinished((run) => searchFinishedRef.current(run));
    const offUpdated = window.sensei.jobSearch.onUpdated((state) => setSearchNew(state.items.filter((item) => item.status === "new").length));
    const offRated = window.sensei.jobSearch.onRated((message) => notify("Light rating finished", message));
    return () => { offStatus(); offFinished(); offUpdated(); offRated(); };
  }, [workspace?.path]);

  // Making a job's PDFs marks a drafted job applied (regular app), with Undo back to Drafted.
  const pdfsCreatedRef = useRef<(jobId: string) => void>(() => undefined);
  pdfsCreatedRef.current = (jobId) => {
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (!FEATURES.pdfsMarkApplied || !job || !readyToSend(job)) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    void updateTracker(jobId, { status: "applied", appliedAt: today }, { quiet: true }).then(() =>
      showToast(`${job.company ?? displayJobName(job.name)}: PDFs made, marked as applied`, () => void updateTracker(jobId, { status: "saved", appliedAt: null, nextFollowUpAt: null }, { quiet: true })));
  };
  useEffect(() => {
    const onPdfs = (event: Event) => pdfsCreatedRef.current(String((event as CustomEvent).detail ?? ""));
    window.addEventListener("sensei-pdfs-created", onPdfs);
    return () => window.removeEventListener("sensei-pdfs-created", onPdfs);
  }, []);

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
  /** Ticks one context file for Agy (recruiter notes are saved as one). */
  async function checkContextPath(path: string) {
    const nextCareerPaths = [...new Set([...selectedCareerPaths, path])];
    setSelectedCareerPaths(nextCareerPaths);
    await refresh();
    await updateContext(nextCareerPaths, selectedJobFiles);
    void loadReadiness();
  }

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
  // The Recruiter Edition has no first-run steps: a candidate is ready once their resume is in (recruiter plan R8).
  const needsSetup = configured && (FEATURES.candidates ? !resumeReady : !workspace.hasCandidateProfile || !resumeReady || (!onboardingDone && workspace.jobCount === 0));
  const activeJobIds = contextManifest?.selectedJobIds ?? [];
  const activeJobs = activeJobIds.map((id) => jobs.find((job) => job.id === id)).filter((job): job is JobFolderSummary => Boolean(job));
  const viewedPath = preview?.relativePath ?? selectedPath;
  const viewedJobId = viewedPath?.match(/^jobs\/([^/]+)/)?.[1] ?? activeJobId;
  const viewedJob = viewedJobId ? jobs.find((job) => job.id === viewedJobId) ?? null : null;
  useEffect(() => {
    let cancelled = false;
    setInterviewOverview(null);
    // Editions without interviews register no interview handlers (src/shared/edition.ts), so nothing is asked for.
    if (!viewedJobId || !FEATURES.interviews) { setInterviewLoading(false); return; }
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
    ...(FEATURES.today ? [{ id: "go-today", title: "Go to Today", subtitle: "Morning search, what's due, insights, and questions", keywords: "home day summary", shortcut: "g t", run: () => showPage("today-home") }] : []),
    { id: "go-docs", title: "Go to Docs", subtitle: "How to get the best results, your data, how Agy uses it, Agy commands", keywords: "help guide documentation commands model theme", run: () => showPage("docs-home") },
    { id: "go-jobs", title: "Go to Jobs", subtitle: "All jobs, the queue, and the status strip", keywords: "home list cards", shortcut: "g j", run: () => showPage("jobs-home") },
    ...(FEATURES.interviews ? [{ id: "go-interviews", title: "Go to Interviews", subtitle: "Every job with interview prep", keywords: "rounds prep", shortcut: "g i", run: () => showPage("interviews-home") }] : []),
    { id: "go-context", title: FEATURES.candidates ? "Go to the candidate's files" : "Go to Career context", subtitle: FEATURES.candidates ? "Their resume, files, and your notes" : "Resumes and sources Agy reads", keywords: "files sources resume", shortcut: "g c", run: () => showPage("context-home") },
    ...[["interviewing", "Interviewing"], ["applied", "Applied"], ["offer", "Offer"], ["closed", "Closed"], ["saved", "Saved"]].map(([group, label]) => ({ id: `filter:${group}`, title: `Show ${label.toLowerCase()} jobs`, subtitle: "Filter the Jobs page by status", keywords: `status:${group} filter`, run: () => { setJobsStatusGroup(group!); showPage("jobs-home"); } })),
    ...recentForStatus.flatMap((job) => TRACKER_STATUSES.filter((status) => status !== effectiveStatus(job)).map((status) => ({ id: `tracker:${job.id}:${status}`, title: `Mark ${job.company ?? displayJobName(job.name)} as ${TRACKER_LABELS[status].toLowerCase()}`, subtitle: job.title ?? "Recent job", keywords: `status ${status}`, run: () => void updateTracker(job.id, { status }) }))),
    { id: "export-csv", title: "Export all jobs to CSV", subtitle: "Save a spreadsheet of every job", keywords: "csv excel spreadsheet download", run: () => void window.sensei.jobs.exportCsv(jobsToCsv(jobs, CSV_COLUMNS)).then((path) => { if (path) showToast(`Saved ${jobs.length} jobs to ${path.split(/[\\/]/).pop()}`); }) },
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
      title: FEATURES.candidates ? "Settings" : "Preferences & Voice Settings",
      subtitle: FEATURES.candidates ? "Candidate details, resume tailoring, what Agy sees, privacy" : "Customize tone, resume tailoring, reusable bullets, and identity",
      keywords: "settings preferences tone voice bullets summary",
      run: () => setSettingsModalOpen(true),
    },
  ];
  const recentJobs = recentJobIds.map((id) => jobs.find((job) => job.id === id)).filter((job): job is JobFolderSummary => Boolean(job)).slice(0, 6);
  const interviewingJobs = jobs.filter((job) => job.interviewRoundLabel);
  const followUpsDue = !FEATURES.nudges ? 0 : jobs.filter((job) => { const days = followUpDays(job.tracker); return days !== null && days <= 0 && !["rejected", "withdrawn"].includes(effectiveStatus(job)); }).length;
  const activePage = currentLocation.kind === "document" ? currentLocation.returnTo.kind : currentLocation.kind;
  const shellStyle = {
    "--right-panel-width": `${rightPanelOpen ? rightPanelWidth : 0}px`,
    "--right-resizer-width": rightPanelOpen ? "7px" : "0px",
  } as CSSProperties;
  const contextSourcesBlock = <section className="context-block"><h2>{FEATURES.candidates ? "Candidate files" : "Career sources"}</h2><p>{FEATURES.candidates ? "Checked files are what Agy may use for this candidate." : "Checked files are what Agy reads as facts about you. Structured files are the strongest evidence."}</p><ContextAdder onAdd={(kind, paths) => void addContextFiles(kind, paths)} onReveal={() => void window.sensei.files.reveal("context").catch(() => undefined)} /><div className="context-tree">{tree.length ? tree.map((node) => <TreeNode key={node.relativePath} node={node} selectedPath={selectedPath} baseResume={baseResume} onSelect={selectFile} selectedPaths={selectedCareerPaths} onTogglePath={togglePath} onDelete={deletePath} revealPath={treeRevealPath} />) : <p className="empty-small">No career context folders found.</p>}</div></section>;
  const contextResumesBlock = <section className="context-block"><h2>Resumes</h2><ResumeSources settings={resumeSettings} selectedPath={selectedPath} onSelect={selectFile} onChoose={chooseResume} onRemoveSecondary={removeSecondary} /></section>;
  const recruiterNotesBlock = FEATURES.candidates ? <RecruiterNotes name={candidateProfile?.identity.fullName ?? null} onSaved={(path) => void checkContextPath(path)} /> : null;
  return <main className={`shell ${leftPanelOpen ? "" : "is-sidebar-closed"}`} style={shellStyle}>
    <nav className="app-sidebar" aria-label="Main" aria-hidden={!leftPanelOpen}>
      <button className="wordmark" aria-label={`${EDITION.productName}: all jobs`} onClick={showJobsHome}><span className="wordmark-mark" aria-hidden="true">S</span><span className="wordmark-name">Sensei{EDITION.subtitle && <small className="wordmark-edition">{EDITION.subtitle}</small>}</span></button>
      {FEATURES.candidates && candidates && <>
        {/* Recruiter Edition (plan Q1): the recruiter's own pages, then the open candidate's workspace. */}
        <h2 className="side-group-title">Recruiter</h2>
        <ul className="side-nav">
          <li><button onClick={() => void window.sensei.candidates.showAll().then(() => window.location.reload())}><NavIcon name="people" />Candidates<span className="side-count">{candidates.candidates.filter((candidate) => candidate.status !== "archived").length}</span></button></li>
          <li><button aria-current={activePage === "pipeline-home" ? "page" : undefined} onClick={() => showPage("pipeline-home")}><NavIcon name="pipeline" />Pipeline</button></li>
          <li><button aria-current={activePage === "postings-home" ? "page" : undefined} onClick={() => showPage("postings-home")}><NavIcon name="jobs" />Postings</button></li>
          <li><button aria-current={activePage === "reports-home" ? "page" : undefined} onClick={() => showPage("reports-home")}><NavIcon name="today" />Reports</button></li>
        </ul>
        <CandidateSwitcher state={candidates} />
      </>}
      <ul className="side-nav">
        {FEATURES.today && <li><button aria-current={activePage === "today-home" ? "page" : undefined} onClick={() => showPage("today-home")}><NavIcon name="today" />Today</button></li>}
        <li><button aria-current={activePage === "jobs-home" ? "page" : undefined} onClick={() => showPage("jobs-home")}><NavIcon name="jobs" />Jobs{followUpsDue > 0 && <span className="side-due" title={`${followUpsDue} follow-up${followUpsDue === 1 ? "" : "s"} due`}>{followUpsDue} due</span>}<span className="side-count">{jobs.length}</span></button></li>
        {FEATURES.jobSearch && <li><button aria-current={activePage === "search-home" ? "page" : undefined} onClick={() => showPage("search-home")}><NavIcon name="search" />Job Search{searchStatus.running ? <span className="side-due" title={searchProgressText(searchStatus)}>Searching…</span> : searchNew > 0 && <span className="side-count" title={`${searchNew} new match${searchNew === 1 ? "" : "es"}`}>{searchNew}</span>}</button></li>}
        {FEATURES.interviews && <li><button aria-current={activePage === "interviews-home" ? "page" : undefined} onClick={() => showPage("interviews-home")}><NavIcon name="interviews" />Interviews{interviewingJobs.length > 0 && <span className="side-count">{interviewingJobs.length}</span>}{newRecordings > 0 && <span className="side-due" title={`${newRecordings} new recording${newRecordings === 1 ? "" : "s"} to import`}>{newRecordings} new</span>}</button></li>}
        <li><button aria-current={activePage === "setup-home" ? "page" : undefined} onClick={() => showPage("setup-home")}><NavIcon name="setup" />{FEATURES.candidates ? "Profile" : "Setup"}{readiness && (FEATURES.candidates ? <span className={readiness.ready ? "side-count" : "side-due"}>{readiness.ready ? "Ready" : "Needs a resume"}</span> : <span className={readiness.ready ? "side-count" : "side-due"} title={readiness.ready ? "Everything required is done" : "A required step is missing"}>{readiness.done} of {readiness.total}</span>)}</button></li>
        {!FEATURES.candidates && <li><button aria-current={activePage === "context-home" ? "page" : undefined} onClick={() => showPage("context-home")}><NavIcon name="context" />Career context{FEATURES.nudges && newContextFiles.length > 0 && <span className="side-due" title={`${newContextFiles.length} new file${newContextFiles.length === 1 ? "" : "s"} to review`}>{newContextFiles.length} new</span>}<span className="side-count">{sourceCount}</span></button></li>}
      </ul>
      {!FEATURES.candidates && recentJobs.length > 0 && <section className="side-recent" aria-labelledby="side-recent-title">
        <h2 id="side-recent-title">Recent jobs</h2>
        <ul>{recentJobs.map((job) => <li key={job.id}><button aria-current={activePage === "job" && viewedJobId === job.id ? "page" : undefined} onClick={() => openJob(job.id)}><strong>{job.company ?? displayJobName(job.name)}</strong><small>{job.title ?? "Role not recorded"}</small></button></li>)}</ul>
      </section>}
      <div className="side-foot">
        <button aria-current={activePage === "docs-home" ? "page" : undefined} onClick={() => showPage("docs-home")}><NavIcon name="docs" />Docs</button>
        <button onClick={() => setSettingsModalOpen(true)} disabled={!configured}><NavIcon name="settings" />Settings</button>
      </div>
    </nav>
    <div className="shell-main">
      <header className="topbar">
        {!leftPanelOpen && <button className="topbar-home" aria-label={`${EDITION.productName}: all jobs`} title="All jobs" onClick={showJobsHome}><span className="wordmark-mark" aria-hidden="true">S</span>{EDITION.badge && <span className="edition-badge" title={EDITION.productName}>{EDITION.badge}</span>}</button>}
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
      {FEATURES.candidates ? settingsModalOpen && <RecruiterSettingsDialog onClose={() => setSettingsModalOpen(false)} /> : <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        profile={candidateProfile}
        settings={resumeSettings}
        onProfileUpdated={(updated) => setCandidateProfile(updated)}
        onSettingsUpdated={(updated) => setResumeSettings(updated)}
      />}
      <section className="viewer-panel">
        {needsSetup ? FEATURES.candidates ? <CandidateResumeCard name={candidateProfile?.identity.fullName ?? null} problem={readiness?.items.find((item) => item.id === "resume")?.state === "problem" ? readiness.items.find((item) => item.id === "resume")!.detail : null} onChoose={async () => { await chooseResume("base"); await loadReadiness(); }} /> : <Onboarding workspace={workspace} profile={candidateProfile} readiness={readiness} onProfileCreated={async (profile) => { setCandidateProfile(profile); await refresh(); await loadReadiness(); }} onProfileSaved={(next) => { if (next) setCandidateProfile(next); }} onChooseBase={async () => { await chooseResume("base"); await loadReadiness(); }} onOpenAgy={() => setRightPanelOpen(true)} onRefresh={() => void loadReadiness()} onAction={runSetupAction} onFinish={finishOnboarding} /> : preview ? <>
          <div className="viewer-header"><div><h1>{preview.name}</h1>{preview.jobCompany && <p className="viewer-subtitle">{[preview.jobCompany, preview.jobTitle].filter(Boolean).join(", ")}</p>}</div><div className="viewer-header-actions"><span className={`label ${preview.canPreview ? "source" : "muted"}`}>{preview.fileType.toUpperCase()}</span><button className="btn-quiet" onClick={closeDocument}>Close</button></div></div>
          <DocumentView key={`${preview.relativePath}:${currentLocation.kind === "document" ? currentLocation.anchor ?? "" : ""}`} preview={preview} isBaseResume={preview.relativePath === baseResume} focusAnchor={currentLocation.kind === "document" ? currentLocation.anchor : undefined} onExported={() => void refresh()} onDirtyChange={setEditorDirty} onSaved={markdownSaved} />
        </> : currentLocation.kind === "job" && viewedJob ? <JobWorkspaceDashboard job={viewedJob} status={applicationStatus} applicationLoading={applicationLoading} overview={interviewOverview} interviewLoading={interviewLoading} jobTree={jobTree} jobActions={jobActions} onStatus={setApplicationStatus} onSelect={selectFile} activeTab={currentLocation.tab} activeRoundId={currentLocation.roundId} onNavigate={openJobView} onInsertPrompt={insertJobPrompt} onUpdateTracker={(update) => updateTracker(viewedJob.id, update)} />
          : FEATURES.today && currentLocation.kind === "today-home" ? <TodayView onOpenJob={openJob} onToast={showToast}
              onOpenMatch={(id) => pushLocation({ kind: "search-home", focus: id })}
              onQueueFound={(id) => queueJob({ kind: "found", id, auto: false }, true)}
              onGo={(target) => showPage(({ setup: "setup-home", jobs: "jobs-home", "job-search": "search-home", interviews: "interviews-home", learnings: "interviews-home", context: "context-home" } as const)[target])}
              onAnswerAddedFile={(path) => void updateContext([...new Set([...selectedCareerPaths, path])], selectedJobFiles)} />
          : FEATURES.jobSearch && currentLocation.kind === "search-home" ? <JobSearchView key={currentLocation.focus ?? ""} status={searchStatus} focusId={currentLocation.focus} onQueueFound={(id, auto) => queueJob({ kind: "found", id, auto }, !auto)} onQueueSaved={(jobId) => queueJob({ kind: "saved", jobId }, true)} onOpenJob={openJob} onToast={showToast} />
          : FEATURES.interviews && currentLocation.kind === "interviews-home" ? <InterviewsHome jobs={interviewingJobs} allJobs={jobs} newRecordings={newRecordings} onRecordingsChanged={() => void loadRecordings()} onSendPrompt={insertJobPrompt} onOpenFile={(path) => void selectFile(path)} onOpen={(jobId, roundId) => openJobView(jobId, "interview", roundId)} />
          : FEATURES.candidates && currentLocation.kind === "postings-home" ? <PostingsView activeId={candidates?.activeId ?? null} onToast={showToast} onActive={async (pasteId, label, url) => {
            const item = newQueueItem({ kind: "paste", label }, new Date(), false);
            item.id = pasteId;
            item.url = url;
            await addToQueue(item);
          }} />
          : FEATURES.candidates && currentLocation.kind === "reports-home" ? <ReportsView />
          : FEATURES.candidates && currentLocation.kind === "pipeline-home" ? <PipelineView activeId={candidates?.activeId ?? null} onToast={showToast} onOpenJob={(candidateId, jobId) => {
            if (candidateId === candidates?.activeId) { openJob(jobId); return; }
            // Another candidate's job: open that candidate (the window reloads), then the job.
            try { window.sessionStorage.setItem("sensei-open-job", jobId); } catch { /* storage unavailable */ }
            void window.sensei.candidates.switchTo(candidateId).then(() => window.location.reload(), (caught) => setError(messageOf(caught, "Couldn't open that candidate.")));
          }} onOpenCandidate={(candidateId) => {
            if (candidateId === candidates?.activeId) { showPage("jobs-home"); return; }
            void window.sensei.candidates.switchTo(candidateId).then(() => window.location.reload(), (caught) => setError(messageOf(caught, "Couldn't open that candidate.")));
          }} />
          : currentLocation.kind === "docs-home" ? <DocsView />
          : FEATURES.candidates && (currentLocation.kind === "setup-home" || currentLocation.kind === "context-home") ? <ProfilePage key={currentLocation.kind}
            name={candidateProfile?.identity.fullName ?? candidates?.candidates.find((candidate) => candidate.id === candidates.activeId)?.displayName ?? "Candidate"}
            initial={currentLocation.kind === "context-home" ? "files" : "overview"}
            overview={<SetupHome onToast={showToast} readiness={readiness} profile={candidateProfile} onProfileSaved={(next) => { if (next) setCandidateProfile(next); }} onRefresh={() => void loadReadiness()} onAction={runSetupAction} onReveal={(path) => void window.sensei.files.reveal(path).catch(() => undefined)} onAddLinkedin={() => void chooseResume("linkedin").then(() => loadReadiness())} />}
            resume={<BaseResumeTab path={baseResume} read={readiness?.items.find((item) => item.id === "resume")?.lines ?? []} viewer={<DocInline path={baseResume} label="base resume" />} onReplace={() => void chooseResume("base").then(() => loadReadiness())} />}
            files={contextSourcesBlock}
            resumes={contextResumesBlock}
            notes={recruiterNotesBlock}
            settings={<CandidateSettingsTab profile={candidateProfile} onSaved={(next) => { setCandidateProfile(next); void loadReadiness(); }} />}
          />
          : currentLocation.kind === "setup-home" ? <SetupHome onToast={showToast} readiness={readiness} profile={candidateProfile} onProfileSaved={(next) => { if (next) setCandidateProfile(next); }} onRefresh={() => void loadReadiness()} onAction={runSetupAction} onReveal={(path) => void window.sensei.files.reveal(path).catch(() => undefined)} onAddLinkedin={() => void chooseResume("linkedin").then(() => loadReadiness())} />
          : currentLocation.kind === "context-home" ? <ContextHome
            onOpen={(path) => void selectFile(path)}
            notes={recruiterNotesBlock}
            notice={FEATURES.nudges && newContextFiles.length > 0 && <section className="context-block new-files" aria-labelledby="new-files-title">
              <h2 id="new-files-title">New since you last looked</h2>
              <p>Check each one, then tick it below if Agy should use it as evidence.</p>
              <ul>{newContextFiles.map((path) => <li key={path}><button className="btn-link" onClick={() => void selectFile(path)}>{path.replace(/^context\//, "")}</button>{selectedCareerPaths.includes(path) ? <span className="doc-state is-ready">Used by Agy</span> : <span className="doc-state">Not used yet</span>}</li>)}</ul>
              <button className="btn-quiet" onClick={markContextReviewed}>Mark as reviewed</button>
            </section>}
            resumes={contextResumesBlock}
            sources={contextSourcesBlock}
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

function NavIcon({ name }: { name: "today" | "jobs" | "search" | "interviews" | "context" | "settings" | "sidebar" | "setup" | "pipeline" | "docs" | "people" }) {
  const paths: Record<typeof name, string> = {
    people: "M9 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6z M3 19c0-3 2.7-5 6-5s6 2 6 5 M16 11a2.5 2.5 0 1 0 0-5 M17 14c2.2.4 4 2.2 4 5",
    today: "M5 6h14v14H5z M5 10h14 M9 4v4 M15 4v4 M9 14h2 M13 14h2 M9 17h2",
    jobs: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
    search: "M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M15.5 15.5L20 20",
    interviews: "M5 5h14v10H9l-4 4z M8.5 9.5h7 M8.5 12h4",
    context: "M5 4h10l4 4v12H5z M15 4v4h4 M8 12h8 M8 16h6",
    docs: "M6 3h9l3 3v15H6z M15 3v3h3 M9 11h6 M9 15h6",
    settings: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1",
    sidebar: "M4 5h16v14H4z M9 5v14",
    setup: "M5 6h14 M5 12h14 M5 18h14 M8 4v4 M15 10v4 M10 16v4",
    pipeline: "M4 6h16 M4 12h16 M4 18h16 M7 6v12",
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
  ["g then t / j / i / c", "Go to Today, Jobs, Interviews, or Career context"],
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
