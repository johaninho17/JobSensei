// The one "Do this next" step on Today (ledger U77, #126): picked from Today's own data, in a fixed order. The view
// only shows it; nothing here reads files or changes state.
import type { TodayData } from "./today";

export type NextStep =
  | { kind: "interview"; jobId: string; label: string; round: string; date: string }
  | { kind: "follow-up"; jobId: string; label: string; days: number }
  | { kind: "closed"; jobId: string; label: string; since: string }
  | { kind: "question"; questionId: string; text: string }
  | { kind: "match"; matchId: string; title: string; company: string | null; score: number };

/** An interview this week → a follow-up due (most overdue) → a posting that closed → an open question → the best new
 * match. Null when there is nothing to do. */
export function pickNextStep(today: Pick<TodayData, "due" | "questions" | "search">): NextStep | null {
  const interview = [...today.due.interviewsThisWeek].sort((a, b) => a.date.localeCompare(b.date))[0];
  if (interview) return { kind: "interview", jobId: interview.id, label: interview.label, round: interview.round, date: interview.date };
  const followUp = [...today.due.followUps].sort((a, b) => b.days - a.days)[0];
  if (followUp) return { kind: "follow-up", jobId: followUp.id, label: followUp.label, days: followUp.days };
  const closed = today.due.closedPostings[0];
  if (closed) return { kind: "closed", jobId: closed.jobId, label: [closed.company, closed.title].filter(Boolean).join(", ") || closed.jobId, since: closed.since };
  const question = today.questions[0];
  if (question) return { kind: "question", questionId: question.id, text: question.text };
  const match = [...today.search.top].map((item) => ({ item, score: item.agyFit?.score ?? item.fit.score })).sort((a, b) => b.score - a.score)[0];
  if (match) return { kind: "match", matchId: match.item.id, title: match.item.title ?? "Untitled role", company: match.item.company ?? null, score: match.score };
  return null;
}
