import type { JobTracker, TrackerStatus } from "./schemas";

export const TRACKER_LABELS: Record<TrackerStatus, string> = { saved: "Saved", applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn" };

type TrackedJob = { tracker: Pick<JobTracker, "status" | "appliedAt"> | null; hasApplicationMaterials: boolean; interviewRoundLabel: string | null; createdAt: string; hasPdfs?: boolean; pdfsAt?: string | null };
type StatusInputs = Pick<TrackedJob, "tracker" | "hasApplicationMaterials" | "interviewRoundLabel" | "hasPdfs">;

/**
 * Drafting is not applying (owner of this rule). A job with drafts is "Drafted" until it is marked applied.
 * Regular app: making the PDFs is what marks it applied (the user's last step before sending). Recruiter Edition:
 * only the recruiter's Mark applied does, and the label is "Ready to send". Set once at start by each process from
 * `features.pdfsMarkApplied`.
 */
let pdfsMarkApplied = true;
export function setPdfsMarkApplied(value: boolean): void { pdfsMarkApplied = value; }

/**
 * The status shown for a job. A status the user set always wins. Otherwise it is derived:
 * interview prep exists -> interviewing; drafts with PDFs -> applied (regular app); else saved.
 */
export function effectiveStatus(job: StatusInputs): TrackerStatus {
  if (job.tracker) return job.tracker.status;
  if (job.interviewRoundLabel) return "interviewing";
  return job.hasApplicationMaterials && pdfsMarkApplied && job.hasPdfs ? "applied" : "saved";
}

/** Drafts are done but the job isn't applied yet: shown as Drafted (regular app) or Ready to send (Recruiter Edition). */
export function readyToSend(job: StatusInputs): boolean {
  return job.hasApplicationMaterials && effectiveStatus(job) === "saved";
}

/** The name of that in-between state in this edition. */
export function draftedLabel(): string { return pdfsMarkApplied ? "Drafted" : "Ready to send"; }

/** The status as shown on a job. */
export function statusLabel(job: StatusInputs): string {
  return readyToSend(job) ? draftedLabel() : TRACKER_LABELS[effectiveStatus(job)];
}

/** The applied date: the user's date; else, when the status counts as applied or later, the local day the PDFs were made, or the day the job was added. */
export function effectiveAppliedAt(job: TrackedJob): string | null {
  if (job.tracker?.appliedAt) return job.tracker.appliedAt;
  const status = effectiveStatus(job);
  if (status === "saved" || job.tracker) return null;
  const added = new Date(job.pdfsAt && status === "applied" ? job.pdfsAt : job.createdAt);
  return `${added.getFullYear()}-${String(added.getMonth() + 1).padStart(2, "0")}-${String(added.getDate()).padStart(2, "0")}`;
}

/** Days until the follow-up date (negative when overdue), or null. Dates are local calendar days. */
export function followUpDays(tracker: Pick<JobTracker, "nextFollowUpAt"> | null, today = new Date()): number | null {
  if (!tracker?.nextFollowUpAt) return null;
  const [y, m, d] = tracker.nextFollowUpAt.split("-").map(Number);
  const due = Date.UTC(y!, m! - 1, d!);
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - base) / 86_400_000);
}

/** True when the job got as far as interviews: recorded interviews, prepared rounds, or the tracker was ever Interviewing or Offer. */
export function reachedInterview(job: { interviewRoundLabel: string | null; interviewRoundCount?: number; tracker: { status: TrackerStatus; history?: Array<{ status?: TrackerStatus | null }>; interviews?: unknown[] } | null }): boolean {
  if ((job.tracker?.interviews?.length ?? 0) > 0) return true;
  if (job.interviewRoundLabel || (job.interviewRoundCount ?? 0) > 0) return true;
  const statuses = [job.tracker?.status, ...(job.tracker?.history ?? []).map((event) => event.status)];
  return statuses.some((status) => status === "interviewing" || status === "offer");
}

export const STALE_DAYS = 30;

/** Applied jobs (set or derived) whose applied date and last tracker change are both older than STALE_DAYS. */
export function staleApplications<T extends TrackedJob & { tracker: (TrackedJob["tracker"] & { updatedAt?: string | null }) | null }>(jobs: T[], now = Date.now()): T[] {
  const cutoff = now - STALE_DAYS * 86_400_000;
  return jobs.filter((job) => {
    if (effectiveStatus(job) !== "applied") return false;
    const appliedAt = effectiveAppliedAt(job);
    const lastTouch = Math.max(appliedAt ? Date.parse(appliedAt) : 0, job.tracker?.updatedAt ? Date.parse(job.tracker.updatedAt) : 0);
    return lastTouch > 0 && lastTouch < cutoff;
  });
}
