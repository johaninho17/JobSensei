// Answers to Profile questions are filed into the candidate's career records in the background: Agy decides which row
// each one updates, or where a new row goes when nothing covers it (rules: .agents/workflows/jobsensei-file-answers.md);
// the app checks the choice and edits the file, after a backup. Answers wait in `.sensei/today-answers.json` (name kept
// for existing workspaces) until filed; drafts never read that file directly.
import { CAREER_LOCK, withWriteLock } from "./write-lock";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AgyRunner } from "./question-agent";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persistence";
import { assertInsideWorkspace, workspaceFile } from "./workspace";

export const ANSWERS_INBOX = ".sensei/today-answers.json";
const RECORDS_DIR = "context/structured";
const WORKFLOW = ".agents/workflows/jobsensei-file-answers.md";

const answerSchema = z.object({
  id: z.string(),
  subject: z.string(),
  question: z.string(),
  answer: z.string(),
  answeredAt: z.string(),
  status: z.enum(["pending", "filed", "skipped"]).default("pending"),
  filedTo: z.string().nullable().default(null),
  /** What filing did to the record: updated an existing row, added a new one, or removed a row the answer contradicts. */
  action: z.enum(["update", "add", "remove"]).nullable().default(null),
  evidenceId: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
  filedAt: z.string().nullable().default(null),
});
export type FiledAnswer = z.infer<typeof answerSchema>;
const inboxSchema = z.object({ answers: z.array(answerSchema).default([]) });

export const FILING_SCHEMA = JSON.stringify({
  type: "object",
  required: ["filings", "skipped"],
  properties: {
    filings: { type: "array", items: { type: "object", required: ["answerId", "action", "file", "evidenceId", "year", "project", "claim", "scope", "publicUse"], properties: {
      answerId: { type: "string" }, action: { type: "string", enum: ["update", "add", "remove"] }, file: { type: "string" }, evidenceId: { type: "string" }, year: { type: "string" }, project: { type: "string" },
      claim: { type: "string" }, scope: { type: "string" }, publicUse: { type: "string" } } } },
    skipped: { type: "array", items: { type: "object", required: ["answerId", "reason"], properties: { answerId: { type: "string" }, reason: { type: "string" } } } },
  },
});

export async function readAnswerInbox(workspace: string): Promise<FiledAnswer[]> {
  const parsed = inboxSchema.safeParse(await readJson<unknown>(workspaceFile(workspace, ANSWERS_INBOX)));
  return parsed.success ? parsed.data.answers : [];
}
const saveInbox = (workspace: string, answers: FiledAnswer[]) => writeJsonAtomic(workspaceFile(workspace, ANSWERS_INBOX), { answers });

/** Queues an answer for filing. */
export async function queueAnswer(workspace: string, input: { subject: string; question: string; answer: string }, now = new Date()): Promise<FiledAnswer> {
  const answers = await readAnswerInbox(workspace);
  let id = `answer-${now.getTime().toString(36)}`;
  for (let n = 2; answers.some((answer) => answer.id === id); n += 1) id = `answer-${now.getTime().toString(36)}-${n}`;
  const entry = answerSchema.parse({ id, ...input, answeredAt: now.toISOString() });
  await saveInbox(workspace, [...answers, entry]);
  return entry;
}

/** Each career record file with its title and each row's ID, year, project, claim, and scope, so Agy can find the row an answer belongs to. */
export async function recordFiles(workspace: string): Promise<Array<{ path: string; title: string; header: string; rows: string[] }>> {
  const folder = workspaceFile(workspace, RECORDS_DIR);
  const out: Array<{ path: string; title: string; header: string; rows: string[] }> = [];
  for (const name of (await readdir(folder).catch(() => [] as string[])).filter((entry) => entry.endsWith(".md") && entry !== "README.md").sort()) {
    const text = await readFile(join(folder, name), "utf8").catch(() => "");
    if (!/^\|\s*Evidence ID\s*\|/m.test(text)) continue;
    const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? name;
    const header = text.split("\n").filter((line) => /^-\s+(years|source_role|projects|how to use):/.test(line)).join("\n");
    const rows = text.split("\n").filter((line) => /^\|\s*context:/.test(line)).map((line) => line.split("|").slice(1, 6).map((cell) => cell.trim()).join(" | "));
    out.push({ path: `${RECORDS_DIR}/${name}`, title, header, rows: rows.slice(0, 60) });
  }
  return out;
}

export function buildFilingPrompt(answers: FiledAnswer[], files: Awaited<ReturnType<typeof recordFiles>>): string {
  return [
    `Follow ${WORKFLOW} to file these answers. Read nothing else and run no commands; reply with JSON only.`,
    "",
    "Answers (each is the candidate's own words):",
    ...answers.map((answer) => `- ${answer.id} (answered ${answer.answeredAt.slice(0, 10)}): question "${answer.question}" → answer "${answer.answer}"`),
    "",
    "Career record files (path, title, header; then rows as ID | year | project | claim | scope):",
    ...files.flatMap((file) => [`## ${file.path}: ${file.title}`, file.header, ...file.rows.map((row) => `  ${row}`)]),
  ].join("\n");
}

const cell = (value: string) => value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

export type RecordRow = { evidenceId: string; year: string; project: string; claim: string; scope: string; locator: string; publicUse: string };

/**
 * Changes one record file's evidence table, after backing the file up: `update` rewrites the row with that ID in place,
 * `remove` deletes it, `add` puts a new row after the last one (with a new ID). Returns the row's ID, or null when an
 * update or remove names a row that isn't in the file (nothing is written; the answer waits for the next run).
 */
export async function writeRecordRow(workspace: string, file: string, action: "update" | "add" | "remove", row: RecordRow, now = new Date()): Promise<string | null> {
  return withWriteLock(CAREER_LOCK, async () => {
    if (!/^context\/structured\/[A-Za-z0-9._-]+\.md$/.test(file)) throw new Error(`Not a career record file: ${file}`);
    const path = workspaceFile(workspace, file);
    const text = await readFile(path, "utf8");
    const lines = text.split("\n");
    const headerAt = lines.findIndex((line) => /^\|\s*Evidence ID\s*\|/.test(line));
    if (headerAt < 0) throw new Error(`${file} has no evidence table.`);
    const rowLine = (id: string, locator = row.locator, confidence = "high") => `| ${id} | ${cell(row.year)} | ${cell(row.project)} | ${cell(row.claim)} | ${cell(row.scope)} | ${cell(locator)} | ${cell(confidence)} | ${cell(row.publicUse) || "eligible"} |`;
    let id = row.evidenceId.trim().toLowerCase();
    let next: string[];
    if (action === "add") {
      id = id.replace(/[^a-z0-9:-]+/g, "-");
      if (!/^context:[a-z0-9-]+:[a-z0-9:-]+$/.test(id)) id = `context:answers:${id.replace(/[^a-z0-9]+/g, "-")}`;
      const base = id;
      for (let n = 2; text.includes(`| ${id} |`); n += 1) id = `${base}-${n}`;
      const last = lines.reduce((found, line, index) => (/^\|\s*context:/.test(line) ? index : found), -1);
      next = [...lines];
      next.splice(last >= 0 ? last + 1 : headerAt + 2, 0, rowLine(id));
    } else {
      const at = lines.findIndex((line) => line.split("|")[1]?.trim().toLowerCase() === id);
      if (at < 0) return null;
      const cells = lines[at]!.split("|").map((value) => value.trim());
      id = cells[1]!;
      next = [...lines];
      // An update keeps where the row first came from and says it was changed by an answer.
      if (action === "update") next[at] = rowLine(id, cells[6] ? `${cells[6]}; updated: ${row.locator}` : row.locator, cells[7] || "high");
      else next.splice(at, 1);
    }
    const backup = assertInsideWorkspace(workspace, join(workspace, ".sensei", "backups", "answer-filing", now.toISOString().slice(0, 10), file.split("/").pop()!));
    await mkdir(dirname(backup), { recursive: true });
    if (!(await stat(backup).catch(() => null))) await copyFile(path, backup);
    await writeTextAtomic(path, next.join("\n"));
    return id;
  });
}

/** Files every pending answer with one Agy call. Returns what happened to each. */
export async function fileAnswers(workspace: string, runner: AgyRunner, now = new Date()): Promise<{ filed: FiledAnswer[]; skipped: FiledAnswer[] }> {
  const answers = await readAnswerInbox(workspace);
  const pending = answers.filter((answer) => answer.status === "pending");
  if (!pending.length) return { filed: [], skipped: [] };
  const files = await recordFiles(workspace);
  const reply = JSON.parse((await runner(buildFilingPrompt(pending, files), { conversationId: null })).response.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
    filings?: Array<{ answerId: string; action?: "update" | "add" | "remove"; file: string; evidenceId: string; year: string; project: string; claim: string; scope: string; publicUse: string }>;
    skipped?: Array<{ answerId: string; reason: string }>;
  };
  const known = new Set(files.map((file) => file.path));
  const updates = new Map<string, Partial<FiledAnswer>>();
  for (const filing of reply.filings ?? []) {
    const answer = pending.find((candidate) => candidate.id === filing.answerId);
    if (!answer || updates.has(answer.id)) continue;
    // Only an existing career record file; anything else waits for the next run.
    if (!known.has(filing.file)) continue;
    const action = filing.action === "update" || filing.action === "remove" ? filing.action : "add";
    const evidenceId = await writeRecordRow(workspace, filing.file, action, { ...filing, locator: `Profile question, answered ${answer.answeredAt.slice(0, 10)}` }, now);
    // An update or remove of a row that isn't there writes nothing; the answer waits for the next run.
    if (!evidenceId) continue;
    updates.set(answer.id, { status: "filed", filedTo: filing.file, action, evidenceId, filedAt: now.toISOString() });
  }
  for (const skip of reply.skipped ?? []) {
    if (pending.some((answer) => answer.id === skip.answerId) && !updates.has(skip.answerId)) updates.set(skip.answerId, { status: "skipped", note: skip.reason, filedAt: now.toISOString() });
  }
  const next = answers.map((answer) => ({ ...answer, ...(updates.get(answer.id) ?? {}) }));
  await saveInbox(workspace, next);
  return { filed: next.filter((answer) => updates.get(answer.id)?.status === "filed"), skipped: next.filter((answer) => updates.get(answer.id)?.status === "skipped") };
}

/**
 * One-time move from the old `context/structured/answers-from-today.md` (read by drafts directly) to the filing queue:
 * its rows become pending answers and the file goes to the backups folder.
 */
export async function migrateOldAnswersFile(workspace: string, now = new Date()): Promise<number> {
  const old = workspaceFile(workspace, "context/structured/answers-from-today.md");
  const text = await readFile(old, "utf8").catch(() => null);
  if (text === null) return 0;
  const rows = text.split("\n").filter((line) => /^\|\s*context:today-answers:/.test(line)).map((line) => line.split("|").slice(1, -1).map((value) => value.trim()));
  const answers = await readAnswerInbox(workspace);
  const added = rows.map(([, , project, claim, , locator], index) => answerSchema.parse({
    id: `answer-old-${index + 1}`, subject: project ?? "", question: `Have you used ${project ?? "this"}?`, answer: claim ?? "",
    answeredAt: new Date(/\d{4}-\d{2}-\d{2}/.exec(locator ?? "")?.[0] ?? now.toISOString()).toISOString(),
  })).filter((entry) => entry.answer && !answers.some((answer) => answer.answer === entry.answer));
  await saveInbox(workspace, [...answers, ...added]);
  const backup = assertInsideWorkspace(workspace, join(workspace, ".sensei", "backups", "answer-filing", "answers-from-today.md"));
  await mkdir(dirname(backup), { recursive: true });
  await copyFile(old, backup);
  const { rm } = await import("node:fs/promises");
  await rm(old, { force: true });
  return added.length;
}
