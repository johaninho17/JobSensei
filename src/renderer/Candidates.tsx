// Recruiter Edition (recruiter plan R1): the candidate list, the first-candidate screen, and the switcher.
// Rendered only when FEATURES.candidates is on, so the solo build leaves this file out.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CandidateEntry, CandidatesState } from "../shared/candidates";
import type { CandidateSuggestion, LibraryPosting } from "../shared/candidate-match";

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
  if (error) return <main className="candidate-start"><p className="inline-error" role="alert">{error}</p></main>;
  if (!state) return null;
  if (!active) return <CandidateStart state={state} />;
  return <>{children(state)}</>;
}

function AddCandidateForm({ autoFocus = false, onCancel }: { autoFocus?: boolean; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try { await window.sensei.candidates.add(name.trim()); reloadForCandidate(); } catch (caught) { setError(message(caught)); setBusy(false); }
  }
  return <form className="candidate-add" onSubmit={(event) => void submit(event)}>
    <label><span>Candidate's full name</span><input value={name} onChange={(event) => setName(event.target.value)} autoFocus={autoFocus} maxLength={120} placeholder="Alex Morgan" /></label>
    <div className="onboarding-actions">
      <button className="btn-primary" type="submit" disabled={!name.trim() || busy}>{busy ? "Adding…" : "Add candidate"}</button>
      {onCancel && <button className="btn-quiet" type="button" onClick={onCancel}>Cancel</button>}
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </form>;
}

/** Shown when no candidate is open: the first run, or after the open candidate was archived. */
function CandidateStart({ state }: { state: CandidatesState }) {
  const others = state.candidates.filter((candidate) => candidate.status !== "archived");
  const archived = state.candidates.filter((candidate) => candidate.status === "archived");
  return <main className="candidate-start" aria-labelledby="candidate-start-title">
    <header>
      <p className="candidate-start-edition">{EDITION.productName}</p>
      <h1 id="candidate-start-title">{state.candidates.length ? "Choose a candidate" : "Add your first candidate"}</h1>
      <p>Each candidate gets their own folder for their resume, career files, and jobs. Agy only ever sees the candidate you have open.</p>
    </header>
    {others.length > 0 && <ul className="candidate-list">{others.map((candidate) => <li key={candidate.id}><CandidateOpenButton candidate={candidate} /></li>)}</ul>}
    <section className="onboarding-card"><h2>{state.candidates.length ? "Add a candidate" : "Who are you working for?"}</h2><AddCandidateForm autoFocus /></section>
    {archived.length > 0 && <ArchivedList candidates={archived} />}
  </main>;
}

function CandidateOpenButton({ candidate }: { candidate: CandidateEntry }) {
  const [error, setError] = useState<string | null>(null);
  return <>
    <button className="candidate-open" onClick={() => void window.sensei.candidates.switchTo(candidate.id).then(reloadForCandidate, (caught) => setError(message(caught)))}>
      <strong>{candidate.displayName}</strong><small>{STATUS_LABEL[candidate.status]}</small>
    </button>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </>;
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
  const [mode, setMode] = useState<"menu" | "add" | "rename">("menu");
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
        <button role="menuitem" className="menu-item" onClick={() => setMode("add")}>Add a candidate</button>
        <button role="menuitem" className="menu-item" onClick={() => setMode("rename")}>Rename {active.displayName}</button>
        {(["paused", "placed"] as const).filter((status) => status !== active.status).map((status) => <button key={status} role="menuitem" className="menu-item" onClick={() => void window.sensei.candidates.setStatus(active.id, status).then(reloadForCandidate, (caught) => setError(message(caught)))}>Mark as {STATUS_LABEL[status].toLowerCase()}</button>)}
        {active.status !== "active" && <button role="menuitem" className="menu-item" onClick={() => void run(window.sensei.candidates.setStatus(active.id, "active"))}>Mark as active</button>}
        <button role="menuitem" className="menu-item" onClick={() => { if (window.confirm(`Archive ${active.displayName}? Their folder stays on this computer and you can restore them later.`)) void run(window.sensei.candidates.setStatus(active.id, "archived")); }}>Archive {active.displayName}</button>
        {archived.length > 0 && <ArchivedList candidates={archived} />}
      </>}
      {mode === "add" && <AddCandidateForm autoFocus onCancel={() => setMode("menu")} />}
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
export function WhoIsThisFor({ posting, activeId, onDone }: { posting: LibraryPosting; activeId: string | null; onDone: (ids: string[] | null) => void }) {
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
  return <div className="search-overlay" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") onDone(null); }}>
    <form className="company-dialog who-dialog" role="dialog" aria-modal="true" aria-labelledby="who-title" onSubmit={(event) => { event.preventDefault(); if (chosen.size) onDone([...chosen]); }}>
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
        <button type="button" className="btn-quiet" onClick={() => onDone(null)}>Cancel</button>
        <button className="btn-primary" disabled={!chosen.size}>{chosen.size > 1 ? `Tailor for ${chosen.size} candidates` : "Tailor for 1 candidate"}</button>
      </div>
    </form>
  </div>;
}
