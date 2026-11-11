import type { JobFolderSummary } from "./schemas";
import { effectiveAppliedAt, statusLabel } from "./tracker";

const ALL_COLUMNS = ["Company", "Title", "Status", "Applied", "Follow up", "Fit", "Interview", "Location", "Added", "Notes", "Job ID"] as const;
/** Follow-up and interview columns exist only where those features do (the Recruiter Edition stops at applying). */
export type CsvColumns = { followUps?: boolean; interviews?: boolean };
const keepFor = (options: CsvColumns) => ALL_COLUMNS.map((column) => !(column === "Follow up" && options.followUps === false) && !(column === "Interview" && options.interviews === false));

/** RFC 4180 cell: quoted when needed; a leading = + - @ (or tab/CR) gets an apostrophe so spreadsheets never run it as a formula. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The jobs as CSV with a UTF-8 BOM, so Excel, Numbers, and Google Sheets read accents correctly. */
export function jobsToCsv(jobs: JobFolderSummary[], options: CsvColumns = {}): string {
  const keep = keepFor(options);
  return toCsv(ALL_COLUMNS.filter((_, index) => keep[index]), jobs.map((job) => fullRow(job).filter((_, index) => keep[index])));
}

/** The cross-candidate pipeline as CSV (Recruiter Edition): the same columns with the candidate first. */
export function pipelineToCsv(rows: Array<JobFolderSummary & { candidateName: string; submission?: { platform: string | null; resumeVersion: string } | null }>, options: CsvColumns = {}): string {
  const keep = keepFor(options);
  return toCsv(["Candidate", ...ALL_COLUMNS.filter((_, index) => keep[index]), "Sent via", "Resume version sent"], rows.map((row) => [row.candidateName, ...fullRow(row).filter((_, index) => keep[index]), row.submission?.platform ?? "", row.submission?.resumeVersion ?? ""]));
}

function toCsv(columns: readonly string[], rows: Array<Array<string | number | null>>): string {
  return `\uFEFF${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function fullRow(job: JobFolderSummary): Array<string | number | null> {
  return [
    job.company ?? job.name,
    job.title ?? "",
    statusLabel(job),
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

