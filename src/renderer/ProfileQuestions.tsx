// Questions for you, on the Profile page: asked only from real gaps (src/shared/profile-questions.ts). Nothing shows
// when no question is open. Skill answers are filed into the matching career record by Agy (electron/answer-filing.ts).
import { useEffect, useState } from "react";
import type { CareerQuestion, QuestionsView } from "../shared/profile-questions";

export function ProfileQuestions({ onToast }: { onToast: (message: string) => void }) {
  const [view, setView] = useState<QuestionsView | null>(null);
  const load = () => void window.sensei.profileQuestions.get().then(setView).catch(() => setView(null));
  useEffect(() => { load(); return window.sensei.profileQuestions.onChanged(load); }, []);
  const pending = view?.answers.filter((answer) => answer.status === "pending").length ?? 0;
  if (!view || (!view.questions.length && !pending)) return null;
  return <section className="context-block profile-questions" aria-labelledby="profile-questions-title">
    <h2 id="profile-questions-title">Questions for you</h2>
    {view.questions.length > 0 && <ul className="pq-list">{view.questions.map((question) => <QuestionRow key={question.id} question={question} onDone={(message) => { onToast(message); load(); }} />)}</ul>}
    {pending > 0 && <p className="muted pq-pending">{pending === 1 ? "1 answer is" : `${pending} answers are`} waiting for Agy to add to your career records.</p>}
  </section>;
}

function QuestionRow({ question, onDone }: { question: CareerQuestion; onDone: (message: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  async function answer(value: string) {
    setBusy(true);
    setProblem("");
    try {
      const result = await window.sensei.profileQuestions.answer(question.id, value);
      onDone(result.queued ? "Saved. Agy will add it to the matching career record." : "Saved.");
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason));
    } finally { setBusy(false); }
  }
  async function remove() {
    await window.sensei.profileQuestions.remove(question.id);
    onDone("Question removed.");
  }
  const typed = question.kind === "skill" || question.kind === "search-title" || question.kind === "logistics";
  return <li className="pq-item">
    <p className="pq-text" title={question.why}>{question.text}</p>
    <div className="pq-answer">
      {question.options.map((option) => <button key={option} className="btn-quiet btn-small" disabled={busy} onClick={() => void answer(option)}>{option}</button>)}
      {typed && <form className="pq-inline" onSubmit={(event) => { event.preventDefault(); if (text.trim()) void answer(text); }}>
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder={question.kind === "skill" ? "Where and how you used it" : question.kind === "search-title" ? "A title to use instead" : "Your answer, in your words"} aria-label="Your answer" />
        <button className="btn-quiet btn-small" type="submit" disabled={busy || !text.trim()}>Save</button>
      </form>}
      <button className="btn-link pq-remove" disabled={busy} onClick={() => void remove()}>Remove</button>
    </div>
    {problem && <p className="inline-error" role="alert">{problem}</p>}
  </li>;
}
