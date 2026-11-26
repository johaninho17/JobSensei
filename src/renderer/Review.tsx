// Review before sending (Recruiter Edition, plan R8 P2): the posting's must-haves and gaps beside the tailored resume,
// with every changed line marked and the evidence it cites, then Mark applied. Rendered only when FEATURES.candidates.
import { useEffect, useState } from "react";
import type { JobFolderSummary, JobTrackerUpdate } from "../shared/schemas";
import type { ApplicationReview } from "../shared/review";
import { effectiveAppliedAt, effectiveStatus, statusLabel } from "../shared/tracker";
import { applicationFacts, type ApplicationFact } from "../shared/application-facts";
import type { Submission } from "../shared/submission";

const MUST_LABEL = { met: "Met", learnable: "To learn", blocker: "Blocker" } as const;

export function ReviewPanel({ job, onUpdateTracker, onOpenResume }: { job: JobFolderSummary; onUpdateTracker: (update: JobTrackerUpdate) => Promise<void>; onOpenResume: () => void }) {
  const [review, setReview] = useState<ApplicationReview | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [changedOnly, setChangedOnly] = useState(false);
  const [facts, setFacts] = useState<ApplicationFact[] | null>(null);
  useEffect(() => { void window.sensei.profile.get().then((profile) => setFacts(applicationFacts(profile)), () => setFacts([])); }, [job.id]);
  useEffect(() => { setReview(undefined); void window.sensei.candidates.review(job.id).then(setReview, (caught: unknown) => setError(caught instanceof Error ? caught.message : "Couldn't read the drafts.")); }, [job.id, job.modifiedAt]);
  const [submission, setSubmission] = useState<Submission | null | undefined>(undefined);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => { void window.sensei.candidates.submission(job.id).then(setSubmission, () => setSubmission(null)); }, [job.id]);
  const status = effectiveStatus(job);
  const applied = Boolean(submission) || status !== "saved";
  async function act(task: () => Promise<unknown>) {
    setWorking(true);
    setActionError(null);
    try { await task(); setSubmission(await window.sensei.candidates.submission(job.id)); } catch (caught) { setActionError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "That didn't work."); } finally { setWorking(false); }
  }
  if (error) return <p className="inline-error" role="alert">{error}</p>;
  if (review === undefined) return <p className="muted">Reading the drafts…</p>;
  if (review === null) return <p className="muted">No tailored resume yet. It appears here once Agy finishes this job.</p>;
  return <section className="review-panel" aria-label="Review before sending">
    <div className="review-bar">
      {submission
        ? <span><strong>Sent {submission.date}</strong>{submission.platform ? ` via ${submission.platform}` : ""} · resume version {submission.resumeVersion} · {submission.files.length} PDF{submission.files.length === 1 ? "" : "s"} kept{submission.screenshot ? " · confirmation saved" : ""}</span>
        : <span><strong>{statusLabel(job)}</strong>{applied && effectiveAppliedAt(job) ? ` on ${effectiveAppliedAt(job)}` : ""} · {review.changed} of {review.total} resume lines changed from the base{review.letter ? " · cover letter written" : ""}</span>}
      <span className="review-actions">
        <button className="btn-link" onClick={onOpenResume}>Open to edit</button>
        {submission && <button className="btn-link" onClick={() => void window.sensei.files.reveal(submission.files[0]?.split("/").slice(0, -1).join("/") ?? `jobs/${job.id}/submitted`).catch(() => undefined)}>Show sent files</button>}
        {submission && !submission.screenshot && <button className="btn-link" disabled={working} onClick={() => void act(() => window.sensei.candidates.addConfirmation(job.id))}>Add confirmation</button>}
        {applied
          ? <button className="btn-quiet" disabled={working} onClick={() => void act(async () => { if (submission) await window.sensei.candidates.undoApplied(job.id); else await onUpdateTracker({ status: "saved", appliedAt: null }); })}>Undo applied</button>
          : <button className="btn-primary" disabled={working} onClick={() => void act(() => window.sensei.candidates.markApplied(job.id))}>{working ? "Saving the PDFs…" : "Mark applied"}</button>}
      </span>
    </div>
    {actionError && <p className="inline-error" role="alert">{actionError}</p>}
    <div className="doc-split is-aside-first">
      <div className="review-job">
        <h3>The job</h3>
        <p>{[job.company, job.title].filter(Boolean).join(" · ")}{job.rating !== null ? ` · fit ${job.rating.toFixed(1)} of 5` : ""}</p>
        {job.mustHaves.length > 0 && <ul className="review-musts">{job.mustHaves.map((item) => <li key={item.requirement} className={`is-${item.status}`}><span>{MUST_LABEL[item.status]}</span> {item.requirement}</li>)}</ul>}
        {job.requirementGaps.length > 0 && <><h4>Gaps</h4><ul>{job.requirementGaps.slice(0, 8).map((gap) => <li key={gap}>{gap}</li>)}</ul></>}
        <FormAnswers facts={facts} />
      </div>
      <div className="review-resume">
        <div className="review-resume-head"><h3>Tailored resume</h3><label className="setup-check"><input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} /> Changed lines only</label></div>
        {review.sections.map((section) => {
          const lines = changedOnly ? section.lines.filter((line) => line.changed) : section.lines;
          if (!lines.length) return null;
          return <div key={section.title} className="review-section"><h4>{section.title}</h4><ul>{lines.map((line, index) => <li key={`${index}-${line.text}`} className={line.changed ? "is-changed" : ""}>
            <span>{line.text.replace(/\*\*|__|`/g, "")}</span>
            {line.changed && <details><summary>{line.evidence.length ? `Why: ${line.evidence.map((item) => item.source).filter((value, position, all) => all.indexOf(value) === position).join(", ")}` : "No evidence cited"}</summary><ul>{line.evidence.map((item) => <li key={item.id}><small>{item.source}</small> {item.text || item.id}</li>)}</ul></details>}
          </li>)}</ul></div>;
        })}
      </div>
    </div>
  </section>;
}

/** The candidate's application facts with copy buttons, for filling in the employer's form (recruiter plan R8 P3). */
function FormAnswers({ facts }: { facts: ApplicationFact[] | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (facts === null) return null;
  const copy = (fact: ApplicationFact, index: number) => void navigator.clipboard.writeText(fact.value).then(() => { setCopied(`${index}`); window.setTimeout(() => setCopied(null), 1500); }, () => undefined);
  return <div className="form-answers">
    <h4>For the application form</h4>
    {facts.length ? <ul>{facts.map((fact, index) => <li key={`${index}-${fact.label}`}>
      <span><small>{fact.label}</small> {fact.value}</span>
      <button className="btn-link" onClick={() => copy(fact, index)}>{copied === `${index}` ? "Copied" : "Copy"}</button>
    </li>)}</ul> : <p className="muted">No form answers yet. Add them on the Candidate page under Application facts.</p>}
  </div>;
}
