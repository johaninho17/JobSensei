import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { candidateProfileSchema, challengePracticeSchema, type EvidenceSnapshot } from "../src/shared/schemas";
import { BANNED_PHRASES } from "./evidence-snapshot";
import { parseMustHaves } from "./fit-scoring";
import {
  EVIDENCE_ID_PATTERN,
  INTERVIEW_STAGES,
  STORY_BANK_PATH,
  STORY_ID_PATTERN,
  parseStoryBank,
  questionBankUsage,
  stageForRoundId,
  interviewEvidence,
} from "./interview-context";
import { writeJsonAtomic, readTextFile } from "./persistence";
import { assertInsideWorkspace } from "./workspace";

export interface InterviewCheckIssue {
  code: string;
  severity: "error" | "warning";
  file: string;
  message: string;
}

export interface InterviewCheckReport {
  status: "passed" | "passed_with_warnings" | "failed";
  jobId: string;
  roundId: string;
  questionCount: number;
  gapQuestionCount: number;
  issues: InterviewCheckIssue[];
  durationSeconds: number | null;
}

const LOCAL_PATH = /(?:file:\/\/|\/Users\/[^\s)]+|\/home\/[^\s)]+|[A-Z]:\\[^\s)]+)/;
const QUOTED_SCRIPT = /[“"]([^”"\n]{120,})[”"]/;
const MAX_LAND_ON_WORDS = 8;
/** Words that turn a "land on" target into a slogan instead of something the candidate would say. */
const SLOGAN_WORDS = /\b(?:bridge|full[- ]lifecycle|high[- ]reliability|seamless(?:ly)?|robust|world[- ]class|best[- ]in[- ]class|cutting[- ]edge|holistic|transformative|synerg\w*|leverag\w*|cleanly|paradigm|game[- ]chang\w*)\b/i;
/** Extra slogan endings seen in generated landings ("fully aligned with role requirements"). */
const SLOGAN_PHRASES = /\b(?:aligned with|role requirements|value[- ]add|perfect fit)\b/i;
const MAX_SAY_WORDS = 10;
/** Words that carry no fact on their own: a Say point made only of these names nothing the candidate did. */
/** "Tell me about a time…", "describe a time…", "give me an example…": questions that want one real case. */
/** The first Say point of an experience question names the situation. */
const MAX_SITUATION_WORDS = 15;
const EXPERIENCE_QUESTION = /^(?:(?:tell me about|describe|give me|share|walk me through)\b.{0,40}\b(?:time|situation|project|customer|client|partner|implementation|onboarding|example|instance|engagement|integration|deployment)\b|how have you (?:handled|dealt with|managed))/i;

const ABSTRACT_WORDS = new Set("a an and the of to for in on with as at by from into it its my our your their i we you they is are be being clear clearly strong strongly good great effective effectively communication communicate communicating technical technically bridge bridging alignment aligned aligning grounded keeping keep ownership owning own collaboration collaborative cross-functional stakeholder stakeholders value impact impactful solutions solution focus focused passion passionate driven results-driven experience experienced expertise skills skill approach mindset quality excellence deep depth both sides internal external requirements needs customer-centric problem-solving problem solving".split(" "));
/** Praise words that make a key point sound like a cover letter instead of a fact. */
const PREP_PRAISE = /\b(?:proven track record|solid (?:background|foundation)|extensive experience|deep expertise|seasoned)\b/i;
const MAX_KEY_POINT_WORDS = 20;
const RESEARCH_SECTIONS: Array<[RegExp, string]> = [[/role decoded/i, "The role decoded"], [/requirement match/i, "Requirement match"], [/words to know/i, "Words to know"]];

function section(markdown: string, heading: RegExp): string | null {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => /^##\s+/.test(line) && heading.test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

function cards(body: string | null): Array<{ heading: string; body: string }> {
  if (!body) return [];
  return body.split(/\n(?=###\s+)/).flatMap((block) => {
    const heading = /^###\s+(.+)$/m.exec(block);
    return heading ? [{ heading: heading[1]!.trim(), body: block }] : [];
  });
}

function field(card: string, name: RegExp): string | null {
  for (const line of card.split("\n")) {
    const match = /^\s*[-*]\s+\*\*([^*]+?):?\*\*:?\s*(.*)$/.exec(line);
    if (match && name.test(match[1]!)) return match[2]!.trim();
  }
  return null;
}

/** Normalizes "$140,000", "$140k", "140K" to whole-dollar numbers. */
export function moneyAmounts(text: string): number[] {
  return [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?\b/g)].map((match) => {
    const base = Number(match[1]!.replaceAll(",", ""));
    const unit = match[2]?.toLowerCase();
    return Math.round(unit === "k" ? base * 1000 : unit === "m" ? base * 1_000_000 : base);
  });
}

const WORD_NUMBERS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", six: "6" };
function noticeWeeks(text: string): string[] {
  return [...text.matchAll(/\b(\d+|one|two|three|four|six)[- ]?(?:to[- ](?:\d+|two|three|four)[- ]?)?weeks?\b/gi)]
    .map((match) => WORD_NUMBERS[match[1]!.toLowerCase()] ?? match[1]!);
}

async function readText(workspace: string, relativePath: string): Promise<string> {
  return readTextFile(assertInsideWorkspace(workspace, join(workspace, relativePath))).catch(() => "");
}

async function exists(workspace: string, relativePath: string): Promise<boolean> {
  return stat(assertInsideWorkspace(workspace, join(workspace, relativePath))).then(() => true, () => false);
}

export async function checkInterviewRound(workspacePath: string, jobId: string, roundId: string, now = new Date()): Promise<InterviewCheckReport> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(jobId) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(roundId)) throw new Error("Interview identifiers are invalid.");
  const workspace = resolve(workspacePath);
  const stage = stageForRoundId(roundId);
  if (!stage) throw new Error(`"${roundId}" is not a canonical round (01-recruiter-screen, 02-hiring-manager, 03-practical-evaluation, 04-final-panel).`);
  const spec = INTERVIEW_STAGES[stage];
  const interviewsRoot = `jobs/${jobId}/interviews`;
  const roundRoot = `${interviewsRoot}/${roundId}`;
  const issues: InterviewCheckIssue[] = [];
  const add = (severity: InterviewCheckIssue["severity"], code: string, file: string, message: string) => issues.push({ code, severity, file, message });

  const [prep, bank, research, storyBankText, evaluation, profileText, snapshotText, labsText, jobText, jobDescription] = await Promise.all([
    readText(workspace, `${roundRoot}/prep.md`),
    readText(workspace, `${roundRoot}/question_bank.md`),
    readText(workspace, `${interviewsRoot}/company_research.md`),
    readText(workspace, STORY_BANK_PATH),
    readText(workspace, `jobs/${jobId}/evaluation.md`),
    readText(workspace, "profile/candidate.json"),
    // The same evidence the prep was written from (a fresh copy when the career files changed since the application).
    interviewEvidence(workspace, jobId).then((snapshot) => snapshot ? JSON.stringify(snapshot) : ""),
    readText(workspace, `${roundRoot}/challenge/practice_labs.json`),
    readText(workspace, `jobs/${jobId}/.sensei/job.json`),
    readText(workspace, `jobs/${jobId}/original_jd.md`),
  ]);
  if (!prep) add("error", "PREP_MISSING", "prep.md", "prep.md is missing.");
  else if (!/^##\s+3 things to get across/im.test(prep)) add("warning", "PREP_NO_KEY_POINTS", "prep.md", "prep.md should open with `## 3 things to get across`.");
  if (!bank) add("error", "QUESTION_BANK_MISSING", "question_bank.md", "question_bank.md is missing.");

  const stories = parseStoryBank(storyBankText);
  const storyIds = new Set(stories.map((story) => story.id));
  const snapshot = snapshotText ? JSON.parse(snapshotText) as EvidenceSnapshot : null;
  const knownEvidence = new Set([...(snapshot?.evidenceRows ?? []).map((row) => row.evidenceId), ...stories.flatMap((story) => story.evidenceIds)]);
  const profile = profileText ? candidateProfileSchema.safeParse(JSON.parse(profileText)).data ?? null : null;
  const company = (jobText ? (JSON.parse(jobText) as { company?: string }).company : null) ?? null;

  // Structure and limits.
  const primary = cards(section(bank, /primary for this round/i)).filter((card) => /^Question\b/i.test(card.heading));
  const gapCards = cards(section(bank, /gap questions/i));
  if (bank && !section(bank, /primary for this round/i)) add("error", "SECTION_MISSING", "question_bank.md", "Missing `## Primary for this round`.");
  if (bank && !section(bank, /questions to ask/i)) add("error", "SECTION_MISSING", "question_bank.md", "Missing `## Questions to ask`.");
  if (bank && (primary.length < spec.min || primary.length > spec.max)) {
    add("error", "QUESTION_COUNT", "question_bank.md", `${primary.length} primary questions; this round needs ${spec.min}–${spec.max}.`);
  }
  const gaps = parseMustHaves(evaluation).filter((row) => row.status !== "met");
  if (gaps.length && !gapCards.length) add("warning", "GAP_QUESTIONS_MISSING", "question_bank.md", `The evaluation lists ${gaps.length} gap(s) but the round has no \`## Gap questions\`.`);

  // Cards: real example or approach, known IDs, short landing target.
  const priorStoryIds = new Map<string, string>();
  for (let number = 1; number < Number(roundId.slice(0, 2)); number += 1) {
    const prior = Object.values(INTERVIEW_STAGES).find((candidate) => candidate.roundId.startsWith(String(number).padStart(2, "0")));
    if (!prior) continue;
    const priorBank = await readText(workspace, `${interviewsRoot}/${prior.roundId}/question_bank.md`);
    for (const id of questionBankUsage(priorBank).storyIds) priorStoryIds.set(id, prior.roundId);
  }
  let followUps = 0;
  for (const card of [...primary, ...gapCards]) {
    // Proof (card v3) or the older "Real example"; gap cards use "Closest real experience".
    const example = field(card.body, /^proof$|^real example$|^closest real experience$/i);
    const approach = field(card.body, /approach/i);
    const say = field(card.body, /^say$|^cues$/i);
    const landOn = field(card.body, /^land on$/i);
    const label = card.heading.slice(0, 70);
    const isGap = /^Gap\b/i.test(card.heading);
    if (!isGap && say === null && approach === null && example === null) {
      add("error", "CARD_UNANCHORED", "question_bank.md", `"${label}" needs **Say:** points or **Your approach:**.`);
    } else if (isGap && example === null) {
      add("error", "CARD_UNANCHORED", "question_bank.md", `"${label}" needs a **Closest real experience:** with a story or evidence ID.`);
    }
    const ids = [...(example ?? "").matchAll(EVIDENCE_ID_PATTERN)].map((match) => match[0]);
    const cardStories = [...(example ?? "").matchAll(STORY_ID_PATTERN)].map((match) => match[0]);
    if (example && !/^none\b/i.test(example) && !ids.length && !cardStories.length) {
      add("error", "CARD_NO_EVIDENCE", "question_bank.md", `"${label}" cites proof without a story or evidence ID.`);
    }
    if (field(card.body, /^likely follow-up$/i)) followUps += 1;
    // Say points (card v3 only; older Cues lines are left as they were written).
    const sayLine = field(card.body, /^say$/i);
    if (sayLine !== null) {
      const points = sayLine.split(/\s+·\s+|;/).map((point) => point.trim()).filter(Boolean);
      const words = (point: string) => point.toLowerCase().replace(/[^a-z0-9$%+.\s-]/g, " ").split(/\s+/).filter(Boolean);
      const abstract = points.filter((point) => words(point).every((word) => ABSTRACT_WORDS.has(word)));
      if (points.length < 3 || points.length > 5) {
        add("warning", "SAY_POINT_COUNT", "question_bank.md", `"${label}": **Say:** has ${points.length} point(s); use 3–5.`);
      }
      // On experience questions the first point names the situation (who, what, when) and may run a little longer.
      const firstLimit = EXPERIENCE_QUESTION.test(card.heading.replace(/^Question\s+\d+:\s*/i, "")) ? MAX_SITUATION_WORDS : MAX_SAY_WORDS;
      const long = points.find((point, index) => words(point).length > (index === 0 ? firstLimit : MAX_SAY_WORDS));
      if (long) add("warning", "SAY_POINT_TOO_LONG", "question_bank.md", `"${label}": "${long.slice(0, 60)}" is over ${MAX_SAY_WORDS} words; a point is a memory trigger, not a sentence.`);
      if (abstract.length >= 2 || (points.length && abstract.length === points.length)) {
        add("warning", "SAY_TOO_VAGUE", "question_bank.md", `"${label}": ${abstract.map((point) => `"${point}"`).join(", ")} name nothing concrete; name the tool, team, step, or result.`);
      }
    }
    for (const id of ids) if (!knownEvidence.has(id)) add("error", "UNKNOWN_EVIDENCE_ID", "question_bank.md", `"${label}" cites ${id}, which is not in the job's evidence or the story bank.`);
    for (const id of cardStories) {
      if (!storyIds.has(id)) add("error", "UNKNOWN_STORY_ID", "question_bank.md", `"${label}" cites ${id}, which is not in ${STORY_BANK_PATH}.`);
      else if (priorStoryIds.has(id)) add("error", "STORY_REUSED", "question_bank.md", `${id} was already used in ${priorStoryIds.get(id)}; pick another story.`);
    }
    if (!landOn) add("warning", "LAND_ON_MISSING", "question_bank.md", `"${label}" has no **Land on:** target.`);
    else if (landOn.split(/\s+/).filter(Boolean).length > MAX_LAND_ON_WORDS || /[“”"]/.test(landOn)) {
      add("warning", "LAND_ON_TOO_LONG", "question_bank.md", `"${label}": **Land on:** is a 3–${MAX_LAND_ON_WORDS} word target, not a sentence to recite.`);
    } else if (SLOGAN_WORDS.test(landOn) || SLOGAN_PHRASES.test(landOn)) {
      add("warning", "LAND_ON_SLOGAN", "question_bank.md", `"${label}": **Land on:** "${landOn}" reads like a slogan; use words the candidate would say out loud.`);
    }
  }

  // Pressure questions always carry a follow-up (about half the round); every card having one means it wasn't chosen.
  if (primary.length > 3 && followUps >= primary.length) {
    add("warning", "FOLLOWUP_EVERYWHERE", "question_bank.md", `${followUps} of ${primary.length} cards have a **Likely follow-up:**; keep it to the pressure questions and the ones most likely to get one.`);
  }
  // Experience questions are answered with a story, not a process list (the list gets recited instead of the example).
  for (const card of primary) {
    if (EXPERIENCE_QUESTION.test(card.heading.replace(/^Question\s+\d+:\s*/i, "")) && field(card.body, /approach/i) !== null) {
      add("warning", "APPROACH_ON_EXPERIENCE", "question_bank.md", `"${card.heading.slice(0, 70)}" asks for a real example; give the story in **Say:**, not a **Your approach:** list.`);
    }
  }
  if (prep && !/^##\s+Story map/im.test(prep)) add("warning", "PREP_NO_STORY_MAP", "prep.md", "prep.md should have `## Story map`: each kind of question → the story to use.");

  // Key points: one short line each, IDs only in trailing parentheses, no praise words.
  for (const item of (section(prep, /things to get across/i) ?? "").split("\n").map((line) => /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line)?.[1] ?? "").filter(Boolean)) {
    const text = item.replace(/\s*\(([^()]*)\)\s*\.?$/, "");
    const label = text.replace(/[*_`]/g, "").slice(0, 60);
    if (text.replace(/[*_`]/g, "").split(/\s+/).filter(Boolean).length > MAX_KEY_POINT_WORDS) add("warning", "PREP_POINT_TOO_LONG", "prep.md", `"${label}…" is over ${MAX_KEY_POINT_WORDS} words; one plain line per point.`);
    if (new RegExp(EVIDENCE_ID_PATTERN.source, "i").test(text) || new RegExp(STORY_ID_PATTERN.source).test(text)) add("warning", "PREP_RAW_ID", "prep.md", `"${label}…" has an ID in the text; put story and evidence IDs in trailing parentheses only.`);
    if (PREP_PRAISE.test(text)) add("warning", "PREP_PRAISE", "prep.md", `"${label}…" uses praise words; state the fact instead.`);
  }

  // Facts the candidate must supply themselves.
  const prepAndBank = `${prep}\n${bank}`;
  // The candidate's own figure, or the posting's published range.
  const allowedMoney = new Set([...moneyAmounts(profile?.preferences.interview.compensation ?? ""), ...moneyAmounts(jobDescription)]);
  for (const amount of new Set(moneyAmounts(prepAndBank))) {
    if (!allowedMoney.has(amount)) add("error", "INVENTED_COMPENSATION", "prep.md / question_bank.md", `$${amount.toLocaleString("en-US")} is not the candidate's own figure (Settings → Interview Prep → Compensation).`);
  }
  const allowedNotice = new Set(noticeWeeks(profile?.preferences.interview.noticePeriod ?? ""));
  const statedNotice = new Set(prepAndBank.split("\n").filter((candidate) => /notice/i.test(candidate)).flatMap(noticeWeeks));
  {
    for (const weeks of statedNotice) {
      if (!allowedNotice.has(weeks)) add("error", "INVENTED_NOTICE", "prep.md / question_bank.md", `A ${weeks}-week notice period is not the candidate's own value (Settings → Interview Prep).`);
    }
  }
  for (const [file, text] of [["prep.md", prep], ["question_bank.md", bank], ["company_research.md", research]] as const) {
    if (LOCAL_PATH.test(text)) add("error", "LOCAL_PATH", file, "Contains a local file path; use workspace-relative paths only.");
    // Reverse questions are the candidate's own questions and may be written out in full.
    const quoted = QUOTED_SCRIPT.exec(file === "question_bank.md" ? text.replace(section(text, /questions to ask/i) ?? "", "") : text);
    if (quoted && file !== "company_research.md") add("warning", "SCRIPTED_ANSWER", file, `Quoted script: “${quoted[1]!.slice(0, 60)}…”. Use short cues instead.`);
    const banned = BANNED_PHRASES.find((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
    if (banned && file !== "company_research.md") add("warning", "BANNED_PHRASE", file, `Uses the banned phrase “${banned}”.`);
  }

  // Research must be sourced.
  if (research) {
    const factLines = research.split("\n").filter((line) => /^\s*(?:[-*]|\|)\s*\S/.test(line) && !/^\s*\|\s*-{3}/.test(line));
    for (const line of factLines.filter((candidate) => /\breported\b/i.test(candidate) && !/https?:\/\//.test(candidate))) {
      add("error", "UNSOURCED_REPORTED", "company_research.md", `"Reported" claim without a URL: ${line.trim().slice(0, 80)}`);
    }
    // A source must point at a specific page, not a bare homepage.
    const deepLink = /https?:\/\/[^\s)]+\/[^\s)]*[a-z0-9]/i;
    const homepageOnly = factLines.filter((line) => /https?:\/\//.test(line) && !deepLink.test(line) && !/\(inferred\)/i.test(line));
    if (homepageOnly.length) add("error", "RESEARCH_HOMEPAGE_SOURCE", "company_research.md", `${homepageOnly.length} fact line(s) cite only a homepage; link the specific page or mark the line (inferred).`);
    const missing = RESEARCH_SECTIONS.filter(([pattern]) => !new RegExp(`^##\\s+.*${pattern.source}`, "im").test(research)).map(([, name]) => name);
    if (missing.length) add("warning", "RESEARCH_SECTIONS_MISSING", "company_research.md", `Missing research sections: ${missing.join(", ")}.`);
    const unsourced = factLines.filter((line) => !/https?:\/\/|\(inferred\)/i.test(line)).length;
    if (unsourced) add("warning", "RESEARCH_UNSOURCED", "company_research.md", `${unsourced} fact line(s) have no URL and aren't marked (inferred).`);
  }

  // Practice labs must be knowable and tied to the JD.
  if (labsText) {
    const parsed = challengePracticeSchema.safeParse(JSON.parse(labsText));
    if (!parsed.success) {
      add("error", "LABS_INVALID", "challenge/practice_labs.json", parsed.error.issues[0]?.message ?? "Invalid practice file.");
    } else {
      if (parsed.data.sourceBasis === "reported_process" && !parsed.data.sources.some((source) => /https?:\/\//.test(source))) {
        add("error", "UNSOURCED_REPORTED", "challenge/practice_labs.json", "sourceBasis is reported_process but no source URL is listed.");
      }
      for (const exercise of parsed.data.exercises) {
        if (!exercise.jdRequirement) add("error", "LAB_NOT_FROM_JD", "challenge/practice_labs.json", `${exercise.id}: add jdRequirement (the JD line it tests).`);
        if (!exercise.knowableFrom) add("error", "LAB_KNOWABILITY", "challenge/practice_labs.json", `${exercise.id}: add knowableFrom ("general craft" or "public docs: <url>").`);
        if (company && company.length >= 3 && exercise.prompt.toLowerCase().includes(company.toLowerCase())) {
          add("error", "LAB_COMPANY_SPECIFIC", "challenge/practice_labs.json", `${exercise.id}: the prompt depends on ${company}; make it a generic version of the JD task.`);
        }
      }
    }
  }

  // Register the round; the app derives the dashboard from the files.
  const interviewPath = `${interviewsRoot}/interview.json`;
  const interviewText = await readText(workspace, interviewPath);
  const interview = interviewText ? JSON.parse(interviewText) as Record<string, unknown> : {};
  const rounds = Array.isArray(interview.rounds) ? interview.rounds as Array<Record<string, unknown>> : [];
  const existing = rounds.find((round) => round.id === roundId);
  const keepStatus = existing && ["completed", "debriefed"].includes(String(existing.status));
  const relative = (path: string) => `${interviewsRoot}/${path}`;
  const artifactPaths = {
    research: await exists(workspace, `${interviewsRoot}/company_research.md`) ? relative("company_research.md") : null,
    prep: prep ? relative(`${roundId}/prep.md`) : null,
    questionBank: bank ? relative(`${roundId}/question_bank.md`) : null,
    challengeBrief: await exists(workspace, `${roundRoot}/challenge/challenge_brief.md`) ? relative(`${roundId}/challenge/challenge_brief.md`) : null,
    practiceLabs: labsText ? relative(`${roundId}/challenge/practice_labs.json`) : null,
    debriefAnalysis: await exists(workspace, `${roundRoot}/debrief_analysis.md`) ? relative(`${roundId}/debrief_analysis.md`) : null,
  };
  const { dashboardBrief: _stale, ...existingRest } = existing ?? {};
  const record = {
    sequence: Number(roundId.slice(0, 2)),
    stage,
    label: spec.label,
    interviewer: null,
    format: null,
    scheduledDate: null,
    debriefSourcePaths: [],
    ...existingRest,
    id: roundId,
    status: keepStatus ? existing!.status : "prep_ready",
    artifactPaths,
  };
  await writeJsonAtomic(assertInsideWorkspace(workspace, join(workspace, interviewPath)), {
    schemaVersion: 2,
    jobId,
    company,
    role: null,
    knownProcess: [],
    ...interview,
    currentRoundId: roundId,
    rounds: [...rounds.filter((round) => round.id !== roundId), record].sort((a, b) => Number(a.sequence) - Number(b.sequence)),
  });

  const timingPath = `${interviewsRoot}/.sensei/run_timing_${roundId}.json`;
  const timing = await readText(workspace, timingPath);
  const startedAt = timing ? (JSON.parse(timing) as { startedAt?: string }).startedAt : undefined;
  const durationSeconds = startedAt ? Math.max(0, Math.round((now.getTime() - Date.parse(startedAt)) / 1000)) : null;
  if (timing) await writeJsonAtomic(join(workspace, timingPath), { startedAt, checkedAt: now.toISOString(), durationSeconds });

  const report: InterviewCheckReport = {
    status: issues.some((item) => item.severity === "error") ? "failed" : issues.length ? "passed_with_warnings" : "passed",
    jobId,
    roundId,
    questionCount: primary.length,
    gapQuestionCount: gapCards.length,
    issues,
    durationSeconds,
  };
  await writeJsonAtomic(assertInsideWorkspace(workspace, join(workspace, `${interviewsRoot}/.sensei/check_${roundId}.json`)), report);
  return report;
}

function defaultWorkspace(): string {
  const configured = process.env.SENSEI_WORKSPACE;
  if (configured) return resolve(configured);
  return basename(process.cwd()) === "data" ? process.cwd() : resolve(process.cwd(), "data");
}

if (require.main === module) {
  const [jobId, roundId] = process.argv.slice(2);
  if (!jobId || !roundId) {
    process.stderr.write("Usage: npm run interview:check -- <job-id> <round-id>\n");
    process.exitCode = 1;
  } else {
    checkInterviewRound(defaultWorkspace(), jobId, roundId)
      .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
      .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 2;
      });
  }
}
