// Recruiter Edition (plan Q4): the recruiter's postings. Add job links or a pasted posting once, choose which
// candidates each one is for, and see who every posting already went to. This is the only place that asks "Who is
// this for?"; inside a candidate, a job is simply for that candidate. Only rendered when FEATURES.candidates is on.
import { useEffect, useState, type FormEvent } from "react";
import type { LibraryEntry, LibraryPosting } from "../shared/candidate-match";
import { newQueueItem } from "../shared/job-queue";
import { WhoIsThisFor } from "./Candidates";
import { PageHead } from "./BentoPrimitives";

const message = (caught: unknown) => (caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "Something went wrong.");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

type Asking = { posting: LibraryPosting; remaining: number; resolve: (ids: string[] | null, forRest: boolean) => void };

/**
 * `onActive` adds the open candidate's copy to the window's queue (the window owns that queue); with no candidate
 * open, every chosen candidate's copy goes straight to their own queue.
 */
export function PostingsView({ activeId, onActive, onToast }: { activeId: string | null; onActive?: (pasteId: string, label: string | null, url: string | null) => Promise<void>; onToast: (text: string) => void }) {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [company, setCompany] = useState<{ posting: LibraryPosting; resolve: (name: string | null) => void } | null>(null);
  const [companyName, setCompanyName] = useState("");
  const load = () => void window.sensei.candidates.library().then(setEntries, (caught) => setError(message(caught)));
  useEffect(load, []);
  const askWho = (posting: LibraryPosting, remaining: number) => new Promise<{ ids: string[] | null; forRest: boolean }>((resolve) => setAsking({ posting, remaining, resolve: (ids, forRest) => resolve({ ids, forRest }) }));
  const askCompany = (posting: LibraryPosting) => new Promise<string | null>((resolve) => { setCompanyName(""); setCompany({ posting, resolve }); });

  async function send(posting: LibraryPosting, ids: string[], url: string | null) {
    const sent = await window.sensei.candidates.send(posting.id, ids);
    if (sent.active && onActive) await onActive(sent.active.pasteId, sent.active.label, url);
    const queued = sent.queued.length + (sent.active ? 1 : 0);
    onToast([queued ? `Queued for ${plural(queued, "candidate")}` : "", sent.proposed.length ? `waiting for approval from ${plural(sent.proposed.length, "candidate")}` : ""].filter(Boolean).join("; "));
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    const links = value.split(/\s+/).filter(Boolean);
    const allLinks = links.every((link) => /^https?:\/\/\S+$/i.test(link));
    if (!allLinks && value.length < 400) { setError("Paste job links (one per line) or a whole job description."); return; }
    setBusy(true); setError(null);
    const failed: string[] = [];
    let same: string[] | null = null;
    const items = allLinks ? [...new Set(links)].map((url) => ({ url, text: null as string | null })) : [{ url: null as string | null, text: value }];
    for (const [index, entry] of items.entries()) {
      try {
        const id = newQueueItem({ kind: "paste", label: null }, new Date()).id;
        let posting = entry.url ? await window.sensei.candidates.stageLink(entry.url, id) : await window.sensei.candidates.stagePaste(entry.text!, id);
        if (!posting.company) {
          const name = await askCompany(posting);
          if (name) posting = await window.sensei.candidates.setPostingCompany(id, name);
        }
        let ids: string[] | null = same;
        if (!ids) {
          const answer = await askWho(posting, items.length - index - 1);
          ids = answer.ids;
          if (answer.forRest && ids) same = ids;
        }
        if (ids?.length) await send(posting, ids, entry.url);
      } catch (caught) { failed.push(`${entry.url ?? "The pasted posting"} (${message(caught)})`); }
    }
    setInput(failed.length && allLinks ? failed.map((line) => line.split(" (")[0]).join("\n") : "");
    if (failed.length) setError(`${plural(failed.length, "posting")} couldn't be added: ${failed.join("; ")}. Paste those job descriptions instead.`);
    setBusy(false);
    load();
  }

  async function sendMore(entry: LibraryEntry) {
    const answer = await askWho(entry, 0);
    if (!answer.ids?.length) return;
    try { await send(entry, answer.ids, entry.url); } catch (caught) { setError(message(caught)); }
    load();
  }

  return <section className="jobs-home postings-page">
    <PageHead title="Postings" tip="Add a posting once, then choose who it is for. Each candidate gets their own copy, tailored in their own folder." />
    <form className="postings-add" onSubmit={(event) => void add(event)}>
      <label htmlFor="postings-input">Job links (one per line) or a whole job description</label>
      <textarea id="postings-input" rows={3} value={input} onChange={(event) => setInput(event.target.value)} placeholder="https://jobs.example.com/…" />
      <div className="onboarding-actions"><button className="btn-primary" disabled={busy || !input.trim()}>{busy ? "Adding…" : "Add and choose candidates"}</button></div>
    </form>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!entries && !error && <p className="muted">Reading postings…</p>}
    {entries && !entries.length && <p className="muted">No postings yet. Add one above.</p>}
    {entries && entries.length > 0 && <table className="pipeline-table postings-table">
      <thead><tr><th scope="col">Company</th><th scope="col">Role</th><th scope="col">Added</th><th scope="col">Sent to</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{entries.map((entry) => <tr key={entry.id}>
        <td>{entry.url ? <a href={entry.url} target="_blank" rel="noreferrer">{entry.company ?? "Unknown company"}</a> : entry.company ?? "Unknown company"}</td>
        <td>{entry.title ?? ""}{entry.location ? <small className="muted"> · {entry.location}</small> : null}</td>
        <td>{entry.addedAt ? new Date(entry.addedAt).toLocaleDateString() : ""}</td>
        <td>{entry.sentTo.length ? [...new Map(entry.sentTo.map((send) => [send.candidateId, send])).values()].map((send) => `${send.name}${send.kind === "proposed" ? " (to approve)" : ""}`).join(", ") : <span className="muted">Nobody yet</span>}</td>
        <td><button className="btn-link" onClick={() => void sendMore(entry)}>Send to candidates…</button></td>
      </tr>)}</tbody>
    </table>}
    {asking && <WhoIsThisFor posting={asking.posting} remaining={asking.remaining} activeId={activeId} onDone={(ids, forRest) => { asking.resolve(ids, forRest); setAsking(null); }} />}
    {company && <div className="search-overlay" role="presentation">
      <form className="company-dialog" role="dialog" aria-modal="true" aria-labelledby="postings-company-title" onSubmit={(event) => { event.preventDefault(); company.resolve(companyName.trim() || null); setCompany(null); }}>
        <h2 id="postings-company-title">Which company is this?</h2>
        <p>{company.posting.title ?? "This posting"} doesn't name the employer. A team, division, or recruiting agency isn't the company.</p>
        <input autoFocus value={companyName} maxLength={120} onChange={(event) => setCompanyName(event.target.value)} aria-label="Company name" />
        <div className="company-dialog-actions"><button type="button" className="btn-quiet" onClick={() => { company.resolve(null); setCompany(null); }}>Skip</button><button className="btn-primary" disabled={!companyName.trim()}>Save</button></div>
      </form>
    </div>}
  </section>;
}
