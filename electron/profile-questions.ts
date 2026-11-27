import { join } from "node:path";
import type { CandidateProfile, JobFolderSummary } from "../src/shared/schemas";
import { computeLearnings, furthestRecordedStage } from "../src/shared/learnings";
import { readLogistics } from "../src/shared/profile-fields";
import { effectiveStatus } from "../src/shared/tracker";
import { candidateQuestions, mergeQuestions, questionsSchema, type CareerQuestion, type QuestionsView } from "../src/shared/profile-questions";
import { queueAnswer, readAnswerInbox } from "./answer-filing";
import { updateCandidateProfileDetails } from "./candidate-profile";
import { assertInsideWorkspace } from "./files";
import { fitsSearchTitles } from "./job-boards";
import { loadVocabulary, readSearchSettings, readSearchState } from "./job-search";
import { readJson, writeJsonAtomic } from "./persistence";
import { updateJobTracker } from "./tracker";

/**
 * Questions for you (shown on the Profile page) and their answers. Questions are computed from the user's own files;
 * a skill answer is filed into the matching career record by Agy in the background (electron/answer-filing.ts).
 * The file names predate the Profile move and are kept so existing workspaces keep their questions and answers.
 */

const QUESTIONS_FILE = ".sensei/today-questions.json";

const path = (workspace: string, relative: string) => assertInsideWorkspace(workspace, join(workspace, relative));
const day = (date: Date) => date.toISOString().slice(0, 10);


async function readQuestions(workspace: string): Promise<CareerQuestion[]> {
  const parsed = questionsSchema.safeParse(await readJson<unknown>(path(workspace, QUESTIONS_FILE)));
  return parsed.success ? parsed.data.questions : [];
}
const saveQuestions = (workspace: string, questions: CareerQuestion[]) => writeJsonAtomic(path(workspace, QUESTIONS_FILE), { questions });

/** Scheduled interview dates from each job's interview plan. */
async function interviewDates(workspace: string, jobs: JobFolderSummary[]): Promise<string[]> {
  const out: string[] = [];
  for (const job of jobs.filter((candidate) => candidate.interviewRoundLabel)) {
    const interview = await readJson<{ rounds?: Array<{ scheduledDate?: string | null }> }>(path(workspace, `jobs/${job.id}/interviews/interview.json`));
    for (const round of interview?.rounds ?? []) if (round.scheduledDate && /^\d{4}-\d{2}-\d{2}/.test(round.scheduledDate)) out.push(round.scheduledDate.slice(0, 10));
  }
  return out;
}

/**
 * Adds questions for new real gaps (never one already asked, answered, or removed) and returns the open ones with recent
 * answers. Asks nothing when the user turned questions off (Settings → Interactive clarifying questions).
 */
export async function refreshQuestions(workspace: string, input: { jobs: JobFolderSummary[]; profile: CandidateProfile | null; now?: Date }): Promise<QuestionsView> {
  const now = input.now ?? new Date();
  let questions = await readQuestions(workspace);
  if (input.profile?.preferences.voice.interactiveQuestions === "never") {
    questions = [];
  } else {
    const [search, settings, dates, vocab] = await Promise.all([
      readSearchState(workspace), readSearchSettings(workspace, input.profile), interviewDates(workspace, input.jobs), loadVocabulary(workspace, input.profile),
    ]);
    const knownTerms = (term: string) => new RegExp(`(?:^|[^a-z0-9])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(vocab.text);
    const recentRuns = search.runs.filter((run) => run.status === "done" && run.source === "search").slice(-3);
    const recentItems = search.items.filter((item) => recentRuns.some((run) => run.id === item.runId));
    const logistics = readLogistics(input.profile);
    const fresh = candidateQuestions({
      jobs: input.jobs,
      gapTerms: computeLearnings(input.jobs).gapTerms,
      knownTerms,
      searchTitlesWithoutMatches: recentRuns.length >= 3 ? settings.titles.filter((title) => !recentItems.some((item) => item.title && fitsSearchTitles(item.title, [title]))) : [],
      blankLogistics: (Object.keys(logistics) as Array<keyof typeof logistics>).filter((key) => !logistics[key].trim()),
      hasUpcomingInterview: dates.some((date) => date >= day(now)) || input.jobs.some((job) => effectiveStatus(job) === "interviewing" && furthestRecordedStage(job) !== null),
      now,
    });
    const merged = mergeQuestions(questions, fresh, now);
    if (merged.length !== questions.length) await saveQuestions(workspace, merged);
    questions = merged;
  }
  const answers = (await readAnswerInbox(workspace).catch(() => [])).filter((answer) => answer.status === "pending" || Date.parse(answer.filedAt ?? answer.answeredAt) > now.getTime() - 7 * 86_400_000)
    .sort((a, b) => b.answeredAt.localeCompare(a.answeredAt)).slice(0, 6)
    .map(({ id, subject, status, filedTo, note, answeredAt }) => ({ id, subject, status, filedTo, note, answeredAt }));
  return { questions: questions.filter((question) => question.status === "open"), answers };
}

/** Answers a question: the answer goes to its owner (career record, tracker, search settings, profile). */
export async function answerQuestion(workspace: string, id: string, answer: string, now = new Date()): Promise<{ queued: boolean }> {
  const questions = await readQuestions(workspace);
  const question = questions.find((candidate) => candidate.id === id && candidate.status === "open");
  if (!question) throw new Error("That question was already answered or removed.");
  const text = answer.trim();
  if (!text) throw new Error("Write an answer, or remove the question.");
  if (question.kind === "skill") {
    // Filed into the matching career record by Agy in the background (electron/answer-filing.ts), never read raw by drafts.
    await queueAnswer(workspace, { subject: question.subject, question: question.text, answer: text }, now);
  } else if (question.kind === "outcome") {
    const result = { Rejected: "rejected", Offer: "offer", "I withdrew": "withdrew" }[text] as "rejected" | "offer" | "withdrew" | undefined;
    if (result) {
      const status = result === "offer" ? "offer" : result === "withdrew" ? "withdrawn" : "rejected";
      await updateJobTracker(workspace, question.subject, { status, outcome: { stageReached: null, result, reason: "", date: day(now) } }, now);
    }
  } else if (question.kind === "search-title") {
    if (text !== "Keep it") {
      const settings = await readSearchSettings(workspace, null);
      await writeJsonAtomic(path(workspace, ".sensei/job-search/settings.json"), { ...settings, titles: settings.titles.map((title) => title === question.subject ? text : title) });
    }
  } else if (question.kind === "logistics") {
    await updateCandidateProfileDetails(workspace, { interviewLogistics: { [question.subject]: text } });
  }
  await saveQuestions(workspace, questions.map((candidate) => candidate.id === id ? { ...candidate, status: "answered" as const, answer: text, answeredAt: now.toISOString() } : candidate));
  return { queued: question.kind === "skill" };
}

export async function removeQuestion(workspace: string, id: string): Promise<void> {
  const questions = await readQuestions(workspace);
  await saveQuestions(workspace, questions.map((candidate) => candidate.id === id ? { ...candidate, status: "removed" as const } : candidate));
}

/** Adds one question from elsewhere in the app (data analysis, #200), unless a question with that ID was ever asked. */
export async function addQuestion(workspace: string, question: Omit<CareerQuestion, "askedAt" | "status" | "answer" | "answeredAt">, now = new Date()): Promise<void> {
  const questions = await readQuestions(workspace);
  const merged = mergeQuestions(questions, [question], now);
  if (merged.length !== questions.length) await saveQuestions(workspace, merged);
}
