// Answers a job's written application questions with a separate, headless Agy (`agy -p`), in the background: the
// terminal Agy and the job queue never see it. The app builds one self-contained prompt (questions, the posting, this
// job's evidence rows, stories, voice, the cover letter, the truth rules), so Agy reads no files. Agy decides per
// question whether to answer, skip, or give notes, and answers by question kind; the answers are checked here before
// they are saved. Owner of the answer rules (application-questions.ts only drops form fields and plain logistics).
import { recordHeadlessConversation } from "./agy-home";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApplicationQuestion, EvidenceSnapshot, QuestionAnswer, QuestionDecision, QuestionKind, QuestionsState } from "../src/shared/schemas";
import { WORDS_PER_SENTENCE, fetchApplicationForm, parsePastedQuestions, writtenQuestions, type FormField } from "./application-questions";
import { APPLICATION_FORM_FILE, formQuestionLines } from "./posting-clean";

export type { QuestionAnswer, QuestionsState };
import { countWords, validateNamedTermSupport } from "./application-artifacts";
import { BANNED_PHRASES } from "./evidence-snapshot";
import { postingBody } from "./fit-scoring";
import { parseInterviewVoice, parseStoryBank, type Story } from "./interview-context";
import { writeJsonAtomic, writeTextAtomic, readTextFile } from "./persistence";
import { assertInsideWorkspace, workspaceFile } from "./workspace";

export const ANSWERS_FILE = "application_answers.md";
export const QUESTIONS_STATE_FILE = ".sensei/application_questions.json";
/** Used when a question gives no limit. */
export const DEFAULT_WORDS = { min: 80, max: 130 } as const;
/** How much of the posting (without its application form) goes into the prompt. */
const POSTING_CHARS = 7000;
/** A sentence longer than this is flagged: answers are read fast and should be easy to say out loud. */
const LONG_SENTENCE = 35;
/** Filler seen in weak answers; the candidate's own allowed phrases ("bridging the gap") are not here. */
const FILLER = /\b(?:successfully|stakeholders?|seamless(?:ly)?|leverag\w*|spearhead\w*|orchestrat\w*|robust|actionable|synerg\w*|transformative|cutting-edge|passionate|dependable|meaningful insights|day-to-day decisions)\b/i;
/** Talk about the candidate's files instead of the candidate. */
const META = /\b(?:the evidence|evidence (?:shows|rows?)|my (?:career )?records|on file|(?:isn't|is not|not) (?:recorded|documented))\b/i;
/** A result stated in the answer… */
const OUTCOME = /\b(?:result(?:ed|ing)? in|led to|which (?:allowed|enabled|gave|let|meant)|allowing|enabling|giving|reduc\w*|increas\w*|improv\w*|saved|faster|on schedule|back on track|without having to)\b/i;
/** …and whether the cited rows state one. */
const ROW_RESULT = /\b(?:so (?:the|that|they|their|our)|result\w*|led to|reduc\w*|increas\w*|improv\w*|saved|faster|got|allow\w*|enabl\w*|back on|went live|launched|adopted)\b/i;


type EvidenceRow = { evidenceId: string; claim: string; scope?: string; employer?: string | null; timeline?: string; eligibility?: string };
export type PromptInput = { company: string | null; title: string | null; questions: ApplicationQuestion[]; evidenceRows: EvidenceRow[]; styleRules: string[]; stories: Story[]; phrases: string[]; posting?: string; coverLetter?: string };

const ANSWER_SCHEMA = JSON.stringify({
  type: "object",
  required: ["answers"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "decision", "kind", "reason", "text", "notes", "evidenceIds", "storyIds"],
        properties: {
          id: { type: "string" },
          decision: { type: "string", enum: ["answer", "skip", "notes"] },
          kind: { type: "string", enum: ["experience", "motivation", "approach", "other"] },
          reason: { type: ["string", "null"] },
          text: { type: ["string", "null"] },
          notes: { type: "array", items: { type: "string" } },
          evidenceIds: { type: "array", items: { type: "string" } },
          storyIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
});

/** The length line for one question. */
function lengthLine(question: ApplicationQuestion): string {
  if (question.sentenceLimit) return `at most ${question.sentenceLimit} sentence${question.sentenceLimit === 1 ? "" : "s"}, each under ${WORDS_PER_SENTENCE} words`;
  return question.wordLimit ? `at most ${question.wordLimit} words` : `${DEFAULT_WORDS.min}–${DEFAULT_WORDS.max} words`;
}

/** The whole prompt: everything Agy needs, no file paths, no tools. */
export function buildQuestionPrompt(input: PromptInput): string {
  const role = [input.title, input.company].filter(Boolean).join(" at ") || "this job";
  const rows = input.evidenceRows.filter((row) => row.eligibility !== "excluded" && row.eligibility !== "blocked")
    .map((row) => `- ${row.evidenceId}: ${row.claim}${row.scope ? ` (Scope: ${row.scope})` : ""}${row.employer ? ` [${row.employer}${row.timeline ? `, ${row.timeline}` : ""}]` : ""}`);
  const stories = input.stories.map((story) => `- ${story.id} · ${story.title}: ${story.cues.join(" · ")}. Evidence: ${story.evidenceIds.join(", ")}. Limit: ${story.framingLimit}`);
  const questions = input.questions.map((question) => [
    `- ${question.id}: ${question.label}`,
    `  Length: ${lengthLine(question)}.`,
    ...(question.force ? ["  The candidate asked for this one: answer it (decision \"answer\")."] : []),
    ...(question.writeYourself ? ["  The employer asks the candidate to write this one themselves: decision \"notes\", text null, and 3–4 short notes (facts and stories to use), never a drafted answer."] : []),
  ].join("\n"));
  const posting = input.posting ? postingBody(input.posting).trim().slice(0, POSTING_CHARS) : "";
  return [
    `You are helping the candidate with the written questions on their application for ${role}. Reply with JSON only, matching the schema. Do not read files, run commands, or browse.`,
    "",
    "## 1. Decide, for each question",
    "- answer: it asks about the candidate's work, skills, how they think or work, or why this company or role.",
    "- skip: it is logistics or a one-line fact only the candidate knows (how they found the job, referrals, salary, dates, availability, location, eligibility, links), or a test or puzzle. Put a short reason in `reason` and set text to null.",
    "- notes: the employer asks the candidate to write it themselves.",
    "- Also skip, with the reason, when nothing real in the evidence or stories can answer it. Never fill an answer with unrelated work.",
    "",
    "## 2. Answer by kind (set `kind`)",
    "- experience (a time you…, your experience with…, an outcome you delivered): one real example. One sentence of situation, then what the candidate did, then the result only if the evidence states one. Pick the row or story that matches the question's topic; if the closest real work is a step away, say plainly what it was, without apologising.",
    "- motivation (why us, what about our mission or approach, why this role): name one or two specific things from the posting below (its mission, who it serves, the work itself) and connect them to the candidate's real reasons from their career story and values, with one short line of real work that shows it. No full story. Never explain the company's business back to them.",
    "- approach (how would you…, your process for…): the steps the candidate would take, in plain words, plus one line of real work that shows they have done something like it.",
    "- other: answer plainly and briefly from the evidence.",
    "",
    "## 3. Length and style",
    "- Follow each question's length line exactly. A sentence limit means that many sentences, each one short.",
    "- First person. Plain, warm, direct paragraphs (no bullets, headings, or quotation marks). One idea per sentence. Lead with the point.",
    "- No corporate or AI filler: never \"successfully\", \"stakeholders\", \"seamless\", \"leveraged\", \"spearheaded\", \"orchestrated\", \"robust\", \"actionable\", \"passionate\".",
    "- Write about the candidate and their work only. Never mention evidence, records, files, or what is or isn't on file.",
    `- Never use these phrases: ${BANNED_PHRASES.join("; ")}.`,
    "",
    "## 4. Truth",
    "- Every fact comes from the evidence rows or stories below. Never invent a client, deal, metric, tool, date, title, audience, or outcome. Keep each row's scope and each story's limit.",
    "- Frame real work confidently, the way the candidate's own resume does, but every word must be defensible in an interview. Light framing of wording is fine; adding an event, number, user group, result, or ownership that isn't in the evidence is not.",
    "- Client and partner companies are described by industry, never named.",
    "- Notes (for write-yourself questions) point only to real facts and stories below.",
    "- List the evidence IDs and story IDs each answer uses.",
    ...(input.styleRules.length ? ["", "## The candidate: career story, values, and voice", ...input.styleRules.map((rule) => `- ${rule}`)] : []),
    ...(input.phrases.length ? ["", "## Phrases the candidate uses", ...input.phrases.map((phrase) => `- ${phrase}`)] : []),
    "",
    "## Evidence rows",
    ...rows,
    ...(stories.length ? ["", "## Stories", ...stories] : []),
    ...(input.coverLetter?.trim() ? ["", "## The cover letter already written for this job (stay consistent with it; don't reuse its sentences)", input.coverLetter.trim()] : []),
    ...(posting ? ["", "## The posting (for motivation questions; don't repeat it back)", posting] : []),
    "",
    "## Questions",
    ...questions,
  ].join("\n");
}

type ReplyAnswer = Omit<QuestionAnswer, "words" | "issues">;
const DECISIONS: QuestionDecision[] = ["answer", "skip", "notes"];
const KINDS: QuestionKind[] = ["experience", "motivation", "approach", "other"];

/** Agy's JSON reply (fenced or not) → answers. */
export function parseAnswerReply(response: string): ReplyAnswer[] {
  const body = response.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const parsed = JSON.parse(body) as { answers?: Array<Partial<QuestionAnswer>> };
  return (parsed.answers ?? []).map((answer) => {
    const text = typeof answer.text === "string" && answer.text.trim() ? answer.text.trim() : null;
    return {
      id: String(answer.id ?? ""),
      decision: DECISIONS.includes(answer.decision as QuestionDecision) ? answer.decision : text ? "answer" : "skip",
      kind: KINDS.includes(answer.kind as QuestionKind) ? answer.kind : "other",
      reason: typeof answer.reason === "string" && answer.reason.trim() ? answer.reason.trim() : null,
      text,
      notes: Array.isArray(answer.notes) ? answer.notes.map(String) : [],
      evidenceIds: Array.isArray(answer.evidenceIds) ? answer.evidenceIds.map(String) : [],
      storyIds: Array.isArray(answer.storyIds) ? answer.storyIds.map(String) : [],
    };
  });
}

/** A logistics question, skipped without asking Agy. */
export function logisticsSkip(question: ApplicationQuestion): QuestionAnswer {
  return { id: question.id, decision: "skip", kind: "other", reason: "Logistics: answer this one yourself in a line.", text: null, notes: [], evidenceIds: [], storyIds: [], words: 0, issues: [] };
}

export function sentences(text: string): string[] {
  return text.replace(/\b(?:e\.g|i\.e|etc|vs|Mr|Ms|Dr)\./gi, (abbreviation) => abbreviation.replace(".", "")).split(/(?<=[.!?])\s+(?=[A-Z"“(])/).map((sentence) => sentence.trim()).filter(Boolean);
}

type CheckContext = { evidenceIds: Set<string>; stories: Story[]; snapshot: EvidenceSnapshot | null; rows?: Map<string, string> };

/** The checks every answer passes before it is shown; a failed check is a warning on that answer. */
export function checkAnswers(questions: ApplicationQuestion[], answers: ReplyAnswer[], context: CheckContext): QuestionAnswer[] {
  return questions.map((question) => {
    const answer = answers.find((candidate) => candidate.id === question.id) ?? { id: question.id, decision: undefined, kind: undefined, reason: null, text: null, notes: [], evidenceIds: [], storyIds: [] };
    const decision: QuestionDecision = question.writeYourself ? "notes" : answer.decision ?? (answer.text ? "answer" : "skip");
    const issues: string[] = [];
    const text = decision === "answer" ? answer.text : null;
    if (question.writeYourself && answer.text) issues.push("This question asks you to write it yourself, so the draft was removed; use the notes.");
    if (decision === "skip" && question.force) issues.push(`Skipped even though you asked: ${answer.reason ?? "no reason given"}.`);
    if (decision === "answer" && !text) issues.push("No answer came back for this question.");
    if (decision === "skip" && !answer.reason && !answer.text) issues.push("No answer came back for this question.");
    const words = text ? countWords(text) : 0;
    const limit = question.wordLimit ?? DEFAULT_WORDS.max + 40;
    if (text && words > limit) issues.push(`${words} words; the limit is ${question.wordLimit ?? `about ${DEFAULT_WORDS.max}`}.`);
    if (text) {
      const parts = sentences(text);
      if (question.sentenceLimit && parts.length > question.sentenceLimit) issues.push(`${parts.length} sentences; the question asks for at most ${question.sentenceLimit}.`);
      const long = parts.map(countWords).filter((count) => count > LONG_SENTENCE);
      if (long.length) issues.push(`${long.length === 1 ? "A sentence runs" : `${long.length} sentences run`} ${Math.max(...long)} words; split ${long.length === 1 ? "it" : "them"}.`);
      const filler = FILLER.exec(text)?.[0];
      if (filler) issues.push(`Uses filler ("${filler}").`);
      const meta = META.exec(text)?.[0];
      if (meta) issues.push(`Talks about your files ("${meta}") instead of you.`);
    }
    const banned = text ? BANNED_PHRASES.find((phrase) => text.toLowerCase().includes(phrase.toLowerCase())) : undefined;
    if (banned) issues.push(`Uses the phrase "${banned}".`);
    const storyIds = answer.storyIds.filter((id) => context.stories.some((story) => story.id === id));
    const unknown = [...answer.evidenceIds.filter((id) => !context.evidenceIds.has(id)), ...answer.storyIds.filter((id) => !storyIds.includes(id))];
    if (unknown.length) issues.push(`Cites ${unknown.join(", ")}, which isn't in your evidence or story bank.`);
    if (text && answer.kind !== "motivation" && !answer.evidenceIds.length && !storyIds.length) issues.push("Cites no evidence; check every fact.");
    const ids = [...answer.evidenceIds.filter((id) => context.evidenceIds.has(id)), ...context.stories.filter((story) => storyIds.includes(story.id)).flatMap((story) => story.evidenceIds)];
    // Experience answers only: a motivation or approach answer names goals, not results.
    if (text && context.rows && ids.length && (answer.kind === "experience" || answer.kind === "other")) {
      const outcome = OUTCOME.exec(text)?.[0];
      const stated = ids.some((id) => ROW_RESULT.test(context.rows!.get(id) ?? ""));
      if (outcome && !stated) issues.push(`States a result ("${outcome}…") the cited work doesn't record; keep it only if it's true.`);
    }
    if (text && context.snapshot) {
      try { validateNamedTermSupport(text, ids, context.snapshot, "framed"); } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
    }
    return { id: question.id, decision, kind: answer.kind ?? "other", reason: decision === "answer" ? null : answer.reason ?? null, text, notes: answer.notes, evidenceIds: answer.evidenceIds, storyIds, words, issues };
  });
}

export function answersMarkdown(state: Pick<QuestionsState, "questions" | "answers">): string {
  const blocks = state.questions.map((question) => {
    const answer = state.answers.find((candidate) => candidate.id === question.id);
    const body = question.writeYourself
      ? ["**Write this one yourself.** Notes:", ...(answer?.notes ?? []).map((note) => `- ${note}`)].join("\n")
      : answer?.decision === "skip" ? `_Skipped: ${answer.reason ?? "not a question to answer here"}_`
      : answer?.text ?? "_No answer yet._";
    return `### ${question.label}\n\n${body}`;
  });
  return `# Application questions\n\n${blocks.join("\n\n")}\n`;
}

export type AgyRunner = (prompt: string, options: { conversationId: string | null }) => Promise<{ response: string; conversationId: string | null }>;

/** Runs `agy -p` with the app's Agy home; stdin closed, no terminal. */
/** How often the wall-clock deadline is checked. Timers pause while the computer sleeps; the clock doesn't. */
const DEADLINE_CHECK_MS = 15_000;

export function headlessAgy(options: { agyPath: string; agyHome: string; cwd: string; timeoutSeconds?: number; jsonSchema?: string; clock?: () => number; checkMs?: number }): AgyRunner {
  const clock = options.clock ?? Date.now;
  return (prompt, { conversationId }) => new Promise((resolve, reject) => {
    const args = ["--sandbox", "-p", prompt, "--output-format", "json", "--json-schema", options.jsonSchema ?? ANSWER_SCHEMA, "--print-timeout", `${options.timeoutSeconds ?? 240}s`, ...(conversationId ? ["--conversation", conversationId] : [])];
    const child = spawn(options.agyPath, args, { cwd: options.cwd, env: { ...process.env, HOME: options.agyHome, ...(process.platform === "win32" ? { USERPROFILE: options.agyHome } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    // Agy's own --print-timeout counts time it is awake; after a sleep or a dropped network it can hang far longer.
    // This deadline uses the wall clock (a minute past Agy's own limit) and ends the run.
    const deadline = clock() + ((options.timeoutSeconds ?? 240) + 60) * 1000;
    let timedOut = false;
    const watch = setInterval(() => {
      if (clock() < deadline) return;
      timedOut = true;
      clearInterval(watch);
      child.kill("SIGKILL");
      // Settle now: a child process Agy started can keep the output open after Agy itself is gone.
      reject(new Error("print_timeout: Agy didn't finish in time (the computer may have slept or lost its connection)."));
    }, options.checkMs ?? DEADLINE_CHECK_MS);
    child.on("error", (error) => { clearInterval(watch); reject(error); });
    child.on("close", (code) => {
      clearInterval(watch);
      if (timedOut) return;
      try {
        const result = JSON.parse(stdout) as { status?: string; response?: string; conversation_id?: string; error?: string };
        if (result.status && result.status !== "SUCCESS") throw new Error(result.error ?? `Agy finished with ${result.status}.`);
        // Conversations the app starts are recorded so old ones can be cleaned up (never the terminal's own).
        if (result.conversation_id) void recordHeadlessConversation(options.agyHome, result.conversation_id).catch(() => undefined);
        resolve({ response: result.response ?? "", conversationId: result.conversation_id ?? null });
      } catch {
        reject(new Error((stderr.trim().split("\n").pop() || `Agy exited with code ${code}.`).slice(0, 300)));
      }
    });
  });
}

const read = (path: string) => readTextFile(path).catch(() => "");

/** The letter's paragraphs from "Dear …" to the sign-off (no header or contact lines). */
export function letterBody(letter: string): string {
  const start = letter.search(/^[ \t]*Dear\b/m);
  const body = start >= 0 ? letter.slice(start).split("\n").slice(1).join("\n") : letter;
  return body.replace(/\n\s*(?:Sincerely|Best|Thank you|Kind regards|Regards|Warmly)\b[\s\S]*$/i, "").trim();
}

/**
 * One background job at a time per app. `auto` reads the posting's form (only Greenhouse, Ashby, and Lever);
 * `ask` answers pasted questions. State and answers are saved in the job folder, and `onUpdate` fires at each step.
 */
export class QuestionAgent {
  private chain: Promise<void> = Promise.resolve();
  private active = new Set<string>();

  constructor(private readonly options: { workspace: () => string; runner: () => Promise<AgyRunner>; fetcher?: typeof fetch; onUpdate?: (jobId: string, state: QuestionsState) => void; now?: () => number }) {}

  private paths(jobId: string) {
    const workspace = this.options.workspace();
    const job = assertInsideWorkspace(workspace, join(workspace, "jobs", jobId));
    return { workspace, job, state: join(job, QUESTIONS_STATE_FILE), answers: join(job, ANSWERS_FILE) };
  }

  async get(jobId: string): Promise<QuestionsState | null> {
    const raw = await read(this.paths(jobId).state);
    return raw ? JSON.parse(raw) as QuestionsState : null;
  }

  isRunning(jobId: string): boolean { return this.active.has(jobId); }

  private async save(jobId: string, state: QuestionsState): Promise<QuestionsState> {
    const paths = this.paths(jobId);
    await writeJsonAtomic(paths.state, state);
    if (state.status === "done" || state.answers.length) await writeTextAtomic(paths.answers, answersMarkdown(state));
    this.options.onUpdate?.(jobId, state);
    return state;
  }

  private now(): number { return this.options.now?.() ?? Date.now(); }

  private enqueue(jobId: string, work: () => Promise<void>): Promise<void> {
    this.active.add(jobId);
    const next = this.chain.then(work).catch(() => undefined).finally(() => this.active.delete(jobId));
    this.chain = next;
    return next;
  }

  /** During or after an application run: answer the posting's written questions once (skipped when already done). */
  auto(jobId: string, force = false): Promise<void> {
    return this.enqueue(jobId, async () => {
      if (!force && await this.get(jobId)) return;
      const posting = await read(join(this.paths(jobId).job, "original_jd.md"));
      const sourceUrl = /\*\*Source(?: URL)?:?\*\*:?\s*(https?:\/\/\S+)/i.exec(posting)?.[1] ?? null;
      const base: QuestionsState = { source: "posting", sourceUrl, status: "reading", questions: [], answers: [], message: null, startedAt: new Date(this.now()).toISOString(), finishedAt: null, durationSeconds: null, conversationId: null };
      // The form split off a pasted or fetched posting: its question lines, used when the board can't be read.
      const savedForm = await read(join(this.paths(jobId).job, APPLICATION_FORM_FILE));
      const formFields: FormField[] = formQuestionLines(savedForm).map((label) => ({ label, type: "long", required: true, description: "" }));
      if (!sourceUrl && !formFields.length) { await this.save(jobId, { ...base, status: "none", message: "No posting link to read questions from. Paste them below." }); return; }
      await this.save(jobId, base);
      let questions: ApplicationQuestion[];
      try {
        const fields = (sourceUrl ? await fetchApplicationForm(sourceUrl, this.options.fetcher) : null) || (formFields.length ? formFields : null);
        if (!fields) { await this.save(jobId, { ...base, status: "none", message: "This job board doesn't show its application questions. Paste them below." }); return; }
        if (!fields.length && !formFields.length) { await this.save(jobId, { ...base, status: "none", message: "Couldn't find the application form (the posting may be closed). Paste the questions below." }); return; }
        questions = writtenQuestions(fields.length ? fields : formFields);
      } catch (error) {
        await this.save(jobId, { ...base, status: "none", message: `Couldn't read the application form (${error instanceof Error ? error.message : String(error)}). Paste the questions below.` });
        return;
      }
      if (!questions.length) { await this.save(jobId, { ...base, status: "none", message: "No written questions on this form." }); return; }
      await this.answer(jobId, { ...base, questions, answers: questions.filter((question) => question.logistics).map(logisticsSkip) });
    });
  }

  /** Pasted questions: added to the job's questions (a repeated question is answered again), then answered. */
  ask(jobId: string, text: string): Promise<void> {
    const pasted = parsePastedQuestions(text);
    if (!pasted.length) return Promise.reject(new Error("Paste at least one question."));
    return this.enqueue(jobId, async () => {
      const current = await this.get(jobId);
      const kept = (current?.questions ?? []).filter((question) => !pasted.some((candidate) => candidate.label.toLowerCase() === question.label.toLowerCase()));
      const questions = [...kept, ...pasted].map((question, index) => ({ ...question, id: `q:${index + 1}` }));
      // Keep earlier answers for questions that weren't pasted again, under their new IDs.
      const isPasted = (label: string) => pasted.some((candidate) => candidate.label.toLowerCase() === label.toLowerCase());
      const earlier = (label: string) => {
        const old = current?.questions.find((question) => question.label.toLowerCase() === label.toLowerCase());
        return old ? current!.answers.find((answer) => answer.id === old.id) : undefined;
      };
      const answers = questions.flatMap((question) => {
        if (isPasted(question.label)) return question.logistics ? [logisticsSkip(question)] : [];
        const answer = earlier(question.label);
        return answer ? [{ ...answer, id: question.id }] : [];
      });
      await this.answer(jobId, {
        source: current?.source === "posting" ? "posting" : "pasted", sourceUrl: current?.sourceUrl ?? null, status: "answering", questions, answers, message: null,
        startedAt: new Date(this.now()).toISOString(), finishedAt: null, durationSeconds: null, conversationId: current?.conversationId ?? null,
      }, new Set(pasted.filter((question) => !question.logistics).map((question) => question.label.toLowerCase())));
    });
  }

  /** "Answer anyway" on a skipped question: Agy must answer it. */
  answerAnyway(jobId: string, questionId: string): Promise<void> {
    return this.enqueue(jobId, async () => {
      const current = await this.get(jobId);
      const target = current?.questions.find((question) => question.id === questionId);
      if (!current || !target) return;
      const questions = current.questions.map((question) => question.id === questionId ? { ...question, force: true } : question);
      await this.answer(jobId, { ...current, questions, answers: current.answers.filter((answer) => answer.id !== questionId) }, new Set([target.label.toLowerCase()]));
    });
  }

  /** Answers the questions not yet answered (or `only` these labels) and saves the result. */
  private async answer(jobId: string, state: QuestionsState, only?: Set<string>): Promise<void> {
    const started = this.now();
    const pending = state.questions.filter((question) => only ? only.has(question.label.toLowerCase()) : !state.answers.some((answer) => answer.id === question.id));
    if (!pending.length) {
      await this.save(jobId, { ...state, status: "done", message: state.questions.length ? "Only logistics questions; nothing for Agy to answer." : null, finishedAt: new Date(this.now()).toISOString(), durationSeconds: 0 });
      return;
    }
    await this.save(jobId, { ...state, status: "answering", message: null });
    const paths = this.paths(jobId);
    try {
      const [contextRaw, snapshotRaw, storyBank, voice, posting, letter] = await Promise.all([
        read(join(paths.job, ".sensei", "application_context.json")),
        read(join(paths.job, ".sensei", "evidence_snapshot.json")),
        read(workspaceFile(paths.workspace, "profile/story_bank.md")),
        read(workspaceFile(paths.workspace, "profile/interview_voice.md")),
        read(join(paths.job, "original_jd.md")),
        read(join(paths.job, "cover_letter.md")),
      ]);
      if (!contextRaw) throw new Error("This job has no application context yet; run the application first.");
      const context = JSON.parse(contextRaw) as { job?: { company?: string | null; title?: string | null }; evidenceRows?: EvidenceRow[]; styleRules?: string[] };
      const snapshot = snapshotRaw ? JSON.parse(snapshotRaw) as EvidenceSnapshot : null;
      const stories = parseStoryBank(storyBank);
      const evidenceRows = context.evidenceRows ?? [];
      const prompt = buildQuestionPrompt({ company: context.job?.company ?? null, title: context.job?.title ?? null, questions: pending, evidenceRows, styleRules: context.styleRules ?? [], stories, phrases: parseInterviewVoice(voice).phrases, posting, coverLetter: letterBody(letter) });
      const runner = await this.options.runner();
      const reply = await runner(prompt, { conversationId: state.conversationId });
      const evidenceIds = new Set([...evidenceRows.map((row) => row.evidenceId), ...(snapshot?.evidenceRows ?? []).map((row) => row.evidenceId)]);
      const rows = new Map([...(snapshot?.evidenceRows ?? []), ...evidenceRows].map((row) => [row.evidenceId, `${row.claim} ${row.scope ?? ""}`] as const));
      const checked = checkAnswers(pending, parseAnswerReply(reply.response), { evidenceIds, stories, snapshot, rows });
      const answers = [...state.answers.filter((answer) => !pending.some((question) => question.id === answer.id)), ...checked];
      await this.save(jobId, { ...state, status: "done", answers, conversationId: reply.conversationId ?? state.conversationId, finishedAt: new Date(this.now()).toISOString(), durationSeconds: Math.round((this.now() - started) / 1000) });
    } catch (error) {
      await this.save(jobId, { ...state, status: "failed", message: error instanceof Error ? error.message : String(error), finishedAt: new Date(this.now()).toISOString(), durationSeconds: Math.round((this.now() - started) / 1000) });
    }
  }
}
