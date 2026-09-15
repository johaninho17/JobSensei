import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, normalize } from "node:path";
import {
  challengePracticeSchema,
  interviewOverviewSchema,
  interviewDashboardBriefSchema,
  type ChallengeAssessmentMode,
  type InterviewArtifactPaths,
  type InterviewDashboardBrief,
  type InterviewDashboardItem,
  type InterviewOverview,
  type InterviewRound,
  type InterviewRoundStatus,
  type InterviewStage,
  type KnownInterviewStep,
} from "../src/shared/schemas";
import { assertInsideWorkspace } from "./workspace";
import { writeJsonAtomic } from "./persistence";

type JsonRecord = Record<string, unknown>;
type RawDashboardItem = Pick<InterviewDashboardItem, "title" | "text" | "sourcePath"> & { anchor?: string | null };

const stageLabels: Record<InterviewStage, string> = {
  recruiter_screen: "Recruiter screen",
  hiring_manager: "Hiring manager",
  technical: "Technical interview",
  technical_challenge: "Technical challenge",
  take_home: "Take-home exercise",
  onsite: "Onsite interview",
  executive: "Executive interview",
  unknown: "Interview",
};

async function exists(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isFile()).catch(() => false);
}

async function readJson(path: string): Promise<JsonRecord | null> {
  return readFile(path, "utf8").then((raw) => JSON.parse(raw) as JsonRecord).catch(() => null);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function plainMarkdown(value: string): string {
  return value
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`>#|]/g, " ")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownSections(markdown: string): Array<{ heading: string; level: number; body: string }> {
  const sections: Array<{ heading: string; level: number; body: string }> = [];
  let current: { heading: string; level: number; lines: string[] } | null = null;
  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const heading = /^(#{2,5})\s+(.+)$/.exec(line);
    if (heading) {
      if (current) sections.push({ heading: plainMarkdown(current.heading), level: current.level, body: current.lines.join("\n").trim() });
      current = { heading: heading[2], level: heading[1].length, lines: [] };
    } else if (current) current.lines.push(line);
  }
  if (current) sections.push({ heading: plainMarkdown(current.heading), level: current.level, body: current.lines.join("\n").trim() });
  return sections;
}

function firstUsefulText(body: string, maxLength = 420): string | null {
  const paragraphs = body.split(/\n\s*\n/).map(plainMarkdown).filter((value) => value.length >= 18);
  const value = paragraphs[0] ?? null;
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;
}

function dashboardItem(item: RawDashboardItem, category: InterviewDashboardItem["category"], priority: InterviewDashboardItem["priority"] = "reference", sourceType: InterviewDashboardItem["sourceType"] = "round_artifact"): InterviewDashboardItem {
  return { ...item, anchor: item.anchor ?? item.title, category, priority, sourceType };
}

function sectionItems(markdown: string, sourcePath: string, pattern: RegExp, limit: number): RawDashboardItem[] {
  return markdownSections(markdown).filter((section) => pattern.test(section.heading)).flatMap((section) => {
    const value = firstUsefulText(section.body);
    return value ? [{ title: section.heading, text: value, sourcePath }] : [];
  }).slice(0, limit);
}

function listItemsFromSection(markdown: string, sourcePath: string, pattern: RegExp, limit: number): RawDashboardItem[] {
  const section = markdownSections(markdown).find((candidate) => pattern.test(candidate.heading));
  if (!section) return [];
  return section.body.split("\n").flatMap((line) => {
    const match = /^\s*(?:[-*+] |\d+[.)] )(.+)/.exec(line);
    const value = match ? plainMarkdown(match[1]) : null;
    return value && value.length >= 8 ? [{ title: value, text: value, sourcePath, anchor: section.heading }] : [];
  }).slice(0, limit);
}

function uniqueDashboardItems<Item extends RawDashboardItem>(items: Item[], limit: number): Item[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = plainMarkdown(item.text).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function questionItems(markdown: string, sourcePath: string, limit: number): RawDashboardItem[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const items: RawDashboardItem[] = [];
  for (let index = 0; index < lines.length && items.length < limit; index += 1) {
    const heading = /^(#{3,4})\s+(.+)$/.exec(lines[index]);
    if (!heading || !(/\?/.test(heading[2]) || /^q\d+\b/i.test(plainMarkdown(heading[2])))) continue;
    const level = heading[1].length;
    const block: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeading = /^(#{1,6})\s+/.exec(lines[cursor]);
      if (nextHeading && nextHeading[1].length <= level) break;
      block.push(lines[cursor]);
    }
    const directIndex = block.findIndex((line) => /^#{4,6}\s+.*(?:direct answer|short answer|answer)/i.test(line));
    const answerLines: string[] = [];
    if (directIndex >= 0) {
      const answerLevel = /^(#{1,6})/.exec(block[directIndex])?.[1].length ?? 6;
      for (const line of block.slice(directIndex + 1)) {
        const nextHeading = /^(#{1,6})\s+/.exec(line);
        if (nextHeading && nextHeading[1].length <= answerLevel) break;
        answerLines.push(line);
      }
    }
    const answer = firstUsefulText(answerLines.join("\n"), 420)
      ?? firstUsefulText(block.join("\n"), 340)
      ?? "Open the question bank for the prepared answer and evidence.";
    items.push({ title: plainMarkdown(heading[2]), text: answer, sourcePath });
  }
  return items;
}

async function readArtifact(workspacePath: string, path: string | null): Promise<string> {
  if (!path) return "";
  const absolute = assertInsideWorkspace(workspacePath, join(workspacePath, path));
  return readFile(absolute, "utf8").catch(() => "");
}

function practiceDashboardItems(raw: string, sourcePath: string): InterviewDashboardItem[] {
  if (!raw || !sourcePath) return [];
  try {
    const parsed = challengePracticeSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return parsed.data.exercises.map((exercise) => dashboardItem({ title: exercise.title, text: exercise.prompt, sourcePath, anchor: exercise.id }, "challenge", "primary"));
  } catch { return []; }
}

async function buildDashboardBrief(workspacePath: string, round: InterviewRound): Promise<InterviewDashboardBrief> {
  const paths = round.artifactPaths;
  const [prep, questionBank, research, challengeBrief, practiceLabs, debriefAnalysis] = await Promise.all([
    readArtifact(workspacePath, paths.prep),
    readArtifact(workspacePath, paths.questionBank),
    readArtifact(workspacePath, paths.research),
    readArtifact(workspacePath, paths.challengeBrief),
    readArtifact(workspacePath, paths.practiceLabs),
    readArtifact(workspacePath, paths.debriefAnalysis),
  ]);
  const quickAnswers = sectionItems(prep, paths.prep ?? "", /tell me about yourself|career intro|introduction|why (?:this )?(?:company|role)|why .*|current role|current company|why leaving|career (?:arc|transition)/i, 10).map((item) => dashboardItem(item, "answer", "primary"));
  const priorityQuestions = questionItems(questionBank, paths.questionBank ?? "", 16).map((item) => dashboardItem(item, "question", "primary"));
  const questionsToAsk = listItemsFromSection(questionBank, paths.questionBank ?? "", /questions to ask/i, 10).map((item) => dashboardItem(item, "reverse_question", "secondary"));
  const cautions = [
    ...sectionItems(prep, paths.prep ?? "", /caution|avoid|gap|truth|clarif|qualif/i, 6),
    ...sectionItems(questionBank, paths.questionBank ?? "", /scope|truthfulness caution/i, 4),
  ].slice(0, 10).map((item) => dashboardItem(item, "caution", "primary"));
  const researchList = listItemsFromSection(research, paths.research ?? "", /company|product|role|research|what .* does|signals|recent/i, 8);
  const companyFacts = uniqueDashboardItems(researchList.length ? researchList : sectionItems(research, paths.research ?? "", /company|product|role|research|what .* does|signals|recent/i, 10), 10).map((item) => dashboardItem(item, "company_fact", "secondary", "official"));
  const technicalTopics = priorityQuestions.filter((item) => /api|sdk|system|debug|data|technical|architecture|code|sql|cloud|integration|webhook/i.test(`${item.title} ${item.text}`)).slice(0, 10).map((item) => ({ ...item, category: "technical" as const }));
  const challengeTopics = sectionItems(challengeBrief, paths.challengeBrief ?? "", /challenge|exercise|assessment|practice|scenario|implementation/i, 10).map((item) => dashboardItem(item, "challenge", "primary"));
  const practiceReferences = practiceDashboardItems(practiceLabs, paths.practiceLabs ?? "");
  const debriefReferences = sectionItems(debriefAnalysis, paths.debriefAnalysis ?? "", /worked|strength|improv|missed|lesson|next|question/i, 10).map((item) => dashboardItem(item, "debrief_lesson", "secondary", "reported"));
  const references = uniqueDashboardItems([
    ...priorityQuestions,
    ...quickAnswers,
    ...companyFacts,
    ...technicalTopics,
    ...challengeTopics,
    ...practiceReferences,
    ...questionsToAsk,
    ...cautions,
    ...debriefReferences,
  ], 60);
  const availableArtifactCount = Object.values(paths).filter(Boolean).length;
  return { priorityQuestions, quickAnswers, companyFacts, questionsToAsk, cautions, technicalTopics: uniqueDashboardItems([...technicalTopics, ...challengeTopics], 16), references, availableArtifactCount, expectedArtifactCount: round.stage === "technical_challenge" ? 5 : 3 };
}

function normalizeStage(value: unknown): InterviewStage {
  const normalized = text(value)?.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ") ?? "";
  if (normalized.includes("recruit") || normalized.includes("intro") || normalized.includes("screen")) return "recruiter_screen";
  if (normalized.includes("hiring manager") || normalized.includes("head of") || normalized.includes("manager")) return "hiring_manager";
  if (normalized.includes("technical challenge") || normalized.includes("coding test") || normalized.includes("live coding") || normalized.includes("implementation walkthrough")) return "technical_challenge";
  if (normalized.includes("take home") || normalized.includes("takehome") || normalized.includes("exercise")) return "take_home";
  if (normalized.includes("onsite") || normalized.includes("on site")) return "onsite";
  if (normalized.includes("executive") || normalized.includes("founder") || normalized.includes("ceo")) return "executive";
  if (normalized.includes("technical") || normalized.includes("engineering")) return "technical";
  return "unknown";
}

function normalizeStatus(value: unknown, hasDebrief: boolean): InterviewRoundStatus {
  if (hasDebrief) return "debriefed";
  const normalized = text(value)?.toLowerCase() ?? "";
  if (normalized.includes("debrief")) return "debriefed";
  if (normalized.includes("complete")) return "completed";
  if (normalized.includes("ready") || normalized.includes("prep")) return "prep_ready";
  return "planned";
}

function normalizeAssessmentMode(value: unknown): ChallengeAssessmentMode | null {
  const normalized = text(value)?.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_|_$/g, "") ?? "";
  return ["live_coding", "debugging", "implementation_walkthrough", "system_design", "take_home", "case_study", "mixed", "unknown"].includes(normalized)
    ? normalized as ChallengeAssessmentMode
    : null;
}

function safeRelativeArtifact(jobId: string, value: unknown): string | null {
  const path = text(value);
  if (!path || path.includes("\\") || path.split("/").includes("..")) return null;
  const normalized = normalize(path).replaceAll("\\", "/");
  const canonical = path.startsWith(`jobs/${jobId}/`) ? path : `jobs/${jobId}/${path}`;
  return normalized === path && canonical.startsWith(`jobs/${jobId}/interviews/`) ? canonical : null;
}

function safeDebriefSource(value: unknown): value is string {
  if (typeof value !== "string" || value.includes("\\") || value.split("/").includes("..")) return false;
  return normalize(value).replaceAll("\\", "/") === value && value.startsWith("debrief/");
}

function parseArtifactPaths(jobId: string, value: unknown): InterviewArtifactPaths {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
  if (Array.isArray(value)) {
    const legacyPaths = value
      .filter((candidate): candidate is string => typeof candidate === "string")
      .map((candidate) => candidate.startsWith("jobs/") ? candidate : `jobs/${jobId}/${candidate}`)
      .map((candidate) => safeRelativeArtifact(jobId, candidate))
      .filter((candidate): candidate is string => Boolean(candidate));
    const byName = (name: string): string | null => legacyPaths.find((candidate) => basename(candidate) === name) ?? null;
    return {
      research: byName("research.md"),
      prep: byName("prep.md"),
      questionBank: byName("question_bank.md"),
      challengeBrief: byName("challenge_brief.md"),
      practiceLabs: byName("practice_labs.json"),
      debriefAnalysis: byName("debrief_analysis.md"),
    };
  }
  return {
    research: safeRelativeArtifact(jobId, record.research),
    prep: safeRelativeArtifact(jobId, record.prep),
    questionBank: safeRelativeArtifact(jobId, record.questionBank),
    challengeBrief: safeRelativeArtifact(jobId, record.challengeBrief),
    practiceLabs: safeRelativeArtifact(jobId, record.practiceLabs),
    debriefAnalysis: safeRelativeArtifact(jobId, record.debriefAnalysis),
  };
}

function parseRound(jobId: string, value: unknown, index: number): InterviewRound | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as JsonRecord;
  const sequence = typeof record.sequence === "number" && Number.isInteger(record.sequence) && record.sequence > 0 ? record.sequence : index + 1;
  const stage = normalizeStage(record.stage);
  const artifactPaths = parseArtifactPaths(jobId, record.artifactPaths);
  const debriefSourcePaths = Array.isArray(record.debriefSourcePaths)
    ? record.debriefSourcePaths.filter(safeDebriefSource)
    : [];
  const storedDashboardBrief = interviewDashboardBriefSchema.safeParse(record.dashboardBrief);
  return {
    id: text(record.id) ?? `${String(sequence).padStart(2, "0")}-${stage.replaceAll("_", "-")}`,
    sequence,
    stage,
    label: text(record.label) ?? stageLabels[stage],
    interviewer: text(record.interviewer),
    format: text(record.format),
    assessmentMode: normalizeAssessmentMode(record.assessmentMode),
    scheduledDate: text(record.scheduledDate),
    status: normalizeStatus(record.status, Boolean(artifactPaths.debriefAnalysis)),
    legacy: record.legacy === true,
    artifactPaths,
    debriefSourcePaths,
    dashboardBrief: storedDashboardBrief.success ? storedDashboardBrief.data : null,
  };
}

function parseKnownProcess(value: unknown): KnownInterviewStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as JsonRecord;
    const sourceType = text(record.sourceType);
    if (!sourceType || !["official", "reported_by_interviewer", "reported", "inferred"].includes(sourceType)) return [];
    const stage = normalizeStage(record.stage ?? record.label);
    return [{
      stage,
      label: text(record.label) ?? stageLabels[stage],
      interviewer: text(record.interviewer),
      format: text(record.format),
      sourceType: sourceType as KnownInterviewStep["sourceType"],
    }];
  });
}

async function discoverDebriefPaths(workspacePath: string, company: string | null): Promise<string[]> {
  if (!company) return [];
  const slug = company.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  const candidates = [...new Set([slug, slug.replace(/-inc$|-llc$|-ltd$/, ""), slug.split("-")[0]])].filter(Boolean);
  for (const candidate of candidates) {
    const root = assertInsideWorkspace(workspacePath, join(workspacePath, "debrief", candidate));
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const paths = entries
      .filter((entry) => entry.isFile() && /\.(txt|md)$/i.test(entry.name))
      .map((entry) => `debrief/${candidate}/${entry.name}`)
      .sort();
    if (paths.length) return paths;
  }
  return [];
}

async function legacyOverview(workspacePath: string, jobId: string, job: JsonRecord, interview: JsonRecord, interviewRoot: string): Promise<InterviewOverview> {
  const company = text(interview.company) ?? text(job.company);
  const role = text(interview.role) ?? text(job.title) ?? text(job.role);
  const roundText = text(interview.round);
  const stage = normalizeStage(roundText);
  const artifactPaths = {
    research: await exists(join(interviewRoot, "research.md")) ? `jobs/${jobId}/interviews/research.md` : null,
    prep: await exists(join(interviewRoot, "prep.md")) ? `jobs/${jobId}/interviews/prep.md` : null,
    questionBank: await exists(join(interviewRoot, "question_bank.md")) ? `jobs/${jobId}/interviews/question_bank.md` : null,
    challengeBrief: await exists(join(interviewRoot, "challenge_brief.md")) ? `jobs/${jobId}/interviews/challenge_brief.md` : null,
    practiceLabs: await exists(join(interviewRoot, "practice_labs.json")) ? `jobs/${jobId}/interviews/practice_labs.json` : null,
    debriefAnalysis: await exists(join(interviewRoot, "debrief_analysis.md")) ? `jobs/${jobId}/interviews/debrief_analysis.md` : null,
  };
  const debriefSourcePaths = await discoverDebriefPaths(workspacePath, company);
  const round: InterviewRound = {
    id: `01-${stage.replaceAll("_", "-")}`,
    sequence: 1,
    stage,
    label: roundText ?? stageLabels[stage],
    interviewer: text(interview.interviewer),
    format: text(interview.format),
    assessmentMode: normalizeAssessmentMode(interview.assessmentMode),
    scheduledDate: text(interview.scheduledDate),
    status: normalizeStatus(interview.status, Boolean(artifactPaths.debriefAnalysis)),
    legacy: true,
    artifactPaths,
    debriefSourcePaths,
    dashboardBrief: null,
  };
  return interviewOverviewSchema.parse({
    schemaVersion: 1,
    jobId,
    company,
    role,
    currentRoundId: round.id,
    rounds: [round],
    knownProcess: [],
    isLegacy: true,
  });
}

export async function getInterviewOverview(workspacePath: string, jobId: string, refreshDashboard = false): Promise<InterviewOverview | null> {
  if (!/^[a-zA-Z0-9._-]+$/.test(jobId)) throw new Error("Job identifier is invalid.");
  const jobRoot = assertInsideWorkspace(workspacePath, join(workspacePath, "jobs", jobId));
  const interviewRoot = assertInsideWorkspace(workspacePath, join(jobRoot, "interviews"));
  const interview = await readJson(join(interviewRoot, "interview.json"));
  if (!interview) return null;
  const job = await readJson(join(jobRoot, ".sensei", "job.json"))
    ?? await readJson(join(jobRoot, "job.json"))
    ?? {};

  if (interview.schemaVersion === 2 && Array.isArray(interview.rounds)) {
    const rounds = interview.rounds.flatMap((round, index) => {
      const parsed = parseRound(jobId, round, index);
      return parsed ? [parsed] : [];
    }).sort((a, b) => a.sequence - b.sequence);
    const enrichedRounds = await Promise.all(rounds.map(async (round) => ({ ...round, dashboardBrief: refreshDashboard || !round.dashboardBrief ? await buildDashboardBrief(workspacePath, round) : round.dashboardBrief })));
    return interviewOverviewSchema.parse({
      schemaVersion: 2,
      jobId,
      company: text(interview.company) ?? text(job.company),
      role: text(interview.role) ?? text(job.title) ?? text(job.role),
      currentRoundId: text(interview.currentRoundId),
      rounds: enrichedRounds,
      knownProcess: parseKnownProcess(interview.knownProcess),
      isLegacy: false,
    });
  }

  const legacy = await legacyOverview(workspacePath, jobId, job, interview, interviewRoot);
  return interviewOverviewSchema.parse({
    ...legacy,
    rounds: await Promise.all(legacy.rounds.map(async (round) => ({ ...round, dashboardBrief: round.dashboardBrief ?? await buildDashboardBrief(workspacePath, round) }))),
  });
}

export async function refreshInterviewDashboard(workspacePath: string, jobId: string): Promise<InterviewOverview | null> {
  return getInterviewOverview(workspacePath, jobId, true);
}

export async function listInterviewRounds(workspacePath: string, jobId: string): Promise<InterviewRound[]> {
  return (await getInterviewOverview(workspacePath, jobId))?.rounds ?? [];
}

export async function setCurrentInterviewRound(workspacePath: string, jobId: string, roundId: string): Promise<InterviewOverview | null> {
  if (!/^[a-zA-Z0-9._-]+$/.test(jobId) || !/^[a-zA-Z0-9._-]+$/.test(roundId)) throw new Error("Interview identifiers are invalid.");
  const interviewPath = assertInsideWorkspace(workspacePath, join(workspacePath, "jobs", jobId, "interviews", "interview.json"));
  const interview = await readJson(interviewPath);
  if (!interview || !Array.isArray(interview.rounds)) throw new Error("This job does not have selectable interview rounds.");
  if (!interview.rounds.some((round) => Boolean(round && typeof round === "object" && !Array.isArray(round) && (round as JsonRecord).id === roundId))) {
    throw new Error("The selected interview round does not exist.");
  }
  await writeJsonAtomic(interviewPath, { ...interview, currentRoundId: roundId });
  return getInterviewOverview(workspacePath, jobId);
}
