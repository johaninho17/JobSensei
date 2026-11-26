// Tidy files (issues #238, #244): one shape for interview recordings and no leftovers. Every recording sits straight in
// `debrief/` (no subfolders), named `<company>-<stage>[-<date>][-n].<ext>` (the job ID instead of the company when the
// company has more than one job), which is how the recording scan links it to its job; practice runs are `mock-…`. A
// job's own `transcripts/` folder joins them. Leftovers (.DS_Store, debug run files at the top, original_jd.txt beside original_jd.md) go to a backup,
// never deleted. Apply writes a manifest, so Undo puts everything back; the import ledger's paths move with the files,
// so nothing reads as new. Paths are logical (the layout maps them to disk).
import { copyFile, mkdir, readFile, readdir, rename, rmdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persistence";
import { assertInsideWorkspace, workspaceFile } from "./workspace";
import { isPracticeRecording, jobAtCompany, stageOf } from "../src/shared/recordings";
export { stageOf };

export type TidyMove = { from: string; to: string; why: string };
export type TidyPlan = { moves: TidyMove[]; toBackup: Array<{ path: string; why: string }> };
export type TidyJob = { id: string; reached: boolean };

const KEEP_FOLDERS = /^debrief\/interview-memory\//;
const TIDY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+$/;
const NOTE_NAME = /\b(?:review|scan|index|readme|routing)\b/i;

const slug = (value: string) => value.toLowerCase().replace(/\(\d+\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const extOf = (name: string) => { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot).toLowerCase() : ""; };
const stem = (name: string) => { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(0, dot) : name; };
/** The name without a leading company word ("IronSite_recruiter.md" → "recruiter.md"). */
const withoutCompany = (name: string, company: string) => name.replace(new RegExp(`^${company.replace(/[^a-z0-9]/gi, "")}[\\s_-]*`, "i"), "");


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
  const matches = jobs.filter((job) => jobAtCompany(job.id, key));
  if (matches.length === 1) return matches[0]!.id;
  const reached = matches.filter((job) => job.reached);
  return reached.length === 1 ? reached[0]!.id : null;
}

/** The start of a recording's name: the company, or the job ID when the company has more than one job (#244). */
function prefixFor(jobId: string, jobs: TidyJob[], company = jobId.split("-")[0]!): string {
  const key = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  return jobs.filter((job) => jobAtCompany(job.id, key)).length > 1 ? jobId : key;
}

/**
 * The tidy plan (#238, flat since #244): every recording sits directly in debrief/, named
 * `<company or job-id>-<stage>[-<date>][-n].<ext>`; practice runs `mock-…`. Recordings come from debrief/ (any depth)
 * and jobs/<id>/transcripts/; debrief/interview-memory/ (the app's own data) stays. `existing` holds files already in
 * debrief/, so new names never collide.
 */
export function planTidy(input: { recordings: string[]; jobs: TidyJob[]; leftovers: Array<{ path: string; why: string }>; existing?: string[] }): TidyPlan {
  const taken = new Set((input.existing ?? []).filter((path) => path.split("/").length === 2).map((path) => path.toLowerCase()));
  const moves: TidyMove[] = [];
  const jobIds = new Set(input.jobs.map((job) => job.id));
  const claim = (base: string, ext: string) => {
    let name = `debrief/${base}${ext}`;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `debrief/${base}-${n}${ext}`;
    taken.add(name.toLowerCase());
    return name;
  };
  for (const path of [...input.recordings].sort((x, y) => x.split("/").length - y.split("/").length || x.localeCompare(y))) {
    if (KEEP_FOLDERS.test(path)) continue;
    const parts = path.split("/");
    const name = parts.at(-1)!;
    const ext = extOf(name);
    // Already tidy: a plain lowercase name straight in debrief/. A second run changes nothing.
    if (parts.length === 2 && parts[0] === "debrief" && TIDY_NAME.test(name)) continue;
    let base: string;
    let why: string;
    const folder = parts.length > 2 && parts[0] === "debrief" ? parts[1]! : null;
    if (folder && (jobIds.has(folder) || ["other", "mock-interviews", "notes"].includes(folder)) && TIDY_NAME.test(name)) {
      // Made by the first Tidy (folders): the name is right, the folder goes. A company with more than one job gets the
      // job ID at the front, so the name alone links it.
      base = stem(name);
      if (jobIds.has(folder)) {
        const company = folder.split("-")[0]!;
        const prefix = prefixFor(folder, input.jobs);
        if (prefix !== company && base.startsWith(`${company}-`)) base = `${prefix}-${base.slice(company.length + 1)}`;
      }
      why = "Recordings sit straight in debrief/";
    } else if (path.startsWith("jobs/")) {
      const jobId = parts[1]!;
      const company = jobId.split("-")[0]!;
      const sub = parts.slice(3, -1).join(" ");
      if (/\b(?:mock|practice|simulation)\b/i.test(sub.replace(/[_-]+/g, " "))) {
        base = `${company}-mock${/\bsummary\b/i.test(name.replace(/_/g, " ")) ? "-summary" : ""}`;
        why = "Practice interview";
      } else {
        const stage = stageOf(`${sub} ${withoutCompany(name, company)}`);
        base = `${prefixFor(jobId, input.jobs)}-${stage ?? slug(stem(name))}${dateOf(name)}`;
        why = "A job's transcripts sit with the other recordings";
      }
    } else if (isPracticeRecording(path)) {
      const number = /(\d+)(?!.*\d)/.exec(stem(name))?.[1];
      base = number ? `mock-${number}` : `mock-${slug(stem(name)).replace(/^mock-?/, "") || "interview"}`;
      why = "Practice interview";
    } else if (NOTE_NAME.test(name.replace(/_/g, " ")) && (stageOf(name) ?? "interview").startsWith("interview")) {
      base = slug(stem(name));
      why = "Notes";
    } else {
      const company = folder ?? stem(name).split(/[_\s-]+/)[0]!;
      const jobId = jobFor(company, input.jobs);
      const key = (jobId && !jobAtCompany(jobId, company) ? jobId.split("-")[0]! : company).toLowerCase().replace(/[^a-z0-9]/g, "");
      // The stage is read after the company's name, so "IronSite" never reads as "onsite".
      const rest = withoutCompany(name, key);
      const stage = stageOf(rest) ?? (slug(stem(rest)) || "interview");
      base = `${jobId ? prefixFor(jobId, input.jobs, key) : key}-${stage}${dateOf(name)}`;
      why = jobId ? `Recording for job ${jobId}` : "Recording with no matching job";
    }
    moves.push({ from: path, to: claim(base, ext), why });
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
  // An earlier tidy's record is kept beside this one's backup, so its moves can still be traced.
  if (await exists(root, MANIFEST)) { await mkdir(dirname(workspaceFile(root, `${backup}/previous-tidy-files.json`)), { recursive: true }); await copyFile(workspaceFile(root, MANIFEST), workspaceFile(root, `${backup}/previous-tidy-files.json`)); }
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
