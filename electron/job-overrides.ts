// Reads and saves the user's corrections to a job's details (#114). src/shared/job-overrides.ts owns the shape and
// how they are laid over a job summary; this file owns the disk and lays them over the job's identity (job.json) for
// drafting and interview prep, so the resume, letter, and PDFs carry the corrected company and title.
import { jobLock, withWriteLock } from "./write-lock";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { JOB_OVERRIDES_FILE, NO_OVERRIDES, jobOverridesSchema, type JobOverrides, type JobOverridesInput } from "../src/shared/job-overrides";
import { assertInsideWorkspace } from "./layout";
import { writeJsonAtomic } from "./persistence";

/** The job's corrections; none when the file is missing or unreadable. */
export async function readJobOverrides(jobPath: string): Promise<JobOverrides> {
  const raw = await readFile(join(jobPath, JOB_OVERRIDES_FILE), "utf8").catch(() => null);
  if (!raw) return NO_OVERRIDES;
  const parsed = jobOverridesSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : NO_OVERRIDES;
}

/** Saves the job page's Edit details form. A blank field goes back to what the posting says. */
export async function saveJobOverrides(workspacePath: string, jobId: string, input: JobOverridesInput, now = new Date()): Promise<JobOverrides> {
  return withWriteLock(jobLock(jobId), async () => {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(jobId)) throw new Error("The job ID is invalid.");
    const jobPath = assertInsideWorkspace(workspacePath, join(resolve(workspacePath), "jobs", jobId));
    const overrides = jobOverridesSchema.parse({ ...input, schemaVersion: 1, updatedAt: now.toISOString() });
    await writeJsonAtomic(join(jobPath, JOB_OVERRIDES_FILE), overrides);
    return overrides;
  });
}

/** A job's identity (job.json) with the user's company, title, and location laid over it. */
export async function withIdentityOverrides<T extends { company?: string | null; title?: string | null; location?: string | null }>(jobPath: string, job: T): Promise<T> {
  const overrides = await readJobOverrides(jobPath);
  return {
    ...job,
    ...(overrides.company ? { company: overrides.company } : {}),
    ...(overrides.title ? { title: overrides.title } : {}),
    ...(overrides.location ? { location: overrides.location } : {}),
  };
}
