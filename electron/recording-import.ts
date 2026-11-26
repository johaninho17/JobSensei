// Adds interview recordings, debrief notes, and practice-interview transcripts from inside the app (Interviews → Your
// content), so nobody has to make folders by hand. The recording scan (electron/content-refresh.ts) then lists them as new.
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { copyFilesInto, type ImportResult } from "./context-import";
import { writeTextAtomic } from "./persistence";
import { workspaceFile } from "./workspace";
import { jobAtCompany, recordingFolder, recordingName, stageOf, type RecordingKind } from "../src/shared/recordings";
import { readdir } from "node:fs/promises";

/** Transcripts and notes: text, documents, and subtitle files. */
export const RECORDING_EXTENSIONS = [".md", ".txt", ".pdf", ".docx", ".rtf", ".json", ".csv", ".vtt", ".srt"];

export async function importRecordings(workspacePath: string, sources: string[], kind: RecordingKind, jobId: string | null): Promise<ImportResult> {
  const prefix = await namePrefix(workspacePath, jobId);
  return copyFilesInto(workspacePath, recordingFolder(kind, jobId), sources, RECORDING_EXTENSIONS, (name) => recordingName(name, kind, prefix, stageOf(name)));
}

/** The start of a recording's name (#244): the company, or the job ID when the company has more than one job. */
async function namePrefix(workspacePath: string, jobId: string | null): Promise<string | null> {
  if (!jobId || !/^[a-z0-9][a-z0-9-]*$/.test(jobId)) return null;
  const company = jobId.split("-")[0]!;
  const jobs = await readdir(workspaceFile(workspacePath, "jobs")).catch(() => [] as string[]);
  return jobs.filter((id) => jobAtCompany(id, company)).length > 1 ? jobId : company;
}

/**
 * Pasted notes or a transcript (#213): saved as a Markdown recording in the same folder a file would go to, so the
 * recording scan lists it as new. A job is optional; without one it is still interview content and evidence.
 */
export async function importRecordingText(workspacePath: string, text: string, kind: RecordingKind, jobId: string | null, now = new Date()): Promise<ImportResult> {
  const body = text.replace(/\r\n/g, "\n").trim();
  if (body.length < 20) throw new Error("Paste the notes or transcript first.");
  if (body.length > 400_000) throw new Error("That's too long to paste; add it as a file instead.");
  const day = now.toISOString().slice(0, 10);
  const folder = recordingFolder(kind, jobId);
  const prefix = await namePrefix(workspacePath, jobId);
  const base = kind === "practice" ? `mock-notes-${day}` : `${prefix ? `${prefix}-` : ""}interview-notes-${day}`;
  let name = `${base}.md`;
  for (let n = 2; await stat(workspaceFile(workspacePath, `${folder}/${name}`)).catch(() => null); n += 1) name = `${base}-${n}.md`;
  const path = workspaceFile(workspacePath, `${folder}/${name}`);
  await mkdir(dirname(path), { recursive: true });
  await writeTextAtomic(path, `# ${kind === "practice" ? "Practice interview" : "Interview"} notes, ${day}\n\n${body}\n`);
  return { added: [name], skipped: [] };
}
