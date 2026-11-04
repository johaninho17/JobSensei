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

/**
 * A pasted posting usually starts with the role name on its own line ("Customer Solutions Engineer"), with no `#`
 * heading. That line is the title when it is short, has no label, and is not a sentence.
 */
export function firstLineTitle(markdown: string): string | null {
  const line = markdown.replace(/\r\n?/g, "\n").split("\n").map((value) => value.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim()).find(Boolean);
  if (!line || line.length > 90 || line.length < 3) return null;
  if (/[.!?]$/.test(line) || /^[^:]{1,30}:\s/.test(line) || /^(?:original\s+)?job\s+description$|^(?:about|overview|summary|description|apply|job details?)\b/i.test(line)) return null;
  return line;
}

/** Parses labeled metadata. `headingFallback` (job postings only) takes the title from the first `#` heading, else a title-like first line. */
export function parseJobDescriptionMetadata(markdown: string, options: { headingFallback?: boolean } = { headingFallback: true }): JobDescriptionMetadata {
  return {
    company: labeledValue(markdown, ["Company", "Employer"]),
    title: labeledValue(markdown, ["Job Title", "Role", "Position"]) ?? (options.headingFallback ? headingTitle(markdown) ?? (/^#\s/m.test(markdown) ? null : firstLineTitle(markdown)) : null),
    location: labeledValue(markdown, ["Location"]),
    jobId: labeledValue(markdown, ["Job ID", "Requisition ID"]),
    url: [labeledValue(markdown, ["Source URL", "Job URL", "URL"]), labeledValue(markdown, ["Source"])].find((value) => value && /^https?:\/\//i.test(value)) ?? null,
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
