// Proof of what was sent (Recruiter Edition, plan R8 P4). "Mark applied" freezes copies of the exact PDFs into
// `jobs/<id>/submitted/<date>/`, notes where the application went (the posting's board, from its link) and which
// resume version was sent, and marks the job applied. A confirmation screenshot can be added later.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { ExportedPdf } from "../src/shared/schemas";
import { submissionSchema, type Submission } from "../src/shared/submission";
import { readJson, writeJsonAtomic } from "./persistence";
import { updateJobTracker } from "./tracker";
import { assertInsideWorkspace } from "./workspace";

const JOB_ID = /^[a-z0-9][a-z0-9._-]*$/i;
const BOARD_LABEL: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", linkedin: "LinkedIn", smartrecruiters: "SmartRecruiters", oracle: "Oracle Cloud" };
const IMAGE_TYPES = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"]);

const jobPath = (folder: string, jobId: string) => {
  if (!JOB_ID.test(jobId)) throw new Error("The job ID is invalid.");
  return assertInsideWorkspace(folder, join(folder, "jobs", jobId));
};
const recordPath = (job: string) => join(job, ".sensei", "submission.json");
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export async function readSubmission(folder: string, jobId: string): Promise<Submission | null> {
  const parsed = submissionSchema.safeParse(await readJson<unknown>(recordPath(jobPath(folder, jobId))));
  return parsed.success ? parsed.data : null;
}

/** Where the application went: the posting's board, else the link's site. */
async function platformOf(job: string): Promise<{ platform: string | null; url: string | null }> {
  const posting = await readJson<{ board?: string | null; url?: string | null }>(join(job, ".sensei", "posting.json"));
  const url = posting?.url ?? null;
  if (posting?.board && BOARD_LABEL[posting.board]) return { platform: BOARD_LABEL[posting.board]!, url };
  try { return { platform: url ? new URL(url).hostname.replace(/^www\./, "") : null, url }; } catch { return { platform: null, url }; }
}

/**
 * Exports the job's resume (and cover letter, when there is one) to PDF, copies them into `submitted/<date>/`,
 * records the submission, and marks the job applied. `exportPdf` is the app's PDF export (passed in by the caller).
 */
export async function recordSubmission(folder: string, jobId: string, exportPdf: (relativePath: string) => Promise<ExportedPdf>, now = new Date()): Promise<Submission> {
  const job = jobPath(folder, jobId);
  const names = await readdir(job);
  const resume = names.find((name) => /_Resume\.md$/i.test(name));
  if (!resume) throw new Error("This job has no tailored resume yet.");
  const sources = [resume, ...(names.includes("cover_letter.md") ? ["cover_letter.md"] : [])];
  const date = localDate(now);
  let target = join(job, "submitted", date);
  for (let n = 2; await stat(target).then(() => true, () => false); n += 1) target = join(job, "submitted", `${date}-${n}`);
  await mkdir(target, { recursive: true });
  const files: string[] = [];
  for (const source of sources) {
    const exported = await exportPdf(`jobs/${jobId}/${source}`);
    const destination = join(target, exported.name);
    await copyFile(join(folder, exported.relativePath), destination);
    files.push(`jobs/${jobId}/submitted/${basename(target)}/${exported.name}`);
  }
  const resumeVersion = createHash("sha256").update(await readFile(join(job, resume))).digest("hex").slice(0, 8);
  const submission = submissionSchema.parse({ submittedAt: now.toISOString(), date, ...(await platformOf(job)), files, resumeVersion, screenshot: null });
  await writeJsonAtomic(recordPath(job), submission);
  await updateJobTracker(folder, jobId, { status: "applied", appliedAt: date }, now);
  return submission;
}

/** Adds a confirmation screenshot (an image or PDF the recruiter saved) to the job's latest submission. */
export async function attachConfirmation(folder: string, jobId: string, sourcePath: string): Promise<Submission> {
  const job = jobPath(folder, jobId);
  const current = await readSubmission(folder, jobId);
  if (!current) throw new Error("Mark the job applied first.");
  const extension = extname(sourcePath).toLowerCase();
  if (!IMAGE_TYPES.has(extension)) throw new Error("Add the confirmation as an image (PNG, JPG, WebP, GIF) or a PDF.");
  const dir = join(folder, current.files[0] ? current.files[0].split("/").slice(0, -1).join("/") : `jobs/${jobId}/submitted/${current.date}`);
  await mkdir(dir, { recursive: true });
  await copyFile(sourcePath, join(dir, `confirmation${extension}`));
  const next = submissionSchema.parse({ ...current, screenshot: `${dir.slice(folder.length + 1)}/confirmation${extension}` });
  await writeJsonAtomic(recordPath(job), next);
  return next;
}

/** Undoes Mark applied: the job goes back to Ready to send. The frozen copies stay in `submitted/` for the record. */
export async function undoSubmission(folder: string, jobId: string): Promise<void> {
  const job = jobPath(folder, jobId);
  await rm(recordPath(job), { force: true });
  await updateJobTracker(folder, jobId, { status: "saved", appliedAt: null });
}
