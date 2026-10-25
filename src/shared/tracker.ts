import type { JobTracker, TrackerStatus } from "./schemas";

export const TRACKER_LABELS: Record<TrackerStatus, string> = { saved: "Saved", applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn" };

/** The status shown for a job: the user's tracker status, or "saved" before they set one. */
export function effectiveStatus(tracker: Pick<JobTracker, "status"> | null): TrackerStatus {
  return tracker?.status ?? "saved";
}

/** True when a job has interview prep but the user has not marked it as interviewing or later. */
export function suggestsInterviewing(tracker: Pick<JobTracker, "status"> | null, hasInterviewRound: boolean): boolean {
  const status = effectiveStatus(tracker);
  return hasInterviewRound && (status === "saved" || status === "applied");
}

/** Days until the follow-up date (negative when overdue), or null. Dates are local calendar days. */
export function followUpDays(tracker: Pick<JobTracker, "nextFollowUpAt"> | null, today = new Date()): number | null {
  if (!tracker?.nextFollowUpAt) return null;
  const [y, m, d] = tracker.nextFollowUpAt.split("-").map(Number);
  const due = Date.UTC(y!, m! - 1, d!);
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - base) / 86_400_000);
}
