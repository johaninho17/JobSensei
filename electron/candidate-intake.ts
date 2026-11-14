// Adding a candidate is the whole setup (Recruiter Edition, plan R8 P1): the recruiter gives a name, the base resume,
// and any extra files and notes in one step. Nothing asks the candidate to describe themselves.
import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { buildContextManifest } from "./context";
import { updateCandidateProfileSources } from "./candidate-profile";
import { importContextFiles } from "./context-import";
import { saveRecruiterNotes } from "./candidates";
import { checkBaseResume } from "./setup-readiness";
import type { SettingsStore } from "./settings";

export type CandidateIntake = { resumePath?: string | null; files?: string[]; notes?: string | null };
export type IntakeResult = { resume: { ok: true; lines: string[] } | { ok: false; message: string } | null; files: string[]; skipped: Array<{ name: string; reason: string }> };

const RESUME_TYPES = new Set([".docx", ".md", ".pdf"]);

/** Copies the resume into the candidate's `resumes/` folder (never overwriting) and returns its workspace path. */
async function copyResume(folder: string, source: string): Promise<string> {
  const extension = extname(source).toLowerCase();
  if (!RESUME_TYPES.has(extension)) throw new Error("Choose the resume as a Word (.docx), Markdown (.md), or PDF file.");
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) throw new Error("That resume file can't be read.");
  const dir = join(folder, "resumes");
  await mkdir(dir, { recursive: true });
  const stem = basename(source, extname(source)).replace(/[^a-zA-Z0-9._-]+/g, "-") || "resume";
  let name = `${stem}${extension}`;
  for (let n = 2; await stat(join(dir, name)).then(() => true, () => false); n += 1) name = `${stem}-${n}${extension}`;
  await copyFile(resolve(source), join(dir, name));
  return `resumes/${name}`;
}

/** Applies an intake to a new candidate's folder: base resume, extra files (checked for Agy), recruiter notes. */
export async function applyIntake(folder: string, settingsStore: SettingsStore, intake: CandidateIntake): Promise<IntakeResult> {
  const result: IntakeResult = { resume: null, files: [], skipped: [] };
  let settings = await settingsStore.get();
  if (intake.resumePath) {
    const relativePath = await copyResume(folder, intake.resumePath);
    settings = await settingsStore.save({ baseResumePath: relativePath });
    await updateCandidateProfileSources(folder, settings);
    const check = await checkBaseResume(folder, relativePath);
    result.resume = check.ok ? { ok: true, lines: check.lines } : { ok: false, message: check.message };
  }
  if (intake.files?.length) {
    // Every file the recruiter adds is the candidate's material; in this edition each one is evidence on its own.
    const imported = await importContextFiles(folder, intake.files, "structured");
    result.files = imported.added;
    result.skipped = imported.skipped;
  }
  if (intake.notes?.trim()) result.files.push(await saveRecruiterNotes(folder, intake.notes));
  if (result.files.length) await buildContextManifest(folder, { careerPaths: result.files, structuredPaths: result.files }, settings);
  return result;
}
