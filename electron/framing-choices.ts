// Keep or revert a line the framing setting flags (#97). The validator decides which lines are flagged and what
// Revert puts back (electron/application-validation.ts, `framingLines`); this file only records a Keep or swaps one
// line in the job's resume, then checks the application again so the answer reflects the files on disk.
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FRAMING_CHOICES_FILE, framingChoicesSchema, type FramingLine } from "../src/shared/schemas";
import { resumeFileIn, validateJobApplication } from "./application-validation";
import { readCandidateProfile } from "./candidate-profile";
import { assertInsideWorkspace } from "./layout";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persistence";
import { lineKey } from "./stretch-score";

function jobPath(workspacePath: string, jobId: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(jobId)) throw new Error("The job ID is invalid.");
  return assertInsideWorkspace(workspacePath, join(resolve(workspacePath), "jobs", jobId));
}

/** The flagged lines as the job's files are now. */
export async function framingLinesFor(workspacePath: string, jobId: string): Promise<FramingLine[]> {
  return (await validateJobApplication(workspacePath, jobId, false)).framingLines;
}

/** Keep a line: it stays as written and stops raising a warning until its text changes. */
export async function keepFramingLine(workspacePath: string, jobId: string, text: string): Promise<FramingLine[]> {
  const file = join(jobPath(workspacePath, jobId), ".sensei", FRAMING_CHOICES_FILE);
  const choices = framingChoicesSchema.parse(await readJson<unknown>(file) ?? {});
  if (!choices.kept.some((kept) => lineKey(kept) === lineKey(text))) choices.kept.push(text);
  await writeJsonAtomic(file, choices);
  return framingLinesFor(workspacePath, jobId);
}

/** Revert a resume line to the base resume's bullet in the same place. Only the one bullet line changes. */
export async function revertFramingLine(workspacePath: string, jobId: string, text: string): Promise<FramingLine[]> {
  const line = (await framingLinesFor(workspacePath, jobId)).find((candidate) => lineKey(candidate.text) === lineKey(text));
  if (!line) throw new Error("That line is no longer flagged. Run the check again.");
  if (!line.revertTo) throw new Error("The base resume has no line in that place to go back to. Keep it, or edit it in the resume.");
  const folder = jobPath(workspacePath, jobId);
  const name = resumeFileIn(await readdir(folder), (await readCandidateProfile(workspacePath))?.identity.artifactPrefix);
  if (!name) throw new Error("The job's resume could not be found.");
  const path = join(folder, name);
  const markdown = await readFile(path, "utf8");
  const lines = markdown.split("\n");
  const index = lines.findIndex((candidate) => /^\s*[-*+]\s+/.test(candidate) && lineKey(candidate.replace(/^\s*[-*+]\s+/, "")) === lineKey(text));
  if (index < 0) throw new Error("That line is not in the resume anymore. Run the check again.");
  lines[index] = `${lines[index]!.match(/^\s*[-*+]\s+/)![0]}${line.revertTo}`;
  await writeTextAtomic(path, lines.join("\n"));
  return framingLinesFor(workspacePath, jobId);
}
