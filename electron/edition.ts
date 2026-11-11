// Which edition this app is (src/shared/edition.ts owns what each one contains) and which edition a folder belongs to.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { EDITION_MARKER, featuresFor, folderMismatchMessage, parseEdition, type Edition } from "../src/shared/edition";
import { setDraftsMarkApplied } from "../src/shared/tracker";
import { writeJsonAtomic } from "./persistence";

let cached: Edition | null = null;

/**
 * JOBSENSEI_EDITION (dev runs, tests, and the build) wins; an installed app reads the `jobsenseiEdition` field the
 * build stamps into its package.json. Anything else is the solo edition.
 */
export function currentEdition(): Edition {
  const edition = readEdition();
  setDraftsMarkApplied(featuresFor(edition).draftsMarkApplied);
  return edition;
}

function readEdition(): Edition {
  if (process.env.JOBSENSEI_EDITION) return parseEdition(process.env.JOBSENSEI_EDITION);
  if (cached) return cached;
  const packagePath = join(__dirname, "..", "..", "package.json");
  let stamped: unknown = undefined;
  try { if (existsSync(packagePath)) stamped = (JSON.parse(readFileSync(packagePath, "utf8")) as { jobsenseiEdition?: unknown }).jobsenseiEdition; } catch { stamped = undefined; }
  cached = parseEdition(stamped);
  return cached;
}

/** The edition a folder was made by: its marker, or (for folders made before markers existed) its layout. */
export async function folderEdition(folder: string): Promise<Edition | null> {
  const marker = await readFile(join(folder, EDITION_MARKER), "utf8").then((raw) => JSON.parse(raw) as { edition?: unknown }, () => null);
  if (marker?.edition) return parseEdition(marker.edition);
  if (await stat(join(folder, "recruiter", "candidates.json")).then(() => true, () => false)) return "recruiter";
  const used = await Promise.all(["profile", "jobs", "resumes", "context"].map((name) => stat(join(folder, name)).then(() => true, () => false)));
  return used.some(Boolean) ? "solo" : null; // null: a new or empty folder, free for either edition
}

/**
 * Returns the folder this edition should open: the chosen one when it is this edition's (or new), otherwise the
 * edition's own default folder, so one edition never opens or changes the other's data. Stamps the marker.
 */
export async function prepareEditionFolder(chosen: string, edition: Edition, fallback: string): Promise<string> {
  const owner = await folderEdition(chosen);
  const message = owner ? folderMismatchMessage(edition, owner) : null;
  const folder = message ? fallback : chosen;
  if (message) console.warn(`${message} (${chosen}); opening ${folder} instead.`);
  if (message && (await folderEdition(folder)) && (await folderEdition(folder)) !== edition) throw new Error(message);
  await mkdir(join(folder, ".sensei"), { recursive: true });
  const markerPath = join(folder, EDITION_MARKER);
  if (!(await stat(markerPath).then(() => true, () => false))) await writeJsonAtomic(markerPath, { edition, createdAt: new Date().toISOString() });
  return folder;
}
