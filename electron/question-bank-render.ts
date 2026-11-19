// Writes a round's `question_bank.md` from Agy's `question_bank.json` (#113, ledger I22), run by `interview:check`.
// A `question_bank.md` changed by hand since the app last wrote it is never replaced silently: the new version waits
// in `interviews/.sensei/pending/<round>.md` until the user picks Replace or Keep mine on the round's Questions tab.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { QUESTION_BANK_JSON, questionBankProblems, questionBankSchema, renderQuestionBank } from "../src/shared/question-bank";
import { assertInsideWorkspace } from "./layout";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persistence";

const RENDERED_FILE = "interviews/.sensei/rendered.json";
const pendingFile = (roundId: string) => `interviews/.sensei/pending/${roundId}.md`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export type QuestionBankRender =
  | { kind: "none" }
  | { kind: "invalid"; problems: string[] }
  | { kind: "written"; markdown: string }
  | { kind: "pending"; markdown: string };

function jobFolder(workspacePath: string, jobId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(jobId)) throw new Error("The job ID is invalid.");
  return assertInsideWorkspace(workspacePath, join(resolve(workspacePath), "jobs", jobId));
}

async function readRendered(job: string): Promise<Record<string, string>> {
  return await readJson<Record<string, string>>(join(job, RENDERED_FILE)) ?? {};
}

/** Renders the round's JSON bank, if there is one. Returns what the check should read and whether it was written. */
export async function renderRoundQuestionBank(workspacePath: string, jobId: string, roundId: string, title: string): Promise<QuestionBankRender> {
  const job = jobFolder(workspacePath, jobId);
  const raw = await readFile(join(job, "interviews", roundId, QUESTION_BANK_JSON), "utf8").catch(() => null);
  if (raw === null) return { kind: "none" };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { kind: "invalid", problems: ["question_bank.json is not valid JSON."] }; }
  const parsed = questionBankSchema.safeParse(value);
  if (!parsed.success) return { kind: "invalid", problems: questionBankProblems(parsed.error) };
  const markdown = renderQuestionBank(parsed.data, title);
  const target = join(job, "interviews", roundId, "question_bank.md");
  const current = await readFile(target, "utf8").catch(() => null);
  const rendered = await readRendered(job);
  const key = `${roundId}/question_bank.md`;
  const untouched = current === null || current === markdown || rendered[key] === sha(current);
  if (!untouched) {
    const pending = join(job, pendingFile(roundId));
    await mkdir(dirname(pending), { recursive: true });
    await writeTextAtomic(pending, markdown);
    return { kind: "pending", markdown };
  }
  await writeTextAtomic(target, markdown);
  await writeJsonAtomic(join(job, RENDERED_FILE), { ...rendered, [key]: sha(markdown) });
  await rm(join(job, pendingFile(roundId)), { force: true });
  return { kind: "written", markdown };
}

/** True when a new version of the round's questions waits for the user's choice. */
export async function hasPendingQuestionBank(workspacePath: string, jobId: string, roundId: string): Promise<boolean> {
  return readFile(join(jobFolder(workspacePath, jobId), pendingFile(roundId)), "utf8").then(() => true, () => false);
}

/** Replace: the new version becomes `question_bank.md`. Keep mine: the new version is dropped. */
export async function resolvePendingQuestionBank(workspacePath: string, jobId: string, roundId: string, choice: "replace" | "keep"): Promise<void> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(roundId)) throw new Error("The round ID is invalid.");
  const job = jobFolder(workspacePath, jobId);
  const pending = join(job, pendingFile(roundId));
  if (choice === "keep") { await rm(pending, { force: true }); return; }
  const markdown = await readFile(pending, "utf8").catch(() => null);
  if (markdown === null) throw new Error("There is no new version of these questions waiting.");
  const target = join(job, "interviews", roundId, "question_bank.md");
  await rename(pending, target);
  await writeJsonAtomic(join(job, RENDERED_FILE), { ...await readRendered(job), [`${roundId}/question_bank.md`]: sha(markdown) });
}
