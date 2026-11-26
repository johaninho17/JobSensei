import { z } from "zod";
import type { JobFolderSummary } from "./schemas";
import { effectiveStatus } from "./tracker";

/**
 * Questions for you (Profile page): asked only from real gaps in the user's own data, kept until answered or removed.
 * Answers go to their owner: career records (filed by Agy, electron/answer-filing.ts), the tracker, search settings, or
 * the profile's interview logistics (electron/questions.ts).
 */

export const QUESTION_KINDS = ["skill", "outcome", "search-title", "logistics"] as const;

export const questionSchema = z.object({
  /** Stable key, so an answered or removed question never comes back and an open one is never duplicated. */
  id: z.string(),
  kind: z.enum(QUESTION_KINDS),
  text: z.string(),
  /** Why it's asked (what the answer improves). */
  why: z.string(),
  /** Buttons for one-click answers; empty means a typed answer. */
  options: z.array(z.string()).default([]),
  /** What the answer updates (a skill term, a job ID, a search title, a logistics field). */
  subject: z.string(),
  askedAt: z.string(),
  status: z.enum(["open", "answered", "removed"]).default("open"),
  answer: z.string().nullable().default(null),
  answeredAt: z.string().nullable().default(null),
});
export type CareerQuestion = z.infer<typeof questionSchema>;
export const questionsSchema = z.object({ questions: z.array(questionSchema).default([]) });

export type QuestionsView = {
  questions: CareerQuestion[];
  /** Recent answers and where Agy filed them (newest first; pending ones wait for the background run). */
  answers: Array<{ id: string; subject: string; status: "pending" | "filed" | "skipped"; filedTo: string | null; note: string | null; answeredAt: string }>;
};

const label = (job: Pick<JobFolderSummary, "company" | "title" | "name">) => [job.company ?? job.name, job.title].filter(Boolean).join(", ");

/** Questions worth asking, from real gaps only. Days with no gap ask nothing. */
export function candidateQuestions(input: {
  jobs: JobFolderSummary[];
  gapTerms: Array<{ term: string; noInterview: number; interviewed: number }>;
  knownTerms: (term: string) => boolean;
  searchTitlesWithoutMatches: string[];
  blankLogistics: string[];
  hasUpcomingInterview: boolean;
  now: Date;
}): Array<Omit<CareerQuestion, "askedAt" | "status" | "answer" | "answeredAt">> {
  const out: Array<Omit<CareerQuestion, "askedAt" | "status" | "answer" | "answeredAt">> = [];
  // 1. A tool that keeps showing up as a gap, with nothing in the user's files: maybe they've used it.
  for (const gap of input.gapTerms.filter((term) => term.noInterview + term.interviewed >= 3 && !input.knownTerms(term.term)).slice(0, 2)) {
    out.push({ id: `skill:${gap.term.toLowerCase()}`, kind: "skill", subject: gap.term, options: [],
      text: `${gap.term} came up as a gap in ${gap.noInterview + gap.interviewed} of your jobs. Have you used it? Say where and how in a sentence or two, or remove this if you haven't.`,
      why: "A real answer becomes career evidence, so drafts and interview prep can use it." });
  }
  // 2. An interview recorded weeks ago with no outcome: what happened?
  for (const job of input.jobs) {
    const events = job.tracker?.interviews ?? [];
    const last = events.map((event) => event.date).filter(Boolean).sort().at(-1);
    if (!events.length || job.tracker?.outcome || !last || effectiveStatus(job) !== "interviewing") continue;
    const days = Math.floor((input.now.getTime() - Date.parse(last)) / 86_400_000);
    if (days < 14) continue;
    out.push({ id: `outcome:${job.id}`, kind: "outcome", subject: job.id, options: ["Still in process", "Rejected", "Offer", "I withdrew"],
      text: `What happened with ${label(job)}? Your last recorded interview was ${days} days ago.`,
      why: "Outcomes teach Learnings and the search which jobs fit you." });
  }
  // 3. A search title that found nothing in recent searches.
  for (const title of input.searchTitlesWithoutMatches.slice(0, 1)) {
    out.push({ id: `search-title:${title.toLowerCase()}`, kind: "search-title", subject: title, options: ["Keep it"],
      text: `"${title}" found nothing in your last searches. Keep it, or type a title to use instead.`,
      why: "Titles that match how companies post find more jobs." });
  }
  // 4. Logistics missing while an interview is coming up (prep never guesses them, I11).
  if (input.hasUpcomingInterview) {
    for (const field of input.blankLogistics.slice(0, 1)) {
      const name = { compensation: "your pay expectation", noticePeriod: "your notice period or start date", workAuthorization: "your work authorization", location: "where you're based", workArrangement: "the work setup you want" }[field] ?? field;
      out.push({ id: `logistics:${field}`, kind: "logistics", subject: field, options: [],
        text: `You have an interview coming up. What's ${name}? Interview prep uses your words exactly.`,
        why: "Prep leaves logistics blank rather than guessing them." });
    }
  }
  return out;
}

/** Keeps open questions across days, adds new ones once, and never brings back answered or removed ones. */
export function mergeQuestions(stored: CareerQuestion[], fresh: ReturnType<typeof candidateQuestions>, now: Date): CareerQuestion[] {
  const known = new Set(stored.map((question) => question.id));
  return [...stored, ...fresh.filter((question) => !known.has(question.id)).map((question) => ({ ...question, askedAt: now.toISOString(), status: "open" as const, answer: null, answeredAt: null }))];
}
