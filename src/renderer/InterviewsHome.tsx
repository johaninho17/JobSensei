import { useEffect, useMemo, useState } from "react";
import { isRecordingPath, usedInText, waitingToImport, type RecordingKind } from "../shared/recordings";
import { type ContentReviewInfo, type RecordingInfo, type InterviewOverview, type JobFolderSummary } from "../shared/schemas";
import { effectiveStatus } from "../shared/tracker";
import { computeLearnings, STAGE_LABELS } from "../shared/learnings";
import { type JobAction } from "./job-actions";
import { markdownHtml } from "./markdown";
import { SubTabPanel, SubTabs } from "./SubTabs";
import { Section } from "./Section";
import { TunePanel } from "./TunePanel";
import { interviewIsPast, nextInterviewStep } from "../shared/interview-progress";
import { storyTitles } from "./interview-cards";
import { TrackerPill, displayJobName, messageOf, plural } from "./app-shared";
import { PageHead } from "./BentoPrimitives";

export function InterviewsHome({ jobs, allJobs, newRecordings, onRecordingsChanged, onSendPrompt, onOpen, onOpenFile }: { jobs: JobFolderSummary[]; allJobs: JobFolderSummary[]; newRecordings: number; onRecordingsChanged: () => void; onSendPrompt: (action: Pick<JobAction, "prompt" | "label">) => void; onOpen: (jobId: string, roundId?: string) => void; onOpenFile: (path: string) => void }) {
  // Another page can ask for a subtab once (the Agy page opens Your content).
  const [view, setView] = useState<"active" | "past" | "learnings" | "content">(() => {
    try { const asked = window.sessionStorage.getItem("sensei-interviews-view"); window.sessionStorage.removeItem("sensei-interviews-view"); return asked === "content" ? "content" : "active"; } catch { return "active"; }
  });
  const [overviews, setOverviews] = useState<Record<string, InterviewOverview | null>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(jobs.map(async (job) => [job.id, await window.sensei.interviews.getOverview(job.id).catch(() => null)] as const))
      .then((entries) => { if (!cancelled) setOverviews(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [jobs]);
  const rows = jobs.map((job) => {
    const overview = overviews[job.id];
    // The round that's actually next (after interviews the user recorded), else the one last opened.
    const next = overview ? nextInterviewStep({ rounds: overview.rounds, knownProcess: overview.knownProcess, recorded: job.tracker?.interviews ?? [] }) : null;
    const round = (next?.kind === "practice" ? overview?.rounds.find((candidate) => candidate.id === next.roundId) : null)
      ?? overview?.rounds.find((candidate) => candidate.id === overview.currentRoundId) ?? overview?.rounds.at(-1) ?? null;
    return { job, overview, round };
  }).sort((a, b) => Number(interviewIsPast(a.job)) - Number(interviewIsPast(b.job)) || (a.round?.scheduledDate ?? "9999").localeCompare(b.round?.scheduledDate ?? "9999") || Date.parse(b.job.modifiedAt) - Date.parse(a.job.modifiedAt));
  const closed = interviewIsPast;
  const renderRows = (list: typeof rows) => <>
    {list.length > 0 && <ul className="interview-rows">{list.map(({ job, overview, round }) => <li key={job.id} className={interviewIsPast(job) ? "is-closed" : ""}>
      <button className="interview-row" onClick={() => onOpen(job.id, round?.id)}>
        <span className="interview-row-main"><strong>{job.company ?? displayJobName(job.name)}</strong><span>{job.title ?? "Role not recorded"}</span></span>
        <TrackerPill status={effectiveStatus(job)} job={job} />
        <span className="interview-row-round"><strong>{round?.label ?? job.interviewRoundLabel}</strong><span>{round ? (round.scheduledDate ?? (round.status === "prep_ready" ? "Prep ready" : round.status.replace("_", " "))) : "Loading…"}</span></span>
        <span className="interview-row-steps" aria-label={`${overview?.rounds.length ?? 0} rounds`}>{(overview?.rounds ?? []).map((candidate) => <i key={candidate.id} className={`is-${candidate.status} ${candidate.id === round?.id ? "is-current" : ""}`} />)}</span>
      </button>
    </li>)}</ul>}
    {!list.length && <p className="doc-inline-empty">Nothing here.</p>}
  </>;
  return <section className="jobs-home">
    <PageHead title="Interviews" status={jobs.length ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} with prep` : null} tip="Open a job with prep to practice its current round. No prep yet? Open a job and prepare its first round when you get the call." />
    <SubTabs<"active" | "past" | "learnings" | "content">
      idPrefix="ivhome"
      label="Interviews"
      value={view}
      onChange={setView}
      tabs={[{ id: "active", label: "Active", count: rows.filter((row) => !closed(row.job)).length }, { id: "past", label: "Past", count: rows.filter((row) => closed(row.job)).length }, { id: "learnings", label: "Learnings" }, { id: "content", label: "Your content", count: newRecordings || null }]}
    />
    <SubTabPanel idPrefix="ivhome" value={view}>
      {view === "active" && renderRows(rows.filter((row) => !closed(row.job)))}
      {view === "past" && renderRows(rows.filter((row) => closed(row.job)))}
      {view === "learnings" && <LearningsView jobs={allJobs} overviews={overviews} onOpenFile={onOpenFile} />}
      {view === "content" && <YourContent jobs={allJobs} onSendPrompt={onSendPrompt} onChanged={onRecordingsChanged} onOpenFile={onOpenFile} />}
    </SubTabPanel>
  </section>;
}

/**
 * What the search so far says: how far applications got, whether fit predicted interviews, the questions asked most
 * (role memory), delivery fixes, and which stories the prep used most. Computed from the workspace; nothing is saved.
 */
function LearningsView({ jobs, overviews, onOpenFile }: { jobs: JobFolderSummary[]; overviews: Record<string, InterviewOverview | null>; onOpenFile: (path: string) => void }) {
  const [texts, setTexts] = useState<{ memory: string; voice: string; banks: string[]; stories: Record<string, string> }>({ memory: "", voice: "", banks: [], stories: {} });
  const [memoryPath, setMemoryPath] = useState<string | null>(null);
  const bankPaths = useMemo(() => Object.values(overviews).flatMap((overview) => overview?.rounds.map((round) => round.artifactPaths.questionBank).filter((path): path is string => Boolean(path)) ?? []), [overviews]);
  useEffect(() => {
    let cancelled = false;
    const read = (path: string) => window.sensei.files.preview(path).then((preview) => preview.content ?? "").catch(() => "");
    // Role memory files are listed in the index (one per role family); their patterns are combined here.
    const memoryPaths = read("debrief/interview-memory/role-index.json").then((raw) => { try { return ((JSON.parse(raw) as { roles?: Array<{ path?: string }> }).roles ?? []).map((role) => role.path).filter((path): path is string => Boolean(path)); } catch { return []; } });
    void Promise.all([memoryPaths.then((paths) => Promise.all(paths.map(read))), read("profile/interview_voice.md"), Promise.all(bankPaths.map(read)), read("profile/story_bank.md")])
      .then(([memories, voice, banks, stories]) => { if (!cancelled) setTexts({ memory: memories.join("\n\n"), voice, banks, stories: storyTitles(stories) }); });
    void memoryPaths.then((paths) => { if (!cancelled) setMemoryPath(paths[0] ?? null); });
    return () => { cancelled = true; };
  }, [bankPaths.join("|")]);
  const learn = useMemo(() => computeLearnings(jobs), [jobs]);
  const percent = (part: number, whole: number) => whole ? ` · ${Math.round((part / whole) * 100)}%` : "";
  const money = (value: number | null) => value === null ? "—" : `$${Math.round(value / 1000)}k`;
  const storyCounts = new Map<string, number>();
  for (const bank of texts.banks) for (const match of bank.matchAll(/\*\*(?:Proof|Real example|Closest real experience):?\*\*:?[^\n]*/gi)) for (const id of new Set(match[0].match(/\bS\d{1,2}\b/g) ?? [])) storyCounts.set(id, (storyCounts.get(id) ?? 0) + 1);
  const section = (markdown: string, heading: RegExp) => { const lines = markdown.split("\n"); const start = lines.findIndex((line) => /^##\s/.test(line) && heading.test(line)); if (start < 0) return ""; const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line)); return lines.slice(start + 1, end < 0 ? undefined : end).join("\n"); };
  const fixes = section(texts.voice, /delivery fixes/i).split("\n").filter((line) => /^\s*-\s/.test(line)).map((line) => { const [fix, , , status] = line.replace(/^\s*-\s*/, "").split(/\s+—\s+/); return { fix: fix ?? line, status: (status ?? "").replace(/^Status\s*/i, "") }; });
  const recruiterQuestions = section(texts.memory, /^##\s*recruiter/i);
  const managerQuestions = section(texts.memory, /hiring manager/i);
  return <div className="learnings">
    {learn.unrecorded > 0 && <p className="learn-note" role="status">{plural(learn.unrecorded, "job")} with interview prep {learn.unrecorded === 1 ? "has" : "have"} no recorded interviews yet, so {learn.unrecorded === 1 ? "it isn't" : "they aren't"} counted below. Record them in each job's "What happened?" (Jobs ⋯ → Data health lists them).</p>}
    <Section id="learn-1" title="How far applications got" defaultOpen={true}>
      <p className="learn-note">Real interviews only, as recorded in each job. Prep alone doesn't count.</p>
      <dl className="learn-stats">
        <div><dt>Applied</dt><dd className="tabular">{learn.applied}</dd></div>
        <div><dt>Got an interview</dt><dd className="tabular">{learn.interviewed}<small>{percent(learn.interviewed, learn.applied)}</small></dd></div>
        {learn.funnel.filter((row) => row.stage !== "recruiter").map((row) => <div key={row.stage}><dt>Reached {STAGE_LABELS[row.stage].toLowerCase()}</dt><dd className="tabular">{row.count}<small>{percent(row.count, learn.interviewed)}</small></dd></div>)}
      </dl>
    </Section>
    <Section id="learn-2" title="Did fit predict how far you got?" defaultOpen={true}>
      <table className="learn-table"><thead><tr><th>Furthest stage</th><th>Jobs</th><th>Average fit</th></tr></thead>
        <tbody>{learn.fitByStage.map((row) => <tr key={row.stage}><td>{STAGE_LABELS[row.stage]}</td><td className="tabular">{row.jobs}</td><td className="tabular">{row.averageFit?.toFixed(2) ?? "—"}</td></tr>)}</tbody></table>
    </Section>
    {(learn.bySetup.length > 0 || learn.pay.interviewed !== null) && <Section id="learn-3" title="Which jobs gave interviews" defaultOpen={false}>
      <table className="learn-table"><thead><tr><th>Jobs</th><th>Applied</th><th>Got an interview</th></tr></thead>
        <tbody>{learn.bySetup.map((row) => <tr key={row.label}><td>{row.label}</td><td className="tabular">{row.applied}</td><td className="tabular">{row.interviewed}{percent(row.interviewed, row.applied)}</td></tr>)}</tbody></table>
      {learn.bySettings.length > 0 && <table className="learn-table"><thead><tr><th>Agy settings the drafts were made under</th><th>Applied</th><th>Got an interview</th></tr></thead>
        <tbody>{learn.bySettings.map((row) => <tr key={row.band}><td>{row.label}</td><td className="tabular">{row.applied}</td><td className="tabular">{row.interviewed}{percent(row.interviewed, row.applied)}</td></tr>)}</tbody></table>}
      <p className="learn-note">Median posted pay: <strong className="tabular">{money(learn.pay.interviewed)}</strong> for jobs with an interview, <strong className="tabular">{money(learn.pay.notInterviewed)}</strong> for the rest.</p>
    </Section>}
    {learn.gapTerms.length > 0 && <Section id="learn-4" title="Gaps in applications that got no interview" defaultOpen={false}>
      <p className="learn-note">Tools the posting asked for that your evidence didn't cover, counted per job.</p>
      <ul className="learn-fixes">{learn.gapTerms.map((row) => <li key={row.term}><span>{row.term}</span><small>{row.noInterview} with no interview · {row.interviewed} with one</small></li>)}</ul>
    </Section>}
    {learn.reasons.length > 0 && <Section id="learn-5" title="Why it ended, in your words" defaultOpen={false}>
      <ul className="learn-fixes">{learn.reasons.map((row) => <li key={row.jobId}><span>{row.company}: {row.reason}</span><small>{row.stage}</small></li>)}</ul>
    </Section>}
    <Section id="learn-6" title="Questions asked most" defaultOpen={false}>
      <div className="learn-columns">
        <div><h4>Recruiter</h4><div className="iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(recruiterQuestions.split("\n").slice(0, 10).join("\n"), [], { readable: true }) }} /></div>
        <div><h4>Hiring manager</h4><div className="iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(managerQuestions.split("\n").slice(0, 8).join("\n"), [], { readable: true }) }} /></div>
      </div>
      {memoryPath && <button className="btn-link" onClick={() => onOpenFile(memoryPath)}>All patterns and interviewer feedback</button>}
    </Section>
    {fixes.length > 0 && <Section id="learn-7" title="Delivery fixes" defaultOpen={false}>
      <ul className="learn-fixes">{fixes.map((item) => <li key={item.fix}><span>{item.fix}</span><small>{item.status || "no status"}</small></li>)}</ul>
      <button className="btn-link" onClick={() => onOpenFile("profile/interview_voice.md")}>Open interview voice</button>
    </Section>}
    {storyCounts.size > 0 && <Section id="learn-8" title="Stories used most in prep" defaultOpen={false}>
      <ul className="learn-fixes">{[...storyCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => <li key={id}><span>{id}{texts.stories[id] ? ` · ${texts.stories[id]}` : ""}</span><small>{count} card{count === 1 ? "" : "s"}</small></li>)}</ul>
    </Section>}
  </div>;
}

const RECORDING_STATE: Record<RecordingInfo["state"], string> = { new: "New", changed: "Fuller version", imported: "Imported", duplicate: "Duplicate", skipped: "Skipped" };
const CONTENT_SOURCES: Array<{ path: string; title: string; what: string }> = [
  { path: "profile/story_bank.md", title: "Story bank", what: "Your best real examples; each prep round uses different ones." },
  { path: "profile/interview_voice.md", title: "Interview voice", what: "Your phrases, how you structure answers, and the delivery fixes you're working on." },
  { path: "debrief/interview-memory", title: "Role memory", what: "Questions asked most in each round, practical formats, and interviewer feedback." },
  { path: "context/structured/interview-stories.md", title: "Interview stories", what: "Work stories you told in interviews, usable as career evidence once checked in Career context." },
];

/**
 * What Agy uses for interview prep, and the recordings that haven't reached it yet. "Update" sends Agy only the new
 * recordings; afterwards the app compares the content with its backup, puts back anything removed without a better
 * replacement, and shows what changed.
 */
function YourContent({ jobs, onSendPrompt, onChanged, onOpenFile }: { jobs: JobFolderSummary[]; onSendPrompt: (action: Pick<JobAction, "prompt" | "label">) => void; onChanged: () => void; onOpenFile: (path: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof window.sensei.content.recordings>> | null>(null);
  const [review, setReview] = useState<ContentReviewInfo | null>(null);
  const [keepOld, setKeepOld] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = () => window.sensei.content.recordings().then(setData).catch((caught) => setMessage(messageOf(caught, "Couldn't read your recordings.")));
  useEffect(() => { void load(); }, []);
  // Files placed in the recordings folder by hand show up without a restart (#16).
  useEffect(() => window.sensei.workspace.onChanged((paths) => { if (!paths.length || paths.some(isRecordingPath)) { void load(); onChanged(); } }), []);
  const jobName = (id: string | null) => { const job = id ? jobs.find((candidate) => candidate.id === id) : null; return job ? `${job.company ?? displayJobName(job.name)}${job.title ? `, ${job.title}` : ""}` : null; };
  const waiting = waitingToImport(data?.recordings ?? []);
  const flagged = (data?.recordings ?? []).filter((recording) => recording.state === "duplicate");
  // Imported recordings and what they were used for, newest import first (#17).
  const imported = (data?.recordings ?? []).filter((recording) => recording.state === "imported").sort((a, b) => (b.importedAt ?? "").localeCompare(a.importedAt ?? ""));
  async function run(task: () => Promise<void>, failure: string) {
    setBusy(true); setMessage("");
    try { await task(); } catch (caught) { setMessage(messageOf(caught, failure)); } finally { setBusy(false); await load(); onChanged(); }
  }
  const check = () => run(async () => { setReview(await window.sensei.content.reviewUpdate()); setKeepOld(new Set()); }, "Couldn't check the update.");
  const finish = () => run(async () => { const { restored } = await window.sensei.content.finishUpdate([...keepOld]); setReview(null); setMessage(restored ? `Update saved. ${plural(restored, "item")} removed without a better replacement ${restored === 1 ? "was" : "were"} put back.` : "Update saved."); }, "Couldn't finish the update.");
  const undo = () => run(async () => { await window.sensei.content.undoUpdate(); setReview(null); setMessage("The update was undone; your content is back as it was."); }, "Couldn't undo the update.");
  const snippet = (text: string) => text.replace(/^#+\s*|^\s*[-*]\s+|^\|\s*/gm, "").replace(/\s+/g, " ").slice(0, 140);
  return <div className="your-content">
    <section className="iv-section">
      <h3>New recordings</h3>
      <p className="learn-note">Transcripts and notes in your <code>debrief</code> folder that Agy hasn't read yet. Tune reads only these, plus the content below, so old recordings are never read again.</p>
      {data?.pending ? <div className="onboarding-result" role="status">
        <strong>Update in progress</strong>
        <p>Agy is importing {plural(data.pending.recordings.length, "recording")} (started {new Date(data.pending.startedAt).toLocaleString()}). Confirm its proposals in the Agy panel; once it has saved, review the changes here.</p>
        <ul className="recording-list">{data.pending.recordings.map((recording) => <li key={recording.path}><span className="setup-state">Importing</span><span><strong>{recording.path.replace(/^debrief\//, "")}</strong></span></li>)}</ul>
        <div className="onboarding-actions"><button className="btn-primary" disabled={busy} onClick={() => void check()}>Review changes</button><button className="btn-quiet" disabled={busy} onClick={() => void undo()}>Undo the update</button></div>
      </div> : <>
        {waiting.length ? <ul className="recording-list">{waiting.map((recording) => <li key={recording.path}>
          <span className="setup-state">{RECORDING_STATE[recording.state]}</span>
          <span><strong>{recording.path.replace(/^debrief\//, "")}</strong><small>{jobName(recording.jobId) ?? "Job not matched: Agy will ask which job it was"}</small></span>
          <button className="btn-link" onClick={() => onOpenFile(recording.path)}>Open</button>
          <button className="btn-link" disabled={busy} onClick={() => void run(() => window.sensei.content.skip([recording.path]), "Couldn't skip it.")}>Skip</button>
        </li>)}</ul> : <p className="muted">No new recordings. Add a transcript or your notes below and it shows up here.</p>}
        <RecordingAdder jobs={jobs} onAdded={(message) => { setMessage(message); void load(); onChanged(); }} />
        {flagged.length > 0 && <p className="learn-note">{flagged.map((recording) => `${recording.path.replace(/^debrief\//, "")} is an exact copy of ${recording.duplicateOf?.replace(/^debrief\//, "")}`).join("; ")}. Copies are never imported twice; if one is filed under the wrong company, move or delete it.</p>}
      </>}
      {message && <p role="status" className="export-note">{message}</p>}
    </section>
    {!data?.pending && <TunePanel area="interviews" title="Tune from new recordings" what="Agy reads only the new recordings above and suggests updates to your story bank, interview voice, role memory, and interview stories. Nothing changes until you apply a suggestion." onSendPrompt={onSendPrompt} onOpenFile={onOpenFile} onApplied={() => { void load(); onChanged(); }} />}
    {review && <section className="iv-section content-review" aria-label="What the update changed">
      <h3>What the update changed</h3>
      {!review.changeListFound && <p className="learn-note">Agy didn't write its change list, so anything removed or shortened will be put back.</p>}
      <p>{plural(review.added.length, "addition")} · {plural(review.upgraded.length, "upgrade")} · {plural(review.replaced.length, "replacement")}{review.lost.length ? ` · ${plural(review.lost.length, "item")} removed without a replacement (will be put back)` : ""}</p>
      {review.added.length > 0 && <details><summary>Added</summary><ul>{review.added.slice(0, 30).map((item) => <li key={item.file + item.key}>{snippet(item.text)} <small className="muted">{item.file}</small></li>)}</ul></details>}
      {review.upgraded.length > 0 && <details><summary>Upgraded</summary><ul>{review.upgraded.map(({ after }) => <li key={after.file + after.key}>{snippet(after.text)} <small className="muted">{after.file}</small></li>)}</ul></details>}
      {review.replaced.length > 0 && <div><h4>Replaced by something better</h4><ul className="content-replaced">{review.replaced.map((entry) => { const id = `${entry.before.file}#${entry.before.key}`; return <li key={id}>
        <span><s>{snippet(entry.before.text)}</s> → {snippet(entry.replacement)}{entry.why && <small className="muted"> ({entry.why})</small>}</span>
        <label><input type="checkbox" checked={keepOld.has(id)} onChange={(event) => setKeepOld((current) => { const next = new Set(current); if (event.target.checked) next.add(id); else next.delete(id); return next; })} /> Keep the old version too</label>
      </li>; })}</ul></div>}
      {review.lost.length > 0 && <details open><summary>Removed without a replacement (will be put back)</summary><ul>{review.lost.map(({ before }) => <li key={before.file + before.key}>{snippet(before.text)} <small className="muted">{before.file}</small></li>)}</ul></details>}
      <div className="onboarding-actions"><button className="btn-primary" disabled={busy} onClick={() => void finish()}>Save the update</button><button className="btn-quiet" disabled={busy} onClick={() => void undo()}>Undo everything</button></div>
    </section>}
    {imported.length > 0 && <section className="iv-section">
      <details>
        <summary><h3 className="inline-heading">Imported recordings</h3> <span className="muted">{plural(imported.length, "recording")}</span></summary>
        <p className="learn-note">What each update took from a recording. "Shared" means Agy didn't say which recording an item came from, so it is counted for each one of that update.</p>
        <ul className="recording-list">{imported.slice(0, 30).map((recording) => <li key={recording.path}>
          <span className="setup-state">{recording.importedAt ? new Date(recording.importedAt).toLocaleDateString() : "Earlier"}</span>
          <span><strong>{recording.path.replace(/^debrief\//, "")}</strong><small>{recording.importedAt ? `Used in: ${usedInText(recording.usedIn ?? [])}${recording.usedInShared ? " (shared)" : ""}` : "Imported before the app kept track"}</small></span>
          <button className="btn-link" onClick={() => onOpenFile(recording.path)}>Open</button>
        </li>)}</ul>
      </details>
    </section>}
    <section className="iv-section">
      <h3>What Agy uses for interview prep</h3>
      <ul className="recording-list">{CONTENT_SOURCES.map((source) => <li key={source.path}>
        <span className="setup-state">{source.path.endsWith(".md") ? "File" : "Folder"}</span>
        <span><strong>{source.title}</strong><small>{source.what}</small></span>
        {source.path.endsWith(".md") ? <button className="btn-link" onClick={() => onOpenFile(source.path)}>Open</button> : <button className="btn-link" onClick={() => void window.sensei.files.reveal(source.path).catch(() => undefined)}>Show</button>}
      </li>)}</ul>
    </section>
  </div>;
}

/** Interviews → Your content → Add recordings (#16): pick the kind and the job, then Add files or drop them. */
function RecordingAdder({ jobs, onAdded }: { jobs: JobFolderSummary[]; onAdded: (message: string) => void }) {
  const [kind, setKind] = useState<RecordingKind>("interview");
  const [jobId, setJobId] = useState("");
  const [over, setOver] = useState(false);
  const sorted = [...jobs].sort((a, b) => (a.company ?? a.name).localeCompare(b.company ?? b.name));
  async function add(paths?: string[]) {
    try {
      const result = paths ? await window.sensei.content.importRecordingPaths(paths, kind, jobId || null) : await window.sensei.content.addRecordings(kind, jobId || null);
      if (!result.added.length && !result.skipped.length) return;
      const skipped = result.skipped.filter((item) => !item.reason.startsWith("already added"));
      onAdded([result.added.length ? `Added ${plural(result.added.length, "file")}.` : "", ...skipped.map((item) => `${item.name}: ${item.reason}.`)].filter(Boolean).join(" "));
    } catch (caught) { onAdded(messageOf(caught, "Couldn't add those files.")); }
  }
  return <div className={`context-add${over ? " is-over" : ""}`} aria-label="Add recordings"
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setOver(true); } }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => { event.preventDefault(); setOver(false); const paths = [...event.dataTransfer.files].map((file) => window.sensei.files.pathForFile(file)).filter(Boolean); if (paths.length) void add(paths); }}>
    <div className="segmented" role="group" aria-label="Kind of recording">
      <button aria-pressed={kind === "interview"} onClick={() => setKind("interview")}>Real interview</button>
      <button aria-pressed={kind === "practice"} onClick={() => setKind("practice")}>Practice interview</button>
    </div>
    <p>{kind === "interview" ? "A transcript or your own notes from a real interview. Choose the job so prep for its next round uses it." : "A mock interview with an AI or a friend. It shapes your interview voice and the hard questions to practice."}</p>
    {kind === "interview" && <label className="search-field"><span>Job</span><select value={jobId} onChange={(event) => setJobId(event.target.value)}>
      <option value="">Not sure (Agy will ask)</option>
      {sorted.map((job) => <option key={job.id} value={job.id}>{job.company ?? displayJobName(job.name)}{job.title ? `, ${job.title}` : ""}</option>)}
    </select></label>}
    <div className="context-add-actions">
      <button className="btn-primary" onClick={() => void add()}>Add files</button>
      <span className="muted">or drop files here (text, Word, PDF, Markdown, subtitles). Copies are added; your originals stay where they are.</span>
    </div>
  </div>;
}
