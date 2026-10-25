import type { JobTracker, TrackerStatus } from "./schemas";

export const TRACKER_LABELS: Record<TrackerStatus, string> = { saved: "Saved", applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn" };

type TrackedJob = { tracker: Pick<JobTracker, "status" | "appliedAt"> | null; hasApplicationMaterials: boolean; interviewRoundLabel: string | null; createdAt: string };

/**
 * The status shown for a job. A status the user set always wins. Otherwise it is derived:
 * interview prep exists -> interviewing; application drafts exist (the job was sent through Sensei) -> applied; else saved.
 */
export function effectiveStatus(job: Pick<TrackedJob, "tracker" | "hasApplicationMaterials" | "interviewRoundLabel">): TrackerStatus {
  if (job.tracker) return job.tracker.status;
  if (job.interviewRoundLabel) return "interviewing";
  return job.hasApplicationMaterials ? "applied" : "saved";
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
