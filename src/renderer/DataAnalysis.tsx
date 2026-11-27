// Your data, on the Profile page (#200): findings about the career records, each one a choice. The app builds the brief
// and checks Agy's findings (electron/data-analysis.ts); nothing changes without the user's pick.
import { useEffect, useState } from "react";
import type { AnalysisView, FixRow, StoredFinding } from "../shared/data-analysis";

const KIND_LABEL: Record<StoredFinding["kind"], string> = { thin: "Thin", stale: "Out of date", conflict: "Conflict", duplicate: "Duplicate" };
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

export function DataAnalysis({ onToast }: { onToast: (message: string) => void }) {
  const [view, setView] = useState<AnalysisView | null>(null);
  const [problem, setProblem] = useState("");
  const load = () => void window.sensei.analysis.get().then(setView).catch(() => setView(null));
  useEffect(() => { load(); return window.sensei.analysis.onChanged(load); }, []);
  if (!view) return null;
  const open = view.findings.filter((finding) => finding.status === "open");
  async function run() {
    setProblem("");
    try { await window.sensei.analysis.run(); } catch (reason) { setProblem(errorText(reason)); }
  }
  return <section className="context-block data-analysis" aria-labelledby="data-analysis-title">
    <div className="da-head">
      <h2 id="data-analysis-title">Your data{open.length > 0 && <span className="da-count">{open.length}</span>}</h2>
      <button className="btn-quiet btn-small" disabled={view.running} onClick={() => void run()}>{view.running ? "Checking…" : view.ranAt ? "Check again" : "Check my data"}</button>
    </div>
    {view.ranAt && !view.running && !open.length && <p className="muted">Nothing to fix from the last check ({new Date(view.ranAt).toLocaleDateString([], { month: "short", day: "numeric" })}).</p>}
    {view.error && !view.running && <p className="inline-error" role="alert">The last check failed: {view.error}</p>}
    {problem && <p className="inline-error" role="alert">{problem}</p>}
    {open.length > 0 && <ul className="da-list">{open.map((finding) => <FindingCard key={finding.key} finding={finding} onDone={(message) => { onToast(message); load(); }} />)}</ul>}
  </section>;
}

function FindingCard({ finding, onDone }: { finding: StoredFinding; onDone: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [row, setRow] = useState<FixRow | null>(finding.fix.row);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const file = finding.file.replace(/^context\/structured\//, "");
  async function decide(decision: "accept" | "edit" | "ask" | "refuse") {
    setBusy(true);
    setProblem("");
    try {
      await window.sensei.analysis.decide(finding.id, decision, decision === "edit" ? row : null);
      onDone(decision === "refuse" ? "Won't suggest that again." : decision === "ask" ? "Added to Questions for you." : `Updated ${file}.`);
    } catch (reason) { setProblem(errorText(reason)); } finally { setBusy(false); }
  }
  const { action } = finding.fix;
  return <li className="da-item">
    <p className="da-issue"><span className={`da-kind is-${finding.kind}`}>{KIND_LABEL[finding.kind]}</span>{finding.issue}</p>
    <ul className="da-basis">{finding.basis.map((basis, index) => <li key={index}><q>{basis.quote}</q> <span className="muted">{basis.file.split("/").pop()}</span></li>)}</ul>
    {action === "ask" ? <p className="da-fix"><strong>Ask:</strong> {finding.fix.question}</p>
      : editing && row ? <div className="da-edit">
        {(["year", "project", "claim", "scope"] as const).map((field) => <label key={field} className="search-field"><span>{field[0]!.toUpperCase() + field.slice(1)}</span>
          {field === "claim" ? <textarea rows={3} value={row[field]} onChange={(event) => setRow({ ...row, [field]: event.target.value })} /> : <input value={row[field]} onChange={(event) => setRow({ ...row, [field]: event.target.value })} />}</label>)}
      </div>
      : <p className="da-fix"><strong>{action === "update" ? "Update" : action === "add" ? "Add" : "Remove"}</strong> in {file}{action !== "remove" && row ? <>: {[row.year, row.project].filter(Boolean).join(" · ")}{row.year || row.project ? " — " : ""}{row.claim}</> : finding.rowId ? `: ${finding.rowId}` : ""}</p>}
    <div className="da-actions">
      {action === "ask" ? <button className="btn-quiet btn-small" disabled={busy} onClick={() => void decide("ask")}>Ask me</button>
        : editing ? <button className="btn-quiet btn-small" disabled={busy || !row?.claim.trim()} onClick={() => void decide("edit")}>Save</button>
        : <button className="btn-quiet btn-small" disabled={busy} onClick={() => void decide("accept")}>Accept</button>}
      {action !== "ask" && action !== "remove" && !editing && <button className="btn-link" disabled={busy} onClick={() => setEditing(true)}>Edit</button>}
      {editing && <button className="btn-link" disabled={busy} onClick={() => { setEditing(false); setRow(finding.fix.row); }}>Cancel</button>}
      <button className="btn-link pq-remove" disabled={busy} onClick={() => void decide("refuse")}>Refuse</button>
    </div>
    {problem && <p className="inline-error" role="alert">{problem}</p>}
  </li>;
}
