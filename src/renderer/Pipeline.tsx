// Pipeline (Recruiter Edition, plan R5): every job across candidates, filtered by candidate and status, optionally
// grouped by posting, with CSV export and status changes for several jobs at once. Rendered only when
// FEATURES.candidates is on.
import { useEffect, useMemo, useRef, useState } from "react";
import type { PipelineRow } from "../shared/candidate-match";
import { pipelineToCsv } from "../shared/jobs-csv";
import { TRACKER_STATUSES, type TrackerStatus } from "../shared/schemas";
import { TRACKER_LABELS, effectiveAppliedAt, effectiveStatus, statusLabel } from "../shared/tracker";

const keyOf = (row: Pick<PipelineRow, "candidateId" | "id">) => `${row.candidateId}/${row.id}`;
const postingKey = (row: PipelineRow) => `${(row.company ?? row.name).toLowerCase()}|${(row.title ?? "").toLowerCase()}`;

export function PipelineView({ activeId, onOpenJob, onToast }: { activeId: string | null; onOpenJob: (candidateId: string, jobId: string) => void; onToast: (message: string, undo?: () => void) => void }) {
  const [rows, setRows] = useState<PipelineRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState("all");
  const [status, setStatus] = useState<"all" | TrackerStatus>("all");
  const [grouped, setGrouped] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<string | null>(null);
  const load = () => window.sensei.candidates.pipeline().then(setRows, (caught: unknown) => setError(caught instanceof Error ? caught.message : "Couldn't read the pipeline."));
  useEffect(() => { void load(); }, []);

  const candidates = useMemo(() => [...new Map((rows ?? []).map((row) => [row.candidateId, row.candidateName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const shown = useMemo(() => {
    const filtered = (rows ?? []).filter((row) => (candidate === "all" || row.candidateId === candidate) && (status === "all" || effectiveStatus(row) === status));
    return grouped ? [...filtered].sort((a, b) => postingKey(a).localeCompare(postingKey(b)) || a.candidateName.localeCompare(b.candidateName)) : filtered;
  }, [rows, candidate, status, grouped]);

  function toggle(row: PipelineRow, range: boolean) {
    const key = keyOf(row);
    setSelected((current) => {
      const next = new Set(current);
      if (range && lastClicked.current) {
        const keys = shown.map(keyOf);
        const [from, to] = [keys.indexOf(lastClicked.current), keys.indexOf(key)].sort((a, b) => a - b);
        if (from >= 0) keys.slice(from, to + 1).forEach((value) => next.add(value));
      } else if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    lastClicked.current = key;
  }

  async function setChosenStatus(next: TrackerStatus) {
    const entries = shown.filter((row) => selected.has(keyOf(row))).map((row) => ({ candidateId: row.candidateId, jobId: row.id }));
    try {
      const done = await window.sensei.candidates.setPipelineStatus(entries, next);
      setSelected(new Set());
      await load();
      onToast(`Marked ${done.length} job${done.length === 1 ? "" : "s"} as ${TRACKER_LABELS[next].toLowerCase()}`, () => {
        void (async () => {
          for (const previous of TRACKER_STATUSES) {
            const back = done.filter((entry) => entry.previous === previous).map(({ candidateId, jobId }) => ({ candidateId, jobId }));
            if (back.length) await window.sensei.candidates.setPipelineStatus(back, previous);
          }
          await load();
        })();
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't change those jobs."); }
  }

  async function exportCsv() {
    const path = await window.sensei.jobs.exportCsv(pipelineToCsv(shown, { followUps: FEATURES.nudges, interviews: FEATURES.interviews })).catch(() => null);
    if (path) onToast(`Saved ${shown.length} job${shown.length === 1 ? "" : "s"} to ${path.split(/[\\/]/).pop()}`);
  }

  let lastPosting = "";
  return <section className="jobs-home pipeline-home">
    <header className="page-head"><div><h1>Pipeline</h1><p>Every candidate's jobs in one list. Each job stays in its candidate's own folder.</p></div></header>
    <div className="pipeline-toolbar">
      <label><span>Candidate</span><select value={candidate} onChange={(event) => setCandidate(event.target.value)}><option value="all">All candidates</option>{candidates.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Any status</option>{TRACKER_STATUSES.map((value) => <option key={value} value={value}>{TRACKER_LABELS[value]}</option>)}</select></label>
      <label className="setup-check"><input type="checkbox" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} /> Group by posting</label>
      <span className="muted">{shown.length} job{shown.length === 1 ? "" : "s"}</span>
      <button className="btn-quiet" disabled={!shown.length} onClick={() => void exportCsv()}>Export CSV</button>
    </div>
    {selected.size > 0 && <div className="select-bar" role="toolbar" aria-label="Change selected jobs">
      <strong>{selected.size} selected</strong>
      {TRACKER_STATUSES.map((value) => <button key={value} className={value === "applied" ? "btn-primary" : "btn-quiet"} onClick={() => void setChosenStatus(value)}>Mark {TRACKER_LABELS[value].toLowerCase()}</button>)}
      <button className="btn-link" onClick={() => setSelected(new Set())}>Clear</button>
    </div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!rows && !error && <p className="muted">Reading every candidate's jobs…</p>}
    {rows && !shown.length && <p className="muted">No jobs match. Add a job and choose who it is for.</p>}
    {shown.length > 0 && <table className="pipeline-table">
      <thead><tr><th scope="col"><input type="checkbox" aria-label="Select all jobs shown" checked={shown.every((row) => selected.has(keyOf(row)))} onChange={(event) => setSelected(event.target.checked ? new Set(shown.map(keyOf)) : new Set())} /></th><th scope="col">Candidate</th><th scope="col">Company</th><th scope="col">Title</th><th scope="col">Fit</th><th scope="col">Status</th><th scope="col">Applied</th><th scope="col">Sent via</th></tr></thead>
      <tbody>{shown.flatMap((row) => {
        const header = grouped && postingKey(row) !== lastPosting ? <tr key={`g-${postingKey(row)}`} className="pipeline-group"><th colSpan={8} scope="rowgroup">{[row.company ?? row.name, row.title].filter(Boolean).join(", ")}</th></tr> : null;
        lastPosting = postingKey(row);
        const key = keyOf(row);
        return [header, <tr key={key} className={selected.has(key) ? "is-selected" : undefined}>
          <td><input type="checkbox" aria-label={`Select ${row.candidateName}: ${row.company ?? row.name}`} checked={selected.has(key)} onChange={() => undefined} onClick={(event) => toggle(row, event.shiftKey)} /></td>
          <td>{row.candidateName}{row.candidateId === activeId && <small className="muted"> · open</small>}</td>
          <td><button className="btn-link" onClick={() => onOpenJob(row.candidateId, row.id)}>{row.company ?? row.name}</button></td>
          <td>{row.title ?? ""}</td>
          <td>{row.rating === null ? "—" : row.rating.toFixed(1)}</td>
          <td>{statusLabel(row)}</td>
          <td>{effectiveAppliedAt(row) ?? ""}</td>
          <td>{row.submission ? <span title={`Resume version ${row.submission.resumeVersion}`}>{row.submission.platform ?? "Recorded"}</span> : ""}</td>
        </tr>].filter(Boolean);
      })}</tbody>
    </table>}
  </section>;
}
