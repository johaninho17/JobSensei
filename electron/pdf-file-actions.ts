import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { assertInsideWorkspace } from "./workspace";

/**
 * What the app may do with a job's PDFs outside the app (#127): drag one out, copy its path, show it in Finder/Explorer.
 * Only a PDF the app made (`jobs/<job-id>/pdfs/<name>.pdf`) qualifies; nothing else in the workspace leaves this way.
 */
const JOB_PDF = /^jobs\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\/pdfs\/[^/\\]+\.pdf$/i;

export async function jobPdfPath(workspacePath: string, relativePath: unknown): Promise<string> {
  if (typeof relativePath !== "string" || !JOB_PDF.test(relativePath) || relativePath.includes("..")) throw new Error("That isn't one of this job's PDFs.");
  const path = assertInsideWorkspace(workspacePath, resolve(workspacePath, relativePath));
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Error("That PDF no longer exists. Create the PDFs again.");
  return path;
}

/** Left out of a workspace backup: caches and copies the app rebuilds, never the user's own files. */
export function skipInBackup(relativePath: string): boolean {
  const path = relativePath.split("\\").join("/");
  return path.startsWith(".sensei/npm-cache/") || path.startsWith(".agents/.backups/") || path.split("/").includes("node_modules") || path.split("/").pop() === ".DS_Store";
}

/** The backup's file name: `<prefix>_JobSensei_backup_<date>.zip`. */
export function backupName(artifactPrefix: string | null | undefined, date = new Date()): string {
  const prefix = (artifactPrefix ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return `${prefix ? `${prefix}_` : ""}JobSensei_backup_${date.toISOString().slice(0, 10)}.zip`;
}
