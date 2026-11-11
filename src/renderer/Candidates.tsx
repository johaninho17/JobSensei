// Recruiter Edition (recruiter plan R1): the candidate list, the first-candidate screen, and the switcher.
// Rendered only when FEATURES.candidates is on, so the solo build leaves this file out.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CandidateEntry, CandidatesState } from "../shared/candidates";
import type { CandidateSuggestion, LibraryPosting } from "../shared/candidate-match";
import { PrivacyDialog } from "./Privacy";
import { daysAgo, reportText, shortlistText, type Proposal, type ReportRow } from "../shared/recruiter-insight";

const message = (caught: unknown) => (caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "Something went wrong.");

/** Every switch reloads the window, so no screen keeps the previous candidate's jobs, files, or drafts. */
function reloadForCandidate(): void {
  window.location.reload();
}

/** Loads the candidate list first; with no candidate open, shows only the first-candidate screen. */
export function CandidateGate({ children }: { children: (state: CandidatesState) => ReactNode }) {
  const [state, setState] = useState<CandidatesState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The main view sets the theme when it loads; this screen can show before it, so it applies the saved one too.
  useEffect(() => { let saved: string | null = null; try { saved = window.localStorage.getItem("sensei-theme-v2"); } catch { saved = null; } document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light"; }, []);
  useEffect(() => { void window.sensei.candidates.state().then(setState, (caught) => setError(message(caught))); }, []);
  const active = state?.candidates.find((candidate) => candidate.id === state.activeId) ?? null;
  useEffect(() => { document.title = active ? `${active.displayName} · ${EDITION.productName}` : EDITION.productName; }, [active?.displayName]);
  if (error) return <main className="candidates-home"><p className="inline-error" role="alert">{error}</p></main>;
  if (!state) return null;
  if (!active) return <CandidatesHome state={state} />;
  return <>{children(state)}</>;
}

/**
 * Adding a candidate is the whole setup (recruiter plan R8): name, base resume, and anything else the recruiter has.
 * Files can be chosen or dropped; nothing here asks the candidate to describe themselves.
 */
function AddCandidateForm({ autoFocus = false, onCancel }: { autoFocus?: boolean; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [resume, setResume] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<"resume" | "files" | null>(null);
  const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
  const dropped = (event: React.DragEvent) => [...event.dataTransfer.files].map((file) => window.sensei.files.pathForFile(file)).filter(Boolean);
  const dropZone = (kind: "resume" | "files") => ({
    onDragOver: (event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); setOver(kind); },
    onDragLeave: () => setOver(null),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault(); event.stopPropagation(); setOver(null);
      const paths = dropped(event);
      if (kind === "resume") { if (paths[0]) setResume(paths[0]); if (paths.length > 1) setFiles((current) => [...new Set([...current, ...paths.slice(1)])]); }
      else setFiles((current) => [...new Set([...current, ...paths])]);
    },
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try { await window.sensei.candidates.add(name.trim(), { resumePath: resume, files, notes: notes.trim() || null }); reloadForCandidate(); } catch (caught) { setError(message(caught)); setBusy(false); }
  }
  return <form className="candidate-add candidate-intake" onSubmit={(event) => void submit(event)}>
    <label><span>Candidate's full name</span><input value={name} onChange={(event) => setName(event.target.value)} autoFocus={autoFocus} maxLength={120} placeholder="Alex Morgan" /></label>
    <div className={`intake-drop${over === "resume" ? " is-over" : ""}`} {...dropZone("resume")}>
      <span className="intake-label">Base resume <small>Word or Markdown; its layout is kept for every tailored resume</small></span>
      {resume ? <span className="intake-file">{fileName(resume)} <button type="button" className="btn-link" onClick={() => setResume(null)}>Remove</button></span>
        : <span className="intake-actions"><button type="button" className="btn-quiet" onClick={() => void window.sensei.candidates.chooseFiles("resume").then((paths) => { if (paths[0]) setResume(paths[0]); })}>Choose resume</button><small>or drop it here</small></span>}
    </div>
    <div className={`intake-drop${over === "files" ? " is-over" : ""}`} {...dropZone("files")}>
      <span className="intake-label">Other files <small>optional: older resumes, LinkedIn export, notes, work samples</small></span>
      {files.length > 0 && <ul className="intake-files">{files.map((path) => <li key={path}>{fileName(path)} <button type="button" className="btn-link" onClick={() => setFiles((current) => current.filter((value) => value !== path))}>Remove</button></li>)}</ul>}
      <span className="intake-actions"><button type="button" className="btn-quiet" onClick={() => void window.sensei.candidates.chooseFiles("files").then((paths) => setFiles((current) => [...new Set([...current, ...paths])]))}>Add files</button><small>or drop them here</small></span>
    </div>
    <label><span>Recruiter notes <small>optional: what you learned from the candidate, one fact per line</small></span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={50_000} placeholder={"- At Northstar Labs, ran onboarding calls for new accounts.\n- Uses Excel for weekly reporting."} /></label>
    <div className="onboarding-actions">
      <button className="btn-primary" type="submit" disabled={!name.trim() || busy}>{busy ? "Adding…" : "Add candidate"}</button>
      {onCancel && <button className="btn-quiet" type="button" onClick={onCancel}>Cancel</button>}
      {!resume && name.trim() && <small className="muted">You can add the resume later; tailoring starts once it's there.</small>}
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </form>;
}

/**
 * The recruiter's home when no candidate is open (recruiter plan R8): every candidate in one table, with their resume,
 * jobs, and queue at a glance, and Add candidate. An empty list is just an empty table, not an onboarding screen.
 */
function CandidatesHome({ state }: { state: CandidatesState }) {
  const [privacy, setPrivacy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [approving, setApproving] = useState<CandidateEntry | null>(null);
  const [reporting, setReporting] = useState<CandidateEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listed = state.candidates.filter((candidate) => candidate.status !== "archived");
  const archived = state.candidates.filter((candidate) => candidate.status === "archived");
  const open = (id: string) => void window.sensei.candidates.switchTo(id).then(reloadForCandidate, (caught) => setError(message(caught)));
  return <main className="candidates-home" aria-labelledby="candidates-title">
    <header className="candidates-top">
      <span className="candidates-brand">{EDITION.productName}</span>
      <button className="btn-link" onClick={() => setPrivacy(true)}>Privacy and terms</button>
    </header>
    <section className="candidates-page">
      <div className="page-head candidates-head">
        <div><h1 id="candidates-title">Candidates</h1><p>{listed.length ? `${listed.length} candidate${listed.length === 1 ? "" : "s"}. Open one to add jobs and review tailored resumes.` : "No candidates yet."}</p></div>
        <button className="btn-primary" onClick={() => setAdding(true)}>Add candidate</button>
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <table className="pipeline-table candidates-table">
        <thead><tr><th scope="col">Candidate</th><th scope="col">Status</th><th scope="col">Resume</th><th scope="col">Jobs</th><th scope="col">To approve</th><th scope="col">Ready to send</th><th scope="col">This week</th><th scope="col">Responses</th><th scope="col">Waiting</th><th scope="col">Last opened</th><th scope="col"><span className="sr-only">Report</span></th></tr></thead>
        <tbody>
          {listed.map((candidate) => { const info = state.overview?.[candidate.id]; return <tr key={candidate.id}>
            <td><button className="btn-link" onClick={() => open(candidate.id)}>{candidate.displayName}</button></td>
            <td>{STATUS_LABEL[candidate.status]}</td>
            <td>{info?.resume ? "Ready" : <span className="side-due">Needs a resume</span>}</td>
            <td>{info?.jobs ?? 0}</td>
            <td>{info?.toApprove ? <button className="btn-link" onClick={() => setApproving(candidate)}>{info.toApprove}</button> : 0}</td>
            <td>{info?.ready ?? 0}</td>
            <td title="Applications sent in the last 7 days">{info?.insight?.appliedThisWeek ?? 0}{info?.weeklyTarget ? ` of ${info.weeklyTarget}` : ""}</td>
            <td title={info?.insight ? `${info.insight.responses} of ${info.insight.applied} applications got a reply; ${info.insight.interviews} interview${info.insight.interviews === 1 ? "" : "s"}, ${info.insight.offers} offer${info.insight.offers === 1 ? "" : "s"}` : undefined}>{info?.insight?.responseRate === null || info?.insight?.responseRate === undefined ? "—" : `${Math.round(info.insight.responseRate * 100)}%`}{info?.insight?.interviews ? ` · ${info.insight.interviews} int.` : ""}</td>
            <td>{state.waiting?.[candidate.id] ?? 0}</td>
            <td>{candidate.lastUsedAt ? new Date(candidate.lastUsedAt).toLocaleDateString() : "Never"}</td>
            <td><button className="btn-link" onClick={() => setReporting(candidate)}>Report</button></td>
          </tr>; })}
          {!listed.length && <tr><td colSpan={11} className="muted">Add a candidate with their resume and anything else you have for them.</td></tr>}
        </tbody>
      </table>
      {archived.length > 0 && <ArchivedList candidates={archived} />}
    </section>
    {adding && <div className="search-overlay" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") setAdding(false); }}>
      <div className="company-dialog intake-dialog" role="dialog" aria-modal="true" aria-labelledby="intake-home-title"><h2 id="intake-home-title">Add a candidate</h2><AddCandidateForm autoFocus onCancel={() => setAdding(false)} /></div>
    </div>}
    {privacy && <PrivacyDialog onClose={() => setPrivacy(false)} />}
    {approving && <ApprovalDialog candidate={approving} onClose={() => { setApproving(null); reloadForCandidate(); }} />}
    {reporting && <ReportDialog candidate={reporting} target={state.overview?.[reporting.id]?.weeklyTarget ?? null} onClose={() => setReporting(null)} />}
  </main>;
}

const SHORTCUT = /mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";
const STATUS_LABEL: Record<CandidateEntry["status"], string> = { active: "Active", paused: "Paused", placed: "Placed", archived: "Archived" };

function ArchivedList({ candidates }: { candidates: CandidateEntry[] }) {
  return <details className="candidate-archived"><summary>Archived ({candidates.length})</summary>
    <ul>{candidates.map((candidate) => <li key={candidate.id}><span>{candidate.displayName}</span><button className="btn-link" onClick={() => void window.sensei.candidates.setStatus(candidate.id, "active").then(reloadForCandidate)}>Restore</button></li>)}</ul>
  </details>;
}

/** Top of the sidebar: who is open, and switching, adding, renaming, or archiving. */
export function CandidateSwitcher({ state }: { state: CandidatesState }) {
  const active = state.candidates.find((candidate) => candidate.id === state.activeId)!;
  const others = state.candidates.filter((candidate) => candidate.id !== active.id && candidate.status !== "archived");
  const archived = state.candidates.filter((candidate) => candidate.status === "archived");
  const listed = state.candidates.filter((candidate) => candidate.status !== "archived");
  const [mode, setMode] = useState<"menu" | "add" | "rename" | "delete">("menu");
  const [notice, setNotice] = useState<string | null>(null);
  const [rename, setRename] = useState(active.displayName);
  const [error, setError] = useState<string | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const run = (task: Promise<unknown>) => task.then(reloadForCandidate, (caught) => setError(message(caught)));
  // ⌘/Ctrl + 1–9 opens the candidates in list order.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || !/^[1-9]$/.test(event.key)) return;
      const target = listed[Number(event.key) - 1];
      if (!target || target.id === active.id) return;
      event.preventDefault();
      void run(window.sensei.candidates.switchTo(target.id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, active.id]);
  return <details className="candidate-switcher" ref={details} onToggle={() => { setMode("menu"); setError(null); }}>
    <summary aria-label={`Candidate: ${active.displayName}. Switch candidate`}><small>Candidate</small><strong>{active.displayName}</strong></summary>
    <div className="jobs-more-menu candidate-menu" role="menu">
      {mode === "menu" && <>
        {others.map((candidate) => {
          const position = listed.findIndex((entry) => entry.id === candidate.id) + 1;
          return <button key={candidate.id} role="menuitem" className="menu-item" onClick={() => void run(window.sensei.candidates.switchTo(candidate.id))}>
            {candidate.displayName}<small>{STATUS_LABEL[candidate.status]}{state.waiting?.[candidate.id] ? ` · ${state.waiting[candidate.id]} waiting` : ""}{position <= 9 ? ` · ${SHORTCUT}${position}` : ""}</small>
          </button>;
        })}
        {others.length > 0 && <hr />}
        <button role="menuitem" className="menu-item" onClick={() => void run(window.sensei.candidates.showAll())}>All candidates</button>
        <button role="menuitem" className="menu-item" onClick={() => setMode("add")}>Add a candidate</button>
        <button role="menuitem" className="menu-item" onClick={() => setMode("rename")}>Rename {active.displayName}</button>
        {(["paused", "placed"] as const).filter((status) => status !== active.status).map((status) => <button key={status} role="menuitem" className="menu-item" onClick={() => void window.sensei.candidates.setStatus(active.id, status).then(reloadForCandidate, (caught) => setError(message(caught)))}>Mark as {STATUS_LABEL[status].toLowerCase()}</button>)}
        {active.status !== "active" && <button role="menuitem" className="menu-item" onClick={() => void run(window.sensei.candidates.setStatus(active.id, "active"))}>Mark as active</button>}
        <button role="menuitem" className="menu-item" onClick={() => { if (window.confirm(`Archive ${active.displayName}? Their folder stays on this computer and you can restore them later.`)) void run(window.sensei.candidates.setStatus(active.id, "archived")); }}>Archive {active.displayName}</button>
        <button role="menuitem" className="menu-item" onClick={() => void window.sensei.candidates.exportCandidate(active.id).then((result) => setNotice(result ? `Saved ${result.files} files to ${result.path.split(/[\\/]/).pop()}` : null), (caught) => setError(message(caught)))}>Export {active.displayName} (.zip)</button>
        <button role="menuitem" className="menu-item is-danger" onClick={() => setMode("delete")}>Delete {active.displayName}…</button>
        {notice && <p className="muted" role="status">{notice}</p>}
        {archived.length > 0 && <ArchivedList candidates={archived} />}
      </>}
      {mode === "add" && <div className="search-overlay" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") setMode("menu"); }}>
        <div className="company-dialog intake-dialog" role="dialog" aria-modal="true" aria-labelledby="intake-title"><h2 id="intake-title">Add a candidate</h2><AddCandidateForm autoFocus onCancel={() => setMode("menu")} /></div>
      </div>}
      {mode === "delete" && <DeleteCandidateForm candidate={active} onCancel={() => setMode("menu")} />}
      {mode === "rename" && <form className="candidate-add" onSubmit={(event) => { event.preventDefault(); void run(window.sensei.candidates.rename(active.id, rename)); }}>
        <label><span>Name</span><input value={rename} onChange={(event) => setRename(event.target.value)} autoFocus maxLength={120} /></label>
        <div className="onboarding-actions"><button className="btn-primary" type="submit" disabled={!rename.trim()}>Save</button><button className="btn-quiet" type="button" onClick={() => setMode("menu")}>Cancel</button></div>
      </form>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  </details>;
}

/** Recruiter plan R4: what the recruiter learned asking the candidate questions. Saved as a checked context file. */
export function RecruiterNotes({ name, onSaved }: { name: string | null; onSaved: (path: string) => void }) {
  const [notes, setNotes] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void window.sensei.candidates.notes().then((text) => { setNotes(text); setSaved(text); }, (caught) => setError(message(caught))); }, []);
  async function save() {
    if (notes === null) return;
    setBusy(true);
    setError(null);
    try { const path = await window.sensei.candidates.saveNotes(notes); setSaved(notes); onSaved(path); } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  const who = name ?? "the candidate";
  return <section className="context-block recruiter-notes" aria-labelledby="recruiter-notes-title">
    <h2 id="recruiter-notes-title">Recruiter notes</h2>
    <p>What you learned asking {who} questions: tools they use, work they did, results they told you about. Agy uses every line as evidence for {who}'s resume, as written, and never adds to it. One fact per line works best; name the employer when it belongs to one job.</p>
    {notes === null && !error ? <p className="muted">Loading…</p> : <>
      <textarea aria-label={`Recruiter notes for ${who}`} value={notes ?? ""} onChange={(event) => setNotes(event.target.value)} rows={14} maxLength={50_000} placeholder={"- At Northstar Labs, ran onboarding calls for new customer accounts.\n- Uses Excel and SQL for weekly reporting."} />
      <div className="onboarding-actions">
        <button className="btn-primary" onClick={() => void save()} disabled={busy || notes === saved}>{busy ? "Saving…" : "Save notes"}</button>
        {notes === saved && saved.trim() !== "" && <span className="muted">Saved and checked for Agy</span>}
      </div>
    </>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}

/**
 * "Who is this for?" (recruiter plan R5): every candidate, best match first, each with why they are or aren't
 * suggested. The open candidate and the suggested ones start ticked; nothing is queued until the recruiter confirms.
 */
export function WhoIsThisFor({ posting, activeId, remaining = 0, onDone }: { posting: LibraryPosting; activeId: string | null; remaining?: number; onDone: (ids: string[] | null, forRest: boolean) => void }) {
  const [forRest, setForRest] = useState(false);
  const [rows, setRows] = useState<CandidateSuggestion[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void window.sensei.candidates.suggest(posting.id).then((list) => {
      setRows(list);
      setChosen(new Set(list.filter((row) => !row.duplicate && !row.blocker && (row.suggested || row.id === activeId)).map((row) => row.id)));
    }, (caught) => setError(message(caught)));
  }, [posting.id]);
  const toggle = (id: string) => setChosen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const label = [posting.company, posting.title].filter(Boolean).join(", ") || posting.url || "this posting";
  return <div className="search-overlay" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") onDone(null, false); }}>
    <form className="company-dialog who-dialog" role="dialog" aria-modal="true" aria-labelledby="who-title" onSubmit={(event) => { event.preventDefault(); if (chosen.size) onDone([...chosen], forRest); }}>
      <h2 id="who-title">Who is this for?</h2>
      <p>{label}{posting.location ? ` · ${posting.location}` : ""}. Each candidate gets their own copy of the posting, tailored in their own folder.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!rows && !error && <p className="muted">Checking candidates…</p>}
      {rows && <ul className="who-list">{rows.map((row) => <li key={row.id} className={row.duplicate || row.blocker ? "is-warn" : row.suggested ? "is-good" : ""}>
        <label>
          <input type="checkbox" checked={chosen.has(row.id)} onChange={() => toggle(row.id)} />
          <span className="who-name"><strong>{row.name}</strong>{row.id === activeId && <small>Open now</small>}{row.status !== "active" && <small>{STATUS_LABEL[row.status as CandidateEntry["status"]] ?? row.status}</small>}{row.suggested && <small className="who-tag">Suggested</small>}</span>
        </label>
        {row.reasons.length > 0 && <ul className="who-reasons">{row.reasons.map((reason) => <li key={reason.text} className={reason.good ? "good" : "bad"}><span aria-hidden="true">{reason.good ? "✓" : "–"}</span> {reason.text}</li>)}</ul>}
      </li>)}</ul>}
      <div className="company-dialog-actions">
        {remaining > 0 && <label className="setup-check"><input type="checkbox" checked={forRest} onChange={(event) => setForRest(event.target.checked)} /> Use the same candidates for the next {remaining} link{remaining === 1 ? "" : "s"}</label>}
        <button type="button" className="btn-quiet" onClick={() => onDone(null, false)}>Cancel</button>
        <button className="btn-primary" disabled={!chosen.size}>{chosen.size > 1 ? `Tailor for ${chosen.size} candidates` : "Tailor for 1 candidate"}</button>
      </div>
    </form>
  </div>;
}

/** Deleting is permanent: the recruiter types the name, and is offered an export first (recruiter plan R6). */
function DeleteCandidateForm({ candidate, onCancel }: { candidate: CandidateEntry; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string[] | null>(null);
  async function remove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try { setRemoved((await window.sensei.candidates.deleteCandidate(candidate.id, typed)).removed); } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  if (removed) return <div className="candidate-add" role="status">
    <p><strong>{candidate.displayName} was deleted.</strong> Removed:</p>
    <ul>{removed.map((line) => <li key={line}>{line}</li>)}</ul>
    <div className="onboarding-actions"><button className="btn-primary" onClick={reloadForCandidate}>Done</button></div>
  </div>;
  return <form className="candidate-add" onSubmit={(event) => void remove(event)}>
    <p>This removes {candidate.displayName}'s folder (resume, career files, notes, jobs, and drafts), their Agy history, and their place on the list. It can't be undone.</p>
    <div className="onboarding-actions"><button type="button" className="btn-quiet" onClick={() => void window.sensei.candidates.exportCandidate(candidate.id).then((result) => setExported(result ? `Exported to ${result.path.split(/[\\/]/).pop()}` : null), (caught) => setError(message(caught)))}>Export first (.zip)</button>{exported && <span className="muted">{exported}</span>}</div>
    <label><span>Type <strong>{candidate.displayName}</strong> to confirm</span><input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus /></label>
    <div className="onboarding-actions">
      <button className="btn-primary is-danger" type="submit" disabled={typed.trim() !== candidate.displayName || busy}>{busy ? "Deleting…" : "Delete for good"}</button>
      <button className="btn-quiet" type="button" onClick={onCancel}>Cancel</button>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </form>;
}

/** A candidate without a readable base resume (recruiter plan R8): one card, no setup steps. */
export function CandidateResumeCard({ name, problem, onChoose }: { name: string | null; problem: string | null; onChoose: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const who = name ?? "the candidate";
  return <main className="candidate-start" aria-labelledby="resume-card-title">
    <section className="onboarding-card">
      <h1 id="resume-card-title">Add {name ? `${name}'s` : "the"} base resume</h1>
      <p>Tailoring starts once {who}'s resume is in. Use a Word (.docx) or Markdown (.md) file; every tailored resume keeps its layout, section order, dates, and length.</p>
      {problem && <p className="inline-error" role="alert">{problem}</p>}
      <div className="onboarding-actions"><button className="btn-primary" disabled={busy} onClick={() => { setBusy(true); void onChoose().finally(() => setBusy(false)); }}>{busy ? "Reading…" : "Choose resume"}</button></div>
    </section>
  </main>;
}

/** Copies text and says so for a moment. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <button className="btn-quiet" type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); })}>{done ? "Copied" : label}</button>;
}

/** Jobs waiting for the candidate's approval: send them the shortlist, then record each answer (plan R8 P5). */
function ApprovalDialog({ candidate, onClose }: { candidate: CandidateEntry; onClose: () => void }) {
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => void window.sensei.candidates.proposals(candidate.id).then(setItems, (caught) => setError(message(caught)));
  useEffect(load, [candidate.id]);
  const decide = (proposal: Proposal, approve: boolean) => void (approve ? window.sensei.candidates.approveProposal(candidate.id, proposal.id) : window.sensei.candidates.declineProposal(candidate.id, proposal.id)).then(load, (caught) => setError(message(caught)));
  return <div className="search-overlay" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <div className="company-dialog intake-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <h2 id="approval-title">Waiting for {candidate.displayName}'s approval</h2>
      <p>Send {candidate.displayName} the shortlist, then mark what they approved. Approved jobs join their queue and are tailored when you open them.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!items ? <p className="muted">Reading…</p> : items.length ? <>
        <ol className="approval-list">{items.map((item) => <li key={item.id}>
          <span><strong>{[item.company, item.title].filter(Boolean).join(": ") || "Job"}</strong>{item.reasons.length > 0 && <small>{item.reasons.slice(0, 3).join(" · ")}</small>}{item.url && <small>{item.url}</small>}</span>
          <span className="review-actions"><button className="btn-primary" onClick={() => decide(item, true)}>Approved</button><button className="btn-quiet" onClick={() => decide(item, false)}>Declined</button></span>
        </li>)}</ol>
        <div className="onboarding-actions"><CopyButton text={shortlistText(candidate.displayName, items)} label="Copy shortlist to send" /><button className="btn-quiet" onClick={onClose}>Done</button></div>
      </> : <><p className="muted">Nothing is waiting.</p><div className="onboarding-actions"><button className="btn-quiet" onClick={onClose}>Done</button></div></>}
    </div>
  </div>;
}

/** The weekly report for one candidate: applications sent in a date range, ready to paste into an email (plan R8 P5). */
function ReportDialog({ candidate, target, onClose }: { candidate: CandidateEntry; target: number | null; onClose: () => void }) {
  const now = new Date();
  const [from, setFrom] = useState(daysAgo(now, 6));
  const [to, setTo] = useState(daysAgo(now, 0));
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setRows(null); void window.sensei.candidates.report(candidate.id, from, to).then(setRows, (caught) => setError(message(caught))); }, [candidate.id, from, to]);
  const csv = rows ? ["Company,Title,Sent,Via,Fit,Status,Link", ...rows.map((row) => [row.company, row.title, row.date, row.via, row.fit, row.status, row.link].map((cell) => /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell).join(","))].join("\n") : "";
  return <div className="search-overlay" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <div className="company-dialog intake-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <h2 id="report-title">Report for {candidate.displayName}</h2>
      <div className="report-dates"><label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!rows ? <p className="muted">Reading…</p> : <>
        <p>{rows.length} application{rows.length === 1 ? "" : "s"} sent{target ? ` (weekly goal: ${target})` : ""}.</p>
        {rows.length > 0 && <table className="pipeline-table"><thead><tr><th scope="col">Company</th><th scope="col">Title</th><th scope="col">Sent</th><th scope="col">Via</th><th scope="col">Status</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={`${index}-${row.company}`}><td>{row.company}</td><td>{row.title}</td><td>{row.date}</td><td>{row.via}</td><td>{row.status}</td></tr>)}</tbody></table>}
        <div className="onboarding-actions"><CopyButton text={reportText(candidate.displayName, from, to, rows, target)} label="Copy as email" />{rows.length > 0 && <CopyButton text={csv} label="Copy as CSV" />}<button className="btn-quiet" onClick={onClose}>Done</button></div>
      </>}
    </div>
  </div>;
}
