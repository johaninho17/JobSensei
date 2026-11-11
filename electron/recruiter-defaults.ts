// The recruiter's defaults for a candidate's folder (Recruiter Edition, plan Q2). A candidate folder sits at
// <root>/candidates/<id>; the recruiter's settings at <root>/recruiter/settings.json. Any other workspace (the regular
// app) has no recruiter, so this returns null and the app's own defaults apply.
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CANDIDATES_DIR, RECRUITER_SETTINGS_PATH, recruiterDefaultsSchema, type RecruiterDefaults } from "../src/shared/candidates";

export async function recruiterDefaultsFor(workspace: string): Promise<RecruiterDefaults | null> {
  const parent = dirname(workspace);
  if (basename(parent) !== CANDIDATES_DIR) return null;
  const raw = await readFile(join(dirname(parent), RECRUITER_SETTINGS_PATH), "utf8").then((text) => JSON.parse(text) as { defaults?: unknown }, () => null);
  if (!raw) return null;
  const parsed = recruiterDefaultsSchema.safeParse(raw.defaults ?? {});
  return parsed.success ? parsed.data : null;
}
