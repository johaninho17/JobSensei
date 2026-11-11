// Pipeline (Recruiter Edition, plan R5): every job across candidates, read from each candidate's own folder, and
// status changes written back to the right candidate's job. Nothing is copied between candidates.
import { trackerStatusSchema, type JobFolderSummary, type TrackerStatus } from "../src/shared/schemas";
import { effectiveStatus } from "../src/shared/tracker";
import type { PipelineRow } from "../src/shared/candidate-match";
import { candidatePath, readRoster } from "./candidates";
import { listJobFolders } from "./job-folders";
import { updateJobTracker } from "./tracker";
import { readSubmission } from "./submission";

export async function listPipeline(root: string): Promise<PipelineRow[]> {
  const roster = await readRoster(root);
  const rows = await Promise.all(roster.candidates.filter((candidate) => candidate.status !== "archived").map(async (candidate) => {
    const folder = await candidatePath(root, candidate.id);
    const jobs: JobFolderSummary[] = await listJobFolders(folder).catch(() => []);
    return Promise.all(jobs.map(async (job) => {
      const sent = await readSubmission(folder, job.id).catch(() => null);
      return { ...job, candidateId: candidate.id, candidateName: candidate.displayName, submission: sent ? { platform: sent.platform, resumeVersion: sent.resumeVersion, date: sent.date } : null };
    }));
  }));
  return rows.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Sets one status on several jobs (any candidates); returns each job's status before, for Undo. */
export async function setPipelineStatus(root: string, entries: Array<{ candidateId: string; jobId: string }>, status: unknown): Promise<Array<{ candidateId: string; jobId: string; previous: TrackerStatus }>> {
  const next = trackerStatusSchema.parse(status);
  if (!entries.length || entries.length > 500) throw new Error("Choose between 1 and 500 jobs.");
  const before = await listPipeline(root);
  const done: Array<{ candidateId: string; jobId: string; previous: TrackerStatus }> = [];
  for (const entry of entries) {
    const job = before.find((row) => row.candidateId === entry.candidateId && row.id === entry.jobId);
    if (!job) continue;
    await updateJobTracker(await candidatePath(root, entry.candidateId), entry.jobId, { status: next });
    done.push({ ...entry, previous: effectiveStatus(job) });
  }
  return done;
}
