import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { PdfFreshness } from "../src/shared/schemas";

/**
 * Which PDF belongs to which application document, and whether it is still current (owner of both).
 * A PDF made before its Markdown source was last edited is out of date: sending it would send the old text.
 */

/** The PDF file name for a job's resume or cover letter. */
export function pdfOutputName(sourcePath: string, artifactType: string, artifactPrefix?: string): string {
  if (artifactType === "resume") return `${artifactPrefix || basename(sourcePath, ".md").replace(/_[^_]+_Resume$/i, "") || "Candidate"}_Resume.pdf`;
  return `${basename(sourcePath, ".md")}.pdf`;
}

/** Saving a file and exporting it can land within the same tick of a coarse file clock; anything closer than this is "current". */
const CLOCK_SLACK_MS = 1000;

export function freshnessState(sourceModifiedMs: number, pdfModifiedMs: number | null): PdfFreshness["state"] {
  if (pdfModifiedMs === null) return "none";
  return sourceModifiedMs > pdfModifiedMs + CLOCK_SLACK_MS ? "stale" : "current";
}

/** The resume and cover letter of one job, each with its PDF's state. */
export async function pdfFreshness(workspacePath: string, jobId: unknown, artifactPrefix?: string): Promise<PdfFreshness[]> {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(jobId) || jobId.includes("..")) throw new Error("That isn't a job.");
  const folder = join(workspacePath, "jobs", jobId);
  const names = await readdir(folder).catch(() => [] as string[]);
  const sources: Array<{ name: string; kind: PdfFreshness["kind"] }> = [];
  for (const name of names) {
    if (/_Resume\.md$/i.test(name)) sources.push({ name, kind: "resume" });
    else if (name.toLowerCase() === "cover_letter.md") sources.push({ name, kind: "cover-letter" });
  }
  const modified = (path: string) => stat(path).then((info) => info.mtimeMs, () => null);
  return Promise.all(sources.map(async ({ name, kind }) => {
    const pdfName = pdfOutputName(name, kind, artifactPrefix);
    const [sourceMs, pdfMs] = await Promise.all([modified(join(folder, name)), modified(join(folder, "pdfs", pdfName))]);
    return { source: `jobs/${jobId}/${name}`, kind, pdf: pdfMs === null ? null : `jobs/${jobId}/pdfs/${pdfName}`, state: freshnessState(sourceMs ?? 0, pdfMs) };
  }));
}
