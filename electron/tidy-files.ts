// Tidy files (issue #238): one shape for interview recordings and no leftovers. Every recording lives in its job's
// folder (`debrief/<job-id>/`, which is how the recording scan links it to the job) and is named
// `<company>-<stage>[-<date>][-n].<ext>`; practice runs go to `debrief/mock-interviews/mock-<n>`, notes to
// `debrief/notes/`, and recordings with no job to `debrief/other/`. A job's own `transcripts/` folder joins its debrief
// folder. Leftovers (.DS_Store, debug run files at the top, original_jd.txt beside original_jd.md) go to a backup,
// never deleted. Apply writes a manifest, so Undo puts everything back; the import ledger's paths move with the files,
// so nothing reads as new. Paths are logical (the layout maps them to disk).
import { copyFile, mkdir, readFile, readdir, rename, rmdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persistence";
import { assertInsideWorkspace, workspaceFile } from "./workspace";
import { isPracticeRecording } from "../src/shared/recordings";

export type TidyMove = { from: string; to: string; why: string };
export type TidyPlan = { moves: TidyMove[]; toBackup: Array<{ path: string; why: string }> };
export type TidyJob = { id: string; reached: boolean };

const KEEP_FOLDERS = /^debrief\/(?:interview-memory|notes)\//;
const TIDY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+$/;
const NOTE_NAME = /\b(?:review|scan|index|readme|routing)\b/i;
const STAGE_WORDS: Array<[RegExp, string]> = [
  [/recruit|\bscreen\b|phone/i, "recruiter"],
  [/hiring[\s_-]*manager|\bhm\b|\bmanager\b/i, "hiring-manager"],
  [/technical|\btech\b|coding|practical|\bcase\b/i, "technical"],
  [/panel|onsite|on-site|final/i, "panel"],
  [/\bintro\b/i, "intro"],
];

const slug = (value: string) => value.toLowerCase().replace(/\(\d+\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const extOf = (name: string) => { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot).toLowerCase() : ""; };
const stem = (name: string) => { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(0, dot) : name; };
/** The name without a leading company word ("IronSite_recruiter.md" → "recruiter.md"). */
const withoutCompany = (name: string, company: string) => name.replace(new RegExp(`^${company.replace(/[^a-z0-9]/gi, "")}[\\s_-]*`, "i"), "");

/** The stage words in a name, in interview order ("recruiter-hiring-manager"); "interview" when it only says so. */
export function stageOf(name: string): string | null {
  const words = name.replace(/[_]+/g, " ");
  const found = STAGE_WORDS.filter(([pattern]) => pattern.test(words)).map(([, stage]) => stage);
  const stages = [...new Set(found)].join("-");
  const summary = /\bsummary\b/i.test(words) ? "-summary" : "";
  if (stages) return stages + summary;
  return /interview|intrerview|transcript/i.test(words) ? `interview${summary}` : null;
}

/** A date (and time) in a name, kept so several transcripts of one stage stay apart: "-2026-07-31-2013". */
function dateOf(name: string): string {
  const match = /(\d{4}-\d{2}-\d{2})(?:[_ T-](\d{2})[-:](\d{2}))?/.exec(name);
  return match ? `-${match[1]}${match[2] ? `-${match[2]}${match[3]}` : ""}` : "";
}

/** The job a company's recording belongs to: the only match, or the only match that reached interviews. */
export function jobFor(company: string, jobs: TidyJob[]): string | null {
  const key = slug(company);
  if (!key) return null;
  const exact = jobs.find((job) => job.id === key);
  if (exact) return exact.id;
  const matches = jobs.filter((job) => job.id.startsWith(`${key}-`));
  if (matches.length === 1) return matches[0]!.id;
  const reached = matches.filter((job) => job.reached);
  return reached.length === 1 ? reached[0]!.id : null;
}

/**
 * The tidy plan for these recording files (logical paths under debrief/ and jobs/<id>/transcripts/), the jobs, and
 * the leftovers found. `existing` holds every file already in debrief/, so new names never collide.
 */
export function planTidy(input: { recordings: string[]; jobs: TidyJob[]; leftovers: Array<{ path: string; why: string }>; existing?: string[] }): TidyPlan {
  const taken = new Set((input.existing ?? []).map((path) => path.toLowerCase()));
  const moves: TidyMove[] = [];
  const jobIds = new Set(input.jobs.map((job) => job.id));
  const claim = (folder: string, base: string, ext: string) => {
    let name = `${folder}/${base}${ext}`;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${folder}/${base}-${n}${ext}`;
    taken.add(name.toLowerCase());
    return name;
  };
  for (const path of [...input.recordings].sort()) {
    if (KEEP_FOLDERS.test(path)) continue;
    const parts = path.split("/");
    const name = parts.at(-1)!;
    // Already tidy: a plain lowercase name in a job folder, other/, or mock-interviews/. A second run changes nothing.
    if (parts.length === 3 && parts[0] === "debrief" && (parts[1] === "other" || parts[1] === "mock-interviews" || jobIds.has(parts[1]!)) && TIDY_NAME.test(name)) { taken.add(path.toLowerCase()); continue; }
    const ext = extOf(name);
    let folder: string;
    let base: string;
    let why: string;
    if (path.startsWith("jobs/")) {
      const jobId = parts[1]!;
      const company = jobId.split("-")[0]!;
      const sub = parts.slice(3, -1).join(" ");
      if (/\b(?:mock|practice|simulation)\b/i.test(sub.replace(/[_-]+/g, " "))) {
        // A practice call for this job is still practice: it belongs to no job (review workflow step 6).
        folder = "debrief/mock-interviews";
        base = `${company}-mock${/\bsummary\b/i.test(name.replace(/_/g, " ")) ? "-summary" : ""}`;
        why = "Practice interview";
      } else {
        const stage = stageOf(`${sub} ${withoutCompany(name, company)}`);
        folder = `debrief/${jobId}`;
        base = `${company}-${stage ?? slug(stem(name))}${dateOf(name)}`;
        why = "A job's transcripts belong with its recordings";
      }
    } else if (isPracticeRecording(path)) {
      const number = /(\d+)(?!.*\d)/.exec(stem(name))?.[1];
      folder = "debrief/mock-interviews";
      base = number ? `mock-${number}` : `mock-${slug(stem(name))}`;
      why = "Practice interview";
    } else if (NOTE_NAME.test(name.replace(/_/g, " ")) && (stageOf(name) ?? "interview").startsWith("interview")) {
      folder = "debrief/notes";
      base = slug(stem(name));
      why = "Notes, not a recording";
    } else {
      const inFolder = parts.length > 2 ? parts[1]! : null;
      const company = inFolder ?? stem(name).split(/[_\s-]+/)[0]!;
      const jobId = jobFor(company, input.jobs);
      const companyName = (jobId ?? slug(company)).split("-")[0]!;
      // The stage is read after the company's name, so a company like "IronSite" never reads as "onsite".
      const rest = withoutCompany(name, companyName);
      const stage = stageOf(rest) ?? (slug(stem(rest)) || "interview");
      folder = `debrief/${jobId ?? "other"}`;
      base = `${companyName}-${stage}${dateOf(name)}`;
      why = jobId ? `Recording for job ${jobId}` : "Recording with no matching job";
    }
    const target = `${folder}/${base}${ext}`;
    if (target.toLowerCase() === path.toLowerCase()) { taken.add(path.toLowerCase()); continue; }
    moves.push({ from: path, to: claim(folder, base, ext), why });
  }
  return { moves, toBackup: input.leftovers };
}

// ---- Reading the workspace ---------------------------------------------------------------------------------
async function walk(root: string, logical: string): Promise<string[]> {
  const entries = await readdir(workspaceFile(root, logical), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const path = `${logical}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await walk(root, path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

async function exists(root: string, logical: string): Promise<boolean> {
  return Boolean(await stat(workspaceFile(root, logical)).catch(() => null));
}

type TrackerLike = { status?: string; history?: Array<{ status?: string }>; interviews?: unknown[] };

/** The tidy plan for a workspace: recordings, job transcripts, and leftovers. Nothing changes. */
export async function planWorkspaceTidy(workspacePath: string): Promise<TidyPlan> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const jobIds = (await readdir(workspaceFile(root, "jobs"), { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
  const jobs: TidyJob[] = await Promise.all(jobIds.map(async (id) => {
    const tracker = await readJson<TrackerLike>(workspaceFile(root, `jobs/${id}/.sensei/tracker.json`)).catch(() => null);
    const statuses = [tracker?.status, ...(tracker?.history ?? []).map((event) => event.status)];
    const rounds = (await readdir(workspaceFile(root, `jobs/${id}/interviews`)).catch(() => [])).some((name) => /^\d{2}-/.test(name));
    return { id, reached: rounds || (tracker?.interviews?.length ?? 0) > 0 || statuses.some((status) => status === "interviewing" || status === "offer") };
  }));
  const debrief = (await walk(root, "debrief")).filter((path) => !path.endsWith("/.DS_Store"));
  const transcripts = (await Promise.all(jobIds.map((id) => walk(root, `jobs/${id}/transcripts`)))).flat().filter((path) => !path.endsWith("/.DS_Store"));
  const leftovers: TidyPlan["toBackup"] = [];
  const stray = async (logical: string, depth: number): Promise<void> => {
    const entries = await readdir(workspaceFile(root, logical || "."), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = logical ? `${logical}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (depth < 4 && !/^(?:\.sensei|\.agents|\.git|node_modules|\.npm)$/.test(entry.name)) await stray(path, depth + 1); }
      else if (entry.name === ".DS_Store") leftovers.push({ path, why: "macOS folder file" });
    }
  };
  await stray("", 0);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && /^run\..+\.json$/i.test(entry.name)) leftovers.push({ path: entry.name, why: "Debug run file at the top of the workspace" });
  }
  for (const id of jobIds) {
    if (await exists(root, `jobs/${id}/original_jd.txt`) && await exists(root, `jobs/${id}/original_jd.md`)) leftovers.push({ path: `jobs/${id}/original_jd.txt`, why: "Old copy of the posting; original_jd.md is the one the app reads" });
  }
  return planTidy({ recordings: [...debrief, ...transcripts], jobs, leftovers, existing: debrief });
}

// ---- Applying and undoing ----------------------------------------------------------------------------------
const MANIFEST = ".sensei/tidy-files.json";
const LEDGER = ".sensei/content-sources.json";
type Manifest = { at: string; backup: string; moves: TidyMove[]; backedUp: Array<{ from: string; to: string }>; rewritten?: Array<{ path: string; copy: string }> };
type Ledger = { files: Record<string, unknown> };

async function move(root: string, from: string, to: string): Promise<void> {
  const target = workspaceFile(root, to);
  await mkdir(dirname(target), { recursive: true });
  await rename(workspaceFile(root, from), target);
}

/** Removes folders left empty under these logical folders (deepest first); a folder with anything left stays. */
async function pruneEmpty(root: string, logical: string): Promise<void> {
  const entries = await readdir(workspaceFile(root, logical), { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  for (const entry of entries) if (entry.isDirectory()) await pruneEmpty(root, `${logical}/${entry.name}`);
  const left = await readdir(workspaceFile(root, logical)).catch(() => ["x"]);
  // The top debrief/ folder always stays, even when empty.
  if (!left.length && logical !== "debrief") await rmdir(workspaceFile(root, logical)).catch(() => undefined);
}

/** Applies the plan: moves, leftovers to `.sensei/backups/tidy-<time>/`, ledger paths renamed, empty folders removed. */
export async function applyWorkspaceTidy(workspacePath: string, now = new Date()): Promise<Manifest> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const plan = await planWorkspaceTidy(root);
  const backup = `.sensei/backups/tidy-${now.toISOString().replace(/[:.]/g, "-")}`;
  const backedUp: Manifest["backedUp"] = [];
  for (const item of plan.toBackup) {
    const to = `${backup}/${item.path}`;
    await move(root, item.path, to);
    backedUp.push({ from: item.path, to });
  }
  const done: TidyMove[] = [];
  for (const step of plan.moves) { await move(root, step.from, step.to); done.push(step); }
  const ledger = await readJson<Ledger>(workspaceFile(root, LEDGER)).catch(() => null);
  if (ledger?.files) {
    for (const step of done) if (ledger.files[step.from] !== undefined) { ledger.files[step.to] = ledger.files[step.from]; delete ledger.files[step.from]; }
    await writeJsonAtomic(workspaceFile(root, LEDGER), ledger);
  }
  // Career and profile notes that cite a recording by path follow it: only the paths change, never the words.
  const rewritten: NonNullable<Manifest["rewritten"]> = [];
  const notes = [...await walk(root, "context"), ...await walk(root, "profile")].filter((path) => path.endsWith(".md"));
  for (const path of notes) {
    const text = await readFile(workspaceFile(root, path), "utf8").catch(() => null);
    if (text === null) continue;
    let next = text;
    for (const step of done) next = next.split(step.from).join(step.to);
    if (next === text) continue;
    const copy = `${backup}/rewritten/${path}`;
    await mkdir(dirname(workspaceFile(root, copy)), { recursive: true });
    await copyFile(workspaceFile(root, path), workspaceFile(root, copy));
    await writeTextAtomic(workspaceFile(root, path), next);
    rewritten.push({ path, copy });
  }
  await pruneEmpty(root, "debrief");
  for (const step of done) if (step.from.startsWith("jobs/")) await pruneEmpty(root, step.from.split("/").slice(0, 3).join("/"));
  const manifest: Manifest = { at: now.toISOString(), backup, moves: done, backedUp, rewritten };
  await writeJsonAtomic(workspaceFile(root, MANIFEST), manifest);
  return manifest;
}

/** Puts the last tidy back: files to their old paths, leftovers out of the backup, ledger paths restored. */
export async function undoWorkspaceTidy(workspacePath: string): Promise<{ restored: number }> {
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const manifest = await readJson<Manifest>(workspaceFile(root, MANIFEST));
  if (!manifest) throw new Error("There is no tidy to undo.");
  let restored = 0;
  for (const step of [...manifest.moves].reverse()) { if (await exists(root, step.to)) { await move(root, step.to, step.from); restored += 1; } }
  for (const item of manifest.backedUp) { if (await exists(root, item.to)) { await move(root, item.to, item.from); restored += 1; } }
  for (const item of manifest.rewritten ?? []) { if (await exists(root, item.copy)) { await copyFile(workspaceFile(root, item.copy), workspaceFile(root, item.path)); restored += 1; } }
  const ledger = await readJson<Ledger>(workspaceFile(root, LEDGER)).catch(() => null);
  if (ledger?.files) {
    for (const step of manifest.moves) if (ledger.files[step.to] !== undefined) { ledger.files[step.from] = ledger.files[step.to]; delete ledger.files[step.to]; }
    await writeJsonAtomic(workspaceFile(root, LEDGER), ledger);
  }
  await pruneEmpty(root, "debrief");
  await rename(workspaceFile(root, MANIFEST), workspaceFile(root, `${MANIFEST}.undone`)).catch(() => undefined);
  return { restored };
}
