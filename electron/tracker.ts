import { stat } from "node:fs/promises";
import { join } from "node:path";
import { jobTrackerSchema, jobTrackerUpdateSchema, type JobTracker } from "../src/shared/schemas";
import { readJson, writeJsonAtomic } from "./persistence";
import { assertInsideWorkspace } from "./workspace";
import { featuresFor } from "../src/shared/edition";
import { currentEdition } from "./edition";

const JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export const DEFAULT_FOLLOW_UP_DAYS = 7;

function addDays(date: Date, days: number): string {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

function trackerPath(jobPath: string): string {
  return join(jobPath, ".sensei", "tracker.json");
}

/** The job's tracker, or null when the user has never set one (or the file is unreadable). */
export async function readJobTracker(jobPath: string): Promise<JobTracker | null> {
  const parsed = jobTrackerSchema.safeParse(await readJson<unknown>(trackerPath(jobPath)));
  return parsed.success ? parsed.data : null;
}

/** Applies a user change. A status change is added to history; moving to "applied" fills an empty applied date with today. */
export async function updateJobTracker(workspacePath: string, jobId: string, input: unknown, now = new Date()): Promise<JobTracker> {
  if (!JOB_ID.test(jobId)) throw new Error("Job identifier is invalid.");
  const jobPath = assertInsideWorkspace(workspacePath, join(workspacePath, "jobs", jobId));
  if (!(await stat(jobPath).catch(() => null))?.isDirectory()) throw new Error(`No job folder found for "${jobId}".`);
  const update = jobTrackerUpdateSchema.parse(input);
  const current = (await readJobTracker(jobPath)) ?? jobTrackerSchema.parse({});
  const statusChanged = update.status !== undefined && update.status !== current.status;
  const next = jobTrackerSchema.parse({
    ...current,
    ...update,
    appliedAt: update.appliedAt !== undefined ? update.appliedAt
      : statusChanged && update.status === "applied" && !current.appliedAt ? now.toISOString().slice(0, 10) : current.appliedAt,
    // Applying sets a follow-up a week out, unless the user already has one or sets one now.
    nextFollowUpAt: update.nextFollowUpAt !== undefined ? update.nextFollowUpAt
      : statusChanged && update.status === "applied" && !current.nextFollowUpAt && featuresFor(currentEdition()).nudges ? addDays(now, DEFAULT_FOLLOW_UP_DAYS) : current.nextFollowUpAt,
    history: statusChanged ? [...current.history, { at: now.toISOString(), status: update.status! }].slice(-200) : current.history,
    updatedAt: now.toISOString(),
  });
  await writeJsonAtomic(trackerPath(jobPath), next);
  return next;
}

