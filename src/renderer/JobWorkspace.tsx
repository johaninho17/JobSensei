import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PDF_TEXT_SIZE, INTERVIEW_ROUNDS, OUTCOME_RESULTS, TRACKER_STATUSES, type InterviewEvent, type InterviewRoundKind, type JobOutcome, type JobTrackerUpdate, type TrackerStatus, type ApplicationStatus, type ApplicationValidationReport, type FilePreview, type FileTreeNode, type InterviewOverview, type JobFolderSummary, type PdfTextSize, type QuestionsState } from "../shared/schemas";
import { TRACKER_LABELS, effectiveAppliedAt, effectiveStatus, draftedLabel } from "../shared/tracker";
import { FIT_CLASSIFICATION_CREDIT } from "../shared/fit-credit";
import { type JobAction } from "./job-actions";
import { markdownHtml } from "./markdown";
import { InterviewView } from "./InterviewView";
import { SubTabPanel, SubTabs } from "./SubTabs";
import { ReviewPanel } from "./Review";
import { TagEditor } from "./JobOrganize";
import { type JobWorkspaceTab, StatusPill, TrackerPill, displayJobName, fileNodes, findNode, formatJobDate, formatRelativeDate, messageOf, plural, useAnnounce } from "./app-shared";
import { DocumentView, PdfTextSizeSelect, documentsChanged, pdfsCreated, usePdfFreshness } from "./Documents";

function TrackerPanel({ job, onUpdate }: { job: JobFolderSummary; onUpdate: (update: JobTrackerUpdate) => Promise<void> }) {
  const tracker = job.tracker;
  const [notes, setNotes] = useState(tracker?.notes ?? "");
  useEffect(() => { setNotes(tracker?.notes ?? ""); }, [job.id, tracker?.notes]);
  const history = [...(tracker?.history ?? [])].reverse().slice(0, 4);
  return <section className="overview-panel tracker-panel">
    <h2>Tracking</h2>
    <div className="tracker-dates">
      <label><span>Applied</span><input type="date" value={effectiveAppliedAt(job) ?? ""} onChange={(event) => void onUpdate({ appliedAt: event.target.value || null })} /></label>
      {FEATURES.nudges && <label><span>Follow up on</span><input type="date" value={tracker?.nextFollowUpAt ?? ""} onChange={(event) => void onUpdate({ nextFollowUpAt: event.target.value || null })} /></label>}
    </div>
    <TagEditor tags={tracker?.tags ?? []} suggestions={[]} onChange={(tags) => void onUpdate({ tags })} />
    <label className="tracker-notes"><span>Notes</span><textarea rows={1} value={notes} placeholder="Recruiter name, referral, what they said…" onChange={(event) => setNotes(event.target.value)} onBlur={() => { if (notes !== (tracker?.notes ?? "")) void onUpdate({ notes }); }} /></label>
    {history.length > 0 && <details className="must-group"><summary>History ({tracker?.history.length ?? history.length})</summary><ol className="tracker-history" aria-label="Status history">{history.map((event) => <li key={event.at}><TrackerPill status={event.status} /><span className="muted">{new Date(event.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></li>)}</ol></details>}
  </section>;
}

export function JobWorkspaceDashboard({ job, status, applicationLoading, overview, interviewLoading, jobTree, jobActions, onStatus, onSelect, activeTab, activeRoundId, onNavigate, onInsertPrompt, onUpdateTracker }: { job: JobFolderSummary; status: ApplicationStatus | null; applicationLoading: boolean; overview: InterviewOverview | null; interviewLoading: boolean; jobTree: FileTreeNode[]; jobActions: JobAction[]; onStatus: (status: ApplicationStatus) => void; onSelect: (path: string, anchor?: string) => void; activeTab: JobWorkspaceTab; activeRoundId?: string; onNavigate: (jobId: string, tab: JobWorkspaceTab, roundId?: string) => void; onInsertPrompt: (action: Pick<JobAction, "prompt" | "label">) => void; onUpdateTracker: (update: JobTrackerUpdate) => Promise<void> }) {
  const trackerStatus = effectiveStatus(job);
  const files = useMemo(() => {
    const root = findNode(jobTree, `jobs/${job.id}`);
    return root ? fileNodes([root]).filter((node) => !node.relativePath.includes("/.sensei/")) : [];
  }, [jobTree, job.id]);
  const applicationFiles = files.filter((file) => /evaluation|resume|cover_letter|original_jd/i.test(file.name));
  const resumeMarkdown = files.find((file) => /_Resume\.md$/i.test(file.name)) ?? files.find((file) => /resume\.md$/i.test(file.name));
  const coverLetterMarkdown = files.find((file) => file.name.toLowerCase() === "cover_letter.md");
  // Recruiter plan R7: why this run wrote no letter (src/shared/cover-letter-policy.ts), from the validation report.
  const letterSkipped = status?.validation?.coverLetterSkipped ?? null;
  const evaluation = files.find((file) => file.name.toLowerCase() === "evaluation.md");
  const jobDescription = files.find((file) => /^original_jd\./i.test(file.name));
  const rounds = overview?.rounds ?? [];
  const [next, ...more] = jobActions;
  // After a run: the most important warnings from the last check, errors first.
  const allIssues = status?.validation?.issues ?? [];
  const reviewIssues = [...allIssues].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).slice(0, 4);
  function navigateRound(roundId: string) {
    void window.sensei.interviews.setCurrentRound(job.id, roundId).catch(() => undefined);
    onNavigate(job.id, "interview", roundId);
  }
  const tabs: Array<[JobWorkspaceTab, string, number | null]> = [["overview", "Overview", null], ["application", "Application", null], ...(FEATURES.interviews ? [["interview", "Interview", rounds.length || null] as [JobWorkspaceTab, string, number | null]] : []), ["files", "Files", files.length]];
  // The Recruiter Edition opens drafts on Review: the posting beside the resume, then Mark applied (recruiter plan R8).
  const firstAppView: ApplicationView = FEATURES.candidates ? "review" : "resume";
  const [appView, setAppView] = useState<ApplicationView>(firstAppView);
  useEffect(() => { setAppView(firstAppView); }, [job.id]);
  function openChecks() { setAppView("checks"); onNavigate(job.id, "application"); }
  const documents: Array<[string, FileTreeNode | undefined]> = [["Job description", jobDescription], ["Evaluation", evaluation], ["Resume", resumeMarkdown], ["Cover letter", coverLetterMarkdown]];
  return <section className="job-page">
    <header className="job-head">
      <div className="job-head-text">
        <p className="job-head-company">{job.company ?? displayJobName(job.name)}</p>
        <h1>{job.title ?? "Role not recorded"}</h1>
        <div className="job-head-meta">
          <label className={`tracker-select is-${trackerStatus}`}><span className="sr-only">Application status</span><select value={trackerStatus} onChange={(event) => void onUpdateTracker({ status: event.target.value as TrackerStatus })}>{TRACKER_STATUSES.map((value) => <option key={value} value={value}>{value === "saved" && job.hasApplicationMaterials ? draftedLabel() : TRACKER_LABELS[value]}</option>)}</select></label>
          {job.applicationStage && <StatusPill value={job.applicationStage} />}
          {job.rating !== null && <span><strong className="tabular">{job.rating.toFixed(1)}</strong> of 5 fit</span>}
          {job.location && <span>{job.location}</span>}
          <span>Added {formatJobDate(job.createdAt)}</span>
        </div>
      </div>
    </header>
    <div className="workspace-tabs-row">
      <nav className="workspace-tabs" role="tablist" aria-label="Job sections">{tabs.map(([value, label, count]) => <button key={value} role="tab" aria-selected={activeTab === value} className={activeTab === value ? "is-active" : ""} onClick={() => onNavigate(job.id, value, value === "interview" ? activeRoundId : undefined)}>{label}{count !== null && <span>{count}</span>}</button>)}</nav>
      <div className="job-head-actions">
        {jobDescription && <button className="btn-quiet" onClick={() => onSelect(jobDescription.relativePath)}>Job posting</button>}
        <JobPdfExportButton resumePath={resumeMarkdown?.relativePath ?? null} coverLetterPath={coverLetterMarkdown?.relativePath ?? null} />
      </div>
    </div>
    {activeTab === "overview" && <div className="job-overview">
      {next && trackerStatus !== "rejected" && trackerStatus !== "withdrawn" && <section className="next-bar" aria-label="Next step">
        <span className="next-bar-label">Next</span>
        <strong className="next-bar-title" title={`Sends this request to Agy for ${job.company ?? displayJobName(job.name)}, ${job.title ?? "this job"}.`}>{next.label}</strong>
        <button className="btn-primary" onClick={() => onInsertPrompt(next)}>Send to Agy</button>
        {more.length > 0 && <details className="jobs-more next-bar-more"><summary aria-label="Other next steps">More</summary><div className="jobs-more-menu">{more.slice(0, 6).map((action) => <button key={action.id} className="menu-item" onClick={() => onInsertPrompt(action)}>{action.label}</button>)}</div></details>}
      </section>}
      {FEATURES.interviews && (trackerStatus === "rejected" || trackerStatus === "withdrawn" || trackerStatus === "interviewing" || trackerStatus === "offer") && <DebriefPanel job={job} closed={trackerStatus === "rejected" || trackerStatus === "withdrawn"} onUpdateTracker={onUpdateTracker} onInsertPrompt={onInsertPrompt} />}
      {reviewIssues.length > 0 && <p className="review-line" role="status">
        <span className={`review-kind ${allIssues.some((issue) => issue.severity === "error") ? "is-error" : ""}`}>{allIssues.some((issue) => issue.severity === "error") ? "Fix" : "Check"}</span>
        <span>{plural(allIssues.length, "thing")} to look at before you send, from the last check.</span>
        <button className="btn-link" onClick={openChecks}>Review</button>
      </p>}
      <div className="overview-cols">
        <div className="overview-col">
          <RolePanel job={job} />
        </div>
        <div className="overview-col">
          <section className="overview-panel">
            <h2>Fit</h2>
            {job.rating === null ? <p className="muted">Not rated yet. Ask Agy to evaluate this job.</p> : <>
              <p className="fit-score"><strong className="tabular">{job.rating.toFixed(1)}</strong> of 5{job.ratingConfidence ? `, ${job.ratingConfidence} confidence` : ""}{evaluation && <> · <button className="btn-link" onClick={() => onSelect(evaluation.relativePath)}>evaluation</button></>}</p>
              <div className="fit-bar" aria-hidden="true"><span style={{ width: `${(job.rating / 5) * 100}%` }} /></div>
              {job.stretch && <StretchSummary stretch={job.stretch} />}
              <MustHaveGroups mustHaves={job.mustHaves} gaps={job.requirementGaps.length ? job.requirementGaps : job.ratingGaps.filter((item) => !/^none\b/i.test(item)).map((item) => item.replace(/^(?:must|req):\d+\s*/i, ""))} />
              {job.mustHaves.length === 0 && job.ratingHighlights.length > 0 && <details className="must-group is-met"><summary>Strengths ({job.ratingHighlights.length})</summary><ul>{job.ratingHighlights.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul></details>}
            </>}
          </section>
          {FEATURES.interviews && <section className="overview-panel">
            <h2>Interviews</h2>
            {interviewLoading ? <p className="muted">Reading rounds…</p> : rounds.length ? <ol className="round-list">{rounds.map((round) => <li key={round.id}><button className="btn-link" onClick={() => navigateRound(round.id)}>{round.label}</button><span className={`round-state is-${round.status}`}>{round.scheduledDate ?? round.status.replace("_", " ")}</span></li>)}</ol> : <p className="muted">No rounds yet.</p>}
          </section>}
          <TrackerPanel job={job} onUpdate={onUpdateTracker} />
        </div>
      </div>
    </div>}
    {activeTab === "application" && <>
      <SubTabs<ApplicationView>
        idPrefix="app"
        label="Application documents"
        value={appView}
        onChange={setAppView}
        tabs={[
          ...(FEATURES.candidates ? [{ id: "review" as const, label: "Review", disabled: !resumeMarkdown }] : []),
          { id: "resume", label: "Resume", disabled: !resumeMarkdown },
          { id: "letter", label: "Cover letter", disabled: !coverLetterMarkdown && !letterSkipped },
          ...(FEATURES.applicationQuestions ? [{ id: "questions" as const, label: "Questions" }] : []),
          { id: "evaluation", label: "Evaluation", disabled: !evaluation },
          { id: "checks", label: "Checks" },
        ]}
      />
      <SubTabPanel idPrefix="app" value={appView}>
        {FEATURES.candidates && appView === "review" && <ReviewPanel job={job} onUpdateTracker={onUpdateTracker} onOpenResume={() => setAppView("resume")} />}
        {appView === "resume" && <DocInline path={resumeMarkdown?.relativePath ?? null} label="resume" />}
        {appView === "letter" && (letterSkipped ? <p className="muted doc-skipped">No cover letter: {letterSkipped}</p> : <DocInline path={coverLetterMarkdown?.relativePath ?? null} label="cover letter" />)}
        {FEATURES.applicationQuestions && appView === "questions" && <QuestionsPanel jobId={job.id} />}
        {appView === "evaluation" && <DocInline path={evaluation?.relativePath ?? null} label="evaluation" />}
        {appView === "checks" && <div className="dashboard-stack"><ApplicationHealth job={job} files={applicationFiles} status={status} loading={applicationLoading} onStatus={onStatus} /><section className="context-block"><h2>Application files</h2><ArtifactTable files={applicationFiles} onSelect={onSelect} empty="No application documents found." /></section></div>}
      </SubTabPanel>
    </>}
    {FEATURES.interviews && activeTab === "interview" && <InterviewView job={job} overview={overview} loading={interviewLoading} initialRoundId={activeRoundId} onRoundChange={navigateRound} onOpenFile={(path) => onSelect(path)} onInsertPrompt={(text, label) => onInsertPrompt({ prompt: text, label })} />}
    {activeTab === "files" && <FilesTab files={files} onSelect={onSelect} />}
  </section>;
}

type ApplicationView = "review" | "resume" | "letter" | "questions" | "evaluation" | "checks";

/** The answers file's sections ("### question" then the answer), so edits made in the file are what's shown and copied. */
function answerSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = markdown.replace(/\r\n?/g, "\n").split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const [label, ...body] = part.split("\n");
    sections.set(label!.trim().toLowerCase(), body.join("\n").trim());
  }
  return sections;
}

/**
 * Written questions from the posting's application form (or pasted here), answered by a background Agy that never
 * touches the terminal. Agy skips logistics and questions nothing real can answer (shown greyed, with "Answer
 * anyway"); write-yourself questions get notes only.
 */
function QuestionsPanel({ jobId }: { jobId: string }) {
  const [state, setState] = useState<QuestionsState | null>(null);
  const [running, setRunning] = useState(false);
  const [file, setFile] = useState<Map<string, string>>(new Map());
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState("");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const answersPath = `jobs/${jobId}/application_answers.md`;
  const readFile = () => void window.sensei.files.preview(answersPath).then((preview) => setFile(answerSections(preview.content ?? ""))).catch(() => setFile(new Map()));
  useEffect(() => {
    let cancelled = false;
    setState(null); setDraft(""); setProblem(""); setEditing(false);
    setFile(new Map());
    void window.sensei.questions.get(jobId).then((result) => {
      if (cancelled) return;
      setState(result.state);
      setRunning(result.running || result.state?.status === "reading" || result.state?.status === "answering");
      // The answers file exists only once something was answered; don't ask for it before.
      if (result.state?.answers.length) readFile();
    });
    const stop = window.sensei.questions.onUpdated((updatedJob, next) => {
      if (updatedJob !== jobId) return;
      setState(next);
      setRunning(next.status === "reading" || next.status === "answering");
      if ((next.status === "done" || next.status === "failed") && next.answers.length) readFile();
    });
    return () => { cancelled = true; stop(); };
  }, [jobId]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  async function submit() {
    if (!draft.trim() || running) return;
    setProblem("");
    try {
      await window.sensei.questions.ask(jobId, draft);
      setDraft("");
      setRunning(true);
    } catch (caught) {
      setProblem(messageOf(caught, "Those questions couldn't be sent."));
    }
  }
  function copy(id: string, text: string) {
    void navigator.clipboard.writeText(text).then(() => { setCopied(id); window.setTimeout(() => setCopied((current) => current === id ? null : current), 1500); });
  }
  const elapsed = state?.startedAt ? Math.max(0, Math.round((now - Date.parse(state.startedAt)) / 1000)) : 0;
  const timer = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const pending = state?.questions.filter((question) => !state.answers.some((answer) => answer.id === question.id)).length ?? 0;
  const status = !state ? null
    : state.status === "reading" ? <>Reading the application form… <span className="tabular">{timer}</span></>
    : state.status === "answering" ? <>Answering {pending || state.questions.length} question{(pending || state.questions.length) === 1 ? "" : "s"}… <span className="tabular">{timer}</span></>
    : state.status === "done" ? <>{state.message ?? <>Answered in {state.durationSeconds ?? 0} s{state.source === "posting" && state.sourceUrl ? " from the posting's application form" : ""}.</>}</>
    : state.status === "failed" ? <>Couldn't answer: {state.message} <button className="btn-link" onClick={() => void window.sensei.questions.retry(jobId).then(() => setRunning(true))}>Retry</button></>
    : <>{state.message}</>;
  if (editing) return <div className="questions-panel">
    <div className="questions-status"><button className="btn-link" onClick={() => { setEditing(false); readFile(); }}>Done editing</button></div>
    <DocInline path={answersPath} label="answers" />
  </div>;
  return <div className="questions-panel">
    {status && <p className={`questions-status is-${state!.status}`} role="status" aria-live="polite">{running && <span className="run-dot" aria-hidden="true" />}{status}</p>}
    {!state && <p className="doc-inline-empty">Written questions from the application form appear here during the application run (Greenhouse, Ashby, and Lever links). For other jobs, paste the questions below.</p>}
    {state && state.questions.length > 0 && <ol className="question-list">{state.questions.map((question) => {
      const answer = state.answers.find((candidate) => candidate.id === question.id);
      const skipped = answer?.decision === "skip";
      const saved = file.get(question.label.toLowerCase());
      const fileBody = saved && saved !== "_No answer yet._" && !saved.startsWith("_Skipped") ? saved : undefined;
      const text = question.writeYourself || skipped ? null : fileBody ?? answer?.text ?? null;
      const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
      const ids = [...(answer?.storyIds ?? []), ...(answer?.evidenceIds ?? [])];
      const limit = question.sentenceLimit ? `${question.sentenceLimit} sentences` : question.wordLimit ? `${question.wordLimit} words` : null;
      return <li key={question.id} className={`question-card ${question.writeYourself ? "is-yourself" : ""} ${skipped ? "is-skipped" : ""}`}>
        <div className="question-head">
          <h3>{question.label}</h3>
          {question.writeYourself && <span className="fit-chip is-learnable">Write yourself</span>}
          {skipped && <span className="fit-chip">Skipped</span>}
        </div>
        {question.writeYourself
          ? <div className="question-notes"><p>The employer asks you to write this one. Notes to draw from:</p><ul>{(answer?.notes ?? []).map((note) => <li key={note}>{note}</li>)}</ul></div>
          : skipped ? <p className="question-skip">{answer?.reason ?? "Not a question to answer here."} <button className="btn-link" disabled={running} onClick={() => void window.sensei.questions.answerAnyway(jobId, question.id).then(() => setRunning(true))}>Answer anyway</button></p>
          : text ? <div className="question-answer iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(text, [], { readable: true }) }} />
          : <p className="doc-inline-empty">{running ? "Answering…" : "No answer yet."}</p>}
        {!skipped && <div className="question-meta">
          {text && <span className={`tabular ${question.wordLimit && words > question.wordLimit ? "is-over" : ""}`}>{words} words{limit ? ` · limit ${limit}` : ""}</span>}
          {ids.length > 0 && <span className="evid" title={ids.join(", ")}>Evidence ⓘ</span>}
          {text && <button className="btn-quiet" onClick={() => copy(question.id, text)}>{copied === question.id ? "Copied" : "Copy"}</button>}
        </div>}
        {(answer?.issues ?? []).map((issue) => <p key={issue} className="question-issue">⚠ {issue}</p>)}
      </li>;
    })}</ol>}
    {state && state.answers.length > 0 && <button className="btn-link" onClick={() => setEditing(true)}>Edit answers</button>}
    <form className="question-paste" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor={`questions-${jobId}`}>Paste questions</label>
      <textarea id={`questions-${jobId}`} rows={3} value={draft} disabled={running} placeholder="One question per line (or separated by blank lines). Enter to answer, Shift+Enter for a new line." onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
      <div className="question-paste-row"><span>{problem || "Answered in the background from your evidence, stories, and the posting; logistics questions are skipped. The terminal is not used."}</span><button className="btn-primary" disabled={running || !draft.trim()}>Answer</button></div>
    </form>
  </div>;
}

/** A job's files in three groups: the application, interview prep, and everything else. */
function FilesTab({ files, onSelect }: { files: FileTreeNode[]; onSelect: (path: string) => void }) {
  const [view, setView] = useState<"application" | "interview" | "other">("application");
  const group = (file: FileTreeNode) => file.relativePath.includes("/interviews/") ? "interview" : /evaluation|resume|cover_letter|original_jd/i.test(file.name) ? "application" : "other";
  const shown = files.filter((file) => group(file) === view);
  return <>
    <SubTabs<"application" | "interview" | "other">
      idPrefix="files"
      label="Job files"
      value={view}
      onChange={setView}
      tabs={(["application", "interview", "other"] as const).map((id) => ({ id, label: id === "application" ? "Application" : id === "interview" ? "Interview" : "Other", count: files.filter((file) => group(file) === id).length }))}
    />
    <SubTabPanel idPrefix="files" value={view}><section className="context-block"><ArtifactTable files={shown} onSelect={onSelect} empty="No files in this group." /></section></SubTabPanel>
  </>;
}

/** What the job is: research summary or responsibilities, company line, and the facts (computed in role-facts.ts). */
function RolePanel({ job }: { job: JobFolderSummary }) {
  const role = job.role;
  if (!role) return null;
  const points = role.summary.length ? role.summary : role.responsibilities;
  // Pay, work setup, and experience always show: a value, or "Not in the posting" (never a silent gap).
  const notStated = <span className="role-missing">Not in the posting</span>;
  const facts = ([
    ["Pay", role.pay ?? notStated],
    ["Work", role.workArrangement ?? job.location ?? notStated],
    ["Experience", role.experience ?? notStated],
    ["Level", role.seniority ? role.seniority[0]!.toUpperCase() + role.seniority.slice(1) : null],
    ["Travel", role.travel],
    ["Authorization", role.workAuthorization],
    ["Must-haves", role.requiredCount ? `${role.requiredCount} in the posting` : null],
    ["Tools", role.tools.length ? role.tools.slice(0, 8).join(", ") : null],
    ["Posting", role.source ? <a href={role.source} title={role.source}>{role.source.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</a> : null],
  ] as Array<[string, React.ReactNode]>).filter((entry) => Boolean(entry[1]));
  return <section className="overview-panel role-panel">
    <h2>Role</h2>
    {role.company && <p className="role-company">{role.company}</p>}
    {points.length > 0 && <ul className="role-points">{points.slice(0, 2).map((point) => <li key={point}>{point}</li>)}</ul>}
    {points.length > 2 && <details className="must-group"><summary>{points.length - 2} more</summary><ul>{points.slice(2).map((point) => <li key={point}>{point}</li>)}</ul></details>}
    {facts.length > 0 && <dl className="role-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    {role.process.length > 0 && <details className="must-group"><summary>Interview process</summary><ul>{role.process.map((step) => <li key={step}>{step}</li>)}</ul></details>}
  </section>;
}

const ROUND_LABELS: Record<InterviewRoundKind, string> = { recruiter: "Recruiter", hiring_manager: "Hiring manager", practical: "Practical", final: "Final panel", other: "Other" };
const RESULT_LABELS: Record<NonNullable<JobOutcome["result"]>, string> = { rejected: "Rejected", withdrew: "I withdrew", no_reply: "No reply", offer: "Offer", accepted: "Accepted", declined: "Declined the offer" };

/**
 * What happened with a job, for learning: the real interviews (prep alone never counts) and, once closed, how it ended
 * and why. Saved in the tracker (`interviews`, `outcome`); an older "Outcome: …" note is read once and moved over.
 */
function DebriefPanel({ job, closed, onUpdateTracker, onInsertPrompt }: { job: JobFolderSummary; closed: boolean; onUpdateTracker: (update: JobTrackerUpdate) => Promise<void>; onInsertPrompt: (action: Pick<JobAction, "prompt" | "label">) => void }) {
  const notes = job.tracker?.notes ?? "";
  const interviews = job.tracker?.interviews ?? [];
  const legacyReason = /^Outcome: (.*)$/m.exec(notes)?.[1] ?? "";
  const outcome = job.tracker?.outcome ?? null;
  const savedReason = outcome?.reason || legacyReason;
  const [reason, setReason] = useState(savedReason);
  const nextRound = INTERVIEW_ROUNDS.find((round) => round !== "other" && !interviews.some((event) => event.round === round)) ?? "other";
  const [round, setRound] = useState<InterviewRoundKind>(nextRound);
  const [date, setDate] = useState("");
  useEffect(() => { setReason(savedReason); }, [job.id, savedReason]);
  useEffect(() => { setRound(nextRound); setDate(""); }, [job.id, interviews.length]);
  const furthestOf = (events: InterviewEvent[]): JobOutcome["stageReached"] => events.map((event) => event.round).filter((value) => value !== "other").sort((x, y) => INTERVIEW_ROUNDS.indexOf(y) - INTERVIEW_ROUNDS.indexOf(x))[0] ?? (events.length ? "other" : "applied");
  const furthest = furthestOf(interviews);
  const status = effectiveStatus(job);
  const defaultResult: JobOutcome["result"] = status === "withdrawn" ? "withdrew" : status === "rejected" ? "rejected" : status === "offer" ? "offer" : null;
  function saveOutcome(change: Partial<JobOutcome>) {
    const next: JobOutcome = { stageReached: furthest, result: outcome?.result ?? defaultResult, reason: savedReason, date: outcome?.date ?? null, ...change };
    const update: JobTrackerUpdate = { outcome: next };
    if (legacyReason) update.notes = notes.replace(/^Outcome: .*$\n?/m, "").trim();
    void onUpdateTracker(update);
  }
  function addInterview() {
    const event: InterviewEvent = { round, date: date || null, note: "", source: "user" };
    const events = [...interviews, event];
    void onUpdateTracker({ interviews: events, ...(outcome ? { outcome: { ...outcome, stageReached: furthestOf(events) } } : {}) });
  }
  const company = job.company ?? displayJobName(job.name);
  const prepared = job.interviewRoundCount ?? 0;
  return <section className="debrief-panel" aria-labelledby="debrief-title">
    <h2 id="debrief-title">What happened? <small>{interviews.length ? `${plural(interviews.length, "interview")} recorded` : prepared ? `Prep for ${plural(prepared, "round")}; record the interviews you actually had` : "Record any interviews you had"}</small></h2>
    {interviews.length > 0 && <ul className="interview-events">{interviews.map((event, index) => <li key={`${event.round}-${index}`}>
      <span>{ROUND_LABELS[event.round]}</span>{event.date && <span className="muted">{event.date}</span>}
      <button className="btn-link" aria-label={`Remove the ${ROUND_LABELS[event.round].toLowerCase()} interview`} onClick={() => void onUpdateTracker({ interviews: interviews.filter((_, other) => other !== index) })}>Remove</button>
    </li>)}</ul>}
    <div className="interview-add">
      <label><span>Interview</span><select value={round} onChange={(event) => setRound(event.target.value as InterviewRoundKind)}>{INTERVIEW_ROUNDS.map((value) => <option key={value} value={value}>{ROUND_LABELS[value]}</option>)}</select></label>
      <label><span>Date (optional)</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <button className="btn-quiet" onClick={addInterview}>Add interview</button>
    </div>
    {closed && <div className="outcome-fields">
      <label><span>Result</span><select value={outcome?.result ?? defaultResult ?? ""} onChange={(event) => saveOutcome({ result: (event.target.value || null) as JobOutcome["result"] })}>
        <option value="">Not set</option>{OUTCOME_RESULTS.map((value) => <option key={value} value={value}>{RESULT_LABELS[value]}</option>)}
      </select></label>
      <label className="outcome-reason"><span>Why it ended, in your words</span><input value={reason} placeholder="e.g. wanted deeper Kubernetes experience" onChange={(event) => setReason(event.target.value)} onBlur={() => { if (reason.trim() !== savedReason || legacyReason) saveOutcome({ reason: reason.trim() }); }} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} /></label>
    </div>}
    {interviews.length > 0 && <button className="btn-link" onClick={() => onInsertPrompt({ prompt: `${company} debrief (job: ${job.id})`, label: "Debrief this interview" })}>Ask Agy to debrief</button>}
  </section>;
}

/**
 * A document shown in place, with the full document view: read it, or press Edit Markdown to change it right here.
 * The file is reread each time the subtab opens, and a save updates the view, so it never shows stale text.
 */
export function DocInline({ path, label }: { path: string | null; label: string }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setFailed(false);
    if (!path) return;
    void window.sensei.files.preview(path).then((next) => { if (!cancelled) setPreview(next); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path]);
  if (!path) return <p className="doc-inline-empty">No {label} yet. Ask Agy to draft the application.</p>;
  if (failed) return <p className="doc-inline-empty">The {label} could not be read.</p>;
  if (!preview || preview.relativePath !== path) return <p className="doc-inline-empty">Reading the {label}…</p>;
  return <div className="doc-inline"><DocumentView key={`${preview.relativePath}:${preview.modifiedAt}`} preview={preview} isBaseResume={false} onExported={() => undefined} onDirtyChange={() => undefined} onSaved={async (saved) => setPreview(saved)} /></div>;
}

const STRETCH_LABEL = { low: "Low", medium: "Medium", high: "High" } as const;
const STRETCH_LEVEL = ["As evidence", "Reworded", "Framed stronger", "Not supported"] as const;

/** How far the drafts reach past the evidence: shown beside fit, never part of it. */
function StretchSummary({ stretch }: { stretch: NonNullable<JobFolderSummary["stretch"]> }) {
  return <details className={`stretch-summary is-${stretch.level}`}>
    <summary><span className="stretch-label">Stretch: {STRETCH_LABEL[stretch.level]}</span><span className="muted"> · {stretch.tailoredPercent}% of the resume tailored</span></summary>
    <p className="muted">How far the resume and letter reach past your evidence. {stretch.counts.unsupported} not supported, {stretch.counts.framed} framed stronger, {stretch.counts.reworded} reworded, {stretch.counts.asEvidence} as the evidence says.</p>
    {stretch.top.length > 0 && <ul className="stretch-lines">{stretch.top.map((line) => <li key={line.text}><span className="stretch-tag">{STRETCH_LEVEL[line.level]}</span> {line.text.replace(/[*_`]/g, "")}<span className="muted"> ({line.artifact === "resume" ? "resume" : "letter"}) {line.reason}</span></li>)}</ul>}
  </details>;
}

/** The posting's required items as rated, grouped so blockers and learnable gaps are seen first. */
/** Must-haves as one line, with the groups (blockers, to learn, gaps, met) folded away until opened. */
function MustHaveGroups({ mustHaves, gaps = [] }: { mustHaves: JobFolderSummary["mustHaves"]; gaps?: string[] }) {
  if (!mustHaves.length && !gaps.length) return null;
  const groups: Array<[string, "blocker" | "learnable" | "met"]> = [["Blockers", "blocker"], ["To learn", "learnable"], ["Met", "met"]];
  const met = mustHaves.filter((item) => item.status === "met").length;
  return <div className="must-haves">
    {mustHaves.length > 0 && <p className="must-line"><strong>Must-haves</strong> {met} of {mustHaves.length} met{mustHaves.some((item) => item.status === "blocker") ? " · has a blocker" : ""}</p>}
    {groups.map(([label, status]) => {
      const items = mustHaves.filter((item) => item.status === status);
      return items.length > 0 && <details key={status} className={`must-group is-${status}`} open={status === "blocker"}>
        <summary>{label} ({items.length})</summary>
        <ul>{items.map((item) => <li key={item.requirement}>{item.requirement}</li>)}</ul>
      </details>;
    })}
    {gaps.length > 0 && <details className="must-group is-gap"><summary>Gaps ({gaps.length})</summary><ul>{gaps.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul></details>}
  </div>;
}

function JobPdfExportButton({ resumePath, coverLetterPath }: { resumePath: string | null; coverLetterPath: string | null }) {
  const announce = useAnnounce();
  // PDFs made before the resume or cover letter was last edited would send the old text.
  const stale = usePdfFreshness(resumePath?.split("/")[1] ?? null).filter((item) => item.state === "stale");
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [textSize, setTextSize] = useState<PdfTextSize>(DEFAULT_PDF_TEXT_SIZE);
  // Recruiter Edition: start from the recruiter's default PDF text size (Settings → Defaults for every candidate).
  useEffect(() => { if (FEATURES.candidates) void window.sensei.candidates.recruiterSettings().then((settings) => setTextSize(settings.defaults.pdfTextSize), () => undefined); }, []);
  // A job may have no cover letter (recruiter plan R7); the resume alone is then exported.
  const missing = !resumePath;
  async function exportApplicationPdfs() {
    if (!resumePath) return;
    setState("working");
    setMessage("");
    try {
      await window.sensei.files.exportMarkdownPdf(resumePath, textSize);
      if (coverLetterPath) await window.sensei.files.exportMarkdownPdf(coverLetterPath, textSize);
      const saved = coverLetterPath ? "Resume and cover letter PDFs saved" : "Resume PDF saved";
      setState("done");
      setMessage(saved);
      announce(`${saved} (${resumePath.split("/")[1] ?? "job"}).`);
      pdfsCreated(resumePath);
      documentsChanged();
    } catch (caught) {
      setState("error");
      setMessage(messageOf(caught, "PDF creation failed."));
      announce(`PDF creation failed: ${messageOf(caught, "unknown error")}`);
    }
  }
  return <span className="job-pdf-export"><PdfTextSizeSelect value={textSize} onChange={setTextSize} disabled={state === "working"} /><button className="export-button" disabled={missing || state === "working"} title={missing ? "A tailored resume is required" : coverLetterPath ? "Create PDFs for this job's resume and cover letter" : "Create a PDF of this job's resume"} onClick={() => void exportApplicationPdfs()}>{state === "working" ? "Creating PDFs…" : stale.length ? "Update PDFs" : "Create PDFs"}</button>{stale.length > 0 && state !== "working"
    ? <small className="export-message is-stale" role="status">{stale.length === 1 ? `The ${stale[0]!.kind === "resume" ? "resume" : "cover letter"} PDF is older than your last edit` : "The PDFs are older than your last edits"}</small>
    : message && <small className={`export-message ${state === "error" ? "is-error" : ""}`} role="status">{message}</small>}</span>;
}




function ArtifactTable({ files, onSelect, empty }: { files: FileTreeNode[]; onSelect: (path: string) => void; empty: string }) {
  if (!files.length) return <p className="dashboard-empty-copy">{empty}</p>;
  return <div className="artifact-table" role="table" aria-label="Workspace files"><div className="artifact-table-row is-heading" role="row"><span role="columnheader">Document</span><span role="columnheader">Type</span><span role="columnheader">Updated</span><span /></div>{files.map((file) => <button className="artifact-table-row" role="row" key={file.relativePath} onClick={() => onSelect(file.relativePath)}><span role="cell"><strong>{displayJobName(file.name.replace(/\.[^.]+$/, ""))}</strong><small>{file.relativePath}</small></span><span role="cell">{fileTypeLabel(file)}</span><span role="cell">{file.modifiedAt ? formatRelativeDate(file.modifiedAt) : "—"}</span><span role="cell">Open</span></button>)}</div>;
}

function fileTypeLabel(file: FileTreeNode): string {
  if (file.name.toLowerCase().endsWith(".md")) return "Markdown";
  return file.fileType === "docx" ? "Document" : file.fileType ? file.fileType.toUpperCase() : "File";
}


function ApplicationHealth({ job, files, status, loading, onStatus }: { job: JobFolderSummary; files: FileTreeNode[]; status: ApplicationStatus | null; loading: boolean; onStatus: (status: ApplicationStatus) => void }) {
  const jobId = job.id;
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState("");
  const [lastReport, setLastReport] = useState<ApplicationValidationReport | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  useEffect(() => {
    setMessage("");
    setLastReport(null);
    setIssuesOpen(false);
  }, [jobId]);
  async function validate() {
    setValidating(true);
    setMessage("");
    try {
      const report = await window.sensei.jobs.validateApplication(jobId);
      setLastReport(report);
      setIssuesOpen(report.issues.length > 0);
      onStatus(await window.sensei.jobs.getApplicationStatus(jobId));
      const errors = report.issues.filter((issue) => issue.severity === "error").length;
      const warnings = report.issues.filter((issue) => issue.severity === "warning").length;
      setMessage(report.status === "passed" ? `Application is reviewable${warnings ? ` with ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.` : `${errors} error${errors === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"}.`);
    } catch (caught) {
      setMessage(messageOf(caught, "Validation could not run."));
    } finally {
      setValidating(false);
    }
  }
  if (loading) return <section className="application-health is-loading"><span>Reading application health…</span></section>;
  if (!status) return null;
  const issues = lastReport?.issues ?? status.validation?.issues ?? [];
  const footprint = status.footprint;
  const hasEvaluation = files.some((file) => file.name.toLowerCase() === "evaluation.md");
  const hasResume = files.some((file) => /resume\.md$/i.test(file.name));
  const hasCoverLetter = files.some((file) => file.name.toLowerCase() === "cover_letter.md");
  const recommendedAction = !hasEvaluation ? "Review the saved job description" : !hasResume || !hasCoverLetter ? "Finish application drafts" : status.state === "validated" ? "Review and export submission PDFs" : "Review the generated application and warnings";
  const validationLabel = validating
    ? "Validating…"
    : lastReport === null
      ? "Validate application"
      : lastReport.status !== "passed"
        ? "Needs review"
        : lastReport.issues.some((issue) => issue.severity === "warning")
          ? "Review warnings"
          : "Validated";
  const stateCopy: Record<ApplicationStatus["state"], string> = {
    not_started: "Not started. Ask Agy to evaluate this job first.",
    snapshot_ready: "Evidence gathered. Drafts are not written yet.",
    matched: "Evaluated. Drafts are not written yet.",
    drafted: "Drafted. Run a check before you send it.",
    validated: "Checked and ready to send.",
    stale: "Files changed since the last check. Run the check again.",
    invalid: "The last check found problems to fix.",
  };
  return <section className={`app-check is-${status.state}`} aria-label="Application check">
    <header className="app-check-head">
      <div><h2>Application check</h2><p>{stateCopy[status.state]}</p></div>
      <button className="btn-primary" disabled={validating} onClick={() => void validate()}>{validating ? "Checking…" : validationLabel === "Validate application" ? "Run check" : validationLabel}</button>
    </header>
    {message && <p className="app-check-message" role="status" aria-live="polite">{message}</p>}
    <ul className="app-check-docs" aria-label="Application documents">
      <li className={hasEvaluation ? "is-ready" : ""}><span aria-hidden="true">{hasEvaluation ? "✓" : "○"}</span>Evaluation</li>
      <li className={hasResume ? "is-ready" : ""}><span aria-hidden="true">{hasResume ? "✓" : "○"}</span>Resume</li>
      <li className={hasCoverLetter ? "is-ready" : ""}><span aria-hidden="true">{hasCoverLetter ? "✓" : "○"}</span>Cover letter</li>
    </ul>
    <p className="app-check-next"><strong>Next:</strong> {recommendedAction}.{job.rating !== null && <> Fit {job.rating.toFixed(1)} of 5{job.ratingConfidence ? `, ${job.ratingConfidence} confidence` : ""}.</>}</p>
    {issues.length > 0 && <details className="application-issues" open={issuesOpen} onToggle={(event) => setIssuesOpen(event.currentTarget.open)}><summary>{plural(issues.filter((issue) => issue.severity === "error").length, "error")} and {plural(issues.filter((issue) => issue.severity === "warning").length, "warning")} from the last check</summary>{issues.map((issue, index) => <div className={`application-issue is-${issue.severity}`} key={`${issue.code}-${issue.artifact}-${index}`}><strong>{issue.severity === "warning" ? "Warning" : "Needs review"}</strong><span>{issue.code} · {issue.artifact}</span><p>{issue.message}</p>{issue.explanation && <div className="application-issue-explanation"><span><b>Sentence</b>{issue.explanation.sentence ?? "Unavailable"}</span><span><b>Source</b>{issue.explanation.sources.length ? issue.explanation.sources.map((source, sourceIndex) => <span className="application-issue-source" key={`${source.evidenceId}-${sourceIndex}`}><code>{source.evidenceId}</code> · <code>{source.sourcePath}</code><em>{source.claim}</em></span>) : "Unavailable"}</span></div>}<small>{issue.repairHint}</small></div>)}</details>}
    {(job.ratingHighlights.length > 0 || job.ratingGaps.length > 0) && <details className="application-fit-details"><summary>Why this rating <span>{job.ratingHighlights.length} strengths · {job.ratingGaps.length} gaps</span></summary><div><section><h3>Strongest alignment</h3>{job.ratingHighlights.length ? <ul>{job.ratingHighlights.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No direct-match summary was found.</p>}</section><section><h3>Gaps and risks</h3>{job.ratingGaps.length ? <ul>{job.ratingGaps.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No material gaps were listed.</p>}</section></div></details>}
    {(lastReport?.ats?.missingFields.length ?? 0) > 0 && <p className="app-check-message">ATS fields to review: {lastReport?.ats?.missingFields.join(", ")}</p>}
    <details className="app-check-details"><summary>Pipeline details</summary>
    <div className="application-health-facts">
      <span><small>Snapshot</small>{status.snapshotConsistent ? "Pinned" : "Mismatch"}</span>
      <span><small>Manifest</small>{status.manifestCurrent ? "Current" : "Stale"}</span>
      <span><small>Base resume</small>{footprint ? `${footprint.format.toUpperCase()}, ${footprint.status}` : "Not profiled"}</span>
      <span><small>Template lock</small>{status.templateIntegrity.replaceAll("_", " ")}</span>
      <span><small>Resume density</small>{status.resumeBulletCount === null ? "Not drafted" : `${status.resumeBulletCount} bullets, ${status.currentEmployerBulletCount ?? 0} in current role`}</span>
      <span><small>Recent work</small>{status.recentCurrentEmployerBulletCount === null ? "Not audited" : `${status.recentCurrentEmployerBulletCount} evidence-backed`}</span>
      <span><small>Word target</small>{footprint && footprint.targetWordMin !== null && footprint.targetWordMax !== null ? `${footprint.targetWordMin}-${footprint.targetWordMax}` : "Unavailable"}</span>
      <span><small>Fit credit</small>{`Direct ${FIT_CLASSIFICATION_CREDIT.direct * 100}%, strong transferable ${FIT_CLASSIFICATION_CREDIT.strong_transferable * 100}%, adjacent ${FIT_CLASSIFICATION_CREDIT.adjacent_transferable * 100}%`}</span>
    </div>
    {(() => {
      const report = lastReport ?? status.validation;
      const ats = report?.ats;
      const keywordClasses = report?.keywordClasses ?? [];
      if (!ats && keywordClasses.length === 0) return null;
      const supported = keywordClasses.filter((item) => item.classification === "supported").length;
      const transferable = keywordClasses.filter((item) => item.classification === "transferable").length;
      const unsupported = keywordClasses.filter((item) => item.classification === "unsupported").length;
      return <div className="application-health-facts application-ats-facts">
        {ats && <span><small>ATS PDF check</small>{ats.status === "passed" ? "Readable · fields found" : ats.status === "not_exported" ? "Not exported" : ats.status === "unavailable" ? "Unavailable" : `${ats.missingFields.length} fields to review`}</span>}
        {keywordClasses.length > 0 && <span><small>Keyword class</small>{supported} supported · {transferable} transferable · {unsupported} unsupported</span>}
      </div>;
    })()}
    </details>
  </section>;
}
