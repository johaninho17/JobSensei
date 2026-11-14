// Interview content refresh: the app knows which recordings are new, sends Agy only those, and checks that an update
// never loses content without a better replacement (`.agents/workflows/jobsensei-interview-review.md` step 4 owns the
// rule for Agy; this file owns the check).
import { waitingToImport } from "../src/shared/recordings";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./persistence";
import { toDisk, toLogical } from "../src/shared/workspace-layout";
import { assertInsideWorkspace, layoutVersion, workspaceFile } from "./workspace";

export const LEDGER_FILE = ".sensei/content-sources.json";
export const UPDATE_FILE = ".sensei/content-update.json";
export const CHANGES_FILE = ".sensei/content-changes.json";
const BACKUP_ROOT = ".sensei/content-backups";
const KEEP_BACKUPS = 10;
const RECORDING = /\.(?:md|txt|vtt|srt)$/i;
/** The condensed content interview prep reads. Role memory files are listed from its folder. */
export const CONTENT_FILES = ["profile/story_bank.md", "profile/interview_voice.md", "context/structured/interview-stories.md"];
export const MEMORY_DIR = "debrief/interview-memory";

const ledgerSchema = z.object({
  files: z.record(z.string(), z.object({
    hash: z.string(),
    size: z.number(),
    firstSeen: z.string(),
    status: z.enum(["imported", "skipped"]),
    importedAt: z.string().nullable().default(null),
  })),
});
type Ledger = z.infer<typeof ledgerSchema>;

export type Recording = {
  path: string;
  size: number;
  /** new: never imported; changed: imported before, but the file changed (e.g. a fuller transcript). */
  state: "new" | "changed" | "imported" | "duplicate" | "skipped";
  duplicateOf: string | null;
  /** The job the recording's folder matches, when exactly one does. */
  jobId: string | null;
};

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

async function walk(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(workspaceFile(root, dir), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (path !== MEMORY_DIR) out.push(...await walk(root, path)); }
    else if (RECORDING.test(entry.name)) out.push(path);
  }
  return out;
}

/** Recordings the old Agy-written list says were imported (backticked `debrief/...` paths under "## Imported recordings"). */
export function importedFromList(interviewStories: string): string[] {
  const section = /##\s*Imported recordings([\s\S]*?)(?=\n##\s|$)/i.exec(interviewStories)?.[1] ?? "";
  // A tidy workspace's list names the recordings by their disk path; both spellings mean the same file.
  return [...section.matchAll(/`((?:debrief|interviews\/recordings)\/[^`]+)`/g)].map((match) => toLogical(match[1]!, 2));
}

async function readLedger(workspace: string): Promise<Ledger> {
  const parsed = ledgerSchema.safeParse(await readJson<unknown>(workspaceFile(workspace, LEDGER_FILE)));
  return parsed.success ? parsed.data : { files: {} };
}

/** Every recording under debrief/, with what the app knows about it. The ledger is seeded once from the old list. */
export async function scanRecordings(workspacePath: string, jobIds: string[] = []): Promise<Recording[]> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const ledger = await readLedger(root);
  const paths = (await walk(root, "debrief")).sort();
  const now = new Date().toISOString();
  if (!Object.keys(ledger.files).length) {
    const listed = new Set(importedFromList(await readFile(workspaceFile(root, "context/structured/interview-stories.md"), "utf8").catch(() => "")));
    // A file the old list names counts as imported as it is now, and so does a companion file beside it that is no
    // newer than it (the AI summary saved with a transcript). Everything else starts as new.
    const modified = new Map(await Promise.all(paths.map(async (path) => [path, (await stat(workspaceFile(root, path))).mtimeMs] as const)));
    const folder = (path: string) => path.slice(0, path.lastIndexOf("/"));
    const companion = (path: string) => folder(path) !== "debrief" && [...listed].some((listedPath) => folder(listedPath) === folder(path) && (modified.get(path) ?? Infinity) <= (modified.get(listedPath) ?? -Infinity) + 60_000);
    for (const path of paths) {
      if (!listed.has(path) && !companion(path)) continue;
      const data = await readFile(workspaceFile(root, path));
      ledger.files[path] = { hash: sha(data), size: data.length, firstSeen: now, status: "imported", importedAt: null };
    }
    if (Object.keys(ledger.files).length) await writeJsonAtomic(workspaceFile(root, LEDGER_FILE), ledger);
  }
  // A file with the same content as one already imported, or as an earlier file in this scan, is a duplicate.
  const hashed = await Promise.all(paths.map(async (path) => { const data = await readFile(workspaceFile(root, path)); return { path, size: data.length, hash: sha(data) }; }));
  const owner = new Map<string, string>();
  for (const [path, entry] of Object.entries(ledger.files)) if (!owner.has(entry.hash)) owner.set(entry.hash, path);
  const recordings: Recording[] = [];
  for (const { path, size, hash } of hashed) {
    const known = ledger.files[path];
    const first = owner.get(hash);
    const state: Recording["state"] = known?.status === "skipped" ? "skipped"
      : known && known.hash === hash ? "imported"
      : first && first !== path ? "duplicate"
      : known ? "changed" : "new";
    if (!owner.has(hash)) owner.set(hash, path);
    recordings.push({ path, size, state, duplicateOf: state === "duplicate" ? first! : null, jobId: matchJob(path, jobIds) });
  }
  return recordings;
}

/** The job whose ID starts with the recording's folder name ("debrief/northstar/…" → "northstar-support-engineer"), when only one does. */
export function matchJob(path: string, jobIds: string[]): string | null {
  const folder = path.split("/")[1]?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "";
  if (!folder || !path.split("/")[2]) return null;
  const matches = jobIds.filter((id) => id === folder || id.startsWith(`${folder}-`));
  return matches.length === 1 ? matches[0]! : null;
}

// ---- Content snapshot and change check -------------------------------------------------------------------

export type ContentItem = { file: string; section: string; key: string; text: string };

/**
 * The pieces of a content file the check compares: story bank sections ("## S3 · …") as whole items, table rows keyed
 * by their first cell, and bullet lines keyed by their first words.
 */
export function contentItems(file: string, markdown: string): ContentItem[] {
  const items: ContentItem[] = [];
  let section = "";
  let story: ContentItem | null = null;
  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      section = heading[2]!.trim();
      const id = /^(S\d{1,2})\b/.exec(section)?.[1];
      story = id ? { file, section, key: id, text: line } : null;
      if (story) items.push(story);
      continue;
    }
    if (story) { story.text += `\n${line}`; continue; }
    const row = /^\|\s*([^|]+?)\s*\|.*\|\s*$/.exec(line);
    if (row && !/^[-: ]+$/.test(row[1]!) && !/^(?:evidence id|id|question|item)$/i.test(row[1]!)) { items.push({ file, section, key: `row:${row[1]!.replace(/`/g, "").toLowerCase()}`, text: line }); continue; }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) items.push({ file, section, key: `${section.toLowerCase()}|${normal(bullet[1]!).split(" ").slice(0, 8).join(" ")}`, text: line });
  }
  for (const item of items) item.text = item.text.trimEnd();
  return items;
}
const normal = (text: string) => text.toLowerCase().replace(/[`*_]/g, "").replace(/[^a-z0-9:.-]+/g, " ").trim();
const ids = (text: string) => new Set(text.match(/\b(?:S\d{1,2}|context:[a-z0-9:._-]+|[a-z][a-z0-9-]*:[a-z0-9-]+:[a-z0-9.+-]+)\b/gi) ?? []);

export type ChangeEntry = { file: string; kind: "added" | "upgraded" | "replaced" | "removed"; item: string; replacement?: string; why?: string };
export type ContentReview = {
  added: ContentItem[];
  upgraded: Array<{ before: ContentItem; after: ContentItem }>;
  /** Removed or shortened items Agy listed with a replacement: shown for the user to confirm. */
  replaced: Array<{ before: ContentItem; after: ContentItem | null; replacement: string; why: string }>;
  /** Removed or shortened items Agy did not list: put back by `restoreLost`. */
  lost: Array<{ before: ContentItem; after: ContentItem | null }>;
};

/** Compares the content before and after an update, using Agy's change list to tell replacements from losses. */
export function reviewChanges(before: ContentItem[], after: ContentItem[], changes: ChangeEntry[]): ContentReview {
  const afterByKey = new Map(after.map((item) => [`${item.file}#${item.key}`, item]));
  const beforeKeys = new Set(before.map((item) => `${item.file}#${item.key}`));
  const explained = (item: ContentItem) => changes.find((change) => (change.kind === "replaced" || change.kind === "removed") && change.file === item.file
    && (change.item === item.key || change.item === item.key.replace(/^row:/, "") || normal(item.text).includes(normal(change.item).slice(0, 60)) || normal(change.item).includes(normal(item.text).slice(0, 60))));
  const review: ContentReview = { added: after.filter((item) => !beforeKeys.has(`${item.file}#${item.key}`)), upgraded: [], replaced: [], lost: [] };
  for (const item of before) {
    const now = afterByKey.get(`${item.file}#${item.key}`) ?? null;
    const lostIds = now ? [...ids(item.text)].filter((id) => !ids(now.text).has(id)) : [];
    const weaker = !now || now.text.length < item.text.length * 0.8 || lostIds.length > 0;
    if (!weaker) { if (now && now.text !== item.text) review.upgraded.push({ before: item, after: now }); continue; }
    const change = explained(item);
    if (change?.replacement) review.replaced.push({ before: item, after: now, replacement: change.replacement, why: change.why ?? "" });
    else review.lost.push({ before: item, after: now });
  }
  return review;
}

/** Puts back lost items: a shortened item gets its old text; a removed one goes back under its section (or at the end). */
export function restoreLost(markdown: string, lost: ContentReview["lost"]): string {
  let text = markdown;
  for (const { before, after } of lost) {
    if (after) { text = text.replace(after.text, before.text); continue; }
    const lines = text.split("\n");
    const at = lines.findIndex((line) => /^#{2,4}\s/.test(line) && line.replace(/^#+\s+/, "").trim() === before.section);
    if (at >= 0 && !/^S\d/.test(before.key)) {
      let end = at + 1;
      while (end < lines.length && !/^#{2,4}\s/.test(lines[end]!)) end++;
      while (end > at + 1 && !lines[end - 1]!.trim()) end--;
      lines.splice(end, 0, before.text);
      text = lines.join("\n");
    } else text = `${text.trimEnd()}\n\n${before.text}\n`;
  }
  return text;
}

async function contentPaths(root: string): Promise<string[]> {
  const memory = (await readdir(workspaceFile(root, MEMORY_DIR)).catch(() => [] as string[])).filter((name) => name.endsWith(".md")).map((name) => `${MEMORY_DIR}/${name}`);
  return [...CONTENT_FILES, ...memory];
}

const updateSchema = z.object({ startedAt: z.string(), backup: z.string(), recordings: z.array(z.object({ path: z.string(), hash: z.string(), size: z.number() })), files: z.array(z.string()) });
export type PendingUpdate = z.infer<typeof updateSchema>;

/** Starts an update: backs up the content files and records which recordings it covers. Returns the prompt for Agy. */
export async function startUpdate(workspacePath: string, recordings: Recording[], jobNames: Record<string, string>, now = new Date(), practiceStories = true): Promise<{ prompt: string; update: PendingUpdate }> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const chosen = waitingToImport(recordings);
  if (!chosen.length) throw new Error("There are no new recordings to import.");
  const backup = `${BACKUP_ROOT}/${now.toISOString().replace(/[:.]/g, "-")}`;
  const files = await contentPaths(root);
  for (const file of files) {
    const source = workspaceFile(root, file);
    if (!(await stat(source).catch(() => null))?.isFile()) continue;
    await mkdir(join(root, backup, file, ".."), { recursive: true });
    await copyFile(source, join(root, backup, file));
  }
  await pruneBackups(root);
  await rm(workspaceFile(root, CHANGES_FILE), { force: true });
  const update: PendingUpdate = { startedAt: now.toISOString(), backup, files, recordings: await Promise.all(chosen.map(async (recording) => { const data = await readFile(workspaceFile(root, recording.path)); return { path: recording.path, hash: sha(data), size: data.length }; })) };
  await writeJsonAtomic(workspaceFile(root, UPDATE_FILE), update);
  const version = layoutVersion(root);
  const list = chosen.map((recording) => `- ${toDisk(recording.path, version)}${recording.jobId ? ` (job: ${recording.jobId}${jobNames[recording.jobId] ? `, ${jobNames[recording.jobId]}` : ""})` : " (job not matched: ask me which job it was)"}${recording.state === "changed" ? " — a newer version of a recording imported before; import only what's new in it" : ""}`).join("\n");
  const prompt = [
    "Run the interview review import (.agents/workflows/jobsensei-interview-review.md) on only these new recordings:",
    list,
    "Read only these files plus the current story bank, interview voice, role memory, and interview stories. Add, merge, or upgrade; remove or shorten something only when a better version replaces it, and show me each one as old → new with why. After I confirm and you save, write the change list to .sensei/content-changes.json as step 4 describes.",
    ...(practiceStories ? [] : ["Practice interviews are not evidence for me (my setting): from practice interviews, update only interview voice and hard questions to practice; propose no interview-story rows."]),
  ].join("\n");
  return { prompt, update };
}

export async function readPendingUpdate(workspacePath: string): Promise<PendingUpdate | null> {
  const parsed = updateSchema.safeParse(await readJson<unknown>(workspaceFile(workspacePath, UPDATE_FILE)));
  return parsed.success ? parsed.data : null;
}

async function readText(root: string, path: string) { return readFile(workspaceFile(root, path), "utf8").catch(() => ""); }

/** What the update changed, compared with the backup and Agy's change list. */
export async function reviewUpdate(workspacePath: string): Promise<ContentReview & { files: string[]; changeListFound: boolean }> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const update = await readPendingUpdate(root);
  if (!update) throw new Error("No content update is in progress.");
  const changesRaw = await readJson<{ changes?: ChangeEntry[] }>(workspaceFile(root, CHANGES_FILE));
  const changes = Array.isArray(changesRaw?.changes) ? changesRaw.changes : [];
  const files = [...new Set([...update.files, ...await contentPaths(root)])];
  const before: ContentItem[] = [];
  const after: ContentItem[] = [];
  for (const file of files) {
    before.push(...contentItems(file, await readText(root, `${update.backup}/${file}`)));
    after.push(...contentItems(file, await readText(root, file)));
  }
  return { ...reviewChanges(before, after, changes), files, changeListFound: Boolean(changesRaw) };
}

/**
 * Finishes the update: puts back anything lost without a replacement (and, when `keepOld` names items, their old
 * versions too), marks the recordings imported, and clears the pending update.
 */
export async function finishUpdate(workspacePath: string, keepOld: string[] = [], now = new Date()): Promise<{ restored: number }> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const update = await readPendingUpdate(root);
  if (!update) throw new Error("No content update is in progress.");
  const review = await reviewUpdate(root);
  const putBack = [...review.lost, ...review.replaced.filter((entry) => keepOld.includes(`${entry.before.file}#${entry.before.key}`)).map(({ before, after }) => ({ before, after }))];
  for (const file of new Set(putBack.map((entry) => entry.before.file))) {
    const path = assertInsideWorkspace(root, workspaceFile(root, file));
    await writeFile(path, restoreLost(await readText(root, file), putBack.filter((entry) => entry.before.file === file)), "utf8");
  }
  const ledger = await readLedger(root);
  for (const recording of update.recordings) ledger.files[recording.path] = { hash: recording.hash, size: recording.size, firstSeen: ledger.files[recording.path]?.firstSeen ?? now.toISOString(), status: "imported", importedAt: now.toISOString() };
  await writeJsonAtomic(workspaceFile(root, LEDGER_FILE), ledger);
  await rm(workspaceFile(root, UPDATE_FILE), { force: true });
  return { restored: putBack.length };
}

/** Puts every content file back as it was before the update and cancels it (the recordings stay new). */
export async function undoUpdate(workspacePath: string): Promise<void> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const update = await readPendingUpdate(root);
  if (!update) return;
  for (const file of update.files) {
    const saved = join(root, update.backup, file);
    if ((await stat(saved).catch(() => null))?.isFile()) await copyFile(saved, workspaceFile(root, file));
    else await rm(workspaceFile(root, file), { force: true });
  }
  await rm(workspaceFile(root, UPDATE_FILE), { force: true });
}

/** Marks recordings skipped (not interview recordings, or not worth importing); they stop showing as new. */
export async function skipRecordings(workspacePath: string, paths: string[], now = new Date()): Promise<void> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const ledger = await readLedger(root);
  for (const path of paths) {
    if (!path.startsWith("debrief/") || path.includes("..")) continue;
    const data = await readFile(workspaceFile(root, path)).catch(() => null);
    if (data) ledger.files[path] = { hash: sha(data), size: data.length, firstSeen: now.toISOString(), status: "skipped", importedAt: null };
  }
  await writeJsonAtomic(workspaceFile(root, LEDGER_FILE), ledger);
}

async function pruneBackups(root: string): Promise<void> {
  const names = (await readdir(workspaceFile(root, BACKUP_ROOT)).catch(() => [] as string[])).sort();
  for (const name of names.slice(0, Math.max(0, names.length - KEEP_BACKUPS))) await rm(join(root, BACKUP_ROOT, name), { recursive: true, force: true });
}

