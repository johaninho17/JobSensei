// Recruiter Edition (plan Q4): the recruiter's client work in one place. Per candidate: applications this week against
// their goal, replies, jobs waiting for their approval, and the report to send them. Only rendered when
// FEATURES.candidates is on.
import { useEffect, useState } from "react";
import type { CandidateEntry, CandidatesState } from "../shared/candidates";
import { ApprovalDialog, ReportDialog } from "./Candidates";
import { PageHead } from "./BentoPrimitives";

const message = (caught: unknown) => (caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "Something went wrong.");

export function ReportsView({ initial }: { initial?: CandidatesState | null }) {
  const [state, setState] = useState<CandidatesState | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<CandidateEntry | null>(null);
  const [reporting, setReporting] = useState<CandidateEntry | null>(null);
  const load = () => void window.sensei.candidates.state().then(setState, (caught) => setError(message(caught)));
  useEffect(load, []);
  const listed = (state?.candidates ?? []).filter((candidate) => candidate.status !== "archived");
  return <section className="jobs-home reports-page">
    <PageHead title="Reports" tip="What you've sent for each candidate, the replies, and jobs waiting for their approval. Reports are copied or saved by you; nothing is sent from the app." />
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!state && !error && <p className="muted">Reading candidates…</p>}
    {state && <table className="pipeline-table reports-table">
      <thead><tr><th scope="col">Candidate</th><th scope="col">This week</th><th scope="col">Applied</th><th scope="col">Replies</th><th scope="col">Interviews</th><th scope="col">To approve</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>
        {listed.map((candidate) => { const info = state.overview?.[candidate.id]; const insight = info?.insight; return <tr key={candidate.id}>
          <td>{candidate.displayName}</td>
          <td title="Applications sent in the last 7 days">{insight?.appliedThisWeek ?? 0}{info?.weeklyTarget ? ` of ${info.weeklyTarget}` : ""}</td>
          <td>{insight?.applied ?? 0}</td>
          <td>{insight ? `${insight.responses}${insight.applied ? ` (${Math.round((insight.responses / insight.applied) * 100)}%)` : ""}` : 0}</td>
          <td>{insight?.interviews ?? 0}</td>
          <td>{info?.toApprove ? <button className="btn-link" onClick={() => setApproving(candidate)}>{info.toApprove} to approve</button> : 0}</td>
          <td><button className="btn-link" onClick={() => setReporting(candidate)}>Report</button></td>
        </tr>; })}
        {!listed.length && <tr><td colSpan={7} className="muted">No candidates yet.</td></tr>}
      </tbody>
    </table>}
    {approving && <ApprovalDialog candidate={approving} onClose={() => { setApproving(null); load(); }} />}
    {reporting && <ReportDialog candidate={reporting} target={state?.overview?.[reporting.id]?.weeklyTarget ?? null} onClose={() => setReporting(null)} />}
  </section>;
}
