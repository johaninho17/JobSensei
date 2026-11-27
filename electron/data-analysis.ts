// Data analysis (#200, decision U120). The app finds the facts (posting demand without evidence, row years, file dates,
// clashing years, duplicate claims) and writes them as a brief; one background Agy call answers in the findings JSON
// (src/shared/data-analysis.ts, rules for Agy: .agents/workflows/jobsensei-data-analysis.md); `checkFindings` drops what
// breaks a rule; the user decides each finding. Accept and Edit write through answer filing's `writeRecordRow` (after a
// backup); Ask becomes a Profile question; Refuse is remembered. Nothing changes without a pick.
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CandidateProfile, JobFolderSummary } from "../src/shared/schemas";
import { computeLearnings } from "../src/shared/learnings";
import { checkFindings, findingSchema, replySchema, type AnalysisView, type FixRow, type StoredFinding, findingKey } from "../src/shared/data-analysis";
import { writeRecordRow } from "./answer-filing";
import { loadCanonicalResumeBaseline } from "./canonical-resume";
import { loadVocabulary } from "./job-search";
import { readJson, writeJsonAtomic } from "./persistence";
import { addQuestion } from "./profile-questions";
import type { AgyRunner } from "./question-agent";
import { workspaceFile } from "./workspace";

const RECORDS_DIR = "context/structured";
const WORKFLOW = ".agents/workflows/jobsensei-data-analysis.md";
export const ANALYSIS_DIR = ".sensei/analysis";
const BRIEF = `${ANALYSIS_DIR}/brief.json`;
const FINDINGS = `${ANALYSIS_DIR}/findings.json`;
const REFUSED = `${ANALYSIS_DIR}/refused.json`;

type RecordRowView = { id: string; year: string; project: string; claim: string; scope: string; line: string };
type RecordFile = { path: string; title: string; header: string; changed: string; rows: RecordRowView[]; text: string };

export type AnalysisBrief = {
  builtAt: string;
  demand: Array<{ term: string; postings: number; inEvidence: boolean }>;
  conflicts: Array<{ project: string; rows: Array<{ file: string; rowId: string; year: string }> }>;
  duplicates: Array<{ claim: string; rows: Array<{ file: string; rowId: string }> }>;
  files: Array<{ path: string; title: string; header: string; changed: string; rows: string[] }>;
  resume: { path: string; lines: string[] } | null;
};

const storedSchema = z.object({
  ranAt: z.string().nullable().default(null),
  findings: z.array(findingSchema.extend({ key: z.string(), status: z.enum(["open", "accepted", "asked", "refused"]) })).default([]),
  dropped: z.array(z.object({ id: z.string(), reason: z.string() })).default([]),
  error: z.string().nullable().default(null),
});
type Stored = z.infer<typeof storedSchema>;

const cells = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim());
const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function readRecordFiles(workspace: string): Promise<RecordFile[]> {
  const folder = workspaceFile(workspace, RECORDS_DIR);
  const out: RecordFile[] = [];
  for (const name of (await readdir(folder).catch(() => [] as string[])).filter((entry) => entry.endsWith(".md") && entry !== "README.md").sort()) {
    const full = join(folder, name);
    const text = await readFile(full, "utf8").catch(() => "");
    if (!/^\|\s*Evidence ID\s*\|/m.test(text)) continue;
    const rows = text.split("\n").filter((line) => /^\|\s*context:/.test(line)).map((line) => {
      const [id = "", year = "", project = "", claim = "", scope = ""] = cells(line);
      return { id, year, project, claim, scope, line };
    });
    out.push({
      path: `${RECORDS_DIR}/${name}`,
      title: /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? name,
      header: text.split("\n").filter((line) => /^-\s+(years|source_role|projects):/.test(line)).join("\n"),
      changed: (await stat(full).catch(() => null))?.mtime.toISOString().slice(0, 10) ?? "",
      rows,
      text,
    });
  }
  return out;
}

async function resumeLines(workspace: string, profile: CandidateProfile | null): Promise<{ path: string; lines: string[] } | null> {
  const path = profile?.sources.baseResumePath;
  if (!path) return null;
  const baseline = await loadCanonicalResumeBaseline(workspace, path).catch(() => null);
  if (!baseline) return null;
  return { path, lines: [...baseline.employers.flatMap((employer) => [...employer.protectedLines, ...employer.originalBullets]), ...baseline.originalSkillsLines].map((line) => line.replace(/[*_`]/g, "").trim()).filter(Boolean) };
}

/** The facts the app finds itself, with no AI: what Agy judges and words fixes for. */
export async function buildBrief(workspace: string, input: { jobs: JobFolderSummary[]; profile: CandidateProfile | null; now?: Date }): Promise<{ brief: AnalysisBrief; files: RecordFile[] }> {
  const files = await readRecordFiles(workspace);
  const vocab = await loadVocabulary(workspace, input.profile).catch(() => ({ text: "" }));
  const known = (term: string) => new RegExp(`(?:^|[^a-z0-9])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(vocab.text.toLowerCase());
  const demand = computeLearnings(input.jobs).gapTerms.map((gap) => ({ term: gap.term, postings: gap.noInterview + gap.interviewed, inEvidence: known(gap.term) })).filter((gap) => gap.postings >= 2);

  const all = files.flatMap((file) => file.rows.map((row) => ({ file: file.path, row })));
  const byProject = new Map<string, typeof all>();
  for (const entry of all) if (entry.row.project) byProject.set(normal(entry.row.project), [...(byProject.get(normal(entry.row.project)) ?? []), entry]);
  const conflicts = [...byProject.values()]
    .filter((entries) => new Set(entries.map((entry) => entry.file)).size > 1 && new Set(entries.map((entry) => normal(entry.row.year))).size > 1)
    .map((entries) => ({ project: entries[0]!.row.project, rows: entries.map((entry) => ({ file: entry.file, rowId: entry.row.id, year: entry.row.year })) }));
  const byClaim = new Map<string, typeof all>();
  for (const entry of all) if (entry.row.claim.length > 20) byClaim.set(normal(entry.row.claim), [...(byClaim.get(normal(entry.row.claim)) ?? []), entry]);
  const duplicates = [...byClaim.values()].filter((entries) => entries.length > 1).map((entries) => ({ claim: entries[0]!.row.claim, rows: entries.map((entry) => ({ file: entry.file, rowId: entry.row.id })) }));

  const brief: AnalysisBrief = {
    builtAt: (input.now ?? new Date()).toISOString(),
    demand,
    conflicts,
    duplicates,
    files: files.map((file) => ({ path: file.path, title: file.title, header: file.header, changed: file.changed, rows: file.rows.map((row) => [row.id, row.year, row.project, row.claim, row.scope].join(" | ")) })),
    resume: await resumeLines(workspace, input.profile),
  };
  return { brief, files };
}

export function buildAnalysisPrompt(brief: AnalysisBrief): string {
  return [
    `Follow ${WORKFLOW}. Read nothing else and run no commands; reply with JSON only.`,
    "",
    "Brief (built by the app from the candidate's own files):",
    JSON.stringify(brief, null, 1),
  ].join("\n");
}

async function readStored(workspace: string): Promise<Stored> {
  const parsed = storedSchema.safeParse(await readJson<unknown>(workspaceFile(workspace, FINDINGS)));
  return parsed.success ? parsed.data : storedSchema.parse({});
}
const saveStored = (workspace: string, stored: Stored) => writeJsonAtomic(workspaceFile(workspace, FINDINGS), stored);
async function readRefused(workspace: string): Promise<Set<string>> {
  const value = await readJson<{ keys?: unknown }>(workspaceFile(workspace, REFUSED));
  return new Set(Array.isArray(value?.keys) ? value.keys.filter((key): key is string => typeof key === "string") : []);
}

export async function readAnalysis(workspace: string, running = false): Promise<AnalysisView> {
  const stored = await readStored(workspace);
  return { ranAt: stored.ranAt, running, findings: stored.findings as StoredFinding[], dropped: stored.dropped, error: stored.error };
}

/** One analysis: brief, one Agy call, the checks, then the open findings are replaced by the new ones. */
export async function runAnalysis(workspace: string, runner: AgyRunner, input: { jobs: JobFolderSummary[]; profile: CandidateProfile | null; now?: Date }): Promise<AnalysisView> {
  const now = input.now ?? new Date();
  const { brief, files } = await buildBrief(workspace, { ...input, now });
  await writeJsonAtomic(workspaceFile(workspace, BRIEF), brief);
  const previous = await readStored(workspace);
  try {
    const response = (await runner(buildAnalysisPrompt(brief), { conversationId: null })).response.replace(/^```(?:json)?\s*|\s*```$/g, "");
    const reply = replySchema.parse(JSON.parse(response));
    const texts: Record<string, string> = Object.fromEntries(files.map((file) => [file.path, file.text]));
    if (brief.resume) texts[brief.resume.path] = brief.resume.lines.join("\n");
    const records = Object.fromEntries(files.map((file) => [file.path, new Map(file.rows.map((row) => [row.id.toLowerCase(), row.line]))]));
    const { kept, dropped } = checkFindings(reply.findings, { texts, records, refused: await readRefused(workspace) });
    const stored: Stored = {
      ranAt: now.toISOString(),
      // Decided findings stay as history; open ones are replaced by this run's.
      findings: [...previous.findings.filter((finding) => finding.status !== "open"), ...kept.map((finding) => ({ ...finding, id: `${now.getTime().toString(36)}-${finding.id}`.slice(0, 40), key: findingKey(finding), status: "open" as const }))]
        .filter((finding, index, list) => finding.status !== "open" || !list.slice(0, index).some((other) => other.key === finding.key)),
      dropped,
      error: null,
    };
    await saveStored(workspace, stored);
    return readAnalysis(workspace);
  } catch (error) {
    await saveStored(workspace, { ...previous, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export type Decision = "accept" | "edit" | "ask" | "refuse";

/** The user's pick for one finding. Returns the record file it changed, if any. */
export async function decideFinding(workspace: string, id: string, decision: Decision, edited: Partial<FixRow> | null = null, now = new Date()): Promise<{ changed: string | null }> {
  const stored = await readStored(workspace);
  const finding = stored.findings.find((candidate) => candidate.id === id && candidate.status === "open");
  if (!finding) throw new Error("That finding was already decided. Run the check again for a fresh list.");
  let changed: string | null = null;
  let status: StoredFinding["status"];
  if (decision === "refuse") {
    const refused = await readRefused(workspace);
    refused.add(finding.key);
    await writeJsonAtomic(workspaceFile(workspace, REFUSED), { keys: [...refused].sort() });
    status = "refused";
  } else if (decision === "ask" || finding.fix.action === "ask") {
    if (decision !== "ask") throw new Error("This finding asks you a question; answer it on Profile.");
    await addQuestion(workspace, {
      id: `analysis:${finding.key}`, kind: "skill", subject: finding.subject, options: [],
      text: finding.fix.question ?? finding.issue, why: finding.issue,
    }, now);
    status = "asked";
  } else {
    const action = finding.fix.action as "update" | "add" | "remove";
    const row = { ...(finding.fix.row ?? { evidenceId: "", year: "", project: "", claim: "", scope: "", publicUse: "eligible" }), ...(decision === "edit" ? edited ?? {} : {}) };
    const evidenceId = action === "add" ? row.evidenceId || `context:analysis:${finding.subject}` : (finding.rowId ?? row.evidenceId);
    const written = await writeRecordRow(workspace, finding.file, action, { ...row, evidenceId, locator: `Data analysis, ${now.toISOString().slice(0, 10)}` }, now);
    if (!written) throw new Error("That row has changed since the check. Run the check again.");
    changed = finding.file;
    status = "accepted";
  }
  await saveStored(workspace, { ...stored, findings: stored.findings.map((candidate) => candidate.id === id ? { ...candidate, status } : candidate) });
  return { changed };
}
