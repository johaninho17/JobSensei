import { appendFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CandidateProfile, JobFolderSummary } from "../src/shared/schemas";
import { canonicalUrl } from "../src/shared/job-search";
import { boardKey, boardRef, type BoardRef } from "../src/shared/boards";
import { computeLearnings, furthestRecordedStage } from "../src/shared/learnings";
import { readLogistics } from "../src/shared/profile-fields";
import { effectiveStatus } from "../src/shared/tracker";
import {
  buildToday, candidateQuestions, mergeQuestions, ratingAccuracy, todayQuestionsSchema,
  type ClosedPosting, type Insight, type TodayData, type TodayQuestion,
} from "../src/shared/today";
import { assertInsideWorkspace } from "./files";
import { listBoardJobs, fitsSearchTitles, type BoardJob } from "./job-boards";
import { loadVocabulary, readSearchSettings, readSearchState } from "./job-search";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persistence";
import { updateCandidateProfileDetails } from "./candidate-profile";
import { updateJobTracker } from "./tracker";
import { parseInterviewVoice } from "./interview-context";

/**
 * The Today page's data, the closed-posting check, Today questions and their answers, and the morning summary the
 * scheduled search writes. All computed from the user's own files; nothing here calls Agy.
 */

const CLOSED_FILE = ".sensei/closed-postings.json";
const QUESTIONS_FILE = ".sensei/today-questions.json";
const SUMMARY_FILE = ".sensei/today.json";
export const ANSWERS_FILE = "context/structured/answers-from-today.md";

const path = (workspace: string, relative: string) => assertInsideWorkspace(workspace, join(workspace, relative));
const day = (date: Date) => date.toISOString().slice(0, 10);

// ---------- Closed postings (C1) ----------

type ClosedState = { checkedAt: string | null; closed: ClosedPosting[]; kept: string[] };

export async function readClosedPostings(workspace: string): Promise<ClosedState> {
  const stored = await readJson<ClosedState>(path(workspace, CLOSED_FILE));
  return { checkedAt: stored?.checkedAt ?? null, closed: stored?.closed ?? [], kept: stored?.kept ?? [] };
}

/**
 * Saved, applied, and interviewing jobs whose posting is on Ashby, Greenhouse, or Lever: a job no longer on its
 * company's live list is "posting closed", for the user to confirm. Each board is read once; at most once a day.
 */
export async function checkClosedPostings(workspace: string, jobs: JobFolderSummary[], options: { fetcher?: typeof fetch; now?: Date; force?: boolean } = {}): Promise<ClosedState> {
  const now = options.now ?? new Date();
  const state = await readClosedPostings(workspace);
  if (!options.force && state.checkedAt?.slice(0, 10) === day(now)) return state;
  const open = jobs.filter((job) => ["saved", "applied", "interviewing"].includes(effectiveStatus(job)) && !state.kept.includes(job.id));
  const boards = new Map<string, Promise<BoardJob[] | null>>();
  const closed: ClosedPosting[] = [];
  for (const job of open) {
    const url = (await readJson<{ url?: string | null }>(path(workspace, `jobs/${job.id}/.sensei/posting.json`)))?.url;
    const ref: BoardRef | null = url ? boardRef(url) : null;
    if (!url || !ref) continue;
    const key = boardKey(ref);
    if (!boards.has(key)) boards.set(key, listBoardJobs(ref, options.fetcher).catch(() => null));
    const live = await boards.get(key)!;
    if (!live) continue; // A board we couldn't read says nothing about the posting.
    const target = canonicalUrl(url).toLowerCase();
    const id = target.split("/").filter(Boolean).at(-1) ?? "";
    const listed = live.some((posting) => canonicalUrl(posting.url).toLowerCase() === target || (id.length > 5 && canonicalUrl(posting.url).toLowerCase().includes(id)));
    if (!listed) closed.push({ jobId: job.id, company: job.company, title: job.title, since: state.closed.find((entry) => entry.jobId === job.id)?.since ?? day(now) });
  }
  const next = { checkedAt: now.toISOString(), closed, kept: state.kept };
  await writeJsonAtomic(path(workspace, CLOSED_FILE), next);
  return next;
}

/** The user keeps a job whose posting looked closed (it isn't checked again). */
export async function keepPosting(workspace: string, jobId: string): Promise<void> {
  const state = await readClosedPostings(workspace);
  await writeJsonAtomic(path(workspace, CLOSED_FILE), { ...state, closed: state.closed.filter((entry) => entry.jobId !== jobId), kept: [...new Set([...state.kept, jobId])] });
}

// ---------- Questions ----------

async function readQuestions(workspace: string): Promise<TodayQuestion[]> {
  const parsed = todayQuestionsSchema.safeParse(await readJson<unknown>(path(workspace, QUESTIONS_FILE)));
  return parsed.success ? parsed.data.questions : [];
}
const saveQuestions = (workspace: string, questions: TodayQuestion[]) => writeJsonAtomic(path(workspace, QUESTIONS_FILE), { questions });

/** Answers a Today question: the answer goes to its owner (career record, tracker, search settings, profile). */
export async function answerQuestion(workspace: string, id: string, answer: string, now = new Date()): Promise<{ addedPath: string | null }> {
  const questions = await readQuestions(workspace);
  const question = questions.find((candidate) => candidate.id === id && candidate.status === "open");
  if (!question) throw new Error("That question was already answered or removed.");
  const text = answer.trim();
  if (!text) throw new Error("Write an answer, or remove the question.");
  let addedPath: string | null = null;
  if (question.kind === "skill") {
    addedPath = await addAnswerEvidence(workspace, question.subject, text, now);
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
  return { addedPath };
}

export async function removeQuestion(workspace: string, id: string): Promise<void> {
  const questions = await readQuestions(workspace);
  await saveQuestions(workspace, questions.map((candidate) => candidate.id === id ? { ...candidate, status: "removed" as const } : candidate));
}

/**
 * A skill answer becomes a career record row (the user's own first-hand statement, dated), in the same table format as
 * other structured evidence, so the snapshot can route it like any work record.
 */
async function addAnswerEvidence(workspace: string, term: string, answer: string, now: Date): Promise<string> {
  const file = path(workspace, ANSWERS_FILE);
  if (!(await stat(file).catch(() => null))) {
    await writeTextAtomic(file, [
      "# Evidence: Answers to Today questions",
      "",
      "- source_path: `context/structured/answers-from-today.md`",
      "- source_family: `today-answers`",
      "- source_role: candidate-confirmed-work-record",
      "- confidence: high",
      "- source_locator: Evidence table rows keyed by Evidence ID",
      "",
      "Each row is the candidate's own answer to a question JobSensei asked on the Today page, in their words.",
      "",
      "## Evidence Inventory",
      "",
      "| Evidence ID | Year | Project | Explicit claim | Scope note | Source locator | Confidence | Public use |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "",
    ].join("\n"));
  }
  const slug = term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "answer";
  const cell = (value: string) => value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
  const existing = await readFile(file, "utf8");
  let id = `context:today-answers:${slug}`;
  for (let n = 2; existing.includes(`| ${id} |`); n += 1) id = `context:today-answers:${slug}-${n}`;
  await appendFile(file, `| ${id} | ${now.getFullYear()} | ${cell(term)} | ${cell(answer)} | The candidate's own answer on ${day(now)}; scope as stated. | Today question ${day(now)} | high | eligible |\n`);
  return ANSWERS_FILE;
}

// ---------- Insights ----------

function insightsFor(input: { jobs: JobFolderSummary[]; readiness: { ready: boolean; done: number; total: number } | null; deliveryFixes: string[]; accuracy: ReturnType<typeof ratingAccuracy>; scheduleOn: boolean; searchTitles: number; knownTerms: (term: string) => boolean }): Insight[] {
  const learn = computeLearnings(input.jobs);
  const out: Insight[] = [];
  if (input.readiness && input.readiness.done < input.readiness.total) out.push({ area: "data", text: `Setup is ${input.readiness.done} of ${input.readiness.total}. The missing steps improve drafts and interview prep.`, action: { label: "Open Setup", target: "setup" } });
  if (learn.unrecorded > 0) out.push({ area: "data", text: `${learn.unrecorded} job${learn.unrecorded === 1 ? " has" : "s have"} interview prep but no recorded interview or outcome, so Learnings can't count ${learn.unrecorded === 1 ? "it" : "them"}.`, action: { label: "See interviews", target: "interviews" } });
  // The fix itself, without the tracker's "Now / Aim / Status" notes.
  const fix = input.deliveryFixes[0]?.split(/\s+—\s+|\s+-\s+Now:/)[0]?.replace(/[.:\s]+$/, "");
  if (fix) out.push({ area: "interviews", text: `Your top delivery fix to practice: ${fix}.`, action: { label: "See Learnings", target: "learnings" } });
  // Only gaps the user's own files don't already cover.
  const recurring = learn.gapTerms.filter((term) => term.noInterview >= 2 && !input.knownTerms(term.term)).slice(0, 3);
  if (recurring.length) out.push({ area: "resume", text: `Gaps that keep showing up in applications without interviews: ${recurring.map((term) => term.term).join(", ")}. Real experience with any of them is worth adding to your career files.`, action: { label: "Open career context", target: "context" } });
  const recentHigh = input.jobs.filter((job) => job.stretch?.level === "high" && Date.now() - Date.parse(job.modifiedAt) < 14 * 86_400_000).length;
  if (recentHigh >= 2) out.push({ area: "resume", text: `${recentHigh} recent drafts stretch past your evidence. Adding the missing experience to your career files makes them stronger without stretching.`, action: { label: "Open Jobs", target: "jobs" } });
  if (input.accuracy) {
    const gap = input.accuracy.averageGap;
    const text = gap > 0.3 ? `Agy's quick rating runs about ${gap} points higher than the full rating (${input.accuracy.count} jobs). Consider raising your bar.`
      : gap < -0.3 ? `Agy's quick rating runs about ${Math.abs(gap)} points lower than the full rating (${input.accuracy.count} jobs). Your bar may be hiding good matches; consider lowering it.`
        : `Agy's quick rating matches the full rating well (${input.accuracy.count} jobs).`;
    out.push({ area: "search", text, action: { label: "Search settings", target: "job-search" } });
  }
  if (!input.scheduleOn && input.searchTitles > 0) out.push({ area: "search", text: "Scheduled search is off, so new jobs only come in when you press Run now.", action: { label: "Open Job Search", target: "job-search" } });
  return out;
}

// ---------- Today ----------

export async function interviewDates(workspace: string, jobs: JobFolderSummary[]): Promise<Array<{ jobId: string; date: string; round: string }>> {
  const out: Array<{ jobId: string; date: string; round: string }> = [];
  for (const job of jobs.filter((candidate) => candidate.interviewRoundLabel)) {
    const interview = await readJson<{ rounds?: Array<{ label?: string; stage?: string; scheduledDate?: string | null }> }>(path(workspace, `jobs/${job.id}/interviews/interview.json`));
    for (const round of interview?.rounds ?? []) if (round.scheduledDate && /^\d{4}-\d{2}-\d{2}/.test(round.scheduledDate)) out.push({ jobId: job.id, date: round.scheduledDate.slice(0, 10), round: round.label ?? round.stage ?? "Interview" });
  }
  return out;
}

/** Light rating vs full rating for found jobs that became jobs (matched by posting link). */
async function ratingPairs(workspace: string, jobs: JobFolderSummary[]): Promise<Array<{ light: number; full: number }>> {
  const state = await readSearchState(workspace);
  const light = new Map(state.items.filter((item) => item.agyFit).map((item) => [canonicalUrl(item.url).toLowerCase(), item.agyFit!.score]));
  if (!light.size) return [];
  const pairs: Array<{ light: number; full: number }> = [];
  for (const job of jobs.filter((candidate) => candidate.rating !== null)) {
    const url = (await readJson<{ url?: string | null }>(path(workspace, `jobs/${job.id}/.sensei/posting.json`)))?.url;
    const score = url ? light.get(canonicalUrl(url).toLowerCase()) : undefined;
    if (score !== undefined) pairs.push({ light: score, full: job.rating! });
  }
  return pairs;
}

export async function buildTodayData(workspace: string, input: { jobs: JobFolderSummary[]; profile: CandidateProfile | null; readiness: { ready: boolean; done: number; total: number } | null; now?: Date }): Promise<TodayData> {
  const now = input.now ?? new Date();
  const [search, closed, dates, settings, voiceText, pairs] = await Promise.all([
    readSearchState(workspace), readClosedPostings(workspace), interviewDates(workspace, input.jobs),
    readSearchSettings(workspace, input.profile), readFile(path(workspace, "profile/interview_voice.md"), "utf8").catch(() => ""), ratingPairs(workspace, input.jobs),
  ]);
  // Questions: only from real gaps, only when the user wants them (Settings → Interactive clarifying questions).
  let questions = await readQuestions(workspace);
  const vocab = await loadVocabulary(workspace, input.profile);
  const knownTerms = (term: string) => new RegExp(`(?:^|[^a-z0-9])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(vocab.text);
  if (input.profile?.preferences.voice.interactiveQuestions !== "never") {
    const recentRuns = search.runs.filter((run) => run.status === "done" && run.source === "search").slice(-3);
    const recentItems = search.items.filter((item) => recentRuns.some((run) => run.id === item.runId));
    const logistics = readLogistics(input.profile);
    const fresh = candidateQuestions({
      jobs: input.jobs,
      gapTerms: computeLearnings(input.jobs).gapTerms,
      knownTerms,
      searchTitlesWithoutMatches: recentRuns.length >= 3 ? settings.titles.filter((title) => !recentItems.some((item) => item.title && fitsSearchTitles(item.title, [title]))) : [],
      blankLogistics: (Object.keys(logistics) as Array<keyof typeof logistics>).filter((key) => !logistics[key].trim()),
      hasUpcomingInterview: dates.some((entry) => entry.date >= day(now)) || input.jobs.some((job) => effectiveStatus(job) === "interviewing" && furthestRecordedStage(job) !== null),
      now,
    });
    const merged = mergeQuestions(questions, fresh, now);
    if (merged.length !== questions.length) await saveQuestions(workspace, merged);
    questions = merged;
  } else {
    questions = [];
  }
  const insights = insightsFor({ jobs: input.jobs, readiness: input.readiness, deliveryFixes: parseInterviewVoice(voiceText).deliveryFixes, accuracy: ratingAccuracy(pairs), scheduleOn: settings.schedule.enabled, searchTitles: settings.titles.length, knownTerms });
  return buildToday({ jobs: input.jobs, search, closedPostings: closed.closed, interviewDates: dates, insights, questions, now });
}

// ---------- Morning summary (C7) ----------

/**
 * Written by the scheduled runner right after its search (a second step, no Agy): checks closed postings, builds Today,
 * saves it for the app, and returns the notification line.
 */
export async function writeMorningSummary(workspace: string, input: { jobs: JobFolderSummary[]; profile: CandidateProfile | null; now?: Date; fetcher?: typeof fetch }): Promise<{ today: TodayData; line: string }> {
  const now = input.now ?? new Date();
  await checkClosedPostings(workspace, input.jobs, { fetcher: input.fetcher, now }).catch(() => null);
  const today = await buildTodayData(workspace, { jobs: input.jobs, profile: input.profile, readiness: null, now });
  await writeJsonAtomic(path(workspace, SUMMARY_FILE), { writtenAt: now.toISOString(), today });
  const parts = [
    today.search.newCount ? `${today.search.newCount} new match${today.search.newCount === 1 ? "" : "es"}` : "",
    today.due.followUps.length ? `${today.due.followUps.length} follow-up${today.due.followUps.length === 1 ? "" : "s"} due` : "",
    today.due.interviewsThisWeek.length ? `${today.due.interviewsThisWeek.length} interview${today.due.interviewsThisWeek.length === 1 ? "" : "s"} this week` : "",
    today.due.closedPostings.length ? `${today.due.closedPostings.length} posting${today.due.closedPostings.length === 1 ? "" : "s"} closed` : "",
    today.questions.length ? `${today.questions.length} question${today.questions.length === 1 ? "" : "s"} for you` : "",
  ].filter(Boolean);
  return { today, line: parts.length ? `${parts.join(", ")}.` : "Nothing new today." };
}
