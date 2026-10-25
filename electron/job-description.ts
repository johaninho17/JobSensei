import { stat } from "node:fs/promises";
import { join } from "node:path";
import { assertInsideWorkspace } from "./workspace";

export type JobDescriptionMetadata = {
  company: string | null;
  title: string | null;
  location: string | null;
  jobId: string | null;
  url: string | null;
};

function labeledValue(markdown: string, labels: string[]): string | null {
  for (const label of labels) {
    const match = new RegExp(`^\\s*(?:[-*+]\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*(.+?)\\s*$`, "im").exec(markdown);
    if (match?.[1]) return match[1].replace(/\*\*/g, "").trim();
  }
  return null;
}

/** The posting's first top-level heading (how `jd:fetch` writes the title) when no "Job Title:" label exists. */
function headingTitle(markdown: string): string | null {
  const heading = /^#\s+(.+?)\s*$/m.exec(markdown)?.[1]?.replace(/\*\*/g, "").trim();
  return heading && !/^(?:original\s+)?job\s+description$|evaluation/i.test(heading) ? heading : null;
}

/** Parses labeled metadata. `headingFallback` (job postings only) takes the title from the first `#` heading. */
export function parseJobDescriptionMetadata(markdown: string, options: { headingFallback?: boolean } = { headingFallback: true }): JobDescriptionMetadata {
  return {
    company: labeledValue(markdown, ["Company", "Employer"]),
    title: labeledValue(markdown, ["Job Title", "Role", "Position"]) ?? (options.headingFallback ? headingTitle(markdown) : null),
    location: labeledValue(markdown, ["Location"]),
    jobId: labeledValue(markdown, ["Job ID", "Requisition ID"]),
    url: labeledValue(markdown, ["Source URL", "Job URL", "URL"]),
  };
}

/** Prefer the readable derivative while keeping legacy TXT workspaces usable. */
export async function resolveJobDescriptionPath(workspacePath: string, jobId: string): Promise<string> {
  for (const name of ["original_jd.md", "original_jd.txt"]) {
    const relativePath = `jobs/${jobId}/${name}`;
    const absolutePath = assertInsideWorkspace(workspacePath, join(workspacePath, relativePath));
    if ((await stat(absolutePath).catch(() => null))?.isFile()) return relativePath;
  }
  throw new Error(`The job workspace is missing original_jd.md or original_jd.txt: jobs/${jobId}.`);
}
