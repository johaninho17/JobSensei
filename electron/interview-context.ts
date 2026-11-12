import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { postingRecordFor } from "./posting-record";
import { basename, join, resolve } from "node:path";
import { candidateProfileSchema, type CandidateProfile, type EvidenceSnapshot, type InterviewLogistics } from "../src/shared/schemas";
import { BANNED_PHRASES, createEvidenceSnapshot, narrativeStoryLines } from "./evidence-snapshot";
import { readActiveContextManifest } from "./context";
import { bestEvidenceForRequirement, parseMustHaves } from "./fit-scoring";
import { writeJsonAtomic, readTextFile } from "./persistence";
import { toDisk } from "../src/shared/workspace-layout";
import { assertInsideWorkspace, layoutVersion } from "./workspace";

/** The four canonical rounds and their question limits. Single owner for round IDs and bounds. */
export const INTERVIEW_STAGES = {
  recruiter_screen: { roundId: "01-recruiter-screen", label: "Recruiter screen", min: 6, max: 8 },
  hiring_manager: { roundId: "02-hiring-manager", label: "Hiring manager", min: 8, max: 10 },
  practical_evaluation: { roundId: "03-practical-evaluation", label: "Practical evaluation", min: 6, max: 8 },
  final_panel: { roundId: "04-final-panel", label: "Final panel", min: 6, max: 8 },
} as const;
export type CanonicalInterviewStage = keyof typeof INTERVIEW_STAGES;

export const STORY_BANK_PATH = "profile/story_bank.md";
export const INTERVIEW_VOICE_PATH = "profile/interview_voice.md";
export const INTERVIEW_MEMORY_ROOT = "debrief/interview-memory";
export const EVIDENCE_ID_PATTERN = /\b[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9.+-]*){2,}\b/gi;
export const STORY_ID_PATTERN = /\bS\d{1,2}\b/g;

export function normalizeInterviewStage(value: string): CanonicalInterviewStage {
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (/^(?:0?1_)?recruit|^screen|^phone|^ta_/.test(key)) return "recruiter_screen";
  if (/^(?:0?2_)?hiring|^hm$|^manager/.test(key)) return "hiring_manager";
  if (/^(?:0?3_)?(?:practical|technical|tech|case|role_play|system|challenge)/.test(key)) return "practical_evaluation";
  if (/^(?:0?4_)?(?:final|panel|team|onsite|on_site|executive|leadership)/.test(key)) return "final_panel";
  throw new Error(`Unknown interview stage "${value}". Use recruiter, hiring-manager, practical, or final-panel.`);
}

export function stageForRoundId(roundId: string): CanonicalInterviewStage | null {
  const entry = Object.entries(INTERVIEW_STAGES).find(([, stage]) => roundId === stage.roundId || roundId.startsWith(stage.roundId.slice(0, 3)));
  return entry ? entry[0] as CanonicalInterviewStage : null;
}

export interface Story {
  id: string;
  title: string;
  themes: string[];
  evidenceIds: string[];
  cues: string[];
  framingLimit: string;
}

/**
 * Story bank format (`data/profile/story_bank.md`):
 *   ## S1 · <title>
 *   - Themes: ownership, hard customer
 *   - Evidence: context:a:b, context:c:d
 *   - Cues: short cue · short cue · short cue
 *   - Framing limit: how strongly it can be told without inventing anything
 */
export function parseStoryBank(markdown: string): Story[] {
  const stories: Story[] = [];
  for (const block of markdown.replaceAll("\r\n", "\n").split(/\n(?=##\s+S\d{1,2}\b)/)) {
    const heading = /^##\s+(S\d{1,2})\b\s*[·:—–-]?\s*(.*)$/m.exec(block);
    if (!heading) continue;
    const field = (name: string) => new RegExp(`^\\s*[-*]\\s+\\*{0,2}${name}\\*{0,2}\\s*:\\*{0,2}\\s*(.+)$`, "im").exec(block)?.[1]?.trim() ?? "";
    const list = (value: string, separator: RegExp) => value.split(separator).map((item) => item.trim()).filter(Boolean);
    stories.push({
      id: heading[1]!,
      title: heading[2]!.trim(),
      themes: list(field("Themes"), /,/),
      evidenceIds: [...field("Evidence").matchAll(EVIDENCE_ID_PATTERN)].map((match) => match[0]),
      cues: list(field("Cues"), /\s+·\s+|;/),
      framingLimit: field("Framing limit"),
    });
  }
  return stories;
}

export interface InterviewVoice { deliveryFixes: string[]; phrases: string[]; structure: string[] }

function bulletsUnder(markdown: string, heading: RegExp): string[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => /^##\s+/.test(line) && heading.test(line));
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s+/.test(line)) break;
    const item = /^\s*[-*]\s+(.+)$/.exec(line)?.[1]?.trim();
    if (item) items.push(item);
  }
  return items;
}

/** Interview voice format (`data/profile/interview_voice.md`): `## Delivery fixes`, `## Phrases I use`, `## How I structure answers`. */
export function parseInterviewVoice(markdown: string): InterviewVoice {
  return {
    deliveryFixes: bulletsUnder(markdown, /delivery fixes/i).slice(0, 5),
    phrases: bulletsUnder(markdown, /phrases/i).slice(0, 12),
    structure: bulletsUnder(markdown, /structure/i).slice(0, 4),
  };
}

export interface QuestionBankUsage { questions: string[]; storyIds: string[]; reverseQuestions: string[] }

function sectionBody(markdown: string, heading: RegExp): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => /^##\s+/.test(line) && heading.test(line));
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** Questions, story IDs, and reverse questions a round already used (for no-overlap across rounds). */
export function questionBankUsage(markdown: string): QuestionBankUsage {
  const questions = [...markdown.matchAll(/^###\s+(?:Question|Gap|Follow-up)\s*\d*\s*[:.]\s*(.+)$/gim)].map((match) => match[1]!.trim());
  const storyIds = [...new Set([...markdown.matchAll(/\*\*(?:Proof|Real example):?\*\*:?\s*(.+)$/gim)]
    .flatMap((match) => [...match[1]!.matchAll(STORY_ID_PATTERN)].map((id) => id[0])))];
  const reverseQuestions = sectionBody(markdown, /questions to ask/i).split("\n")
    .map((line) => /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line)?.[1]?.replace(/[*_"“”]/g, "").trim() ?? "")
    .filter((line) => line.length > 8);
  return { questions, storyIds, reverseQuestions };
}

export function logisticsLines(logistics: InterviewLogistics | undefined): Record<keyof InterviewLogistics, string | null> {
  const value = (text: string | undefined) => (text?.trim() ? text.trim() : null);
  return {
    location: value(logistics?.location),
    workAuthorization: value(logistics?.workAuthorization),
    compensation: value(logistics?.compensation),
    noticePeriod: value(logistics?.noticePeriod),
    workArrangement: value(logistics?.workArrangement),
  };
}

async function readText(workspace: string, relativePath: string): Promise<string> {
  return readTextFile(assertInsideWorkspace(workspace, join(workspace, relativePath))).catch(() => "");
}

async function readJsonFile<T>(workspace: string, relativePath: string): Promise<T | null> {
  const text = await readText(workspace, relativePath);
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

export const INTERVIEW_SNAPSHOT_DIR = "interviews/.sensei";

/**
 * The evidence interview prep reads. The application's snapshot is used while it is newer than every selected career
 * file and the selection itself; once the user changes their context (new dates, stories, files), a fresh snapshot is
 * built under `interviews/.sensei/` so prep never tells old facts, and the application's own files stay as they are.
 */
export async function interviewEvidence(workspace: string, jobId: string): Promise<EvidenceSnapshot | null> {
  const jobRoot = `jobs/${jobId}`;
  const changed = await newestContextChange(workspace);
  const modified = async (relativePath: string) => (await stat(assertInsideWorkspace(workspace, join(workspace, relativePath))).catch(() => null))?.mtimeMs ?? -1;
  for (const path of [`${jobRoot}/.sensei/evidence_snapshot.json`, `${jobRoot}/${INTERVIEW_SNAPSHOT_DIR}/evidence_snapshot.json`]) {
    if (await modified(path) >= changed) return readJsonFile<EvidenceSnapshot>(workspace, path);
  }
  try {
    return await createEvidenceSnapshot(workspace, jobId, { stateDir: INTERVIEW_SNAPSHOT_DIR });
  } catch {
    // Without a manifest or base resume, prep falls back to whatever snapshot the job has.
    return readJsonFile<EvidenceSnapshot>(workspace, `${jobRoot}/.sensei/evidence_snapshot.json`);
  }
}

/** When the user's selected career files (or the selection) last changed. */
async function newestContextChange(workspace: string): Promise<number> {
  const manifest = await readActiveContextManifest(workspace).catch(() => null);
  if (!manifest) return 0;
  const paths = [".sensei/active-context.json", "profile/candidate.json", ...manifest.sourceFiles.map((source) => source.path).filter((path) => !path.startsWith("jobs/"))];
  const times = await Promise.all(paths.map(async (path) => (await stat(assertInsideWorkspace(workspace, join(workspace, path))).catch(() => null))?.mtimeMs ?? 0));
  return Math.max(0, ...times);
}

/** Reads the matching generalized role memory (see interview-memory-contract.md). */
async function roleMemoryFor(workspace: string, title: string): Promise<{ family: string; path: string; patterns: string } | null> {
  const index = await readJsonFile<{ roles?: Array<{ family?: string; aliases?: string[]; path?: string }> }>(workspace, `${INTERVIEW_MEMORY_ROOT}/role-index.json`);
  const normalized = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const match = (index?.roles ?? []).find((role) => [role.family ?? "", ...(role.aliases ?? [])]
    .some((alias) => alias.trim() && normalized.includes(` ${alias.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `)));
  if (!match?.path) return null;
  const patterns = await readText(workspace, match.path);
  return patterns ? { family: match.family ?? "", path: toDisk(match.path, layoutVersion(workspace)), patterns: patterns.slice(0, 6000) } : null;
}

/**
 * Company research for this round: this job's own file, or a recent one (under 60 days) from another job at the same
 * company, whose company, news, and process sections Agy reuses (the pipeline skill owns how). Role sections are
 * always written fresh for this job.
 */
export async function companyResearchFor(workspace: string, jobId: string, company: string | null, now = new Date()): Promise<{ path: string | null; reuseFrom: string | null; reuseAgeDays: number | null }> {
  const own = `jobs/${jobId}/interviews/company_research.md`;
  if (await stat(join(workspace, own)).catch(() => null)) return { path: own, reuseFrom: null, reuseAgeDays: null };
  const key = (company ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|ltd|corp|co)\b/g, "").trim();
  if (!key) return { path: null, reuseFrom: null, reuseAgeDays: null };
  let best: { path: string; mtime: number } | null = null;
  for (const entry of await readdir(join(workspace, "jobs"), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.name === jobId) continue;
    const other = await readJsonFile<{ company?: string }>(workspace, `jobs/${entry.name}/.sensei/job.json`);
    const otherKey = (other?.company ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|ltd|corp|co)\b/g, "").trim();
    if (otherKey !== key) continue;
    const path = `jobs/${entry.name}/interviews/company_research.md`;
    const info = await stat(join(workspace, path)).catch(() => null);
    if (info && (!best || info.mtimeMs > best.mtime)) best = { path, mtime: info.mtimeMs };
  }
  const age = best ? Math.floor((now.getTime() - best.mtime) / 86_400_000) : null;
  return best && age !== null && age <= 60 ? { path: null, reuseFrom: best.path, reuseAgeDays: age } : { path: null, reuseFrom: null, reuseAgeDays: null };
}

export async function buildInterviewContext(workspacePath: string, jobId: string, stageInput: string, now = new Date()) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(jobId)) throw new Error("Job identifier is invalid.");
  const workspace = resolve(workspacePath);
  const stage = normalizeInterviewStage(stageInput);
  const spec = INTERVIEW_STAGES[stage];
  const jobRoot = `jobs/${jobId}`;
  const job = await readJsonFile<{ company?: string; title?: string; role?: string }>(workspace, `${jobRoot}/.sensei/job.json`)
    ?? await readJsonFile<{ company?: string; title?: string; role?: string }>(workspace, `${jobRoot}/job.json`);
  const jobDescription = await readText(workspace, `${jobRoot}/original_jd.md`) || await readText(workspace, `${jobRoot}/original_jd.txt`);
  if (!job || !jobDescription) throw new Error(`No job workspace with job.json and original_jd.md found for "${jobId}".`);
  // Fetched postings may leave job.json without a title; the JD's first heading is the fallback.
  const title = job.title ?? job.role ?? /^#\s+(.+)$/m.exec(jobDescription)?.[1]?.replace(/[*_]/g, "").trim() ?? "";

  const snapshot = await interviewEvidence(workspace, jobId);
  const selected = new Set(snapshot?.applicationRouting?.selectedEvidenceIds ?? []);
  const allRows = snapshot?.evidenceRows ?? [];
  const eligible = allRows.filter((row) => row.eligibility === "eligible" && !row.evidenceId.startsWith("job:"));
  const evaluation = await readText(workspace, `${jobRoot}/evaluation.md`);
  const gaps = parseMustHaves(evaluation).filter((row) => row.status !== "met").map((row) => {
    const closest = bestEvidenceForRequirement(row.requirement, eligible);
    return {
      requirement: row.requirement,
      status: row.status,
      note: row.note,
      closestEvidence: closest ? { evidenceId: closest, claim: eligible.find((candidate) => candidate.evidenceId === closest)?.claim ?? "" } : null,
    };
  });
  const routed = allRows.filter((row) => selected.has(row.evidenceId) && !row.evidenceId.startsWith("job:"));
  const gapEvidence = gaps.flatMap((gap) => (gap.closestEvidence ? [gap.closestEvidence.evidenceId] : []));
  const evidenceRows = [...routed, ...eligible.filter((row) => gapEvidence.includes(row.evidenceId) && !selected.has(row.evidenceId))]
    .map((row) => ({ evidenceId: row.evidenceId, claim: row.claim, scope: row.scope, employer: row.employer ?? null, year: row.year }));

  const profileRaw = await readJsonFile<unknown>(workspace, "profile/candidate.json");
  const profile: CandidateProfile | null = profileRaw ? candidateProfileSchema.safeParse(profileRaw).data ?? null : null;
  const stories = parseStoryBank(await readText(workspace, STORY_BANK_PATH));
  const voice = parseInterviewVoice(await readText(workspace, INTERVIEW_VOICE_PATH));

  const interviewsRoot = `${jobRoot}/interviews`;
  const entries = await readdir(assertInsideWorkspace(workspace, join(workspace, interviewsRoot)), { withFileTypes: true }).catch(() => []);
  const currentNumber = Number(spec.roundId.slice(0, 2));
  const priorRounds = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory() && /^0\d-/.test(candidate.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    if (Number(entry.name.slice(0, 2)) >= currentNumber) continue;
    const bank = await readText(workspace, `${interviewsRoot}/${entry.name}/question_bank.md`);
    if (bank) priorRounds.push({ roundId: entry.name, ...questionBankUsage(bank) });
  }

  const context = {
    schemaVersion: 1,
    jobId,
    stage,
    roundId: spec.roundId,
    generatedAt: now.toISOString(),
    job: {
      company: job.company ?? null,
      title: title || null,
      requiredItems: postingRecordFor(jobDescription).requiredItems,
      responsibilities: postingRecordFor(jobDescription).responsibilities,
    },
    gaps,
    evidenceRows,
    storyBank: { path: toDisk(STORY_BANK_PATH, layoutVersion(workspace)), exists: stories.length > 0, stories },
    voice: { path: toDisk(INTERVIEW_VOICE_PATH, layoutVersion(workspace)), ...voice },
    /** Career direction, story, working style, and values from Settings: the substance behind motivation questions. */
    careerStory: narrativeStoryLines(profile),
    logistics: logisticsLines(profile?.preferences.interview),
    roleMemory: await roleMemoryFor(workspace, title),
    priorRounds,
    companyResearch: await companyResearchFor(workspace, jobId, job.company ?? null, now),
    rules: {
      questionLimits: { min: spec.min, max: spec.max },
      bannedPhrases: BANNED_PHRASES,
      confidentialNamesAllowedInPrep: true,
      outputFiles: [`${interviewsRoot}/${spec.roundId}/prep.md`, `${interviewsRoot}/${spec.roundId}/question_bank.md`, `${interviewsRoot}/company_research.md`],
    },
  };
  const stateDir = assertInsideWorkspace(workspace, join(workspace, interviewsRoot, ".sensei"));
  await mkdir(stateDir, { recursive: true });
  const contextPath = `${interviewsRoot}/.sensei/interview_context.json`;
  await writeJsonAtomic(join(workspace, contextPath), context);
  await writeJsonAtomic(join(stateDir, `run_timing_${spec.roundId}.json`), { startedAt: now.toISOString() });
  return { contextPath, context };
}

function defaultWorkspace(): string {
  const configured = process.env.SENSEI_WORKSPACE;
  if (configured) return resolve(configured);
  return basename(process.cwd()) === "data" ? process.cwd() : resolve(process.cwd(), "data");
}

if (require.main === module) {
  const [jobId, stage] = process.argv.slice(2);
  if (!jobId || !stage) {
    process.stderr.write("Usage: npm run interview:context -- <job-id> <recruiter|hiring-manager|practical|final-panel>\n");
    process.exitCode = 1;
  } else {
    buildInterviewContext(defaultWorkspace(), jobId, stage)
      .then(({ contextPath, context }) => {
        process.stdout.write(`${JSON.stringify({
          roundId: context.roundId,
          questionLimits: context.rules.questionLimits,
          requiredItems: context.job.requiredItems.length,
          gaps: context.gaps.length,
          evidenceRows: context.evidenceRows.length,
          stories: context.storyBank.stories.length,
          storyBankMissing: !context.storyBank.exists,
          logisticsMissing: Object.entries(context.logistics).filter(([, value]) => !value).map(([key]) => key),
          priorRounds: context.priorRounds.map((round) => round.roundId),
          next: `Read ${contextPath} once (the whole file), then write the round files.`,
        }, null, 2)}\n`);
      })
      .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 2;
      });
  }
}
