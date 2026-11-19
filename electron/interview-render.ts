// Writes a round's Markdown from the JSON Agy writes (#113, ledger I22), run by `interview:check`:
// `question_bank.json` → `question_bank.md`, `prep.json` → `prep.md`, and the job's `company_research.json` →
// `company_research.md`. A Markdown file changed by hand since the app last wrote it is never replaced silently: the
// new version waits in `interviews/.sensei/pending/<file>` until the user picks Replace or Keep mine on the round page.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { z } from "zod";
import { PREP_JSON, RESEARCH_JSON, prepSchema, renderPrep, renderResearch, researchSchema } from "../src/shared/interview-docs";
import { QUESTION_BANK_JSON, questionBankProblems, questionBankSchema, renderQuestionBank } from "../src/shared/question-bank";
import { assertInsideWorkspace } from "./layout";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persistence";

const RENDERED_FILE = "interviews/.sensei/rendered.json";
const PENDING_DIR = "interviews/.sensei/pending";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export type RenderResult =
  | { kind: "none" }
  | { kind: "invalid"; problems: string[] }
  | { kind: "written"; markdown: string }
  | { kind: "pending"; markdown: string };

/** The interview files the app writes from JSON. `key` is the Markdown path under `interviews/`. */
export type RenderedDoc = "question_bank" | "prep" | "research";
const DOCS: Record<RenderedDoc, { json: (roundId: string) => string; key: (roundId: string) => string; schema: z.ZodTypeAny; render: (value: never, title: string) => string }> = {
  question_bank: { json: (round) => `${round}/${QUESTION_BANK_JSON}`, key: (round) => `${round}/question_bank.md`, schema: questionBankSchema, render: renderQuestionBank as (value: never, title: string) => string },
  prep: { json: (round) => `${round}/${PREP_JSON}`, key: (round) => `${round}/prep.md`, schema: prepSchema, render: renderPrep as (value: never, title: string) => string },
  research: { json: () => RESEARCH_JSON, key: () => "company_research.md", schema: researchSchema, render: renderResearch as (value: never, title: string) => string },
};

function jobFolder(workspacePath: string, jobId: string): string {
  if (!SAFE_ID.test(jobId)) throw new Error("The job ID is invalid.");
  return assertInsideWorkspace(workspacePath, join(resolve(workspacePath), "jobs", jobId));
}

async function readRendered(job: string): Promise<Record<string, string>> {
  return await readJson<Record<string, string>>(join(job, RENDERED_FILE)) ?? {};
}

/** Renders one JSON file, if there is one. Returns what the check should read and whether it was written. */
export async function renderInterviewDoc(workspacePath: string, jobId: string, roundId: string, doc: RenderedDoc, title: string): Promise<RenderResult> {
  if (!SAFE_ID.test(roundId)) throw new Error("The round ID is invalid.");
  const job = jobFolder(workspacePath, jobId);
  const spec = DOCS[doc];
  const raw = await readFile(join(job, "interviews", spec.json(roundId)), "utf8").catch(() => null);
  if (raw === null) return { kind: "none" };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { kind: "invalid", problems: [`${spec.json(roundId).split("/").pop()} is not valid JSON.`] }; }
  const parsed = spec.schema.safeParse(value);
  if (!parsed.success) return { kind: "invalid", problems: questionBankProblems(parsed.error) };
  const markdown = spec.render(parsed.data as never, title);
  const key = spec.key(roundId);
  const target = join(job, "interviews", key);
  const current = await readFile(target, "utf8").catch(() => null);
  const rendered = await readRendered(job);
  const untouched = current === null || current === markdown || rendered[key] === sha(current);
  const pending = join(job, PENDING_DIR, key);
  if (!untouched) {
    await mkdir(dirname(pending), { recursive: true });
    await writeTextAtomic(pending, markdown);
    return { kind: "pending", markdown };
  }
  await mkdir(dirname(target), { recursive: true });
  await writeTextAtomic(target, markdown);
  await writeJsonAtomic(join(job, RENDERED_FILE), { ...rendered, [key]: sha(markdown) });
  await rm(pending, { force: true });
  return { kind: "written", markdown };
}

/** The files with a new version waiting for the user's choice on this round (keys under `interviews/`). */
export async function pendingInterviewDocs(workspacePath: string, jobId: string, roundId: string): Promise<string[]> {
  if (!SAFE_ID.test(roundId)) throw new Error("The round ID is invalid.");
  const job = jobFolder(workspacePath, jobId);
  const round = await readdir(join(job, PENDING_DIR, roundId)).catch(() => [] as string[]);
  const research = await readFile(join(job, PENDING_DIR, "company_research.md"), "utf8").then(() => ["company_research.md"], () => []);
  return [...round.filter((name) => name === "question_bank.md" || name === "prep.md").sort().map((name) => `${roundId}/${name}`), ...research];
}

/** Replace: the new version becomes the file. Keep mine: the new version is dropped. */
export async function resolvePendingInterviewDoc(workspacePath: string, jobId: string, key: string, choice: "replace" | "keep"): Promise<void> {
  const [first, second, extra] = key.split("/");
  const valid = extra === undefined && (second === undefined ? first === "company_research.md" : SAFE_ID.test(first ?? "") && (second === "question_bank.md" || second === "prep.md"));
  if (!valid) throw new Error("That file can't be resolved here.");
  const job = jobFolder(workspacePath, jobId);
  const pending = join(job, PENDING_DIR, key);
  if (choice === "keep") { await rm(pending, { force: true }); return; }
  const markdown = await readFile(pending, "utf8").catch(() => null);
  if (markdown === null) throw new Error("There is no new version of this file waiting.");
  await rename(pending, join(job, "interviews", key));
  await writeJsonAtomic(join(job, RENDERED_FILE), { ...await readRendered(job), [key]: sha(markdown) });
}
