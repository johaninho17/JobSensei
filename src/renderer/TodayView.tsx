// Today: the app's main page. What the morning search found, today's activity, what's due, insights for the coming
// days, and questions whose answers make tailoring, interview prep, or the search better (src/shared/today.ts).
import { useEffect, useState } from "react";
import type { Insight, TodayData, TodayQuestion } from "../shared/today";
import { Section } from "./Section";

type Target = NonNullable<Insight["action"]>["target"];

export function TodayView({ onOpenJob, onGo, onToast, onAnswerAddedFile }: {
  onOpenJob: (jobId: string) => void;
  onGo: (target: Target) => void;
  onToast: (message: string) => void;
  /** A skill answer was saved as a career record; the app checks it for Agy. */
  onAnswerAddedFile: (path: string) => void;
}) {
  const [today, setToday] = useState<TodayData | null>(null);
  const [problem, setProblem] = useState("");
  const load = () => void window.sensei.today.get().then(setToday).catch((reason) => setProblem(reason instanceof Error ? reason.message : String(reason)));
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
  const jobLink = (id: string, text: string) => <button className="btn-link" onClick={() => onOpenJob(id)}>{text}</button>;

  async function closePosting(jobId: string, label: string) {
    await window.sensei.today.closePosting(jobId);
    onToast(`Marked ${label} as closed (posting closed).`);
    load();
  }
  async function keepPosting(jobId: string) {
    await window.sensei.today.keepPosting(jobId);
    load();
  }

  const insightsBlock = <Section id="today-insights" title="For the coming days" count={today.insights.length} note={today.insights.length ? null : "Nothing to improve right now."}>
    <ul className="today-insights">{today.insights.map((insight, index) => <li key={index} className={`is-${insight.area}`}>
      <span className="today-area">{({ data: "Your data", interviews: "Interviews", resume: "Resume", search: "Search" } as const)[insight.area]}</span>
      <span className="today-insight-text">{insight.text}</span>
      {insight.action && <button className="btn-link" onClick={() => onGo(insight.action!.target)}>{insight.action.label}</button>}
    </li>)}</ul>
  </Section>;

  return <section className="today">
    <header className="page-head"><div><h1>Today</h1><p>{date}{run ? ` · last search ${new Date(run.startedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}</p></div></header>

    <div className="today-grid">
      <div className="today-col">
        {today.questions.length > 0 && <Section id="today-questions" title="Questions for you" count={today.questions.length} note="Each answer makes drafts, interview prep, or the search better. They stay until you answer or remove them.">
          <ul className="today-questions">{today.questions.map((question) => <QuestionCard key={question.id} question={question} onDone={(message, addedPath) => { onToast(message); if (addedPath) onAnswerAddedFile(addedPath); load(); }} />)}</ul>
        </Section>}

        {(today.answers?.length ?? 0) > 0 && <Section id="today-answers" title="Your answers" count={today.answers!.filter((answer) => answer.status === "pending").length || null} defaultOpen={false} note="Agy adds each answer to the right career record in the background; drafts and interview prep use it from there.">
          <ul className="today-list">{today.answers!.map((answer) => <li key={answer.id}><strong>{answer.subject}</strong> <span className="muted">· {answer.status === "pending" ? "waiting to be added" : answer.status === "filed" ? `added to ${(answer.filedTo ?? "").split("/").pop()?.replace(/\.md$/, "")}` : `not added: ${answer.note ?? "nothing to record"}`}</span></li>)}</ul>
        </Section>}

        <Section id="today-search" title="New matches" count={today.search.newCount} actions={<button className="btn-link" onClick={() => onGo("job-search")}>Open Job Search</button>}>
          {today.search.top.length ? <ul className="today-list today-scored">{today.search.top.map((item) => { const score = item.agyFit?.score ?? item.fit.score; return <li key={item.id}>
            <span className={`fit-badge ${score >= 4 ? "is-high" : score >= 3 ? "is-mid" : "is-low"}`}>{score.toFixed(1)}</span>
            <span><strong>{item.title ?? "Untitled role"}</strong> <span className="muted">· {item.company ?? ""}{item.location ? ` · ${item.location}` : ""}</span></span>
          </li>; })}</ul> : <p className="muted">No new matches waiting.{run ? ` Last search found ${run.added}.` : ""}</p>}
          {today.search.newCount > today.search.top.length && <button className="btn-link" onClick={() => onGo("job-search")}>See all {today.search.newCount}</button>}
        </Section>

        <Section id="today-due" title="Due" count={dueCount} note={dueCount ? null : "Nothing due."}>
          {due.interviewsThisWeek.length > 0 && <><h3>Interviews this week</h3><ul className="today-list">{due.interviewsThisWeek.map((entry) => <li key={`${entry.id}${entry.date}`}><span className="today-when">{new Date(`${entry.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span> {jobLink(entry.id, entry.label)} <span className="muted">· {entry.round}</span></li>)}</ul></>}
          {due.followUps.length > 0 && <><h3>Follow-ups</h3><ul className="today-list">{due.followUps.map((entry) => <li key={entry.id}>{jobLink(entry.id, entry.label)} <span className="muted">· {entry.days ? `${entry.days} day${entry.days === 1 ? "" : "s"} overdue` : "today"}</span></li>)}</ul></>}
          {due.closedPostings.length > 0 && <><h3>Postings that closed</h3><ul className="today-list today-actionable">{due.closedPostings.map((entry) => { const label = [entry.company, entry.title].filter(Boolean).join(", ") || entry.jobId; return <li key={entry.jobId}>
            <span>{jobLink(entry.jobId, label)} <span className="muted">· gone since {entry.since}</span></span>
            <span className="today-actions"><button className="btn-link" onClick={() => void closePosting(entry.jobId, label)}>Mark closed</button><button className="btn-link" onClick={() => void keepPosting(entry.jobId)}>Keep</button></span>
          </li>; })}</ul></>}
          {due.stale.length > 0 && <><h3>No reply for a while</h3><ul className="today-list">{due.stale.map((entry) => <li key={entry.id}>{jobLink(entry.id, entry.label)} <span className="muted">· applied {entry.days} days ago</span></li>)}</ul></>}
        </Section>
      </div>

      <div className="today-col">
        {insightsBlock}
        <Section id="today-activity" title="Today's activity" count={activityCount} defaultOpen={false} note={activityCount ? null : "Nothing yet today."}>
          {([["Added", activity.added], ["Applied", activity.applied], ["Drafted", activity.drafted]] as const).map(([title, list]) => list.length > 0 && <div key={title}><h3>{title} <span className="muted">{list.length}</span></h3><ul className="today-list">{list.slice(0, 8).map((entry) => <li key={entry.id}>{jobLink(entry.id, entry.label)}</li>)}{list.length > 8 && <li><button className="btn-link" onClick={() => onGo("jobs")}>+{list.length - 8} more in Jobs</button></li>}</ul></div>)}
          {activity.interviews.length > 0 && <><h3>Interviews</h3><ul className="today-list">{activity.interviews.map((entry) => <li key={`${entry.id}${entry.round}`}>{jobLink(entry.id, entry.label)} <span className="muted">· {entry.round.replace("_", " ")}</span></li>)}</ul></>}
        </Section>
      </div>
    </div>
  </section>;
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
