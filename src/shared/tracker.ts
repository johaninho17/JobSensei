import type { JobTracker, TrackerStatus } from "./schemas";

export const TRACKER_LABELS: Record<TrackerStatus, string> = { saved: "Saved", applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn" };

type TrackedJob = { tracker: Pick<JobTracker, "status" | "appliedAt"> | null; hasApplicationMaterials: boolean; interviewRoundLabel: string | null; createdAt: string };

/**
 * Whether drafts count as applied. In the solo edition a job sent through Sensei is assumed applied (U7); in the
 * Recruiter Edition drafts are only ready to send until the recruiter marks the job applied. Set once at start by
 * each process from `features.draftsMarkApplied`.
 */
let draftsMarkApplied = true;
export function setDraftsMarkApplied(value: boolean): void { draftsMarkApplied = value; }

/**
 * The status shown for a job. A status the user set always wins. Otherwise it is derived:
 * interview prep exists -> interviewing; application drafts exist -> applied (solo) or still saved (recruiter); else saved.
 */
export function effectiveStatus(job: Pick<TrackedJob, "tracker" | "hasApplicationMaterials" | "interviewRoundLabel">): TrackerStatus {
  if (job.tracker) return job.tracker.status;
  if (job.interviewRoundLabel) return "interviewing";
  return job.hasApplicationMaterials && draftsMarkApplied ? "applied" : "saved";
}

/** Drafts are done but the job isn't marked applied yet (Recruiter Edition). */
export function readyToSend(job: Pick<TrackedJob, "tracker" | "hasApplicationMaterials" | "interviewRoundLabel">): boolean {
  return !draftsMarkApplied && job.hasApplicationMaterials && effectiveStatus(job) === "saved";
}

/** The status as shown on a job: "Ready to send" for drafted, unsent jobs in the Recruiter Edition. */
export function statusLabel(job: Pick<TrackedJob, "tracker" | "hasApplicationMaterials" | "interviewRoundLabel">): string {
  return readyToSend(job) ? "Ready to send" : TRACKER_LABELS[effectiveStatus(job)];
}

/** The applied date: the user's date, else the local day the job was added when its status counts as applied or later. */
export function effectiveAppliedAt(job: TrackedJob): string | null {
  if (job.tracker?.appliedAt) return job.tracker.appliedAt;
  const status = effectiveStatus(job);
  if (status === "saved" || job.tracker) return null;
  const added = new Date(job.createdAt);
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
