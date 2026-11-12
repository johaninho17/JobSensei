import { z } from "zod";
import type { InboxItem, JobSearchState, SearchRun } from "./job-search";
import type { JobFolderSummary } from "./schemas";
import { effectiveStatus, followUpDays } from "./tracker";

/**
 * The Today page: what happened, what's due, what to improve, and questions that would make tailoring, interview prep,
 * or the search better. Everything here is computed by the app from the user's own data (no Agy).
 */

export const TODAY_QUESTION_KINDS = ["skill", "outcome", "search-title", "logistics"] as const;

export const todayQuestionSchema = z.object({
  /** Stable key, so an answered or removed question never comes back and an open one is never duplicated. */
  id: z.string(),
  kind: z.enum(TODAY_QUESTION_KINDS),
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
export type TodayQuestion = z.infer<typeof todayQuestionSchema>;
export const todayQuestionsSchema = z.object({ questions: z.array(todayQuestionSchema).default([]) });

export type ClosedPosting = { jobId: string; company: string | null; title: string | null; since: string };

export type Insight = { area: "data" | "interviews" | "resume" | "search"; text: string; action: { label: string; target: "setup" | "jobs" | "job-search" | "interviews" | "learnings" | "context" } | null };

export type TodayData = {
  date: string;
  search: { lastRun: SearchRun | null; newCount: number; top: Array<Pick<InboxItem, "id" | "title" | "company" | "location" | "fit" | "agyFit">> };
  activity: { added: Array<{ id: string; label: string }>; applied: Array<{ id: string; label: string }>; drafted: Array<{ id: string; label: string }>; interviews: Array<{ id: string; label: string; round: string }> };
  due: { followUps: Array<{ id: string; label: string; days: number }>; interviewsThisWeek: Array<{ id: string; label: string; date: string; round: string }>; closedPostings: ClosedPosting[]; stale: Array<{ id: string; label: string; days: number }> };
  insights: Insight[];
  questions: TodayQuestion[];
  /** Recent answers to Today questions and where Agy filed them (newest first; pending ones wait for the background run). */
  answers?: Array<{ id: string; subject: string; status: "pending" | "filed" | "skipped"; filedTo: string | null; note: string | null; answeredAt: string }>;
};

const label = (job: Pick<JobFolderSummary, "company" | "title" | "name">) => [job.company ?? job.name, job.title].filter(Boolean).join(", ");
const day = (iso: string | null | undefined) => (iso ?? "").slice(0, 10);

/** Light rating vs the full rating for found jobs that were drafted: how well the quick score predicts. */
export function ratingAccuracy(pairs: Array<{ light: number; full: number }>): { count: number; averageGap: number; lightHigher: number } | null {
  if (pairs.length < 3) return null;
  const gaps = pairs.map((pair) => pair.light - pair.full);
  return { count: pairs.length, averageGap: Math.round((gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) * 10) / 10, lightHigher: gaps.filter((gap) => gap > 0.3).length };
}

/** Questions worth asking, from real gaps only. Days with no gap ask nothing. */
export function candidateQuestions(input: {
  jobs: JobFolderSummary[];
  gapTerms: Array<{ term: string; noInterview: number; interviewed: number }>;
  knownTerms: (term: string) => boolean;
  searchTitlesWithoutMatches: string[];
  blankLogistics: string[];
  hasUpcomingInterview: boolean;
  now: Date;
}): Array<Omit<TodayQuestion, "askedAt" | "status" | "answer" | "answeredAt">> {
  const out: Array<Omit<TodayQuestion, "askedAt" | "status" | "answer" | "answeredAt">> = [];
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
export function mergeQuestions(stored: TodayQuestion[], fresh: ReturnType<typeof candidateQuestions>, now: Date): TodayQuestion[] {
  const known = new Set(stored.map((question) => question.id));
  return [...stored, ...fresh.filter((question) => !known.has(question.id)).map((question) => ({ ...question, askedAt: now.toISOString(), status: "open" as const, answer: null, answeredAt: null }))];
}

export function buildToday(input: {
  jobs: JobFolderSummary[];
  search: JobSearchState | null;
  closedPostings: ClosedPosting[];
  interviewDates: Array<{ jobId: string; date: string; round: string }>;
  insights: Insight[];
  questions: TodayQuestion[];
  now: Date;
}): TodayData {
  const today = day(input.now.toISOString());
  const byId = new Map(input.jobs.map((job) => [job.id, job]));
  const weekAhead = new Date(input.now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const items = (input.search?.items ?? []).filter((item) => item.status === "new");
  const changedToday = (job: JobFolderSummary, status: string) => (job.tracker?.history ?? []).some((entry) => entry.status === status && day(entry.at) === today);
  return {
    date: today,
    search: {
      lastRun: input.search?.runs.at(-1) ?? null,
      newCount: items.length,
      top: [...items].sort((a, b) => (b.agyFit?.score ?? b.fit.score) - (a.agyFit?.score ?? a.fit.score)).slice(0, 5).map(({ id, title, company, location, fit, agyFit }) => ({ id, title, company, location, fit, agyFit })),
    },
    activity: {
      added: input.jobs.filter((job) => day(job.createdAt) === today).map((job) => ({ id: job.id, label: label(job) })),
      applied: input.jobs.filter((job) => job.tracker?.appliedAt === today || changedToday(job, "applied")).map((job) => ({ id: job.id, label: label(job) })),
      drafted: input.jobs.filter((job) => job.hasApplicationMaterials && day(job.modifiedAt) === today && day(job.createdAt) === today).map((job) => ({ id: job.id, label: label(job) })),
      interviews: input.jobs.flatMap((job) => (job.tracker?.interviews ?? []).filter((event) => event.date === today).map((event) => ({ id: job.id, label: label(job), round: event.round }))),
    },
    due: {
      followUps: input.jobs.map((job) => ({ job, days: followUpDays(job.tracker, input.now) })).filter((entry): entry is { job: JobFolderSummary; days: number } => entry.days !== null && entry.days <= 0 && !["rejected", "withdrawn"].includes(effectiveStatus(entry.job))).map((entry) => ({ id: entry.job.id, label: label(entry.job), days: -entry.days })),
      interviewsThisWeek: input.interviewDates.filter((entry) => entry.date >= today && entry.date <= weekAhead && byId.has(entry.jobId)).map((entry) => ({ id: entry.jobId, label: label(byId.get(entry.jobId)!), date: entry.date, round: entry.round })).sort((a, b) => a.date.localeCompare(b.date)),
      closedPostings: input.closedPostings.filter((posting) => byId.has(posting.jobId) && !["rejected", "withdrawn"].includes(effectiveStatus(byId.get(posting.jobId)!))),
      // Jobs with a follow-up date are covered by Follow-ups.
      stale: input.jobs.filter((job) => effectiveStatus(job) === "applied" && job.tracker?.appliedAt && !job.tracker.nextFollowUpAt).map((job) => ({ id: job.id, label: label(job), days: Math.floor((input.now.getTime() - Date.parse(job.tracker!.appliedAt!)) / 86_400_000) })).filter((entry) => entry.days >= 30).sort((a, b) => b.days - a.days).slice(0, 5),
    },
    insights: input.insights,
    questions: input.questions.filter((question) => question.status === "open"),
  };
}
