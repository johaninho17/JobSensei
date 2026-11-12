// The recruiter's defaults and Agy instructions for a candidate's folder (Recruiter Edition, plans Q2 and Q3), read
// from the copy the app keeps inside the folder (RECRUITER_COPY_PATH), because Agy builds its snapshot from inside the
// candidate's folder and can't read the recruiter folder. Any other workspace (the regular app) has no copy, so these
// return null / nothing and the app's own defaults apply.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RECRUITER_COPY_PATH, recruiterDefaultsSchema, type RecruiterDefaults } from "../src/shared/candidates";
import { agyInstructionsSchema } from "../src/shared/schemas";

async function readCopy(workspace: string): Promise<{ defaults?: unknown; agyInstructions?: unknown } | null> {
  return readFile(join(workspace, ...RECRUITER_COPY_PATH.split("/")), "utf8").then((text) => JSON.parse(text) as { defaults?: unknown; agyInstructions?: unknown }, () => null);
}

export async function recruiterDefaultsFor(workspace: string): Promise<RecruiterDefaults | null> {
  const raw = await readCopy(workspace);
  if (!raw) return null;
  const parsed = recruiterDefaultsSchema.safeParse(raw.defaults ?? {});
  return parsed.success ? parsed.data : null;
}

export async function recruiterInstructionsFor(workspace: string): Promise<string[]> {
  const parsed = agyInstructionsSchema.safeParse((await readCopy(workspace))?.agyInstructions ?? []);
  return parsed.success ? parsed.data : [];
}
