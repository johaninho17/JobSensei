// Moves a workspace from the original folder layout to the tidy one (src/shared/workspace-layout.ts owns the names).
// Preview first (nothing moves), then apply, with a log that undoes every move. Nothing is deleted: files the app no
// longer uses and exact duplicates go to `archive/`. Job folders, resumes, and the profile file are not touched.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { LAYOUT_FILE, LAYOUT_V2_RULES, parseLayoutVersion } from "../src/shared/workspace-layout";
import type { LayoutMove, LayoutPlan } from "../src/shared/schemas";
import { forgetLayout } from "./layout";
import { readJson, writeJsonAtomic } from "./persistence";

export const MIGRATION_LOG = ".sensei/layout-migration.json";

export type { LayoutMove };
export type MigrationPlan = LayoutPlan;
type MigrationLog = { startedAt: string; finishedAt: string | null; done: LayoutMove[] };

const disk = (root: string, path: string) => {
  const absolute = resolve(root, path);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new Error("A layout move left the workspace.");
  return absolute;
};
const kind = async (path: string) => { const info = await stat(path).catch(() => null); return !info ? null : info.isDirectory() ? "dir" : "file"; };
const names = async (path: string) => (await readdir(path).catch(() => [] as string[])).filter((name) => name !== ".DS_Store").sort();

async function filesUnder(root: string, folder: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(disk(root, folder), { withFileTypes: true }).catch(() => [])) {
    if (entry.name === ".DS_Store") continue;
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await filesUnder(root, path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

async function hashOf(root: string, path: string): Promise<string> {
  return createHash("sha256").update(await readFile(disk(root, path))).digest("hex");
}

async function currentVersion(root: string): Promise<1 | 2> {
  return parseLayoutVersion(await readJson<unknown>(join(root, LAYOUT_FILE)));
}

/** Exact copies inside one group of files: every copy after the one kept (in `keepFirst` order). */
async function exactCopies(root: string, files: string[], keepFirst: (a: string, b: string) => number): Promise<Array<{ copy: string; of: string }>> {
  const bySize = new Map<number, string[]>();
  for (const file of files) {
    const size = (await stat(disk(root, file))).size;
    if (size > 0) bySize.set(size, [...(bySize.get(size) ?? []), file]);
  }
  const out: Array<{ copy: string; of: string }> = [];
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    const byHash = new Map<string, string[]>();
    for (const file of group) { const hash = await hashOf(root, file); byHash.set(hash, [...(byHash.get(hash) ?? []), file]); }
    for (const same of byHash.values()) {
      const [kept, ...copies] = [...same].sort(keepFirst);
      for (const copy of copies) out.push({ copy, of: kept });
    }
  }
  return out.sort((a, b) => a.copy.localeCompare(b.copy));
}

/** What a migration would do. Reads only. */
export async function planMigration(workspacePath: string): Promise<MigrationPlan> {
  const root = resolve(workspacePath);
  const log = await readJson<MigrationLog>(join(root, MIGRATION_LOG));
  const canUndo = Boolean(log?.done?.length);
  if (await currentVersion(root) === 2) return { version: 2, moves: [], conflicts: [], notes: [], canUndo };

  const moves: LayoutMove[] = [];
  const notes: string[] = [];
  const archived = new Set<string>();
  const selected = new Set((await readJson<{ selectedCareerPaths?: string[] }>(join(root, ".sensei/active-context.json")))?.selectedCareerPaths ?? []);

  // 1. Exact copies. Work records win over notes; a copy stays put when it is checked for Agy and its twin isn't.
  const structured = await filesUnder(root, "context/structured");
  const broad = await filesUnder(root, "context/broad");
  const rank = (path: string) => (path.startsWith("context/structured/") ? 0 : 1);
  for (const { copy, of } of await exactCopies(root, [...structured, ...broad], (a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b))) {
    if (selected.has(copy) && !selected.has(of)) { notes.push(`${copy} is an exact copy of ${of}, but only the copy is checked for Agy, so both stay.`); continue; }
    moves.push({ from: copy, to: `archive/duplicates/${copy}`, kind: "archive", reason: `exact copy of ${of}` });
    archived.add(copy);
  }
  const recordings = (await filesUnder(root, "debrief")).filter((path) => !path.startsWith("debrief/interview-memory/"));
  const numbered = (path: string) => (/\(\d+\)|\bcopy\b/i.test(path) ? 1 : 0);
  for (const { copy, of } of await exactCopies(root, recordings, (a, b) => numbered(a) - numbered(b) || a.length - b.length || a.localeCompare(b))) {
    // The same file under two companies is a mix-up for the user to sort out (Interviews → Your content flags it), not a spare copy.
    if (dirname(copy) !== dirname(of)) { notes.push(`${copy} has the same content as ${of}. Both stay; check which company it belongs to.`); continue; }
    moves.push({ from: copy, to: `archive/duplicates/${copy}`, kind: "archive", reason: `exact copy of ${of}` });
    archived.add(copy);
  }

  // 2. Files and folders the app no longer reads.
  for (const name of await names(root)) {
    if (/^run\.paste-.*\.json$/.test(name)) moves.push({ from: name, to: `archive/stray/${name}`, kind: "archive", reason: "leftover from an old run" });
  }
  if (await kind(disk(root, "screened-jobs")) === "dir") moves.push({ from: "screened-jobs", to: "archive/screened-jobs", kind: "archive", reason: "older screening folders; the app reads jobs/ only" });

  // 3. The layout rules: single files first, then whole folders, then what is left in the catch-all folders.
  const whole = new Set<string>();
  for (const [logical, target] of LAYOUT_V2_RULES) {
    const type = await kind(disk(root, logical));
    if (!type || archived.has(logical)) continue;
    const catchAll = LAYOUT_V2_RULES.some(([other]) => other !== logical && other.startsWith(`${logical}/`));
    if (type === "file" || !catchAll) {
      moves.push({ from: logical, to: target, kind: "move", reason: "new home" });
      whole.add(logical);
      continue;
    }
    for (const name of await names(disk(root, logical))) {
      const child = `${logical}/${name}`;
      if (whole.has(child) || archived.has(child)) continue;
      moves.push({ from: child, to: `${target}/${name}`, kind: "move", reason: "new home" });
    }
  }

  // Archive moves inside a folder must happen before that folder moves.
  moves.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "archive" ? -1 : 1));
  const conflicts: string[] = [];
  const targets = new Set<string>();
  for (const move of moves) {
    if (targets.has(move.to) || await kind(disk(root, move.to))) conflicts.push(`${move.to} already exists (from ${move.from})`);
    targets.add(move.to);
  }

  const pdfs = structured.filter((path) => path.toLowerCase().endsWith(".pdf") && !archived.has(path)).length;
  if (pdfs) notes.push(`${pdfs} PDF${pdfs === 1 ? "" : "s"} in your work records stay where they are (text records work best there).`);
  const resumes = (await names(disk(root, "resumes"))).length;
  if (resumes > 6) notes.push(`resumes/ has ${resumes} files; they are not moved, because your profile points to them by name.`);
  notes.push("Job folders are not moved or renamed.");
  return { version: 1, moves, conflicts, notes, canUndo };
}

async function removeIfEmpty(root: string, folder: string): Promise<void> {
  const path = disk(root, folder);
  if (await kind(path) !== "dir") return;
  if ((await readdir(path)).every((name) => name === ".DS_Store")) await rm(path, { recursive: true, force: true });
}

/** Removes a folder tree that holds no files at all. */
async function removeIfNoFiles(root: string, folder: string): Promise<void> {
  if (await kind(disk(root, folder)) === "dir" && !(await filesUnder(root, folder)).length) await rm(disk(root, folder), { recursive: true, force: true });
}

/** Applies the plan. Safe to run again after an interruption: finished moves are skipped. */
export async function applyMigration(workspacePath: string, now = new Date()): Promise<MigrationPlan> {
  const root = resolve(workspacePath);
  const plan = await planMigration(root);
  if (plan.version === 2) return plan;
  if (plan.conflicts.length) throw new Error(`The folders can't be tidied yet: ${plan.conflicts[0]}${plan.conflicts.length > 1 ? ` (and ${plan.conflicts.length - 1} more)` : ""}.`);
  const previous = await readJson<MigrationLog>(join(root, MIGRATION_LOG));
  const log: MigrationLog = previous && !previous.finishedAt ? previous : { startedAt: now.toISOString(), finishedAt: null, done: [] };
  for (const move of plan.moves) {
    const from = disk(root, move.from);
    const to = disk(root, move.to);
    if (!await kind(from)) continue;
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    log.done.push(move);
    await writeJsonAtomic(join(root, MIGRATION_LOG), log);
  }
  for (const folder of ["context", "debrief"]) await removeIfEmpty(root, folder);
  await writeJsonAtomic(join(root, LAYOUT_FILE), { version: 2, migratedAt: now.toISOString() });
  log.finishedAt = now.toISOString();
  await writeJsonAtomic(join(root, MIGRATION_LOG), log);
  forgetLayout(root);
  return planMigration(root);
}

/** Puts every moved file back and returns the workspace to the original layout. */
export async function undoMigration(workspacePath: string): Promise<{ restored: number; skipped: string[] }> {
  const root = resolve(workspacePath);
  const log = await readJson<MigrationLog>(join(root, MIGRATION_LOG));
  if (!log?.done?.length) throw new Error("There is no folder tidy-up to undo.");
  const skipped: string[] = [];
  let restored = 0;
  for (const move of [...log.done].reverse()) {
    const from = disk(root, move.to);
    const to = disk(root, move.from);
    if (!await kind(from)) { skipped.push(`${move.to} is no longer there`); continue; }
    if (await kind(to)) {
      // Files added to the old place since (for example by a run that used an old path) stay; the moved folder's
      // contents are merged back around them.
      if (await kind(from) !== "dir" || await kind(to) !== "dir") { skipped.push(`${move.from} already exists`); continue; }
      for (const name of await readdir(from)) {
        if (await kind(join(to, name))) { skipped.push(`${move.from}/${name} already exists`); continue; }
        await rename(join(from, name), join(to, name));
      }
      await rmdir(from).catch(() => undefined);
      restored += 1;
      continue;
    }
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    restored += 1;
  }
  await rm(join(root, LAYOUT_FILE), { force: true });
  forgetLayout(root);
  for (const folder of ["archive", "career", "interviews"]) await removeIfNoFiles(root, folder);
  if (!skipped.length) await rm(join(root, MIGRATION_LOG), { force: true });
  return { restored, skipped };
}

/**
 * In a tidy workspace, a file written to an old path (an Agy run following an old instruction) would be invisible
 * to the app. This moves such files to their real home when nothing is there, and reports the ones it can't.
 */
export async function healStrayPaths(workspacePath: string): Promise<{ moved: string[]; left: string[] }> {
  const root = resolve(workspacePath);
  const moved: string[] = [];
  const left: string[] = [];
  if (await currentVersion(root) !== 2) return { moved, left };
  for (const [logical, target] of LAYOUT_V2_RULES) {
    const type = await kind(disk(root, logical));
    if (!type) continue;
    const files = type === "file" ? [logical] : await filesUnder(root, logical);
    for (const file of files) {
      // The most specific rule decides each file's home.
      const rule = [...LAYOUT_V2_RULES].sort((a, b) => b[0].length - a[0].length).find(([prefix]) => file === prefix || file.startsWith(`${prefix}/`));
      if (!rule || rule[0] !== logical) continue;
      const home = `${target}${file.slice(logical.length)}`;
      if (await kind(disk(root, home))) { left.push(file); continue; }
      await mkdir(dirname(disk(root, home)), { recursive: true });
      await rename(disk(root, file), disk(root, home));
      moved.push(home);
    }
  }
  for (const folder of ["context/structured", "context/broad", "context", "debrief/interview-memory", "debrief"]) await removeIfEmpty(root, folder);
  return { moved, left };
}

if (require.main === module) {
  const [workspace, flag] = process.argv.slice(2);
  if (!workspace) { console.error("Usage: layout-migration <workspace> [--apply | --undo]"); process.exit(1); }
  void (async () => {
    if (flag === "--undo") { console.log(JSON.stringify(await undoMigration(workspace), null, 2)); return; }
    const plan = flag === "--apply" ? await applyMigration(workspace) : await planMigration(workspace);
    console.log(JSON.stringify(plan, null, 2));
  })().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
