import type { JobFolderSummary } from "./schemas";
import { TRACKER_LABELS, effectiveAppliedAt, effectiveStatus } from "./tracker";

const COLUMNS = ["Company", "Title", "Status", "Applied", "Follow up", "Fit", "Interview", "Location", "Added", "Notes", "Job ID"] as const;

/** RFC 4180 cell: quoted when needed; a leading = + - @ (or tab/CR) gets an apostrophe so spreadsheets never run it as a formula. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The jobs as CSV with a UTF-8 BOM, so Excel, Numbers, and Google Sheets read accents correctly. */
export function jobsToCsv(jobs: JobFolderSummary[]): string {
  return toCsv(COLUMNS, jobs.map(jobRow));
}

/** The cross-candidate pipeline as CSV (Recruiter Edition): the same columns with the candidate first. */
export function pipelineToCsv(rows: Array<JobFolderSummary & { candidateName: string }>): string {
  return toCsv(["Candidate", ...COLUMNS], rows.map((row) => [row.candidateName, ...jobRow(row)]));
}

function toCsv(columns: readonly string[], rows: Array<Array<string | number | null>>): string {
  return `\uFEFF${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function jobRow(job: JobFolderSummary): Array<string | number | null> {
  return [
    job.company ?? job.name,
    job.title ?? "",
    TRACKER_LABELS[effectiveStatus(job)],
    effectiveAppliedAt(job) ?? "",
    job.tracker?.nextFollowUpAt ?? "",
    job.rating === null ? "" : job.rating.toFixed(1),
    job.interviewRoundLabel ?? "",
    job.location ?? "",
    job.createdAt.slice(0, 10),
    job.tracker?.notes ?? "",
    job.id,
  ];
}

