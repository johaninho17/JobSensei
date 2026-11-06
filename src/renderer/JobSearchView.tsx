// Job Search page: search settings, Run now, and the inbox of found postings ranked by quick fit.
// Agy only finds links; the app opened, saved, and rated every posting shown here (electron/job-search.ts).
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_JOB_SEARCH_SETTINGS, SEARCH_BOARDS, SEARCH_LEVELS, SKIPPED_BOARDS, WORK_SETUPS, rankInbox, searchProgressText,
  type InboxItem, type JobSearchSettings, type JobSearchState, type SearchRun, type SearchStatus, type WatchedSuggestion,
} from "../shared/job-search";
import { SubTabs } from "./SubTabs";

type Tab = "matches" | "settings" | "runs";
type Sort = "fit" | "newest" | "company";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : /(?:ch|sh|s|x)$/.test(word) ? "es" : "s"}`;
const BOARD_NAMES: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", smartrecruiters: "SmartRecruiters", oracle: "Oracle", linkedin: "LinkedIn" };
const capital = (text: string | null) => text ? text[0].toUpperCase() + text.slice(1) : null;
const fitClass = (score: number) => score >= 4 ? "is-high" : score >= 3 ? "is-mid" : "is-low";
const SETUP_LABEL: Record<(typeof WORK_SETUPS)[number], string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

/** Why a finished run added nothing (or what it left out), in plain words. */
export function runSummary(run: SearchRun): string {
  const left = Object.entries(run.leftOut).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${count} ${reason}`).join(", ");
  if (run.status === "failed") return `The search didn't finish: ${run.error ?? "unknown error"}`;
  const head = `${run.added} new match${run.added === 1 ? "" : "es"} from ${run.found} link${run.found === 1 ? "" : "s"}`;
  const notes = [
    run.replaced ? `${run.replaced} dead link${run.replaced === 1 ? "" : "s"} swapped for the live posting` : "",
    left ? `left out: ${left}` : "",
    run.error ? `Agy: ${run.error}` : "",
  ].filter(Boolean).join("; ");
  return `${head}${notes ? ` (${notes})` : ""}.`;
}

export function JobSearchView({ status, onQueueFound, onOpenJob, onToast }: {
  /** The run's live status, kept by the app so it survives leaving this page. */
  status: SearchStatus;
  /** Sends a found job to the application queue; returns how many jobs are ahead of it. */
  onQueueFound: (id: string, auto: boolean) => Promise<number>;
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

  const live = useMemo(() => rankInbox((state?.items ?? []).filter((item) => item.status !== "dismissed"), sort), [state, sort]);
  const bar = settings?.minFit ?? DEFAULT_JOB_SEARCH_SETTINGS.minFit;
  const above = live.filter((item) => item.fit.score >= bar && !item.fit.blockers.length);
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

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
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
      for (const id of ids) await window.sensei.jobSearch.saveJob(id);
      setState((await window.sensei.jobSearch.get()).state);
      setSelected(new Set());
      onToast(`Saved ${plural(ids.length, "job")} to Jobs.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  async function queue(ids: string[]) {
    setBusy(true);
    try {
      let ahead = 0;
      for (const id of ids) ahead = await onQueueFound(id, false);
      setState((await window.sensei.jobSearch.get()).state);
      setSelected(new Set());
      onToast(`Sent ${plural(ids.length, "job")} for drafts${ahead ? ` (${ahead} ahead in the queue)` : ""}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason));
    } finally { setBusy(false); }
  }

  function renderItem(item: InboxItem) {
    const isSelected = selected.has(item.id);
    const facts = [item.location, item.workSetup, item.pay, capital(item.level), item.postedAt ? `Posted ${item.postedAt}` : null, item.board ? BOARD_NAMES[item.board] ?? item.board : null].filter(Boolean);
    return <li key={item.id} className={`find-row${isSelected ? " is-selected" : ""}`} onClick={selecting ? () => toggle(item.id) : undefined}>
      {selecting && <input type="checkbox" checked={isSelected} onChange={() => toggle(item.id)} onClick={(event) => event.stopPropagation()} aria-label={`Select ${item.company ?? ""} ${item.title ?? ""}`} />}
      <span className={`fit-badge ${fitClass(item.fit.score)}`} title="Quick fit: the app's own check of your files against the posting, not a full rating">{item.fit.score.toFixed(1)}</span>
      <div className="find-main">
        <strong>{item.title ?? "Untitled role"}</strong> <span className="muted">· {item.company ?? "Company not named"}</span>{item.watched && <span className="find-tag">Watched company</span>}
        {facts.length > 0 && <p className="find-facts">{facts.join(" · ")}</p>}
        <p className="find-why">{item.fit.why}</p>
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
        {item.status === "saved" && item.jobId && <button className="btn-link" onClick={() => onOpenJob(item.jobId!)}>In Jobs: open</button>}
        {item.status === "queued" && <span className="muted">{item.autoQueued ? "Sent for drafts automatically" : "Sent for drafts"}</span>}
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
    </p></div>
    <div className="find-run-buttons">
      {(settings?.watched.length ?? 0) > 0 && <button className="btn-quiet" disabled={running || !settings?.titles.length} onClick={() => void runNow("watched")}>Check watched companies</button>}
      <button className="btn-primary" disabled={running || !settings?.titles.length} title={settings?.titles.length ? undefined : "Add at least one job title in Search settings"} onClick={() => void runNow("search")}>{running ? "Searching…" : "Run now"}</button>
    </div>
    </header>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <SubTabs idPrefix="job-search" label="Job Search" value={tab} onChange={setTab} tabs={[
      { id: "matches", label: "Matches", count: newCount || null },
      { id: "settings", label: "Search settings" },
      { id: "runs", label: "Runs", count: state?.runs.length || null },
    ]} actions={tab === "matches" && live.length > 0 ? <>
      <label className="muted find-sort">Sort <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="fit">Fit</option><option value="newest">Newest</option><option value="company">Company</option></select></label>
      <button className="btn-quiet" onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? "Done" : "Select"}</button>
    </> : null} />

    {tab === "matches" && <div role="tabpanel" aria-labelledby="job-search-tab-matches">
      {selecting && <div className="select-bar" role="toolbar" aria-label="Selected matches">
        <strong aria-live="polite">{selected.size ? `${plural(selected.size, "job")} selected` : "Click jobs to select them"}</strong>
        <button className="btn-link" onClick={() => setSelected(new Set(visibleNew))}>Select all {visibleNew.length} new</button>
        <button className="btn-link" onClick={() => setSelected(new Set(below.filter((item) => item.status === "new").map((item) => item.id)))}>Select all below your bar</button>
        {selected.size > 0 && <button className="btn-link" onClick={() => setSelected(new Set())}>Clear</button>}
        <span className="select-bar-actions">
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
      <p className="muted find-note">Quick fit is the app's own check of your resume and checked work records against the posting's requirements. The full rating runs when you draft an application.</p>
    </div>}

    {tab === "settings" && settings && <SearchSettingsForm settings={settings} onSaved={(next) => { setSettings(next); onToast("Search settings saved."); }} />}

    {tab === "runs" && <div role="tabpanel" aria-labelledby="job-search-tab-runs">
      {!state?.runs.length ? <p className="muted">No searches yet.</p> : <ul className="find-runs">
        {[...state.runs].reverse().map((run) => <li key={run.id}>
          <strong>{new Date(run.startedAt).toLocaleString()}</strong>{run.status === "running" && " · running"}
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
    excludeKeywords: listText(settings.excludeKeywords), extraSites: listText(settings.extraSites), skipSites: listText(settings.skipSites), skipCompanies: listText(settings.skipCompanies),
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
        titles: parseList(lists.titles), locations: parseList(lists.locations), includeKeywords: parseList(lists.includeKeywords), excludeKeywords: parseList(lists.excludeKeywords),
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
    <fieldset><legend>What to look for</legend>
      {text("titles", "Job titles", "e.g. Solutions Engineer, Customer Success Manager")}
      {text("locations", "Where", "Cities or states; leave empty for anywhere in the US")}
      <div className="search-field"><span>Work setup</span><div className="search-checks">{WORK_SETUPS.map((mode) => <label key={mode}><input type="checkbox" checked={draft.workSetups.includes(mode)} onChange={() => set("workSetups", toggleIn(draft.workSetups, mode))} />{SETUP_LABEL[mode]}</label>)}</div></div>
      <div className="search-field"><span>Level</span><div className="search-checks">{SEARCH_LEVELS.map((level) => <label key={level}><input type="checkbox" checked={draft.levels.includes(level)} onChange={() => set("levels", toggleIn(draft.levels, level))} />{level[0].toUpperCase() + level.slice(1)}</label>)}</div></div>
      <label className="search-field"><span>Lowest base pay (per year, USD)</span><input type="number" min={0} step={5000} value={draft.payFloor ?? ""} onChange={(event) => set("payFloor", event.target.value ? Number(event.target.value) : null)} placeholder="No floor" /></label>
      <label className="search-check"><input type="checkbox" checked={draft.needsSponsorship} onChange={(event) => set("needsSponsorship", event.target.checked)} />I need visa sponsorship</label>
      <label className="search-field"><span>Posted within (days)</span><input type="number" min={1} max={90} value={draft.postedWithinDays} onChange={(event) => set("postedWithinDays", Number(event.target.value) || 14)} /></label>
      {text("includeKeywords", "Should mention", "Optional keywords")}
      {text("excludeKeywords", "Leave out postings about", "e.g. commission only, clearance")}
      {text("skipCompanies", "Never show these companies", "Optional")}
    </fieldset>
    <fieldset><legend>Where to search</legend>
      <div className="search-field"><span>Boards</span><div className="search-checks">{SEARCH_BOARDS.map((board) => <label key={board.id}><input type="checkbox" checked={!draft.boardsOff.includes(board.id)} onChange={() => set("boardsOff", toggleIn(draft.boardsOff, board.id))} />{board.name}</label>)}</div></div>
      {text("extraSites", "Also search these sites", "Careers pages or boards, e.g. jobs.example.com")}
      {text("skipSites", "Never use these sites", "Domains to skip")}
      <p className="muted">Always skipped: {SKIPPED_BOARDS.map((board) => `${board.name} (${board.reason})`).join("; ")}.</p>
    </fieldset>
    <WatchedCompanies watched={draft.watched} onChange={(watched) => set("watched", watched)} />
    <fieldset><legend>Ratings and drafts</legend>
      <label className="search-field"><span>Your bar (quick fit, 1–5)</span><input type="number" min={1} max={5} step={0.1} value={draft.minFit} onChange={(event) => set("minFit", Number(event.target.value) || 3)} /></label>
      <label className="search-check"><input type="checkbox" checked={draft.autoDraftAt !== null} onChange={(event) => set("autoDraftAt", event.target.checked ? 4 : null)} />Draft applications automatically for strong matches</label>
      {draft.autoDraftAt !== null && <div className="settings-inline-fields">
        <label className="search-field"><span>At or above</span><input type="number" min={1} max={5} step={0.1} value={draft.autoDraftAt} onChange={(event) => set("autoDraftAt", Number(event.target.value) || 4)} /></label>
        <label className="search-field"><span>At most per day</span><input type="number" min={1} max={10} value={draft.autoDraftDailyCap} onChange={(event) => set("autoDraftDailyCap", Number(event.target.value) || 3)} /></label>
      </div>}
      <label className="search-field"><span>Links per search</span><input type="number" min={5} max={40} value={draft.resultsPerRun} onChange={(event) => set("resultsPerRun", Number(event.target.value) || 20)} /></label>
    </fieldset>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save search settings"}</button>
  </form>;
}

const BOARD_LABEL: Record<WatchedSuggestion["board"], string> = { ashby: "Ashby", greenhouse: "Greenhouse", lever: "Lever" };

/** Companies checked on every run through their public boards, free and without Agy. */
function WatchedCompanies({ watched, onChange }: { watched: JobSearchSettings["watched"]; onChange: (watched: JobSearchSettings["watched"]) => void }) {
  const [link, setLink] = useState("");
  const [problem, setProblem] = useState("");
  const [suggestions, setSuggestions] = useState<WatchedSuggestion[] | null>(null);
  const has = (board: string, slug: string) => watched.some((company) => company.board === board && company.slug.toLowerCase() === slug.toLowerCase());
  function addLink() {
    setProblem("");
    const ref = parseBoardLink(link);
    if (!ref) { setProblem("Use a company's Ashby, Greenhouse, or Lever jobs link, such as jobs.lever.co/acme."); return; }
    if (!has(ref.board, ref.slug)) onChange([...watched, { ...ref, name: ref.slug }]);
    setLink("");
  }
  return <fieldset><legend>Watched companies</legend>
    <p className="muted">Checked on every run through their public job boards, with no Agy quota. Only roles that fit your job titles are shown.</p>
    {watched.length > 0 && <ul className="watched-list">{watched.map((company) => <li key={`${company.board}:${company.slug}`}>
      <span>{company.name || company.slug} <span className="muted">· {BOARD_LABEL[company.board]}</span></span>
      <button type="button" className="btn-link" onClick={() => onChange(watched.filter((candidate) => candidate !== company))}>Remove</button>
    </li>)}</ul>}
    <div className="settings-inline-fields">
      <label className="search-field"><span>Add by jobs link</span><input value={link} onChange={(event) => setLink(event.target.value)} placeholder="jobs.ashbyhq.com/acme" /></label>
      <button type="button" className="btn-quiet" disabled={!link.trim()} onClick={addLink}>Add</button>
    </div>
    {problem && <p className="inline-error" role="alert">{problem}</p>}
    {suggestions === null ? <button type="button" className="btn-link" onClick={() => void window.sensei.jobSearch.suggestWatched().then(setSuggestions).catch(() => setSuggestions([]))}>Suggest companies from your jobs</button>
      : !suggestions.filter((item) => !has(item.board, item.slug)).length ? <p className="muted">No more companies from your jobs use Ashby, Greenhouse, or Lever.</p>
        : <div className="watched-suggestions"><span className="muted">From your jobs:</span>{suggestions.filter((item) => !has(item.board, item.slug)).slice(0, 24).map((item) =>
          <button type="button" key={`${item.board}:${item.slug}`} className="btn-quiet" title={`${item.jobs} job${item.jobs === 1 ? "" : "s"}${item.interviewed ? ", reached an interview" : ""}`} onClick={() => onChange([...watched, { board: item.board, slug: item.slug, name: item.name }])}>+ {item.name}{item.interviewed ? " ★" : ""}</button>)}</div>}
  </fieldset>;
}

/** The board and company in a jobs link the user pasted (same rules as electron/job-boards.ts boardRef). */
function parseBoardLink(text: string): { board: WatchedSuggestion["board"]; slug: string } | null {
  let parsed: URL;
  try { parsed = new URL(text.trim().includes("://") ? text.trim() : `https://${text.trim()}`); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  const first = parsed.pathname.split("/").filter(Boolean)[0];
  const slug = first && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(first) ? first : null;
  if (host === "jobs.ashbyhq.com" && slug) return { board: "ashby", slug };
  if (host === "jobs.lever.co" && slug) return { board: "lever", slug };
  if (/(?:^|\.)greenhouse\.io$/.test(host)) { const ghSlug = first === "embed" ? parsed.searchParams.get("for") : slug; if (ghSlug) return { board: "greenhouse", slug: ghSlug }; }
  return null;
}
