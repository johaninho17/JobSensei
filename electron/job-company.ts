import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./persistence";
import { assertInsideWorkspace } from "./workspace";
import { readJobOverrides } from "./job-overrides";

/**
 * Records the employer's name in the job's hidden metadata (`.sensei/job.json`), keeping its other
 * fields. Used when a pasted JD has no "Company:" line and the run names the employer itself
 * (`--company`), so file names and the job list never fall back to a placeholder.
 */
export async function recordJobCompany(workspacePath: string, jobId: string, company: string): Promise<string> {
  const name = company.replace(/[\r\n]+/g, " ").trim().slice(0, 120);
  if (!name) throw new Error("The company name is empty.");
  const jobPath = assertInsideWorkspace(workspacePath, join(workspacePath, "jobs", jobId));
  const hiddenJobPath = join(jobPath, ".sensei", "job.json");
  const current = await readFile(hiddenJobPath, "utf8").then((text) => JSON.parse(text) as Record<string, unknown>).catch(() => ({ id: jobId }));
  await writeJsonAtomic(hiddenJobPath, { ...current, company: name });
  // A company the user corrected on the job page (#114) still names the resume.
  return (await readJobOverrides(jobPath)).company ?? name;
}

/** The value after `--company` in a command's arguments, if any. */
export function companyArgument(argv: string[]): string | null {
  const index = argv.indexOf("--company");
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : null;
}
