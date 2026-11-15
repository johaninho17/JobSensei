// Job Search page: search settings, Run now, and the inbox of found postings ranked by quick fit.
// Agy only finds links; the app opened, saved, and rated every posting shown here (electron/job-search.ts).
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_JOB_SEARCH_SETTINGS, SEARCH_BOARDS, SEARCH_LEVELS, SKIPPED_BOARDS, WORK_SETUPS, DEFAULT_RANKING, effectiveFit, rankInbox, rankReason, searchProgressText, type RankingWeights,
  type InboxItem, type JobSearchSettings, type JobSearchState, type ScheduleInfo, type SearchRun, type SearchStatus, type WatchedSuggestion,
} from "../shared/job-search";
import { SubTabs } from "./SubTabs";
import { Section } from "./Section";
import { draftFound, foundError, foundRowId, saveFound } from "./found-actions";
import { boardName, boardRef } from "../shared/boards";

type Tab = "matches" | "drafting" | "saved" | "dismissed" | "settings" | "runs";
type Sort = "fit" | "newest" | "company";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : /(?:ch|sh|s|x)$/.test(word) ? "es" : "s"}`;
const capital = (text: string | null) => text ? text[0].toUpperCase() + text.slice(1) : null;
const fitClass = (score: number) => score >= 4 ? "is-high" : score >= 3 ? "is-mid" : "is-low";
const SETUP_LABEL: Record<(typeof WORK_SETUPS)[number], string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

/** Why a finished run added nothing (or what it left out), in plain words. */
export function runSummary(run: SearchRun): string {
  const left = Object.entries(run.leftOut).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${count} ${reason}`).join(", ");
  if (run.status === "failed") return `The search didn't finish: ${run.error ?? "unknown error"}`;
  const head = `${run.added} new match${run.added === 1 ? "" : "es"} from ${run.found} link${run.found === 1 ? "" : "s"}`;
  const notes = [
    run.rated ? `${run.rated} rated by Agy` : "",
    run.companies ? `${run.companies} compan${run.companies === 1 ? "y" : "ies"} found by Agy` : "",
    run.replaced ? `${run.replaced} dead link${run.replaced === 1 ? "" : "s"} swapped for the live posting` : "",
    left ? `left out: ${left}` : "",
    run.error ? `Agy: ${run.error}` : "",
  ].filter(Boolean).join("; ");
  return `${head}${notes ? ` (${notes})` : ""}.`;
}

export function JobSearchView({ ranking = DEFAULT_RANKING, status, focusId, onQueueFound, onQueueSaved, onOpenJob, onToast }: {
  /** How matches are ordered (Agy page → Behavior → Job Search ranking). */
  ranking?: RankingWeights;
  /** A match to show and scroll to when the page opens (from Today). */
  focusId?: string;
  /** The run's live status, kept by the app so it survives leaving this page. */
  status: SearchStatus;
  /** Sends a found job to the application queue; returns how many jobs are ahead of it. */
  onQueueFound: (id: string, auto: boolean) => Promise<number>;
  /** Sends a saved match's job (already in Jobs) for drafts; resolves to how many jobs are ahead in the queue. */
  onQueueSaved: (jobId: string) => Promise<number>;
  onOpenJob: (jobId: string) => void;
  onToast: (message: string, undo?: () => void) => void;
}) {
  const [tab, setTab] = useState<Tab>("matches");
  const [settings, setSettings] = useState<JobSearchSettings | null>(null);
  const [state, setState] = useState<JobSearchState | null>(null);
  const running = status.running;
  const [error, setError] = useState("");
  const [sort, setSort] = useState<Sort>("fit");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.sensei.jobSearch.get().then((result) => { setSettings(result.settings); setState(result.state); }).catch((reason) => setError(String(reason?.message ?? reason)));
    return window.sensei.jobSearch.onUpdated(setState);
  }, []);

  // Opened on one match (from Today): show its tab and scroll it into view once the list is loaded.
  const focusItem = focusId ? state?.items.find((item) => item.id === focusId) ?? null : null;
  useEffect(() => {
    if (!focusItem) return;
    setTab(focusItem.status === "queued" ? "drafting" : focusItem.status === "saved" ? "saved" : focusItem.status === "dismissed" ? "dismissed" : "matches");
    window.requestAnimationFrame(() => document.getElementById(foundRowId(focusItem.id))?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  }, [focusItem?.id]);

  // Matches are only new finds; jobs sent for drafts, saved, or dismissed each get their own tab.
  const live = useMemo(() => rankInbox((state?.items ?? []).filter((item) => item.status === "new"), sort, ranking), [state, sort, ranking]);
  const byStatus = (status: InboxItem["status"]) => rankInbox((state?.items ?? []).filter((item) => item.status === status), "newest");
  const drafting = byStatus("queued");
  const savedItems = byStatus("saved");
  const dismissedItems = byStatus("dismissed");
  const bar = settings?.minFit ?? DEFAULT_JOB_SEARCH_SETTINGS.minFit;
  const above = live.filter((item) => effectiveFit(item) >= bar && !item.fit.blockers.length);
  const below = live.filter((item) => !above.includes(item));
  const newCount = live.filter((item) => item.status === "new").length;
  const lastRun = state?.runs.at(-1) ?? null;

  async function runNow(mode: "search" | "watched") {
    setError("");
    try {
      await window.sensei.jobSearch.run(mode);
      setTab("matches");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason));
    }
  }

  async function turnOnSchedule() {
    if (!settings) return;
    setError("");
    try {
      setSettings(await window.sensei.jobSearch.saveSettings({ ...settings, schedule: { ...settings.schedule, enabled: true } }));
      onToast(settings.schedule.mode === "daily" ? `Scheduled search on: once a day, the first time your computer is on after ${settings.schedule.after}.` : "Scheduled search on.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason));
    }
  }

  // Companies of the user's jobs on Ashby/Greenhouse/Lever: watched in one click, then checked right away (free).
  const [jobCompanies, setJobCompanies] = useState<WatchedSuggestion[]>([]);
  useEffect(() => { void window.sensei.jobSearch.suggestWatched().then(setJobCompanies).catch(() => undefined); }, [settings?.watched.length]);
  const unwatched = settings ? jobCompanies.filter((company) => !settings.watched.some((watched) => watched.board === company.board && watched.slug.toLowerCase() === company.slug.toLowerCase())) : [];
  async function watchJobCompaniesAndCheck() {
    if (!settings) return;
    setError("");
    try {
      const next = await window.sensei.jobSearch.saveSettings({ ...settings, watched: [...settings.watched, ...unwatched.map((company) => ({ board: company.board, slug: company.slug, name: company.name, source: "jobs" as const }))] });
      setSettings(next);
      await runNow("watched");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason));
    }
  }

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function rate(ids: string[]) {
    setError("");
    try {
      await window.sensei.jobSearch.rate(ids.slice(0, 10));
      setSelecting(false);
      setSelected(new Set());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason));
    }
  }

  async function dismiss(ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    try {
      setState(await window.sensei.jobSearch.setStatus(ids, "dismissed"));
      setSelected(new Set());
      onToast(`Dismissed ${plural(ids.length, "job")}.`, () => void window.sensei.jobSearch.setStatus(ids, "new").then(setState));
    } finally { setBusy(false); }
  }

  async function save(ids: string[]) {
    setBusy(true);
    try {
      const message = await saveFound(ids);
      setState((await window.sensei.jobSearch.get()).state);
      setSelected(new Set());
      onToast(message);
    } catch (reason) {
      setError(foundError(reason));
    } finally { setBusy(false); }
  }

  async function queue(ids: string[]) {
    setBusy(true);
    try {
      const message = await draftFound(ids, (id) => onQueueFound(id, false));
      setState((await window.sensei.jobSearch.get()).state);
      setSelected(new Set());
      onToast(message);
    } catch (reason) {
      setError(foundError(reason));
    } finally { setBusy(false); }
  }

  /** A saved match already has its job in Jobs; its drafts go into that job. */
  async function draftSaved(jobId: string) {
    setBusy(true);
    try {
      const ahead = await onQueueSaved(jobId);
      setState((await window.sensei.jobSearch.get()).state);
      onToast(`Sent 1 job for drafts${ahead ? ` (${ahead} ahead in the queue)` : ""}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason));
    } finally { setBusy(false); }
  }

  function renderItem(item: InboxItem) {
    const isSelected = selected.has(item.id);
    const facts = [item.location, item.workSetup, item.pay, capital(item.level), item.postedAt ? `Posted ${item.postedAt}` : null, boardName(item.board)].filter(Boolean);
    return <li key={item.id} id={foundRowId(item.id)} className={`find-row${isSelected ? " is-selected" : ""}${item.id === focusId ? " is-focused" : ""}`} onClick={selecting ? () => toggle(item.id) : undefined}>
      {selecting && <input type="checkbox" checked={isSelected} onChange={() => toggle(item.id)} onClick={(event) => event.stopPropagation()} aria-label={`Select ${item.company ?? ""} ${item.title ?? ""}`} />}
      <span className={`fit-badge ${fitClass(effectiveFit(item))}`} title={item.agyFit ? `Agy's light rating (quick fit ${item.fit.score.toFixed(1)}); the full rating runs when you draft` : "Quick fit: the app's own check of your files against the posting, not a full rating"}>{effectiveFit(item).toFixed(1)}{item.agyFit && <small className="fit-badge-source">Agy</small>}</span>
      <div className="find-main">
        {selecting ? <strong>{item.title ?? "Untitled role"}</strong> : <button className="find-title" title="Open the posting in your browser" onClick={() => void window.sensei.jobSearch.openPosting(item.id)}>{item.title ?? "Untitled role"}</button>} <span className="muted">· {item.company ?? "Company not named"}</span>{item.watched && <span className="find-tag">Watched company</span>}{item.likeInterviewed && <span className="find-tag" title="Ranked a little higher: similar to a job where you got a real interview">{item.likeInterviewed}</span>}
        {facts.length > 0 && <p className="find-facts">{facts.join(" · ")}</p>}
        {item.agyFit && <p className="find-why">{item.agyFit.why}{item.agyFit.gaps.length > 0 && <span className="muted"> Gaps: {item.agyFit.gaps.join("; ")}.</span>}</p>}
        <p className={item.agyFit ? "find-why muted" : "find-why"}>{item.agyFit ? `Quick check: ${item.fit.why}` : item.fit.why}</p>
        {item.status === "new" && sort === "fit" && <p className="find-why muted find-rank">Ranked by {rankReason(item, ranking)}</p>}
        {(item.fit.blockers.length > 0 || item.fit.flags.length > 0 || item.fit.gaps.length > 0) && <p className="find-tags">
          {item.fit.blockers.map((text) => <span key={text} className="find-tag is-blocker">{text}</span>)}
          {item.fit.flags.map((text) => <span key={text} className="find-tag">{text}</span>)}
          {item.fit.gaps.length > 0 && <span className="find-tag is-gap">To learn: {item.fit.gaps.slice(0, 4).join(", ")}</span>}
        </p>}
      </div>
      {!selecting && <div className="find-actions">
        <button className="btn-quiet" onClick={() => void window.sensei.jobSearch.openPosting(item.id)}>Open posting</button>
        {item.status === "new" && <>
          <button className="btn-quiet" disabled={busy} onClick={() => void queue([item.id])}>Draft application</button>
          <button className="btn-quiet" disabled={busy} onClick={() => void save([item.id])}>Save for later</button>
          <button className="btn-link" disabled={busy} onClick={() => void dismiss([item.id])}>Dismiss</button>
        </>}
        {item.status === "saved" && item.jobId && <>
          <button className="btn-quiet" disabled={busy} onClick={() => void draftSaved(item.jobId!)}>Draft application</button>
          <button className="btn-link" onClick={() => onOpenJob(item.jobId!)}>In Jobs: open</button>
        </>}
        {item.status === "queued" && <span className="muted">{item.autoQueued ? "Sent for drafts automatically" : "Sent for drafts"}{item.queuedAt ? ` · ${new Date(item.queuedAt).toLocaleDateString()}` : ""}</span>}
        {item.status === "dismissed" && <button className="btn-quiet" disabled={busy} onClick={() => void window.sensei.jobSearch.setStatus([item.id], "new").then(setState)}>Restore</button>}
      </div>}
    </li>;
  }

  const visibleNew = live.filter((item) => item.status === "new").map((item) => item.id);
  return <section className="jobs-home job-search">
    <header className="page-head"><div><h1>Job Search</h1><p>
      {running ? <strong role="status">{searchProgressText(status)} You can leave this page; the search keeps going.</strong>
        : lastRun && lastRun.status !== "running" ? `Last ${lastRun.source === "watched" ? "check" : "search"} ${new Date(lastRun.startedAt).toLocaleString()}: ${runSummary(lastRun)}`
          : "Agy searches the job boards with your settings; the app opens every link, drops closed and old postings, and rates each one against your files."}
      {!running && " A search uses one Agy run; checking watched companies and rating postings use none."}
    </p>
    {settings && <ScheduleStatus settings={settings} onTurnOn={() => void turnOnSchedule()} />}
    </div>
    <div className="find-run-buttons">
      {(settings?.watched.length ?? 0) > 0 && <button className="btn-quiet" disabled={running || !settings?.titles.length} onClick={() => void runNow("watched")}>Check watched companies</button>}
      <button className="btn-primary" disabled={running || !settings?.titles.length} title={settings?.titles.length ? undefined : "Add at least one job title in Search settings"} onClick={() => void runNow("search")}>{running ? "Searching…" : "Run now"}</button>
    </div>
    </header>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <SubTabs idPrefix="job-search" label="Job Search" value={tab} onChange={setTab} tabs={[
      { id: "matches", label: "Matches", count: newCount || null },
      { id: "drafting", label: "Sent for drafts", count: drafting.length || null },
      { id: "saved", label: "Saved", count: savedItems.length || null },
      { id: "dismissed", label: "Dismissed", count: dismissedItems.length || null },
      { id: "settings", label: "Search settings" },
      { id: "runs", label: "Runs", count: state?.runs.length || null },
    ]} actions={tab === "matches" && live.length > 0 ? <>
      <label className="muted find-sort">Sort <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="fit">Fit</option><option value="newest">Newest</option><option value="company">Company</option></select></label>
      <button className="btn-quiet" onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? "Done" : "Select"}</button>
    </> : null} />

    {tab === "matches" && <div role="tabpanel" aria-labelledby="job-search-tab-matches">
      {unwatched.length > 0 && !running && <div className="find-callout">
        <span>{unwatched.length} compan{unwatched.length === 1 ? "y" : "ies"} from your jobs post on Ashby, Greenhouse, or Lever. Watching them means every run reads their open jobs directly: free, with real dates.</span>
        <button className="btn-quiet" disabled={!settings?.titles.length} onClick={() => void watchJobCompaniesAndCheck()}>Watch them and check now</button>
      </div>}
      {selecting && <div className="select-bar" role="toolbar" aria-label="Selected matches">
        <strong aria-live="polite">{selected.size ? `${plural(selected.size, "job")} selected` : "Click jobs to select them"}</strong>
        <button className="btn-link" onClick={() => setSelected(new Set(visibleNew))}>Select all {visibleNew.length} new</button>
        <button className="btn-link" onClick={() => setSelected(new Set(below.filter((item) => item.status === "new").map((item) => item.id)))}>Select all below your bar</button>
        {selected.size > 0 && <button className="btn-link" onClick={() => setSelected(new Set())}>Clear</button>}
        <span className="select-bar-actions">
          <button className="btn-quiet" disabled={!selected.size || busy || running} title="One Agy call for up to 10 matches" onClick={() => void rate([...selected])}>Rate with Agy{selected.size > 10 ? " (first 10)" : ""}</button>
          <button className="btn-quiet" disabled={!selected.size || busy} onClick={() => void queue([...selected])}>Draft applications</button>
          <button className="btn-quiet" disabled={!selected.size || busy} onClick={() => void save([...selected])}>Save for later</button>
          <button className="btn-quiet" disabled={!selected.size || busy} onClick={() => void dismiss([...selected])}>Dismiss</button>
        </span>
      </div>}
      {!live.length ? <div className="dashboard-empty"><h2>{running ? "Searching…" : "No matches yet"}</h2><p>{running ? "Matches appear here as each posting is checked." : lastRun && lastRun.status !== "running" ? runSummary(lastRun) : settings?.titles.length ? "Run a search to find postings that fit your settings." : "Start in Search settings: add the job titles you want."}</p></div> : <>
        <section className="jobs-group" aria-labelledby="find-above"><h2 id="find-above">At or above your bar ({bar.toFixed(1)}) <span>{above.length}</span></h2>
          {above.length ? <ul className="find-list">{above.map(renderItem)}</ul> : <p className="muted">Nothing above your bar in this search.</p>}</section>
        {below.length > 0 && <details className="jobs-group"><summary><h2>Below your bar <span>{below.length}</span></h2></summary>
          <p className="muted">Live postings that scored under {bar.toFixed(1)} or have a blocker. They're never drafted automatically.</p>
          <ul className="find-list">{below.map(renderItem)}</ul></details>}
      </>}
      <p className="muted find-note">Quick fit is the app's own check of your resume and checked work records against the posting's requirements (no quota). Scores marked Agy are its light rating of the requirements against a short card of your roles, skills, and story. The full rating runs when you draft an application.</p>
    </div>}

    {(tab === "drafting" || tab === "saved" || tab === "dismissed") && <div role="tabpanel" aria-labelledby={`job-search-tab-${tab}`}>
      <p className="muted find-tab-note">{tab === "drafting" ? "Jobs you sent to the queue for a tailored resume and letter. Each becomes a job in Jobs once Agy finishes." : tab === "saved" ? "Jobs you saved for later. They're in Jobs as Saved." : "Jobs you dismissed. They never come back in a search; restore one to see it in Matches again."}</p>
      {(() => { const list = tab === "drafting" ? drafting : tab === "saved" ? savedItems : dismissedItems; return list.length ? <ul className="find-list">{list.map(renderItem)}</ul> : <p className="muted">Nothing here yet.</p>; })()}
    </div>}

    {tab === "settings" && settings && <SearchSettingsForm settings={settings} onSaved={(next) => { setSettings(next); onToast("Search settings saved."); }} />}

    {tab === "runs" && <div role="tabpanel" aria-labelledby="job-search-tab-runs">
      {!state?.runs.length ? <p className="muted">No searches yet.</p> : <ul className="find-runs">
        {[...state.runs].reverse().map((run) => <li key={run.id}>
          <strong>{new Date(run.startedAt).toLocaleString()}</strong>{run.scheduled && " · scheduled"}{run.status === "running" && " · running"}
          <span className="muted"> · {run.source === "watched" ? "watched companies" : "Agy search + watched companies"}: {runSummary(run)}</span>
        </li>)}
      </ul>}
    </div>}
  </section>;
}

const listText = (values: string[]) => values.join(", ");
const parseList = (text: string) => text.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean);

function SearchSettingsForm({ settings, onSaved }: { settings: JobSearchSettings; onSaved: (settings: JobSearchSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [lists, setLists] = useState(() => ({
    titles: listText(settings.titles), locations: listText(settings.locations), includeKeywords: listText(settings.includeKeywords),
    excludeKeywords: listText(settings.excludeKeywords), excludeTitleWords: listText(settings.excludeTitleWords), extraSites: listText(settings.extraSites), skipSites: listText(settings.skipSites), skipCompanies: listText(settings.skipCompanies),
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof JobSearchSettings>(key: K, value: JobSearchSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const toggleIn = <T extends string>(values: T[], value: T) => values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
  async function submit() {
    setError("");
    setSaving(true);
    try {
      const next = await window.sensei.jobSearch.saveSettings({
        ...draft,
        titles: parseList(lists.titles), locations: parseList(lists.locations), includeKeywords: parseList(lists.includeKeywords), excludeKeywords: parseList(lists.excludeKeywords), excludeTitleWords: parseList(lists.excludeTitleWords),
        extraSites: parseList(lists.extraSites), skipSites: parseList(lists.skipSites), skipCompanies: parseList(lists.skipCompanies),
      });
      onSaved(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason));
    } finally { setSaving(false); }
  }
  const text = (key: keyof typeof lists, label: string, hint: string) => <label className="search-field"><span>{label}</span>
    <input value={lists[key]} onChange={(event) => setLists((current) => ({ ...current, [key]: event.target.value }))} placeholder={hint} /></label>;
  return <form className="search-settings" role="tabpanel" aria-labelledby="job-search-tab-settings" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <Section id="search-look" title="What to look for" defaultOpen={true} note={"Titles, places, level, pay, and words to leave out."}>
      {text("titles", "Job titles", "e.g. Solutions Engineer, Customer Success Manager")}
      {text("locations", "Where", "Cities or states; leave empty for anywhere in the US")}
      <div className="search-field"><span>Work setup</span><div className="search-checks">{WORK_SETUPS.map((mode) => <label key={mode}><input type="checkbox" checked={draft.workSetups.includes(mode)} onChange={() => set("workSetups", toggleIn(draft.workSetups, mode))} />{SETUP_LABEL[mode]}</label>)}</div></div>
      <div className="search-field"><span>Level</span><div className="search-checks">{SEARCH_LEVELS.map((level) => <label key={level}><input type="checkbox" checked={draft.levels.includes(level)} onChange={() => set("levels", toggleIn(draft.levels, level))} />{level[0].toUpperCase() + level.slice(1)}</label>)}</div></div>
      <label className="search-field"><span>Lowest base pay (per year, USD)</span><input type="number" min={0} step={5000} value={draft.payFloor ?? ""} onChange={(event) => set("payFloor", event.target.value ? Number(event.target.value) : null)} placeholder="No floor" /></label>
      <label className="search-check"><input type="checkbox" checked={draft.needsSponsorship} onChange={(event) => set("needsSponsorship", event.target.checked)} />I need visa sponsorship</label>
      <label className="search-field"><span>Posted within (days)</span><input type="number" min={1} max={90} value={draft.postedWithinDays} onChange={(event) => set("postedWithinDays", Number(event.target.value) || 30)} /></label>
      {text("includeKeywords", "Should mention", "Optional keywords")}
      {text("excludeTitleWords", "Leave out titles with", "Whole words, e.g. Senior, Principal, Lead, Staff")}
      {text("excludeKeywords", "Leave out postings about", "e.g. commission only, clearance")}
      {text("skipCompanies", "Never show these companies", "Optional")}
    </Section>
    <Section id="search-where" title="Where to search" defaultOpen={false} note={"Boards Agy searches and boards the app reads directly."}>
      <div className="search-field"><span>Boards</span><div className="search-checks">{SEARCH_BOARDS.map((board) => <label key={board.id} title={board.direct ? "The app reads companies' open jobs here itself, free" : "Agy searches this site; the companies it finds are read from their own boards"}><input type="checkbox" checked={!draft.boardsOff.includes(board.id)} onChange={() => set("boardsOff", toggleIn(draft.boardsOff, board.id))} />{board.name}<span className="muted"> · {board.direct ? "read directly" : "searched by Agy"}</span></label>)}</div></div>
      {text("extraSites", "Also search these sites", "Careers pages or boards, e.g. jobs.example.com")}
      {text("skipSites", "Never use these sites", "Domains to skip")}
      <p className="muted">Always skipped: {SKIPPED_BOARDS.map((board) => `${board.name} (${board.reason})`).join("; ")}.</p>
    </Section>
    <WatchedCompanies watched={draft.watched} onChange={(watched) => set("watched", watched)} autoWatch={draft.autoWatch} onAutoWatch={(value) => set("autoWatch", value)} watchFound={draft.watchFoundCompanies} onWatchFound={(value) => set("watchFoundCompanies", value)} />
    <ScheduleFields schedule={draft.schedule} onChange={(schedule) => set("schedule", schedule)} />
    <Section id="search-ratings" title="Ratings and drafts" defaultOpen={false} note={"Your bar, automatic drafts, and how much each search does."}>
      <label className="search-field"><span>Your bar (quick fit, 1–5)</span><input type="number" min={1} max={5} step={0.1} value={draft.minFit} onChange={(event) => set("minFit", Number(event.target.value) || 3)} /></label>
      <label className="search-check"><input type="checkbox" checked={draft.autoDraftAt !== null} onChange={(event) => set("autoDraftAt", event.target.checked ? 4 : null)} />Draft applications automatically for strong matches</label>
      {draft.autoDraftAt !== null && <div className="settings-inline-fields">
        <label className="search-field"><span>At or above</span><input type="number" min={1} max={5} step={0.1} value={draft.autoDraftAt} onChange={(event) => set("autoDraftAt", Number(event.target.value) || 4)} /></label>
        <label className="search-field"><span>At most per day</span><input type="number" min={1} max={10} value={draft.autoDraftDailyCap} onChange={(event) => set("autoDraftDailyCap", Number(event.target.value) || 3)} /></label>
      </div>}
      <label className="search-check"><input type="checkbox" checked={draft.lightRating} onChange={(event) => set("lightRating", event.target.checked)} />After each search, let Agy rate up to 10 of the best new matches (one short call)</label>
      <label className="search-field"><span>Companies Agy looks for per search</span><input type="number" min={5} max={40} value={draft.resultsPerRun} onChange={(event) => set("resultsPerRun", Number(event.target.value) || 20)} /></label>
      <label className="search-field"><span>New matches per run, at most (newest first; the rest wait for the next run)</span><input type="number" min={5} max={300} value={draft.maxNewPerRun} onChange={(event) => set("maxNewPerRun", Number(event.target.value) || 60)} /></label>
    </Section>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save search settings"}</button>
  </form>;
}


const SOURCE_LABEL: Record<JobSearchSettings["watched"][number]["source"], string> = { user: "added by you", jobs: "from your jobs", search: "found by search" };

/** Companies checked on every run through their public boards, free and without Agy. */
function WatchedCompanies({ watched, onChange, autoWatch, onAutoWatch, watchFound, onWatchFound }: { watched: JobSearchSettings["watched"]; onChange: (watched: JobSearchSettings["watched"]) => void; autoWatch: boolean; onAutoWatch: (value: boolean) => void; watchFound: boolean; onWatchFound: (value: boolean) => void }) {
  const [link, setLink] = useState("");
  const [problem, setProblem] = useState("");
  const [filter, setFilter] = useState("");
  const [suggestions, setSuggestions] = useState<WatchedSuggestion[] | null>(null);
  const has = (board: string, slug: string) => watched.some((company) => company.board === board && company.slug.toLowerCase() === slug.toLowerCase());
  function addLink() {
    setProblem("");
    const ref = boardRef(link);
    if (!ref) { setProblem("Use a company's Ashby, Greenhouse, or Lever jobs link, such as jobs.lever.co/acme."); return; }
    if (!has(ref.board, ref.slug)) onChange([...watched, { ...ref, name: ref.slug, source: "user" }]);
    setLink("");
  }
  const counts = (["user", "jobs", "search"] as const).map((source) => [source, watched.filter((company) => company.source === source).length] as const).filter(([, count]) => count > 0);
  const shown = watched.filter((company) => !filter.trim() || `${company.name} ${company.slug}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const fresh = (suggestions ?? []).filter((item) => !has(item.board, item.slug));
  return <Section id="search-watched" title="Watched companies" defaultOpen={false} count={watched.length || null}>
    <p className="muted">Checked on every run through their public job boards, with no Agy quota. Only roles that fit your titles, places, and work setups are kept.</p>
    <label className="search-check"><input type="checkbox" checked={autoWatch} onChange={(event) => onAutoWatch(event.target.checked)} />Watch the companies of jobs I add</label>
    <label className="search-check"><input type="checkbox" checked={watchFound} onChange={(event) => onWatchFound(event.target.checked)} />Watch companies Agy finds hiring for my titles</label>
    {watched.length > 0 && <details className="watched-details" open={watched.length <= 12}>
      <summary>{watched.length} watched{counts.length ? ` (${counts.map(([source, count]) => `${count} ${SOURCE_LABEL[source]}`).join(", ")})` : ""}</summary>
      {watched.length > 12 && <input className="watched-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a company" aria-label="Find a watched company" />}
      <ul className="watched-list">{shown.map((company) => <li key={`${company.board}:${company.slug}`}>
        <span>{company.name || company.slug} <span className="muted">· {boardName(company.board)} · {SOURCE_LABEL[company.source]}</span></span>
        <button type="button" className="btn-link" onClick={() => onChange(watched.filter((candidate) => candidate !== company))}>Remove</button>
      </li>)}</ul>
    </details>}
    <div className="settings-inline-fields">
      <label className="search-field"><span>Add by jobs link</span><input value={link} onChange={(event) => setLink(event.target.value)} placeholder="jobs.ashbyhq.com/acme" /></label>
      <button type="button" className="btn-quiet" disabled={!link.trim()} onClick={addLink}>Add</button>
    </div>
    {problem && <p className="inline-error" role="alert">{problem}</p>}
    {suggestions === null ? <button type="button" className="btn-link" onClick={() => void window.sensei.jobSearch.suggestWatched().then(setSuggestions).catch(() => setSuggestions([]))}>Suggest companies from your jobs</button>
      : !fresh.length ? <p className="muted">No more companies from your jobs use Ashby, Greenhouse, or Lever.</p>
        : <div className="watched-suggestions"><span className="muted">From your jobs:</span>
          <button type="button" className="btn-quiet" onClick={() => onChange([...watched, ...fresh.map((item) => ({ board: item.board, slug: item.slug, name: item.name, source: "jobs" as const }))])}>Watch all {fresh.length}</button>
          {fresh.slice(0, 24).map((item) =>
          <button type="button" key={`${item.board}:${item.slug}`} className="btn-quiet" title={`${item.jobs} job${item.jobs === 1 ? "" : "s"}${item.interviewed ? ", reached an interview" : ""}`} onClick={() => onChange([...watched, { board: item.board, slug: item.slug, name: item.name, source: "jobs" }])}>+ {item.name}{item.interviewed ? " ★" : ""}</button>)}</div>}
  </Section>;
}

/** The scheduled search, said plainly: off (with Turn on), or when it runs; a repair the app made is mentioned. */
function ScheduleStatus({ settings, onTurnOn }: { settings: JobSearchSettings; onTurnOn: () => void }) {
  const [info, setInfo] = useState<(ScheduleInfo & { repaired?: string | null }) | null>(null);
  useEffect(() => { void window.sensei.jobSearch.scheduleInfo().then(setInfo).catch(() => undefined); }, [settings.schedule.enabled, settings.schedule.after, settings.schedule.mode]);
  if (!info?.supported) return null;
  const days = settings.schedule.days.length === 7 || !settings.schedule.days.length ? "every day" : settings.schedule.days.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ");
  const when = settings.schedule.mode === "daily" ? `once a day, the first time your computer is on after ${settings.schedule.after} (${days})` : `at ${settings.schedule.times.join(", ")} (${days})`;
  if (!settings.schedule.enabled) return <p className="find-schedule is-off">Scheduled search is off. <button className="btn-link" disabled={!settings.titles.length} onClick={onTurnOn}>Turn on</button> <span className="muted">({when}; change it in Search settings)</span></p>;
  if (!info.installed) return <p className="find-schedule is-off">Scheduled search is on in your settings but not installed on this computer. <button className="btn-link" onClick={onTurnOn}>Install it</button></p>;
  return <p className="find-schedule">Scheduled search is on: {when}.{info.repaired === "installed" ? " It was reinstalled when the app started, to match your settings." : ""}</p>;
}


const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** When searches run by themselves, even with the app closed (installed with the OS when settings are saved). */
function ScheduleFields({ schedule, onChange }: { schedule: JobSearchSettings["schedule"]; onChange: (schedule: JobSearchSettings["schedule"]) => void }) {
  const [info, setInfo] = useState<ScheduleInfo | null>(null);
  const [times, setTimes] = useState(schedule.times.join(", "));
  useEffect(() => { void window.sensei.jobSearch.scheduleInfo().then(setInfo).catch(() => undefined); }, [schedule.enabled]);
  function updateTimes(text: string) {
    setTimes(text);
    const parsed = text.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean).map((value) => {
      const match = /^(\d{1,2}):?(\d{2})$/.exec(value);
      return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
    });
    if (parsed.length && parsed.length <= 4 && parsed.every(Boolean)) onChange({ ...schedule, times: parsed as string[] });
  }
  return <Section id="search-schedule" title="Schedule" defaultOpen={false} count={schedule.enabled ? "On" : "Off"}>
    {info && !info.supported ? <p className="muted">{info.detail}</p> : <>
      <label className="search-check"><input type="checkbox" checked={schedule.enabled} onChange={(event) => onChange({ ...schedule, enabled: event.target.checked })} />Search on a schedule, even when JobSensei is closed</label>
      {schedule.enabled && <>
        <div className="search-field"><span>Days</span><div className="search-checks">{DAY_LABELS.map((label, day) => <label key={label}><input type="checkbox" checked={schedule.days.includes(day)} onChange={() => onChange({ ...schedule, days: schedule.days.includes(day) ? schedule.days.filter((value) => value !== day) : [...schedule.days, day].sort() })} />{label}</label>)}</div></div>
        <div className="search-field"><span>When</span>
          <div className="search-checks"><label><input type="radio" name="schedule-mode" checked={schedule.mode === "daily"} onChange={() => onChange({ ...schedule, mode: "daily" })} />Once a day, the first time my computer is on after</label>
            <input type="time" aria-label="Earliest time" value={schedule.after} disabled={schedule.mode !== "daily"} onChange={(event) => { if (/^\d{2}:\d{2}$/.test(event.target.value)) onChange({ ...schedule, after: event.target.value }); }} /></div>
          <div className="search-checks"><label><input type="radio" name="schedule-mode" checked={schedule.mode === "times"} onChange={() => onChange({ ...schedule, mode: "times" })} />At set times</label></div>
        </div>
        {schedule.mode === "times" && <label className="search-field"><span>Times (24-hour, up to 4, e.g. 08:00, 17:30)</span><input value={times} onChange={(event) => updateTimes(event.target.value)} /></label>}
        {schedule.mode === "times" && info?.platform === "win32" && <label className="search-check"><input type="checkbox" checked={schedule.wake} onChange={(event) => onChange({ ...schedule, wake: event.target.checked })} />Wake the computer from sleep to search (plugged in works best)</label>}
        <div className="search-field"><span>What each scheduled search does</span>
          <div className="search-checks">
            <label><input type="radio" name="schedule-agy" checked={schedule.agy === "never"} onChange={() => onChange({ ...schedule, agy: "never" })} />Watched companies only (free, seconds)</label>
            <label><input type="radio" name="schedule-agy" checked={schedule.agy === "every"} onChange={() => onChange({ ...schedule, agy: "every" })} />Watched companies and an Agy web search (uses Agy, a few minutes)</label>
            <label><input type="radio" name="schedule-agy" checked={schedule.agy === "days"} onChange={() => onChange({ ...schedule, agy: "days" })} />Watched companies every time, Agy on some days</label>
          </div>
          {schedule.agy === "days" && <div className="search-checks" aria-label="Days with an Agy web search">{DAY_LABELS.map((label, day) => <label key={label}><input type="checkbox" checked={schedule.agyDays.includes(day)} onChange={() => onChange({ ...schedule, agyDays: schedule.agyDays.includes(day) ? schedule.agyDays.filter((value) => value !== day) : [...schedule.agyDays, day].sort() })} />{label}</label>)}</div>}
        </div>
        <p className="muted">{schedule.agy === "never" ? "Each scheduled search reads your watched companies' job boards; Agy's web search runs only when you press Run now." : "With Agy, a search finds new companies too and takes a few minutes. If Agy's part doesn't finish (sleep, quota), the watched matches are kept and Agy tries once more later that day."} {schedule.mode === "daily"
          ? `One search per day, counted from ${schedule.after} to ${schedule.after} the next day: it runs the first time your computer is on in that stretch, whether it's already awake, wakes from sleep, or starts up. Searches you run yourself add jobs but don't use up the day's search. Example: on at 8:30 Monday runs Monday's search; on again at 1 a.m. doesn't; the next one runs the first time you're on after ${schedule.after} Tuesday.`
          : info?.platform === "win32" ? (schedule.wake ? "A sleeping PC wakes for it; a PC that's off runs it when you next sign in." : "If your PC is asleep or off at that time, the search runs as soon as it's back.") : "If your Mac is asleep at that time, the search runs when it wakes; if it's shut down, it waits for the next time."} Strong matches are drafted when you next open the app. Searching while the computer is fully off isn't possible yet.</p>
      </>}
      {info && <p className="muted">{info.installed ? (schedule.enabled ? "Status: scheduled. Changes apply when you save." : "Status: scheduled. Saving turns it off.") : schedule.enabled ? "Status: not scheduled yet. Save to turn it on." : "Status: off."}</p>}
    </>}
  </Section>;
}

