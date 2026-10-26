import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { evidenceSnapshotSchema, type ArtifactFile, type FileTreeNode, type JobFolderSummary } from "../src/shared/schemas";
import { previewFile } from "./files";
import { assertInsideWorkspace } from "./workspace";
import { normalizeEvidenceClassifications, scoreEvaluation } from "./fit-scoring";
import { parseJobDescriptionMetadata } from "./job-description";
import { readJobTracker } from "./tracker";

type JsonRecord = Record<string, unknown>;

async function readJson(path: string): Promise<JsonRecord> {
  return readFile(path, "utf8").then((raw) => JSON.parse(raw) as JsonRecord).catch(() => ({}));
}

function stringValue(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() ?? null;
}

function parseCompanyAndTitle(value: string): { company: string | null; title: string | null } {
  const roleAtCompany = /^(.+?)\s+@\s+(.+)$/.exec(value.trim());
  if (roleAtCompany) return { company: roleAtCompany[2].trim() || null, title: roleAtCompany[1].trim() || null };
  const roleAt = /^(.+?)\s+at\s+(.+)$/i.exec(value.trim());
  if (roleAt) return { company: roleAt[2].trim() || null, title: roleAt[1].trim() || null };
  const separator = value.search(/\s+-\s+/);
  if (separator < 0) return { company: value.trim() || null, title: null };
  return {
    company: value.slice(0, separator).trim() || null,
    title: value.slice(separator).replace(/^\s+-\s+/, "").trim() || null,
  };
}

function headingMetadata(markdown: string): { company: string | null; title: string | null } {
  const heading = markdown.match(/^#\s+(?:Job\s+)?Evaluation:\s*(.+)$/im)?.[1]?.trim();
  if (!heading) return { company: null, title: null };
  return parseCompanyAndTitle(heading);
}

async function legacyJobMetadata(jobPath: string): Promise<{ company: string | null; title: string | null }> {
  const evaluation = await readFile(join(jobPath, "evaluation.md"), "utf8").catch(() => "");
  const labeledEvaluation = parseJobDescriptionMetadata(evaluation, { headingFallback: false });
  if (labeledEvaluation.company || labeledEvaluation.title) {
    return { company: labeledEvaluation.company, title: labeledEvaluation.title };
  }
  const fromEvaluation = headingMetadata(evaluation);
  if (fromEvaluation.company || fromEvaluation.title) return fromEvaluation;

  const jobDescription = await readFile(join(jobPath, "original_jd.md"), "utf8")
    .catch(() => readFile(join(jobPath, "original_jd.txt"), "utf8"))
    .catch(() => "");
  const labeledDescription = parseJobDescriptionMetadata(jobDescription);
  if (labeledDescription.company || labeledDescription.title) {
    return { company: labeledDescription.company, title: labeledDescription.title };
  }
  const lines = jobDescription.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, "").trim()).filter(Boolean);
  const first = lines.find((line) => !/^original job description$/i.test(line)
    && !/^(summary|about|description|job summary)$/i.test(line)
    && !/^(location|department|employment|commitment|compensation):/i.test(line));
  if (!first) return { company: null, title: null };
  const next = lines[lines.indexOf(first) + 1];
  const parsed = parseCompanyAndTitle(first);
  if (parsed.title) return parsed;
  return { company: first, title: next && !/^location:/i.test(next) ? next : null };
}

function normalizedDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

async function creationDate(jobPath: string, entries: Array<{ name: string; isFile(): boolean }>, metadataCreatedAt: unknown, fallback: string): Promise<string> {
  // The JD is written when a workspace is first added. Its birth time avoids
  // AI-authored timestamps that may incorrectly label local time as UTC.
  const jobDescriptions = entries
    .filter((entry) => entry.isFile() && /^original_jd\.(md|txt)$/i.test(entry.name))
    .map((entry) => join(jobPath, entry.name));
  const descriptionDates = await Promise.all(jobDescriptions.map(async (candidate) => {
    try { return (await stat(candidate)).birthtimeMs; }
    catch { return null; }
  }));
  const validDescriptionDates = descriptionDates.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (validDescriptionDates.length) return new Date(Math.min(...validDescriptionDates)).toISOString();

  const runCreatedAt = await readJson(join(jobPath, ".sensei", "application_run.json"))
    .then((run) => normalizedDate(run.createdAt));
  return runCreatedAt ?? normalizedDate(metadataCreatedAt) ?? fallback;
}

function cleanMarkdownLine(value: string): string {
  return value
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sectionBullets(markdown: string, headingPattern: RegExp, limit = 4): string[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const headingIndex = lines.findIndex((line) => /^#{2,4}\s+/.test(line) && headingPattern.test(line));
  if (headingIndex < 0) return [];
  const result: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (/^#{1,4}\s+/.test(line)) break;
    if (!/^\s*[-*+]\s+/.test(line)) continue;
    const cleaned = cleanMarkdownLine(line);
    if (cleaned) result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function evaluationInsights(markdown: string): Pick<JobFolderSummary, "ratingDecision" | "ratingConfidence" | "ratingHighlights" | "ratingGaps"> {
  const decision = markdown.match(/(?:gate status|screening status|recommendation)\s*[:|]\s*\*{0,2}`?([^\n*`|]+)/i)?.[1]?.trim() ?? null;
  const confidence = markdown.match(/(?:fit confidence|confidence)\s*[:|]\s*\*{0,2}`?([^\n*`|]+)/i)?.[1]?.trim() ?? null;
  const ratingHighlights = sectionBullets(markdown, /direct matches?|strengths?|transferable evidence/i);
  const ratingGaps = sectionBullets(markdown, /gaps?|risks?|hard blockers?/i);
  return { ratingDecision: decision, ratingConfidence: confidence, ratingHighlights, ratingGaps };
}

export async function readRating(jobPath: string, status: JsonRecord): Promise<number | null> {
  const evaluation = await readFile(join(jobPath, "evaluation.md"), "utf8").catch(() => "");
  try {
    // Apply the same evidence ceiling used by validation without rewriting old evaluations.
    const snapshot = await readFile(join(jobPath, ".sensei", "evidence_snapshot.json"), "utf8")
      .then((raw) => evidenceSnapshotSchema.parse(JSON.parse(raw)))
      .catch(() => null);
    const boundedEvaluation = snapshot ? normalizeEvidenceClassifications(evaluation, snapshot).markdown : evaluation;
    const deterministic = scoreEvaluation(boundedEvaluation);
    if (deterministic) return deterministic.score;
  } catch {
    // Preserve the declared legacy score when a generated scoring table is malformed.
  }
  for (const value of [status.screeningScore, status.gateScore, status.rating, status.score]) {
    if (typeof value === "number" && value >= 0 && value <= 5) return value;
  }
  const labels = /overall\s+(?:fit\s+)?(?:score|rating)|weighted\s+(?:fit\s+|match\s+|experience\s+)?(?:score|rating)|fit\s+(?:score|rating)|total\s*\/\s*final\s+score|total\s+weighted\s+score|original\s+score|(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?score\s*:/ig;
  const candidates: string[] = [];
  for (const match of evaluation.matchAll(labels)) {
    candidates.push(evaluation.slice(match.index ?? 0, (match.index ?? 0) + 320));
  }
  // Table rows can place the label and value in separate Markdown cells, so
  // also accept a row whose label contains both "total" and "score".
  candidates.push(...evaluation.split("\n").filter((line) => /total|final|weighted|overall|fit/i.test(line) && /\d+(?:\.\d+)?\s*\/\s*(?:5(?:\.0)?|100)/i.test(line)));
  for (const candidate of candidates) {
    const match = candidate.match(/(\d{1,3}(?:\.\d+)?)\s*\/\s*(100|5(?:\.0)?)/i);
    if (!match) continue;
    const raw = Number(match[1]);
    const denominator = Number(match[2]);
    const parsed = denominator === 100 ? raw / 20 : raw;
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 5) return parsed;
  }
  return null;
}

async function readCurrentInterviewLabel(jobPath: string): Promise<string | null> {
  const interview = await readJson(join(jobPath, "interviews", "interview.json"));
  const rounds = Array.isArray(interview.rounds) ? interview.rounds.filter((round): round is JsonRecord => Boolean(round && typeof round === "object" && !Array.isArray(round))) : [];
  const currentId = stringValue(interview.currentRoundId);
  const current = rounds.find((round) => stringValue(round.id) === currentId) ?? rounds.at(-1);
  return current ? stringValue(current.label, current.stage) : stringValue(interview.round, interview.stage);
}

// Per-job caches so a refresh rereads only the jobs that changed (159 jobs took ~250 ms per full scan).
// Summaries are keyed by the mtimes of everything they read; .sensei writes never reach the
// watcher, so they cannot rely on invalidation. Trees exclude .sensei, so the watcher clears them.
const SUMMARY_INPUTS = [
  "", ".sensei", "interviews", ".sensei/job.json", "job.json", ".sensei/status.json", "status.json", "evaluation.md",
  "original_jd.md", "original_jd.txt", ".sensei/application_run.json", ".sensei/evidence_snapshot.json", ".sensei/tracker.json",
  "interviews/interview.json",
];
const summaryCache = new Map<string, { key: string; summary: JobFolderSummary }>();
const treeCache = new Map<string, { key: string; node: FileTreeNode | null }>();

async function summaryKey(jobPath: string): Promise<string> {
  const times = await Promise.all(SUMMARY_INPUTS.map((input) => stat(join(jobPath, input)).then((info) => info.mtimeMs, () => 0)));
  return times.join(":");
}

/** Called by the workspace watcher with a workspace-relative path; clears that job's cached tree. */
export function invalidateJobCache(workspacePath: string, changedPath: string): void {
  const match = /^jobs\/([^/]+)/.exec(changedPath.replaceAll("\\", "/"));
  if (!match) return;
  const path = join(workspacePath, "jobs", match[1]);
  summaryCache.delete(path);
  treeCache.delete(path);
}

export async function listJobFolders(workspacePath: string): Promise<JobFolderSummary[]> {
  const root = assertInsideWorkspace(workspacePath, join(workspacePath, "jobs"));
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const summaries = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const path = join(root, entry.name);
    const key = await summaryKey(path);
    const cached = summaryCache.get(path);
    if (cached?.key === key) return cached.summary;
    const summary = await readJobSummary(path, entry.name);
    summaryCache.set(path, { key, summary });
    return summary;
  }));
  return summaries.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.name.localeCompare(b.name));
}

async function readJobSummary(path: string, name: string): Promise<JobFolderSummary> {
  const files = await readdir(path, { withFileTypes: true });
  const info = await stat(path);
  const metadata = await readFile(join(path, ".sensei", "job.json"), "utf8")
    .catch(() => readFile(join(path, "job.json"), "utf8"))
    .then((raw) => JSON.parse(raw) as JsonRecord)
    .catch(() => ({} as JsonRecord));
  const status = await readJson(join(path, ".sensei", "status.json"));
  const legacyStatus = Object.keys(status).length ? status : await readJson(join(path, "status.json"));
  const metadataFallback = await legacyJobMetadata(path);
  const title = stringValue(metadata.title, metadata.role, legacyStatus.title, legacyStatus.role, metadataFallback.title);
  const company = stringValue(metadata.company, legacyStatus.company, metadataFallback.company);
  const hasResume = files.some((file) => file.isFile() && /_Resume\.md$/i.test(file.name));
  const hasCoverLetter = files.some((file) => file.isFile() && file.name.toLowerCase() === "cover_letter.md");
  const hasApplicationMaterials = hasResume || hasCoverLetter;
  const applicationStage = stringValue(legacyStatus.status, legacyStatus.stage, legacyStatus.pipelineStage, metadata.status)
    ?? (hasApplicationMaterials ? "application_ready" : null);
  const evaluation = await readFile(join(path, "evaluation.md"), "utf8").catch(() => "");
  const [rating, interviewRoundLabel] = await Promise.all([readRating(path, legacyStatus), readCurrentInterviewLabel(path)]);
  const insights = evaluationInsights(evaluation);
  const createdAt = await creationDate(path, files, metadata.createdAt, info.birthtime.toISOString());
  return {
    id: name,
    relativePath: `jobs/${name}`,
    name: name,
    title,
    company,
    createdAt,
    modifiedAt: info.mtime.toISOString(),
    artifactCount: files.filter((file) => file.isFile()).length,
    applicationStage,
    rating,
    ...insights,
    location: stringValue(metadata.location, legacyStatus.location),
    interviewRoundLabel,
    hasApplicationMaterials,
    tracker: await readJobTracker(path),
  };
}

export async function listJobArtifacts(workspacePath: string, jobId: string): Promise<ArtifactFile[]> {
  const root = assertInsideWorkspace(workspacePath, join(workspacePath, "jobs", jobId));
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const artifacts: ArtifactFile[] = [];
  const hasMarkdownJobDescription = entries.some((entry) => entry.isFile() && entry.name === "original_jd.md");
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === "original_jd.txt" && hasMarkdownJobDescription) continue;
    const path = join(root, entry.name);
    const info = await stat(path);
    const preview = await previewFile(workspacePath, `jobs/${jobId}/${entry.name}`);
    artifacts.push({ relativePath: preview.relativePath, name: basename(path), fileType: preview.fileType, sizeBytes: info.size, modifiedAt: info.mtime.toISOString() });
  }
  return artifacts.sort((a, b) => a.name.localeCompare(b.name));
}

function typeForName(name: string): FileTreeNode["fileType"] {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".docx" || extension === ".doc") return "docx";
  if (extension === ".rtf") return "rtf";
  if (extension === ".json") return "json";
  if ([".txt", ".md", ".log", ".csv"].includes(extension)) return "text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension)) return "image";
  return "unknown";
}

async function treeNode(workspacePath: string, path: string, relativePath: string): Promise<FileTreeNode | null> {
  const info = await stat(path).catch(() => null);
  if (!info) return null;
  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    const children: FileTreeNode[] = [];
    const hasMarkdownJobDescription = entries.some((entry) => entry.isFile() && entry.name === "original_jd.md");
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".DS_Store" || entry.name === ".sensei") continue;
      if (entry.name === "original_jd.txt" && hasMarkdownJobDescription) continue;
      const child = await treeNode(workspacePath, join(path, entry.name), `${relativePath}/${entry.name}`);
      if (child) children.push(child);
    }
    return { name: basename(path), relativePath, kind: "directory", children };
  }
  return { name: basename(path), relativePath, kind: "file", fileType: typeForName(basename(path)), sizeBytes: info.size, modifiedAt: info.mtime.toISOString() };
}

export async function listJobTree(workspacePath: string): Promise<FileTreeNode[]> {
  const root = assertInsideWorkspace(workspacePath, join(workspacePath, "jobs"));
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nodes: FileTreeNode[] = [];
  const summaries = new Map((await listJobFolders(workspacePath)).map((job) => [job.id, job]));
  const jobs = entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const treeNodes = await Promise.all(jobs.map(async (entry) => {
    const path = join(root, entry.name);
    // The folder mtime guards against missed watcher events (entries added or removed).
    const key = String(await stat(path).then((info) => info.mtimeMs, () => 0));
    const cached = treeCache.get(path);
    if (cached?.key === key) return cached.node;
    const node = await treeNode(workspacePath, path, `jobs/${entry.name}`);
    treeCache.set(path, { key, node });
    return node;
  }));
  for (const [index, entry] of jobs.entries()) {
    const node = treeNodes[index];
    if (node) {
      const summary = summaries.get(entry.name);
      nodes.push({
        ...node,
        displayName: summary?.company ?? node.name,
        subtitle: summary?.title ?? undefined,
        rating: summary?.rating ?? null,
      });
    }
  }
  return nodes;
}
