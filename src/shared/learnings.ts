// Learnings across jobs, from structured data only: recorded interviews and outcomes (tracker), fit and gap terms
// (job record), and posting facts (role). Prep files never count as an interview here. Pure, so it is tested.
import type { InterviewRoundKind, JobFolderSummary } from "./schemas";
import { effectiveStatus } from "./tracker";

export const FUNNEL_STAGES = ["recruiter", "hiring_manager", "practical", "final", "offer"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const STAGE_LABELS: Record<FunnelStage | "none", string> = { none: "No interview", recruiter: "Recruiter", hiring_manager: "Hiring manager", practical: "Practical", final: "Final round", offer: "Offer" };

export type Learnings = {
  applied: number;
  /** Jobs with at least one recorded interview. */
  interviewed: number;
  /** Jobs that reached each stage or further. */
  funnel: Array<{ stage: FunnelStage; count: number }>;
  /** Average fit by the furthest stage reached ("none" = applied, no interview). */
  fitByStage: Array<{ stage: FunnelStage | "none"; jobs: number; averageFit: number | null }>;
  /** Interview rate by work mode and by level. */
  bySetup: Array<{ label: string; applied: number; interviewed: number }>;
  /** Median posted pay (yearly) for jobs with and without interviews. */
  pay: { interviewed: number | null; notInterviewed: number | null };
  /** Gap terms most common among applications that got no interview, with how often they appear in interviewed ones. */
  gapTerms: Array<{ term: string; noInterview: number; interviewed: number }>;
  /** The user's own reasons, newest first. */
  reasons: Array<{ jobId: string; company: string; stage: string; result: string; reason: string }>;
  /** Jobs with interview prep but no recorded interview: data still to add. */
  unrecorded: number;
};

const ROUND_TO_STAGE: Record<InterviewRoundKind, FunnelStage | null> = { recruiter: "recruiter", hiring_manager: "hiring_manager", practical: "practical", final: "final", other: "recruiter" };

/** The furthest stage a job reached, from recorded interviews and the outcome; null when no interview was recorded. */
export function furthestRecordedStage(job: Pick<JobFolderSummary, "tracker">): FunnelStage | null {
  const tracker = job.tracker;
  if (!tracker) return null;
  if (tracker.outcome?.result === "offer" || tracker.outcome?.result === "accepted" || tracker.outcome?.result === "declined" || tracker.status === "offer") return "offer";
  const stages = tracker.interviews.map((event) => ROUND_TO_STAGE[event.round]).filter((stage): stage is FunnelStage => Boolean(stage));
  return stages.sort((a, b) => FUNNEL_STAGES.indexOf(b) - FUNNEL_STAGES.indexOf(a))[0] ?? null;
}

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
const yearlyPay = (job: JobFolderSummary) => {
  const range = job.role?.payRange;
  if (!range || range.period !== "year") return null;
  const values = [range.min, range.max].filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};

export function computeLearnings(jobs: JobFolderSummary[]): Learnings {
  const applied = jobs.filter((job) => effectiveStatus(job) !== "saved");
  const stageOf = new Map(applied.map((job) => [job.id, furthestRecordedStage(job)]));
  const interviewed = applied.filter((job) => stageOf.get(job.id));
  const notInterviewed = applied.filter((job) => !stageOf.get(job.id));
  const funnel = FUNNEL_STAGES.map((stage) => ({ stage, count: interviewed.filter((job) => FUNNEL_STAGES.indexOf(stageOf.get(job.id)!) >= FUNNEL_STAGES.indexOf(stage)).length }));
  const fitByStage = (["none", ...FUNNEL_STAGES] as const).map((stage) => {
    const group = applied.filter((job) => (stageOf.get(job.id) ?? "none") === stage);
    return { stage, jobs: group.length, averageFit: average(group.map((job) => job.rating).filter((value): value is number => value !== null)) };
  }).filter((row) => row.jobs > 0);
  const bySetup: Learnings["bySetup"] = [];
  const addGroup = (label: string, match: (job: JobFolderSummary) => boolean) => {
    const group = applied.filter(match);
    if (group.length) bySetup.push({ label, applied: group.length, interviewed: group.filter((job) => stageOf.get(job.id)).length });
  };
  for (const mode of ["remote", "hybrid", "onsite"] as const) addGroup(mode === "onsite" ? "On-site" : mode[0]!.toUpperCase() + mode.slice(1), (job) => job.role?.workMode === mode);
  for (const level of ["junior", "mid", "senior", "staff", "lead"]) addGroup(`${level[0]!.toUpperCase()}${level.slice(1)} level`, (job) => job.role?.seniority === level);
  const count = (list: JobFolderSummary[]) => {
    const counts = new Map<string, number>();
    for (const job of list) for (const term of new Set(job.gapTerms)) counts.set(term, (counts.get(term) ?? 0) + 1);
    return counts;
  };
  const missed = count(notInterviewed);
  const hit = count(interviewed);
  const gapTerms = [...missed].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([term, total]) => ({ term, noInterview: total, interviewed: hit.get(term) ?? 0 }));
  const reasons = applied
    .filter((job) => job.tracker?.outcome?.reason)
    .sort((a, b) => (b.tracker?.updatedAt ?? "").localeCompare(a.tracker?.updatedAt ?? ""))
    .map((job) => ({
      jobId: job.id,
      company: job.company ?? job.name,
      stage: STAGE_LABELS[stageOf.get(job.id) ?? "none"],
      result: job.tracker!.outcome!.result ?? "",
      reason: job.tracker!.outcome!.reason,
    }));
  return {
    applied: applied.length,
    interviewed: interviewed.length,
    funnel,
    fitByStage,
    bySetup,
    pay: { interviewed: median(interviewed.map(yearlyPay).filter((value): value is number => value !== null)), notInterviewed: median(notInterviewed.map(yearlyPay).filter((value): value is number => value !== null)) },
    gapTerms,
    reasons,
    unrecorded: jobs.filter((job) => (job.interviewRoundCount ?? 0) > 0 && !(job.tracker?.interviews.length)).length,
  };
}

