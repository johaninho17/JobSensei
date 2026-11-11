// Review before sending (Recruiter Edition, plan R8 P2): the posting's must-haves and gaps beside the tailored resume,
// with every changed line marked and the evidence it cites, then Mark applied. Rendered only when FEATURES.candidates.
import { useEffect, useState } from "react";
import type { JobFolderSummary, JobTrackerUpdate } from "../shared/schemas";
import type { ApplicationReview } from "../shared/review";
import { effectiveAppliedAt, effectiveStatus, statusLabel } from "../shared/tracker";

const MUST_LABEL = { met: "Met", learnable: "To learn", blocker: "Blocker" } as const;

export function ReviewPanel({ job, onUpdateTracker, onOpenResume }: { job: JobFolderSummary; onUpdateTracker: (update: JobTrackerUpdate) => Promise<void>; onOpenResume: () => void }) {
  const [review, setReview] = useState<ApplicationReview | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [changedOnly, setChangedOnly] = useState(false);
  useEffect(() => { setReview(undefined); void window.sensei.candidates.review(job.id).then(setReview, (caught: unknown) => setError(caught instanceof Error ? caught.message : "Couldn't read the drafts.")); }, [job.id, job.modifiedAt]);
  const status = effectiveStatus(job);
  const applied = status !== "saved";
  if (error) return <p className="inline-error" role="alert">{error}</p>;
  if (review === undefined) return <p className="muted">Reading the drafts…</p>;
  if (review === null) return <p className="muted">No tailored resume yet. It appears here once Agy finishes this job.</p>;
  return <section className="review-panel" aria-label="Review before sending">
    <div className="review-bar">
      <span><strong>{statusLabel(job)}</strong>{applied && effectiveAppliedAt(job) ? ` on ${effectiveAppliedAt(job)}` : ""} · {review.changed} of {review.total} resume lines changed from the base{review.letter ? " · cover letter written" : ""}</span>
      <span className="review-actions">
        <button className="btn-link" onClick={onOpenResume}>Open to edit</button>
        {applied
          ? <button className="btn-quiet" onClick={() => void onUpdateTracker({ status: "saved", appliedAt: null })}>Undo applied</button>
          : <button className="btn-primary" onClick={() => void onUpdateTracker({ status: "applied" })}>Mark applied</button>}
      </span>
    </div>
    <div className="review-cols">
      <div className="review-job">
        <h3>The job</h3>
        <p>{[job.company, job.title].filter(Boolean).join(" · ")}{job.rating !== null ? ` · fit ${job.rating.toFixed(1)} of 5` : ""}</p>
        {job.mustHaves.length > 0 && <ul className="review-musts">{job.mustHaves.map((item) => <li key={item.requirement} className={`is-${item.status}`}><span>{MUST_LABEL[item.status]}</span> {item.requirement}</li>)}</ul>}
        {job.requirementGaps.length > 0 && <><h4>Gaps</h4><ul>{job.requirementGaps.slice(0, 8).map((gap) => <li key={gap}>{gap}</li>)}</ul></>}
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
