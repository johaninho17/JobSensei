// Tune (ledger U76, #117): per area, the app finds what changed since the last Tune, briefs Agy on only those files,
// collects Agy's suggestions (`.sensei/tune/<area>.json`, checked by `src/shared/tune-schemas.ts`), banks them, and
// applies only what the user picks, with a backup, Undo, and history for anything replaced or archived.
// `.agents/workflows/jobsensei-tune.md` owns what Agy may suggest; this file owns what the app accepts and how it lands.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { waitingToImport } from "../src/shared/recordings";
import {
  TUNE_BANK_FILE, TUNE_DECLINED_FILE, TUNE_DIR, TUNE_HISTORY_FILE, rankTuneSuggestions, tuneBankSchema, tuneDeclinedSchema, tuneHistorySchema,
  tuneSuggestionId, tuneSuggestionsFile, tuneSuggestionsFileSchema, type TuneArea, type TuneSuggestion,
} from "../src/shared/tune-schemas";
import { toDisk, toLogical } from "../src/shared/workspace-layout";
import { agyActivity } from "./agy-activity";
import { CONTENT_FILES, MEMORY_DIR, markRecordingsImported, readPendingUpdate, scanRecordings } from "./content-refresh";
import { readJobQueue } from "./job-queue";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persistence";
import { applyTuneSuggestion } from "./tune-apply";
import { assertInsideWorkspace, layoutVersion, workspaceFile } from "./workspace";
import { CAREER_LOCK, withWriteLock } from "./write-lock";

const SOURCES_FILE = `${TUNE_DIR}/sources.json`;
const LAST_APPLY_FILE = `${TUNE_DIR}/last-apply.json`;
const BACKUP_ROOT = `${TUNE_DIR}/backups`;
const KEEP_BACKUPS = 10;
const runFile = (area: TuneArea) => `${TUNE_DIR}/run-${area}.json`;
const briefFile = (area: TuneArea) => `${TUNE_DIR}/${area}-brief.md`;
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export const TUNE_LABELS: Record<TuneArea, string> = { interviews: "interview content" };

type Run = { area: TuneArea; startedAt: string; sources: Record<string, string> };

// ---- What each area reads and may change ---------------------------------------------------------------------

async function filesUnder(root: string, dir: string, pattern: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(workspaceFile(root, dir), { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith(".")) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (path !== MEMORY_DIR) out.push(...await filesUnder(root, path, pattern)); }
    else if (pattern.test(entry.name)) out.push(path);
  }
  return out.sort();
}

const exists = async (root: string, path: string) => Boolean((await stat(workspaceFile(root, path)).catch(() => null))?.isFile());

async function jobIds(root: string): Promise<string[]> {
  return (await readdir(join(root, "jobs"), { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
}

/** Every file an area reads, before filtering to what changed. */
async function areaSources(root: string, _area: TuneArea): Promise<string[]> {
  return waitingToImport(await scanRecordings(root, await jobIds(root))).map((recording) => recording.path);
}

/** The content files an area's suggestions may change. */
export async function areaTargets(root: string, _area: TuneArea): Promise<string[]> {
  return [...CONTENT_FILES, ...await filesUnder(root, MEMORY_DIR, /\.md$/i)];
}

async function hashes(root: string, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of paths) { const data = await readFile(workspaceFile(root, path)).catch(() => null); if (data) out[path] = sha(data); }
  return out;
}

async function lastTuned(root: string): Promise<Partial<Record<TuneArea, Record<string, string>>>> {
  return await readJson<Partial<Record<TuneArea, Record<string, string>>>>(workspaceFile(root, SOURCES_FILE)) ?? {};
}

/** The area's files that are new or changed since its last Tune. */
export async function changedSources(workspacePath: string, area: TuneArea): Promise<Record<string, string>> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const current = await hashes(root, await areaSources(root, area));
  const seen = (await lastTuned(root))[area] ?? {};
  return Object.fromEntries(Object.entries(current).filter(([path, hash]) => seen[path] !== hash));
}

// ---- Busy, status ---------------------------------------------------------------------------------------------

/** Why Tune can't start now, or null: Agy is running a job, an application, an interview prep, or a content update. */
export async function tuneBusyReason(workspacePath: string): Promise<string | null> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  if ((await readJobQueue(root).catch(() => null))?.items.some((item) => item.status === "running")) return "Agy is running a job. Tune when it's done.";
  if (await readPendingUpdate(root).catch(() => null)) return "An interview content update is still open. Finish or undo it first.";
  const running = (await agyActivity(root, { limit: 20 }).catch(() => [])).find((item) => item.result === "running" && item.where === "panel");
  return running ? `Agy is busy (${running.label}). Tune when it's done.` : null;
}

export type TuneAreaStatus = { area: TuneArea; changed: number; waitingForAgy: boolean; suggestionsReady: boolean; banked: number };

export async function tuneStatus(workspacePath: string, areas: readonly TuneArea[]): Promise<TuneAreaStatus[]> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const bank = await readBank(root);
  const declined = new Set((await readDeclined(root)).ids);
  return Promise.all(areas.map(async (area) => ({
    area,
    changed: Object.keys(await changedSources(root, area)).length,
    waitingForAgy: await exists(root, runFile(area)),
    suggestionsReady: await exists(root, tuneSuggestionsFile(area)),
    banked: bank.items.filter((item) => item.area === area && !declined.has(item.id)).length,
  })));
}

// ---- Start: brief Agy on only what changed --------------------------------------------------------------------

export async function startTune(workspacePath: string, area: TuneArea, options: { now?: Date; practiceStories?: boolean } = {}): Promise<{ prompt: string; sources: string[] }> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const busy = await tuneBusyReason(root);
  if (busy) throw new Error(busy);
  const sources = await changedSources(root, area);
  const paths = Object.keys(sources);
  if (!paths.length) throw new Error(`Nothing new for your ${TUNE_LABELS[area]} since the last Tune.`);
  const version = layoutVersion(root);
  const disk = (path: string) => `\`${toDisk(path, version)}\``;
  const targets = await areaTargets(root, area);
  const brief = [
    `# Tune: ${TUNE_LABELS[area]}`,
    "",
    "Follow `.agents/workflows/jobsensei-tune.md`.",
    "",
    "Read only these new or changed files:",
    ...paths.map((path) => `- ${disk(path)}`),
    "",
    "Content you may suggest changes to (read it; never edit it):",
    ...targets.map((path) => `- ${disk(path)}`),
    ...(area === "interviews" ? ["", "What to take from recordings: steps 1–2, 6, and 7 of `.agents/workflows/jobsensei-interview-review.md` (question patterns, interview voice, interview stories; no logistics)."] : []),
    ...(area === "interviews" && options.practiceStories === false ? ["", "Practice interviews are not evidence for me (my setting): from practice interviews, suggest only interview voice and question patterns, no interview-story rows."] : []),
    "",
    `Write your suggestions to \`${tuneSuggestionsFile(area)}\`, then stop.`,
  ].join("\n");
  await mkdir(workspaceFile(root, TUNE_DIR), { recursive: true });
  await rm(workspaceFile(root, tuneSuggestionsFile(area)), { force: true });
  await writeTextAtomic(workspaceFile(root, briefFile(area)), `${brief}\n`);
  await writeJsonAtomic(workspaceFile(root, runFile(area)), { area, startedAt: (options.now ?? new Date()).toISOString(), sources } satisfies Run);
  return { prompt: `Tune my ${TUNE_LABELS[area]}: read ${briefFile(area)} first, then follow it.`, sources: paths };
}

// ---- Collect: check Agy's suggestions and bank them -----------------------------------------------------------

async function readBank(root: string) {
  const parsed = tuneBankSchema.safeParse(await readJson<unknown>(workspaceFile(root, TUNE_BANK_FILE)));
  return parsed.success ? parsed.data : { schemaVersion: 1 as const, items: [] };
}
async function readDeclined(root: string) {
  const parsed = tuneDeclinedSchema.safeParse(await readJson<unknown>(workspaceFile(root, TUNE_DECLINED_FILE)));
  return parsed.success ? parsed.data : { schemaVersion: 1 as const, ids: [] };
}

/** Agy names files as it sees them on disk; the app keeps logical paths. */
function logical(path: string, version: ReturnType<typeof layoutVersion>): string {
  const bare = path.replace(/^\.?\/?data\//, "").replace(/^\.\//, "");
  return toLogical(bare, version) ?? bare;
}

export type TuneView = { shown: TuneSuggestion[]; banked: number };

/** Banked suggestions for an area whose sources are unchanged, ranked; the top five are shown. */
export async function tuneView(workspacePath: string, area: TuneArea): Promise<TuneView> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const bank = await readBank(root);
  const declined = (await readDeclined(root)).ids;
  const items = bank.items.filter((item) => item.area === area);
  const current = await hashes(root, [...new Set(items.map((item) => item.source))]);
  const fresh = items.filter((item) => current[item.source] === item.sourceHash);
  if (fresh.length !== items.length) await writeJsonAtomic(workspaceFile(root, TUNE_BANK_FILE), { ...bank, items: bank.items.filter((item) => item.area !== area || fresh.includes(item)) });
  const { shown, banked } = rankTuneSuggestions(fresh, declined);
  return { shown, banked: banked.length };
}

export async function collectTune(workspacePath: string, area: TuneArea, now = new Date()): Promise<TuneView & { added: number; problems: string[] }> {
  return withWriteLock(CAREER_LOCK, async () => {
    const root = assertInsideWorkspace(workspacePath, workspacePath);
    const run = await readJson<Run>(workspaceFile(root, runFile(area)));
    if (!run) throw new Error(`No Tune is waiting for your ${TUNE_LABELS[area]}.`);
    const raw = await readFile(workspaceFile(root, tuneSuggestionsFile(area)), "utf8").catch(() => null);
    if (raw === null) throw new Error("Agy hasn't written its suggestions yet.");
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error(`${tuneSuggestionsFile(area)} is not valid JSON. Ask Agy to write it again.`); }
    const parsed = tuneSuggestionsFileSchema.safeParse(value);
    if (!parsed.success) throw new Error(`Agy's suggestions don't match the format: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}.`);
    if (parsed.data.area !== area) throw new Error(`The suggestions are for "${parsed.data.area}", not "${area}".`);
    const version = layoutVersion(root);
    const targets = new Set(await areaTargets(root, area));
    const problems: string[] = [];
    const fresh: TuneSuggestion[] = [];
    for (const input of parsed.data.suggestions) {
      const suggestion = { ...input, file: logical(input.file, version), source: logical(input.source, version) };
      if (!targets.has(suggestion.file)) { problems.push(`Left out a suggestion for ${input.file}: Tune for your ${TUNE_LABELS[area]} doesn't change that file.`); continue; }
      const sourceHash = run.sources[suggestion.source];
      if (!sourceHash) { problems.push(`Left out a suggestion from ${input.source}: it wasn't one of the files this Tune read.`); continue; }
      fresh.push({ ...suggestion, id: tuneSuggestionId(area, suggestion), area, sourceHash, createdAt: now.toISOString() });
    }
    const bank = await readBank(root);
    const known = new Set(bank.items.map((item) => item.id));
    const added = fresh.filter((item) => !known.has(item.id) && known.add(item.id));
    await writeJsonAtomic(workspaceFile(root, TUNE_BANK_FILE), { ...bank, items: [...bank.items, ...added] });
    const tuned = await lastTuned(root);
    await writeJsonAtomic(workspaceFile(root, SOURCES_FILE), { ...tuned, [area]: { ...tuned[area], ...run.sources } });
    if (area === "interviews") {
      const recordings = await Promise.all(Object.entries(run.sources).map(async ([path, hash]) => ({ path, hash, size: (await stat(workspaceFile(root, path)).catch(() => null))?.size ?? 0 })));
      await markRecordingsImported(root, recordings, now);
    }
    await rm(workspaceFile(root, runFile(area)), { force: true });
    await rm(workspaceFile(root, briefFile(area)), { force: true });
    return { ...await tuneView(root, area), added: added.length, problems };
  });
}

/** Drops a Tune run Agy never finished, so the area can start again. */
export async function cancelTune(workspacePath: string, area: TuneArea): Promise<void> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  await rm(workspaceFile(root, runFile(area)), { force: true });
  await rm(workspaceFile(root, briefFile(area)), { force: true });
  await rm(workspaceFile(root, tuneSuggestionsFile(area)), { force: true });
}

// ---- Apply, decline, undo -------------------------------------------------------------------------------------

type LastApply = { at: string; backup: string; created: string[]; applied: TuneSuggestion[] };

async function pruneBackups(root: string): Promise<void> {
  const dirs = (await readdir(workspaceFile(root, BACKUP_ROOT)).catch(() => [] as string[])).sort();
  for (const name of dirs.slice(0, Math.max(0, dirs.length - KEEP_BACKUPS))) await rm(join(workspaceFile(root, BACKUP_ROOT), name), { recursive: true, force: true });
}

export type ApplyOutcome = { applied: string[]; skipped: Array<{ id: string; reason: string }>; declined: string[] };

/** Applies the checked suggestions, declines the ones the user turned down, and leaves the rest in the bank. */
export async function applyTune(workspacePath: string, area: TuneArea, applyIds: string[], declineIds: string[] = [], now = new Date()): Promise<ApplyOutcome> {
  return withWriteLock(CAREER_LOCK, async () => {
    const root = assertInsideWorkspace(workspacePath, workspacePath);
    const bank = await readBank(root);
    const chosen = applyIds.map((id) => bank.items.find((item) => item.id === id && item.area === area)).filter((item): item is TuneSuggestion => Boolean(item));
    const backup = `${BACKUP_ROOT}/${now.toISOString().replace(/[:.]/g, "-")}`;
    const created: string[] = [];
    const files = new Map<string, string>();
    for (const file of new Set(chosen.map((item) => item.file))) {
      const path = assertInsideWorkspace(root, workspaceFile(root, file));
      const text = await readFile(path, "utf8").catch(() => null);
      if (text === null) { created.push(file); files.set(file, ""); continue; }
      await mkdir(dirname(join(root, backup, file)), { recursive: true });
      await copyFile(path, join(root, backup, file));
      files.set(file, text);
    }
    const history = tuneHistorySchema.parse(await readJson<unknown>(workspaceFile(root, TUNE_HISTORY_FILE)) ?? { schemaVersion: 1 });
    const outcome: ApplyOutcome = { applied: [], skipped: [], declined: [] };
    const applied: TuneSuggestion[] = [];
    for (const item of chosen) {
      const result = applyTuneSuggestion(files.get(item.file)!, item);
      if (!result.ok) { outcome.skipped.push({ id: item.id, reason: result.reason }); continue; }
      files.set(item.file, result.markdown);
      applied.push(item);
      outcome.applied.push(item.id);
      if (result.oldText !== null && item.operation !== "add") history.entries.push({ suggestionId: item.id, operation: item.operation, file: item.file, section: item.section, oldText: result.oldText, newText: item.text, reason: item.reason, at: now.toISOString() });
    }
    for (const [file, text] of files) {
      if (!applied.some((item) => item.file === file)) continue;
      const path = assertInsideWorkspace(root, workspaceFile(root, file));
      await mkdir(dirname(path), { recursive: true });
      await writeTextAtomic(path, text.endsWith("\n") ? text : `${text}\n`);
    }
    await writeJsonAtomic(workspaceFile(root, TUNE_HISTORY_FILE), history);
    const declined = await readDeclined(root);
    outcome.declined = declineIds.filter((id) => bank.items.some((item) => item.id === id && item.area === area));
    await writeJsonAtomic(workspaceFile(root, TUNE_DECLINED_FILE), { ...declined, ids: [...new Set([...declined.ids, ...outcome.declined])] });
    // Applied and declined leave the bank; a skipped one (its target is gone) leaves too, since it can't apply.
    const gone = new Set([...outcome.applied, ...outcome.declined, ...outcome.skipped.map((entry) => entry.id)]);
    await writeJsonAtomic(workspaceFile(root, TUNE_BANK_FILE), { ...bank, items: bank.items.filter((item) => !gone.has(item.id)) });
    if (applied.length) {
      await writeJsonAtomic(workspaceFile(root, LAST_APPLY_FILE), { at: now.toISOString(), backup, created: created.filter((file) => applied.some((item) => item.file === file)), applied } satisfies LastApply);
      await pruneBackups(root);
    }
    return outcome;
  });
}

/** Undo the last apply: every file goes back to its backup, files it created are removed, suggestions return to the bank. */
export async function undoTune(workspacePath: string): Promise<{ restored: number }> {
  return withWriteLock(CAREER_LOCK, async () => {
    const root = assertInsideWorkspace(workspacePath, workspacePath);
    const last = await readJson<LastApply>(workspaceFile(root, LAST_APPLY_FILE));
    if (!last) throw new Error("There is no Tune to undo.");
    const files = [...new Set(last.applied.map((item) => item.file))];
    for (const file of files) {
      const path = assertInsideWorkspace(root, workspaceFile(root, file));
      if (last.created.includes(file)) await rm(path, { force: true });
      else await copyFile(join(root, last.backup, file), path);
    }
    const bank = await readBank(root);
    const ids = new Set(last.applied.map((item) => item.id));
    await writeJsonAtomic(workspaceFile(root, TUNE_BANK_FILE), { ...bank, items: [...bank.items.filter((item) => !ids.has(item.id)), ...last.applied] });
    const history = tuneHistorySchema.parse(await readJson<unknown>(workspaceFile(root, TUNE_HISTORY_FILE)) ?? { schemaVersion: 1 });
    await writeJsonAtomic(workspaceFile(root, TUNE_HISTORY_FILE), { ...history, entries: history.entries.filter((entry) => !ids.has(entry.suggestionId)) });
    await rm(workspaceFile(root, LAST_APPLY_FILE), { force: true });
    return { restored: files.length };
  });
}
