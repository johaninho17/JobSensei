// Today: the app's main page, in the Bento pilot layout (ledger U77, #126). What the morning search found, today's activity, what's due, insights for the coming
// days, and questions whose answers make tailoring, interview prep, or the search better (src/shared/today.ts).
import { useEffect, useState, type ReactNode } from "react";
import type { Insight, TodayData, TodayQuestion } from "../shared/today";
import { pickNextStep, type NextStep } from "../shared/today-next";
import { BentoCard, FitRing, Kpi } from "./BentoPrimitives";
import { Section } from "./Section";
import { SubTabPanel, SubTabs } from "./SubTabs";
import { draftFound, foundError, saveFound } from "./found-actions";

type Target = NonNullable<Insight["action"]>["target"];

export function TodayView({ onOpenJob, onOpenMatch, onQueueFound, onGo, onOpenTune, onToast, onAnswerAddedFile }: {
  onOpenJob: (jobId: string) => void;
  /** Opens Job Search on one match. */
  onOpenMatch: (id: string) => void;
  /** Sends a found job to the application queue (same as Job Search); returns how many are ahead. */
  onQueueFound: (id: string) => Promise<number>;
  onGo: (target: Target) => void;
  /** Opens Career context on its Tune tab. */
  onOpenTune: () => void;
  onToast: (message: string) => void;
  /** A skill answer was saved as a career record; the app checks it for Agy. */
  onAnswerAddedFile: (path: string) => void;
}) {
  const [today, setToday] = useState<TodayData | null>(null);
  const [busyMatch, setBusyMatch] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [tuneFiles, setTuneFiles] = useState<number | null>(null);
  const [pickedList, setListTab] = useState<TodayList | null>(null);
  const [activityKind, setActivityKind] = useState<ActivityKind>("all");
  const load = () => {
    void window.sensei.today.get().then(setToday).catch((reason) => setProblem(reason instanceof Error ? reason.message : String(reason)));
    if (FEATURES.tune) void window.sensei.tune.status().then((areas) => setTuneFiles(areas.reduce((sum, area) => sum + area.changed, 0))).catch(() => setTuneFiles(null));
  };
  useEffect(() => {
    load();
    const off = window.sensei.today.onChanged(load);
    const offRun = window.sensei.jobSearch.onFinished(() => load());
    return () => { off(); offRun(); };
  }, []);
  if (problem) return <section className="today"><p className="inline-error" role="alert">{problem}</p></section>;
  if (!today) return <section className="today"><p className="muted">Getting your day ready…</p></section>;

  const date = new Date(`${today.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const due = today.due;
  const dueCount = due.followUps.length + due.interviewsThisWeek.length + due.closedPostings.length + due.stale.length;
  const activity = today.activity;
  const activityCount = activity.added.length + activity.applied.length + activity.drafted.length + activity.interviews.length;
  const run = today.search.lastRun;
  // The lists card opens on the first tab with something in it, until the user picks one.
  const listTab: TodayList = pickedList ?? (dueCount ? "due" : FEATURES.jobSearch && today.search.newCount ? "matches" : "coming");
  const jobLink = (id: string, text: string) => <button className="btn-link" onClick={() => onOpenJob(id)}>{text}</button>;

  async function closePosting(jobId: string, label: string) {
    await window.sensei.today.closePosting(jobId);
    onToast(`Marked ${label} as closed (posting closed).`);
    load();
  }
  async function matchAction(id: string, action: "draft" | "save") {
    setBusyMatch(id);
    try {
      onToast(action === "draft" ? await draftFound([id], onQueueFound) : await saveFound([id]));
      load();
    } catch (reason) {
      onToast(foundError(reason));
    } finally { setBusyMatch(null); }
  }
  async function keepPosting(jobId: string) {
    await window.sensei.today.keepPosting(jobId);
    load();
  }

  const next = pickNextStep(today);
  const showQuestions = () => document.getElementById("today-questions-card")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return <section className="today bento-page">
    <header className="page-head page-head-compact"><div className="page-head-title"><h1>Today</h1><span className="muted">{date}{run ? ` · last search ${new Date(run.startedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}</span></div></header>

    <div className="bento">
      <div className="bento-row">
      {next && <BentoCard tone="hero" title="Do this next" className="today-hero">
        <NextStepBody step={next} busy={busyMatch !== null} onOpenJob={onOpenJob} onOpenMatch={onOpenMatch} onClose={closePosting} onKeep={keepPosting} onDraft={(id) => void matchAction(id, "draft")} onShowQuestions={showQuestions} />
      </BentoCard>}
      <div className={`kpi-stack${next ? "" : " is-row"}`}>
      {FEATURES.interviews && <Kpi value={due.interviewsThisWeek.length} label={due.interviewsThisWeek.length === 1 ? "Interview in the next 7 days" : "Interviews in the next 7 days"} actionLabel="Open Interviews" onAction={() => onGo("interviews")} />}
      {FEATURES.jobSearch && <Kpi value={today.search.newCount} label={today.search.newCount === 1 ? "New match" : "New matches"} actionLabel="Open Job Search" onAction={() => onGo("job-search")} />}
      {FEATURES.tune && tuneFiles !== null && <Kpi value={tuneFiles} label={tuneFiles === 1 ? "New file to tune" : "New files to tune"} actionLabel="Open Tune" onAction={onOpenTune} />}
      </div>
      </div>

      {/* Due, New matches, and For the coming days share one card with tabs in its header (U79). */}
      <BentoCard span={4} className="today-lists">
        <SubTabs<TodayList> idPrefix="today-lists" label="Today's lists" value={listTab} onChange={setListTab}
          tabs={[{ id: "due", label: "Due", count: dueCount }, ...(FEATURES.jobSearch ? [{ id: "matches" as const, label: "New matches", count: today.search.newCount }] : []), { id: "coming", label: "For the coming days", count: today.insights.length }]}
          actions={listTab === "matches" ? <button className="btn-link" onClick={() => onGo("job-search")}>Open Job Search</button> : undefined} />
        <SubTabPanel idPrefix="today-lists" value={listTab}>
          {listTab === "due" && <div id="today-due">
            {dueCount === 0 && <p className="muted">Nothing due.</p>}
          {due.interviewsThisWeek.length > 0 && <><h3>Interviews this week</h3><ul className="today-list">{due.interviewsThisWeek.map((entry) => <li key={`${entry.id}${entry.date}`}><span className="today-when">{dayLabel(entry.date)}</span> {jobLink(entry.id, entry.label)} <span className="muted">· {entry.round}</span></li>)}</ul></>}
          {due.followUps.length > 0 && <><h3>Follow-ups</h3><ul className="today-list">{due.followUps.map((entry) => <li key={entry.id}>{jobLink(entry.id, entry.label)} <span className="muted">· {entry.days ? `${entry.days} day${entry.days === 1 ? "" : "s"} overdue` : "today"}</span></li>)}</ul></>}
          {due.closedPostings.length > 0 && <><h3>Postings that closed</h3><ul className="today-list today-actionable">{due.closedPostings.map((entry) => { const label = [entry.company, entry.title].filter(Boolean).join(", ") || entry.jobId; return <li key={entry.jobId}>
            <span>{jobLink(entry.jobId, label)} <span className="muted">· gone since {entry.since}</span></span>
            <span className="today-actions"><button className="btn-link" onClick={() => void closePosting(entry.jobId, label)}>Mark closed</button><button className="btn-link" onClick={() => void keepPosting(entry.jobId)}>Keep</button></span>
          </li>; })}</ul></>}
          {due.stale.length > 0 && <><h3>No reply for a while</h3><ul className="today-list">{due.stale.map((entry) => <li key={entry.id}>{jobLink(entry.id, entry.label)} <span className="muted">· applied {entry.days} days ago</span></li>)}</ul></>}
          </div>}
          {listTab === "matches" && <div id="today-search">
          {today.search.top.length ? <ul className="today-list today-scored">{today.search.top.map((item) => { const score = item.agyFit?.score ?? item.fit.score; return <li key={item.id}>
            <FitRing rating={score} size={34} />
            <span><button className="find-title" title="Show this match in Job Search" onClick={() => onOpenMatch(item.id)}>{item.title ?? "Untitled role"}</button> <span className="muted">· {item.company ?? ""}{item.location ? ` · ${item.location}` : ""}</span></span>
            <span className="today-row-actions">
              <button className="btn-link" disabled={busyMatch !== null} onClick={() => void matchAction(item.id, "draft")}>Draft</button>
              <button className="btn-link" disabled={busyMatch !== null} onClick={() => void matchAction(item.id, "save")}>Save</button>
            </span>
          </li>; })}</ul> : <p className="muted">No new matches waiting.{run ? ` Last search found ${run.added}.` : ""}</p>}
          {today.search.newCount > today.search.top.length && <button className="btn-link" onClick={() => onGo("job-search")}>See all {today.search.newCount}</button>}
          </div>}
          {listTab === "coming" && <div id="today-insights">
            {today.insights.length === 0 && <p className="muted">Nothing to improve right now.</p>}
          <ul className="today-insights">{today.insights.map((insight, index) => <li key={index} className={`is-${insight.area}`}>
            <span className="today-area">{({ data: "Your data", interviews: "Interviews", resume: "Resume", search: "Search" } as const)[insight.area]}</span>
            <span className="today-insight-text">{insight.text}</span>
            {insight.action && <button className="btn-link" onClick={() => onGo(insight.action!.target)}>{insight.action.label}</button>}
          </li>)}</ul>
          </div>}
        </SubTabPanel>
      </BentoCard>


      {today.questions.length > 0 && <BentoCard span={2} id="today-questions-card" className="today-questions-card">
        <Section id="today-questions" title="Questions for you" count={today.questions.length} note="Each answer makes drafts, interview prep, or the search better. They stay until you answer or remove them.">
          <ul className="today-questions">{today.questions.map((question) => <QuestionCard key={question.id} question={question} onDone={(message, addedPath) => { onToast(message); if (addedPath) onAnswerAddedFile(addedPath); load(); }} />)}</ul>
        </Section>
      </BentoCard>}

      {(today.answers?.length ?? 0) > 0 && <BentoCard span={2}>
        <Section id="today-answers" title="Your answers" count={today.answers!.filter((answer) => answer.status === "pending").length || null} defaultOpen={false} note="Agy adds each answer to the right career record in the background; drafts and interview prep use it from there.">
          <ul className="today-list">{today.answers!.map((answer) => <li key={answer.id}><strong>{answer.subject}</strong> <span className="muted">· {answer.status === "pending" ? "waiting to be added" : answer.status === "filed" ? `added to ${(answer.filedTo ?? "").split("/").pop()?.replace(/\.md$/, "")}` : `not added: ${answer.note ?? "nothing to record"}`}</span></li>)}</ul>
        </Section>
      </BentoCard>}


      <BentoCard span={2}>
        <Section id="today-activity" title="Today's activity" count={activityCount} defaultOpen={false} note={activityCount ? null : "Nothing yet today."}>
          {activityCount > 0 && <div className="activity-chips" role="group" aria-label="Show activity">{([["all", activityCount], ["Added", activity.added.length], ["Applied", activity.applied.length], ["Drafted", activity.drafted.length], ["Interviews", activity.interviews.length]] as const).filter(([, count]) => count > 0).map(([kind, count]) => <button key={kind} className="filter-toggle" aria-pressed={activityKind === kind} onClick={() => setActivityKind(kind)}>{kind === "all" ? "All" : kind}<span>{count}</span></button>)}</div>}
          {([["Added", activity.added], ["Applied", activity.applied], ["Drafted", activity.drafted]] as const).filter(([title]) => activityKind === "all" || activityKind === title).map(([title, list]) => list.length > 0 && <div key={title}><h3>{title} <span className="muted">{list.length}</span></h3><ul className="today-list">{list.slice(0, 8).map((entry) => <li key={entry.id}>{jobLink(entry.id, entry.label)}</li>)}{list.length > 8 && <li><button className="btn-link" onClick={() => onGo("jobs")}>+{list.length - 8} more in Jobs</button></li>}</ul></div>)}
          {(activityKind === "all" || activityKind === "Interviews") && activity.interviews.length > 0 && <><h3>Interviews</h3><ul className="today-list">{activity.interviews.map((entry) => <li key={`${entry.id}${entry.round}`}>{jobLink(entry.id, entry.label)} <span className="muted">· {entry.round.replace("_", " ")}</span></li>)}</ul></>}
        </Section>
      </BentoCard>
    </div>
  </section>;
}

type TodayList = "due" | "matches" | "coming";
type ActivityKind = "all" | "Added" | "Applied" | "Drafted" | "Interviews";

const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** The hero's text and its one main action (U2: brass card, pine button). */
function NextStepBody({ step, busy, onOpenJob, onOpenMatch, onClose, onKeep, onDraft, onShowQuestions }: {
  step: NextStep;
  busy: boolean;
  onOpenJob: (jobId: string) => void;
  onOpenMatch: (id: string) => void;
  onClose: (jobId: string, label: string) => Promise<void>;
  onKeep: (jobId: string) => Promise<void>;
  onDraft: (id: string) => void;
  onShowQuestions: () => void;
}) {
  const body = (title: string, detail: string, actions: ReactNode) => <>
    <p className="today-hero-title">{title}</p>
    <p className="today-hero-detail">{detail}</p>
    <div className="today-hero-actions">{actions}</div>
  </>;
  switch (step.kind) {
    case "interview": return body(`${step.round.replace(/_/g, " ")} interview, ${dayLabel(step.date)}`, step.label, <button className="btn-primary" onClick={() => onOpenJob(step.jobId)}>Open the job</button>);
    case "follow-up": return body(`Follow up: ${step.label}`, step.days ? `${step.days} day${step.days === 1 ? "" : "s"} overdue` : "Due today", <button className="btn-primary" onClick={() => onOpenJob(step.jobId)}>Open the job</button>);
    case "closed": return body(`The posting closed: ${step.label}`, `Gone since ${step.since}`, <><button className="btn-primary" onClick={() => void onClose(step.jobId, step.label)}>Mark closed</button><button className="btn-link" onClick={() => void onKeep(step.jobId)}>Keep</button></>);
    case "question": return body(step.text, "One answer makes drafts, interview prep, or the search better.", <button className="btn-primary" onClick={onShowQuestions}>Answer it</button>);
    case "match": return body(step.company ? `${step.title} at ${step.company}` : step.title, `New match, fit ${step.score.toFixed(1)} of 5`, <><button className="btn-primary" disabled={busy} onClick={() => onDraft(step.matchId)}>Draft</button><button className="btn-link" onClick={() => onOpenMatch(step.matchId)}>Open in Job Search</button></>);
  }
}

function QuestionCard({ question, onDone }: { question: TodayQuestion; onDone: (message: string, addedPath: string | null) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  async function answer(value: string) {
    setBusy(true);
    setProblem("");
    try {
      const result = await window.sensei.today.answer(question.id, value);
      onDone(result.queued ? "Saved. Agy will add it to the right career record shortly." : "Saved.", result.addedPath);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason));
    } finally { setBusy(false); }
  }
  async function remove() {
    await window.sensei.today.removeQuestion(question.id);
    onDone("Removed.", null);
  }
  const asked = new Date(question.askedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const typed = question.kind === "skill" || question.kind === "search-title" || question.kind === "logistics";
  return <li className="today-question">
    <p className="today-question-text">{question.text}</p>
    <p className="today-question-why">{question.why} · asked {asked}</p>
    <div className="today-question-answer">
      {question.options.map((option) => <button key={option} className="btn-quiet btn-small" disabled={busy} onClick={() => void answer(option)}>{option}</button>)}
      {typed && <form className="today-inline" onSubmit={(event) => { event.preventDefault(); if (text.trim()) void answer(text); }}>
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder={question.kind === "skill" ? "Where and how you used it" : question.kind === "search-title" ? "A title to use instead" : "Your answer, in your words"} aria-label="Your answer" />
        <button className="btn-quiet btn-small" type="submit" disabled={busy || !text.trim()}>Save</button>
      </form>}
      <button className="btn-link today-remove" disabled={busy} onClick={() => void remove()}>Remove</button>
    </div>
    {problem && <p className="inline-error" role="alert">{problem}</p>}
  </li>;
}
