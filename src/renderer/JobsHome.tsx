import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { jobSettingsScore } from "../shared/agy-behavior";
import { looksLikePastedPosting } from "../shared/paste-limits";
import { askConfirm } from "./confirm";
import { createPortal } from "react-dom";
import { TRACKER_STATUSES, type JobQueue, type JobTrackerUpdate, type TrackerStatus, type JobFolderSummary } from "../shared/schemas";
import { jobsToCsv } from "../shared/jobs-csv";
import { STALE_DAYS, TRACKER_LABELS, effectiveAppliedAt, effectiveStatus, readyToSend, followUpDays, reachedInterview, staleApplications } from "../shared/tracker";
import { type Readiness } from "../shared/readiness";
import { SubTabPanel, SubTabs } from "./SubTabs";
import { CompanyStrip, JobFilters, SavedViews, storeJobViews, storedJobViews } from "./JobOrganize";
import { GROUPINGS, NO_FACETS, countWithin, groupJobs, matchesFacets, type Grouping, type JobFacets, type JobView } from "../shared/job-organize";
import { FitBadge, type JobWorkspaceTab, type QueueJob, TrackerPill, displayJobName, formatJobDate, formatTrackerDate, messageOf, plural, saveFavoriteJobIds, storedFavoriteJobIds } from "./app-shared";

// CSV columns follow the edition: no follow-up or interview columns where those features are left out.
export const CSV_COLUMNS = { followUps: FEATURES.nudges, interviews: FEATURES.interviews };

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

type JobsFilter = "all" | "active" | "interviewing" | "follow-up" | "review" | "favorites";
type JobsView = "list" | "cards";
type JobsTab = "active" | "ready" | "interviewing" | "offer" | "reached" | "applied" | "saved" | "closed" | "all";
/** Status subtabs on the Jobs page; Active is the default. */
const JOB_TABS: Array<{ id: JobsTab; label: string; statuses: TrackerStatus[] | null }> = [
  { id: "active", label: "Active", statuses: ["saved", "applied", "interviewing", "offer"] },
  // Drafts done, not applied yet (`src/shared/tracker.ts` owns the rule and the label).
  { id: "ready", label: FEATURES.pdfsMarkApplied ? "Drafted" : "Ready to send", statuses: null },
  { id: "interviewing", label: "Interviewing", statuses: ["interviewing"] },
  { id: "offer", label: "Offer", statuses: ["offer"] },
  // Every job that got to an interview, whatever its status now (open or closed). Not in editions without interviews.
  ...(FEATURES.interviews ? [{ id: "reached" as const, label: "Went to interview", statuses: null }] : []),
  { id: "applied", label: "Applied", statuses: ["applied"] },
  { id: "saved", label: "Saved", statuses: ["saved"] },
  { id: "closed", label: "Closed", statuses: ["rejected", "withdrawn"] },
  { id: "all", label: "All", statuses: null },
];
const ACTIVE_STATUSES: TrackerStatus[] = ["saved", "applied", "interviewing", "offer"];

export function JobsHome({ jobs, onOpenJob, onOpenJobView, onOpenEvaluation, onMoveToTrash, onUpdateTracker, onToast, statusGroup, onStatusGroup: setStatusGroup, queue, agyReady, onOpenAgy, onSaveQueue, onQueueJob, setup }: { agyReady: boolean; onOpenAgy: () => void; onToast: (message: string, undo?: () => void) => void; statusGroup: string | null; onStatusGroup: (group: string | null) => void; queue: JobQueue; onSaveQueue: (queue: JobQueue) => void; onQueueJob: QueueJob; setup: React.ReactNode; jobs: JobFolderSummary[]; onOpenJob: (jobId: string) => void; onOpenJobView: (jobId: string, tab: JobWorkspaceTab, roundId?: string) => void; onOpenEvaluation: (jobId: string) => void; onMoveToTrash: (jobId: string) => void; onUpdateTracker: (jobId: string, update: JobTrackerUpdate, options?: { quiet?: boolean }) => Promise<void> }) {
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
  const [facets, setFacets] = useState<JobFacets>(NO_FACETS);
  const [views, setViews] = useState<JobView[]>(storedJobViews);
  const [group, setGroup] = useState<Grouping>(() => { const stored = window.localStorage.getItem("sensei-jobs-group"); return GROUPINGS.includes(stored as Grouping) ? stored as Grouping : "none"; });
  useEffect(() => { window.localStorage.setItem("sensei-jobs-group", group); }, [group]);
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
  useEffect(() => { saveFavoriteJobIds(favorites); }, [favorites]);
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
  const inTab = (job: JobFolderSummary, value: JobsTab) => { if (value === "reached") return reachedInterview(job); if (value === "ready") return readyToSend(job); const statuses = JOB_TABS.find((candidate) => candidate.id === value)!.statuses; if (value === "saved" && readyToSend(job)) return false; return !statuses || statuses.includes(effectiveStatus(job)); };
  // The jobs the open tab, filters, and search show; a quick filter's count is how many of these it keeps (#15).
  const normalizedQuery = query.trim().toLowerCase();
  const inView = (job: JobFolderSummary) => inTab(job, tab) && matchesFacets(job, facets) && (!normalizedQuery || `${job.company ?? ""} ${job.title ?? ""} ${job.name} ${job.location ?? ""} ${effectiveStatus(job)} ${job.interviewRoundLabel ?? ""} ${job.tracker?.notes ?? ""}`.toLowerCase().includes(normalizedQuery));
  const filterCounts = countWithin(jobs, inView, ["all", "active", "interviewing", "follow-up", "review", "favorites"] as JobsFilter[], matches);
  const visibleJobs = useMemo(() => {
    const text = (value: string | null | undefined, fallback: string) => (value ?? fallback).toLowerCase();
    return jobs
      .filter((job) => matches(job, filter) && inView(job))
      .sort((a, b) => {
        if (sort === "company") return text(a.company, displayJobName(a.name)).localeCompare(text(b.company, displayJobName(b.name)));
        if (sort === "role") return text(a.title, "").localeCompare(text(b.title, ""));
        if (sort === "fit") return (b.rating ?? -1) - (a.rating ?? -1);
        if (sort === "follow-up") return (followUpDays(a.tracker) ?? 9999) - (followUpDays(b.tracker) ?? 9999);
        return Date.parse(b.createdAt) - Date.parse(a.createdAt) || text(a.company, displayJobName(a.name)).localeCompare(text(b.company, displayJobName(b.name)));
      });
  }, [jobs, query, filter, sort, favorites, tab, facets]);
  const stale = staleApplications(jobs);
  async function closeStale() {
    if (!(await askConfirm({ title: `Mark ${stale.length} application${stale.length === 1 ? "" : "s"} as rejected?`, body: `No reply after ${STALE_DAYS} days. You can change any of them back later.`, confirmLabel: "Mark as rejected" }))) return;
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
  const filterLabels: Record<JobsFilter, string> = { all: "All", active: "Active", interviewing: "Interviewing", "follow-up": FEATURES.nudges ? "Follow-up due" : "", review: "Needs review", favorites: "Favorites" };
  const renderJobs = (list: JobFolderSummary[]) => view === "cards" ? <div className="job-card-grid">{list.map((job) => <JobCard key={job.id} job={job} favorite={favorites.has(job.id)} onToggleFavorite={() => toggleFavorite(job.id)} handlers={menuHandlers(job)} selecting={selecting} selected={selected.has(job.id)} onSelect={(event) => toggleSelected(job.id, event as { shiftKey?: boolean })} />)}</div>
      : <div className="jobs-table-wrap"><table className="jobs-table"><thead><tr>{selecting && <th scope="col"><span className="sr-only">Selected</span></th>}<th scope="col">Role</th><th scope="col">Fit</th><th scope="col">Status</th><th scope="col">Interview</th><th scope="col">Next</th><th scope="col" className="col-added">Added</th><th scope="col"><span className="sr-only">Favorite and actions</span></th></tr></thead><tbody>{list.map((job) => <tr key={job.id} tabIndex={0} className={selected.has(job.id) ? "is-selected" : undefined} aria-selected={selecting ? selected.has(job.id) : undefined} onClick={(event) => { if (selecting || event.metaKey || event.ctrlKey) toggleSelected(job.id, event); else onOpenJob(job.id); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); if (selecting) toggleSelected(job.id, event); else onOpenJob(job.id); } }}>{selecting && <td><input type="checkbox" className="job-select" checked={selected.has(job.id)} aria-label={`Select ${job.company ?? displayJobName(job.name)}, ${job.title ?? "role"}`} onClick={(event) => event.stopPropagation()} onChange={(event) => toggleSelected(job.id, { shiftKey: (event.nativeEvent as globalThis.MouseEvent).shiftKey })} /></td>}<td className="jobs-role"><strong>{job.company ?? displayJobName(job.name)}</strong><span>{job.title ?? "Role not recorded"}</span></td><td><FitBadge rating={job.rating} gate={jobSettingsScore(job.settingsScore).behavior.fit.gate} /></td><td><TrackerPill status={effectiveStatus(job)} job={job} /></td><td>{job.interviewRoundLabel ? <button className="btn-link" onClick={(event) => { event.stopPropagation(); onOpenJobView(job.id, "interview"); }}>{job.interviewRoundLabel}</button> : <span className="muted">None</span>}</td><td><NextBadge job={job} /></td><td className="tabular muted col-added">{formatJobDate(job.createdAt)}</td><td><button className={`job-favorite ${favorites.has(job.id) ? "is-favorite" : ""}`} aria-pressed={favorites.has(job.id)} aria-label={`Favorite ${job.company ?? displayJobName(job.name)}, ${job.title ?? "role"}`} onClick={(event) => { event.stopPropagation(); toggleFavorite(job.id); }}>{favorites.has(job.id) ? "★" : "☆"}</button><JobMenuButton job={job} handlers={menuHandlers(job)} /></td></tr>)}</tbody></table></div>;
  return <section className="jobs-home">
    <header className="page-head"><div><h1>Jobs</h1><p>{visibleJobs.length === jobs.length ? `${jobs.length} job${jobs.length === 1 ? "" : "s"}` : `${visibleJobs.length} of ${jobs.length} jobs shown`}. {FEATURES.candidates ? "Open one to review the tailored resume and mark it applied." : "Open one to see its application and interview prep."}</p></div></header>
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
    <SavedViews views={views} current={{ tab, query, facets, group, sort }} onChange={(next) => { setViews(next); storeJobViews(next); }}
      onApply={(saved) => { setStatusGroup(saved.tab); setQuery(saved.query); setFacets(saved.facets); setGroup(saved.group); if (["added", "company", "role", "follow-up", "fit"].includes(saved.sort)) setSort(saved.sort as typeof sort); setFilter("all"); }} />
    <div className="jobs-toolbar">
      <label className="workspace-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search jobs…" aria-label="Search jobs" /></label>
      {(["follow-up", "review", "favorites"] as JobsFilter[]).filter((value) => FEATURES.nudges || value !== "follow-up").filter((value) => filterCounts[value] > 0 || filter === value).map((value) => <button key={value} className="filter-toggle" aria-pressed={filter === value} onClick={() => setFilter(filter === value ? "all" : value)}>{filterLabels[value]}<span>{filterCounts[value]}</span></button>)}
      <label className="jobs-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort jobs"><option value="added">Recently added</option>{FEATURES.nudges && <option value="follow-up">Follow-up date</option>}<option value="fit">Best fit</option><option value="company">Company A-Z</option><option value="role">Role A-Z</option></select></label>
      <JobFilters jobs={jobs.filter((job) => inTab(job, tab))} facets={facets} onChange={setFacets} />
      <label className="jobs-sort"><span>Group</span><select value={group} onChange={(event) => setGroup(event.target.value as Grouping)} aria-label="Group jobs"><option value="none">No groups</option><option value="company">Company</option><option value="role">Kind of role</option><option value="status">Status</option><option value="work">Work setup</option></select></label>
      <button className="filter-toggle" aria-pressed={selecting} title="Select several jobs to change their status at once (or Cmd/Ctrl-click a job)" onClick={() => selecting ? exitSelect() : setSelecting(true)}>{selecting ? "Done" : "Select"}</button>
      <div className="segmented" role="group" aria-label="Layout">{(["cards", "list"] as JobsView[]).map((value) => <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      <details className="jobs-more">
        <summary aria-label="More job actions">⋯</summary>
        <div className="jobs-more-menu">
          <button className="menu-item" disabled={!visibleJobs.length} title="Export the jobs shown to a spreadsheet" onClick={() => void window.sensei.jobs.exportCsv(jobsToCsv(visibleJobs, CSV_COLUMNS)).then((path) => setExported(path ? `Saved ${visibleJobs.length} job${visibleJobs.length === 1 ? "" : "s"} to ${path.split(/[\\/]/).pop()}` : "")).catch(() => setExported("Export failed."))}>Export these jobs to CSV</button>
          <button className="menu-item" onClick={(event) => { (event.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); setHealthOpen(true); }}>Data health</button>
          {stale.length > 0 && <button className="menu-item" disabled={closing} onClick={() => void closeStale()}>{closing ? "Closing…" : `Mark ${stale.length} with no reply for ${STALE_DAYS}+ days as rejected`}</button>}
        </div>
      </details>
    </div>
    {facets.company && <CompanyStrip jobs={jobs} company={facets.company} onOpenJob={(jobId, view) => view ? onOpenJobView(jobId, view) : onOpenJob(jobId)} onClear={() => setFacets({ ...facets, company: null })} />}
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
      : group === "none" ? renderJobs(visibleJobs)
      : groupJobs(visibleJobs, group).map((entry) => <section key={entry.key} className="jobs-group jobs-group-by" aria-label={entry.label}>
          <h2>{entry.label} <span>{entry.jobs.length}</span>{group === "company" && entry.jobs.length > 1 && <button className="btn-link" onClick={() => setFacets({ ...facets, company: entry.label })}>View company</button>}</h2>
          {renderJobs(entry.jobs)}
        </section>)}
    </SubTabPanel>
  </section>;
}

/** One line on the Jobs page while setup isn't complete: what is missing, and a link to Setup. */
export function SetupLine({ readiness, onOpen }: { readiness: Readiness | null; onOpen: () => void }) {
  if (!readiness) return null;
  const recommended = readiness.items.filter((item) => item.level === "recommended" && item.state === "missing").length;
  if (readiness.ready && !recommended) return null;
  return <section className={`setup-banner${readiness.ready ? "" : " is-blocking"}`} aria-labelledby="setup-banner-title">
    <strong id="setup-banner-title">{readiness.ready ? "Make your drafts better" : "Finish setup before adding jobs"}</strong>
    <span>{readiness.ready ? `${plural(recommended, "recommended step")} left: ${readiness.items.filter((item) => item.level === "recommended" && item.state === "missing").map((item) => item.title.charAt(0).toLowerCase() + item.title.slice(1)).slice(0, 3).join("; ")}${recommended > 3 ? ", …" : ""}.` : readiness.blocker}</span>
    <button className="btn-link" onClick={onOpen}>Open Setup</button>
  </section>;
}

const QUEUE_LABEL: Record<JobQueue["items"][number]["status"], string> = { queued: "Waiting", running: "Running in Agy", done: "Done", needs_attention: "Needs attention" };

function JobQueueBox({ queue, jobs, agyReady, onOpenAgy, onSave, onQueueJob, onOpenJob }: { queue: JobQueue; jobs: JobFolderSummary[]; agyReady: boolean; onOpenAgy: () => void; onSave: (queue: JobQueue) => void; onQueueJob: QueueJob; onOpenJob: (jobId: string) => void }) {
  const [input, setInput] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const value = input.trim();
  // Several links (one per line or separated by spaces) are added one after another.
  const links = value.split(/\s+/).filter(Boolean);
  const manyLinks = links.length > 1 && links.every((link) => /^https?:\/\/\S+$/i.test(link) && link.length <= 400);
  const isLink = /^https?:\/\/[^\s]+$/i.test(value);
  const duplicate = isLink && queue.items.some((item) => item.url === value && item.status !== "done");
  const valid = !adding && !duplicate && (manyLinks || (isLink ? value.length <= 400 : looksLikePastedPosting(value)));
  const update = (id: string, patch: Partial<JobQueue["items"][number]>) => onSave({ ...queue, items: queue.items.map((item) => item.id === id ? { ...item, ...patch } : item) });
  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setAdding(true);
    setProblem(null);
    try {
      if (manyLinks) {
        const fresh = [...new Set(links)].filter((link) => !queue.items.some((item) => item.url === link && item.status !== "done"));
        const failed: string[] = [];
        for (const [index, url] of fresh.entries()) {
          try { await onQueueJob({ kind: "link", url, batch: { index, size: fresh.length } }, false); }
          catch (caught) { if (caught instanceof Error && caught.name === "NotQueued") continue; failed.push(`${url} (${messageOf(caught, "couldn't be read")})`); }
        }
        setInput(failed.join("\n"));
        if (failed.length) setProblem(`${failed.length} of ${fresh.length} link${fresh.length === 1 ? "" : "s"} couldn't be added; they're left in the box. Paste those job descriptions instead.`);
      } else {
        await onQueueJob(isLink ? { kind: "link", url: value } : { kind: "paste", text: value }, false);
        setInput("");
      }
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
      <textarea id="add-job-url" rows={!manyLinks && (isLink || !value) ? 1 : 4} value={input} onChange={(event) => { setInput(event.target.value); setProblem(null); }} placeholder="Paste a job link or description" aria-describedby="add-job-help" />
      <button className="btn-primary" disabled={!valid}>Add to queue</button>
      <p id="add-job-help">{problem ?? (duplicate ? "That link is already in the queue." : manyLinks ? `${links.length} links: each is added in turn.` : value && !isLink && !looksLikePastedPosting(value) ? "Paste the whole job description, or just its link." : FEATURES.candidates ? <>Agy tailors one job at a time for the candidate it's for: it reads the posting, rates the fit, and drafts the resume (and a cover letter when turned on).</> : <>Agy runs one job at a time: it reads the posting, scores your fit, and drafts the resume and cover letter.</>)}</p>
      <label className="queue-auto"><input type="checkbox" checked={queue.autoRun} onChange={(event) => onSave({ ...queue, autoRun: event.target.checked })} /> Run automatically when Agy is free</label>
    </form>
    {QUEUE_LIST}
    {queue.autoRun && waiting > 0 && !agyReady && !queue.items.some((item) => item.status === "running") && <p className="queue-wait">{waiting} waiting for Agy. The queue starts by itself once Agy is open and signed in. <button className="btn-link" onClick={onOpenAgy}>Open Agy</button></p>}
    {!queue.autoRun && waiting > 0 && <button className="btn-quiet" onClick={() => onSave({ ...queue, autoRun: true })}>Start the queue ({waiting})</button>}
  </section>;
}

/** Follow-up due, or the applied date, in plain words. */
function NextBadge({ job, quiet = false, due = false }: { job: JobFolderSummary; quiet?: boolean; due?: boolean }) {
  const days = followUpDays(job.tracker);
  const status = effectiveStatus(job);
  if (FEATURES.nudges && days !== null && ACTIVE_STATUSES.includes(status)) {
    const label = days < 0 ? `Follow up, ${-days} day${days === -1 ? "" : "s"} late` : days === 0 ? "Follow up today" : `Follow up in ${days} day${days === 1 ? "" : "s"}`;
    return <span className={`next-badge ${days <= 0 ? "is-due" : ""}`}>{label}</span>;
  }
  const appliedAt = effectiveAppliedAt(job);
  if (due) return null;
  if (appliedAt) return <span className="muted">Applied {formatTrackerDate(appliedAt)}</span>;
  return quiet ? null : <span className="muted">—</span>;
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
  return <article className={`job-card${selecting ? " is-selecting" : ""}${selected ? " is-selected" : ""}`} aria-selected={selecting ? selected : undefined} onClick={onCardClick} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); }}><div className="job-card-heading">{selecting ? <input type="checkbox" className="job-select" checked={selected} aria-label={`Select ${job.company ?? displayJobName(job.name)}, ${job.title ?? "role"}`} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelect?.(event as unknown as MouseEvent)} /> : <span className="company-mark">{initials || "J"}</span>}<div><h2>{job.company ?? displayJobName(job.name)}</h2><p>{job.title ?? "Role not recorded"}</p></div><span className="job-card-badges"><FitBadge rating={job.rating} gate={jobSettingsScore(job.settingsScore).behavior.fit.gate} /><JobMenuButton job={job} handlers={handlers} /></span></div><dl><div><dt>Status</dt><dd><TrackerPill status={effectiveStatus(job)} job={job} /></dd></div>{FEATURES.interviews && <div><dt>Interview</dt><dd>{job.interviewRoundLabel ?? "Not prepared"}</dd></div>}<div><dt>Added</dt><dd className="job-card-added"><span>{formatJobDate(job.createdAt)}</span><button className={`job-favorite ${favorite ? "is-favorite" : ""}`} aria-label={`${favorite ? "Remove" : "Add"} ${job.company ?? displayJobName(job.name)} ${favorite ? "from" : "to"} favorites`} aria-pressed={favorite} title={favorite ? "Remove from favorites" : "Add to favorites"} onClick={(event) => { event.stopPropagation(); onToggleFavorite(); }}>{favorite ? "★" : "☆"}</button></dd></div></dl>{!selecting && <button onClick={(event) => { event.stopPropagation(); onOpen(); }}>Open job</button>}{menu && <JobMenu job={job} at={menu} handlers={handlers} onClose={() => setMenu(null)} />}</article>;
}
