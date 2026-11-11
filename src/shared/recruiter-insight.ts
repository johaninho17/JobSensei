// Recruiter Edition (plan R8 P5): what the recruiter sees per candidate and sends them. Pure, so it is tested alone.
// - Insight from statuses: applications sent, this week against the weekly target, responses, interviews, offers.
// - The weekly report: applications sent in a date range, as copy-ready email text and CSV rows.
// - The approval shortlist: proposed jobs as text the recruiter sends the candidate.
import { effectiveAppliedAt, effectiveStatus } from "./tracker";
import type { JobFolderSummary } from "./schemas";

type Job = Pick<JobFolderSummary, "tracker" | "hasApplicationMaterials" | "interviewRoundLabel" | "createdAt">;
export type CandidateInsight = { applied: number; appliedThisWeek: number; responses: number; interviews: number; offers: number; responseRate: number | null };

const DAY = 86_400_000;
const SENT = new Set(["applied", "interviewing", "offer", "rejected"]);

/** Local calendar day N days before `now` (YYYY-MM-DD). */
export function daysAgo(now: Date, days: number): string {
  const date = new Date(now.getTime() - days * DAY);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function candidateInsight(jobs: Job[], now = new Date()): CandidateInsight {
  const sent = jobs.filter((job) => SENT.has(effectiveStatus(job)) || Boolean(job.tracker?.appliedAt));
  const since = daysAgo(now, 6);
  const today = daysAgo(now, 0);
  const statuses = sent.map((job) => effectiveStatus(job));
  const interviews = statuses.filter((status) => status === "interviewing" || status === "offer").length;
  const offers = statuses.filter((status) => status === "offer").length;
  // A response is any reply from the employer: an interview, an offer, or a rejection.
  const responses = statuses.filter((status) => status === "interviewing" || status === "offer" || status === "rejected").length;
  return {
    applied: sent.length,
    appliedThisWeek: sent.filter((job) => { const at = effectiveAppliedAt(job); return Boolean(at && at >= since && at <= today); }).length,
    responses,
    interviews,
    offers,
    responseRate: sent.length ? responses / sent.length : null,
  };
}

export type ReportRow = { company: string; title: string; date: string; via: string; link: string; fit: string; status: string };
type ReportJob = Job & Pick<JobFolderSummary, "company" | "name" | "title" | "rating"> & { submission?: { platform: string | null; date: string } | null; postingUrl?: string | null; statusText: string };

/** Applications sent from `from` to `to` (inclusive, YYYY-MM-DD), newest first. */
export function reportRows(jobs: ReportJob[], from: string, to: string): ReportRow[] {
  return jobs
    .map((job) => ({ job, date: job.submission?.date ?? effectiveAppliedAt(job) }))
    .filter((entry): entry is { job: ReportJob; date: string } => Boolean(entry.date && entry.date >= from && entry.date <= to))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ job, date }) => ({
      company: job.company ?? job.name, title: job.title ?? "", date,
      via: job.submission?.platform ?? "", link: job.postingUrl ?? "",
      fit: job.rating === null ? "" : job.rating.toFixed(1), status: job.statusText,
    }));
}

/** The report as an email the recruiter can paste and send. No numbers beyond what the rows show. */
export function reportText(name: string, from: string, to: string, rows: ReportRow[], target: number | null): string {
  const first = name.split(/\s+/)[0] || name;
  const lines = [
    `Hi ${first},`,
    "",
    rows.length
      ? `Here are the applications I sent for you from ${from} to ${to}: ${rows.length}${target ? ` (weekly goal: ${target})` : ""}.`
      : `I didn't send any applications for you from ${from} to ${to}.`,
    "",
    ...rows.map((row) => `- ${row.company}: ${row.title}${row.via ? ` (via ${row.via})` : ""}, sent ${row.date}${row.status !== "Applied" ? `, now ${row.status.toLowerCase()}` : ""}${row.link ? `\n  ${row.link}` : ""}`),
    ...(rows.length ? [""] : []),
    "If any employer contacts you, let me know and I'll update your tracker.",
  ];
  return lines.join("\n");
}

export type Proposal = { id: string; company: string | null; title: string | null; url: string | null; reasons: string[]; proposedAt: string };

/** The jobs waiting for the candidate's approval, as text the recruiter sends them. */
export function shortlistText(name: string, proposals: Proposal[]): string {
  const first = name.split(/\s+/)[0] || name;
  return [
    `Hi ${first},`,
    "",
    `I found ${proposals.length} job${proposals.length === 1 ? "" : "s"} that fit what you're looking for. Reply with the numbers you'd like me to apply to:`,
    "",
    ...proposals.map((proposal, index) => `${index + 1}. ${[proposal.company, proposal.title].filter(Boolean).join(": ") || "Job"}${proposal.reasons.length ? ` (${proposal.reasons.slice(0, 3).join("; ")})` : ""}${proposal.url ? `\n   ${proposal.url}` : ""}`),
  ].join("\n");
}
