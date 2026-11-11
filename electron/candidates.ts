// Recruiter Edition (recruiter plan R1): the candidate roster and the active candidate. Only the app writes these
// files; each candidate's folder is a normal workspace, so the pipeline runs unchanged inside it.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CANDIDATES_DIR, RECRUITER_DIR, RECRUITER_SETTINGS_PATH, ROSTER_PATH, candidateFolder, candidateIdFor,
  recruiterSettingsSchema, rosterSchema, type CandidateEntry, type CandidateStatus, type RecruiterSettings, type Roster,
} from "../src/shared/candidates";
import { featuresFor } from "../src/shared/edition";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persistence";
import { assertInsideWorkspace } from "./workspace";
import { workspaceFile } from "./layout";
import { initializeWorkspace } from "./workspace-init";

const now = () => new Date().toISOString();

function randomSuffix(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return [...randomBytes(4)].map((byte) => alphabet[byte % alphabet.length]).join("");
}

/** Creates the recruiter layout (settings, roster, candidates folder) when it is missing; never overwrites. */
export async function ensureRecruiterRoot(root: string): Promise<void> {
  await mkdir(join(root, RECRUITER_DIR), { recursive: true });
  await mkdir(join(root, CANDIDATES_DIR), { recursive: true });
  if (!(await readJson(join(root, ROSTER_PATH)))) await writeJsonAtomic(join(root, ROSTER_PATH), rosterSchema.parse({ schemaVersion: 1, candidates: [], updatedAt: now() }));
  if (!(await readJson(join(root, RECRUITER_SETTINGS_PATH)))) await writeJsonAtomic(join(root, RECRUITER_SETTINGS_PATH), recruiterSettingsSchema.parse({ schemaVersion: 1, updatedAt: now() }));
}

export async function readRoster(root: string): Promise<Roster> {
  const raw = await readJson<unknown>(join(root, ROSTER_PATH));
  return raw ? rosterSchema.parse(raw) : rosterSchema.parse({ schemaVersion: 1, candidates: [], updatedAt: now() });
}

export async function readRecruiterSettings(root: string): Promise<RecruiterSettings> {
  const raw = await readJson<unknown>(join(root, RECRUITER_SETTINGS_PATH));
  return raw ? recruiterSettingsSchema.parse(raw) : recruiterSettingsSchema.parse({ schemaVersion: 1, updatedAt: now() });
}

async function saveRoster(root: string, roster: Roster): Promise<Roster> {
  const next = rosterSchema.parse({ ...roster, updatedAt: now() });
  await writeJsonAtomic(join(root, ROSTER_PATH), next);
  return next;
}

/** Absolute folder of a candidate on the roster, checked to sit inside the recruiter root. */
export async function candidatePath(root: string, id: string): Promise<string> {
  const roster = await readRoster(root);
  if (!roster.candidates.some((candidate) => candidate.id === id)) throw new Error("That candidate isn't on the list.");
  return assertInsideWorkspace(join(root, CANDIDATES_DIR), join(root, candidateFolder(id)));
}

/** Adds a candidate with a fresh folder laid out like a normal workspace (seeded with this edition's Agy files). */
export async function addCandidate(root: string, displayName: string, options: { suffix?: string; seed?: boolean } = {}): Promise<CandidateEntry> {
  const name = displayName.trim();
  if (!name) throw new Error("Enter the candidate's name.");
  await ensureRecruiterRoot(root);
  const roster = await readRoster(root);
  let id = candidateIdFor(name, options.suffix ?? randomSuffix());
  while (roster.candidates.some((candidate) => candidate.id === id)) id = candidateIdFor(name, randomSuffix());
  const entry: CandidateEntry = { id, displayName: name, status: "active", createdAt: now(), lastUsedAt: null };
  const folder = join(root, candidateFolder(id));
  if (options.seed === false) await mkdir(folder, { recursive: true });
  else await initializeWorkspace(folder, featuresFor("recruiter"));
  await saveRoster(root, { ...roster, candidates: [...roster.candidates, entry] });
  return entry;
}

async function updateCandidate(root: string, id: string, change: (entry: CandidateEntry) => CandidateEntry): Promise<CandidateEntry> {
  const roster = await readRoster(root);
  const index = roster.candidates.findIndex((candidate) => candidate.id === id);
  if (index < 0) throw new Error("That candidate isn't on the list.");
  const updated = change(roster.candidates[index]!);
  const candidates = [...roster.candidates];
  candidates[index] = updated;
  await saveRoster(root, { ...roster, candidates });
  return updated;
}

/** Renames a candidate; the folder keeps its id, so nothing moves on disk. */
export async function renameCandidate(root: string, id: string, displayName: string): Promise<CandidateEntry> {
  const name = displayName.trim();
  if (!name) throw new Error("Enter the candidate's name.");
  return updateCandidate(root, id, (entry) => ({ ...entry, displayName: name }));
}

export async function setCandidateStatus(root: string, id: string, status: CandidateStatus): Promise<CandidateEntry> {
  const updated = await updateCandidate(root, id, (entry) => ({ ...entry, status }));
  // An archived candidate is never left active.
  if (status === "archived") {
    const settings = await readRecruiterSettings(root);
    if (settings.activeCandidateId === id) await writeJsonAtomic(join(root, RECRUITER_SETTINGS_PATH), recruiterSettingsSchema.parse({ ...settings, activeCandidateId: null, updatedAt: now() }));
  }
  return updated;
}

/** Makes a candidate the active one and returns their folder (the workspace the app then opens). */
export async function setActiveCandidate(root: string, id: string): Promise<string> {
  const roster = await readRoster(root);
  const entry = roster.candidates.find((candidate) => candidate.id === id);
  if (!entry) throw new Error("That candidate isn't on the list.");
  if (entry.status === "archived") throw new Error(`${entry.displayName} is archived. Restore them before working on their jobs.`);
  const folder = await candidatePath(root, id);
  const settings = await readRecruiterSettings(root);
  await writeJsonAtomic(join(root, RECRUITER_SETTINGS_PATH), recruiterSettingsSchema.parse({ ...settings, activeCandidateId: id, updatedAt: now() }));
  await updateCandidate(root, id, (current) => ({ ...current, lastUsedAt: now() }));
  return folder;
}

/** The active candidate's folder, or null when none is chosen (or the chosen one is gone or archived). */
export async function activeCandidatePath(root: string): Promise<string | null> {
  const settings = await readRecruiterSettings(root);
  if (!settings.activeCandidateId) return null;
  const entry = (await readRoster(root)).candidates.find((candidate) => candidate.id === settings.activeCandidateId);
  if (!entry || entry.status === "archived") return null;
  return candidatePath(root, entry.id);
}

/** Recruiter plan R4: what the recruiter learned asking the candidate questions, saved as a checked context file. */
export const RECRUITER_NOTES_PATH = "context/structured/recruiter-notes.md";
const NOTES_HEADER = "# Recruiter notes\n\n- source_role: recruiter-notes\n\n";
const MAX_NOTES = 50_000;

export async function readRecruiterNotes(candidateFolder: string): Promise<string> {
  const raw = await readFile(workspaceFile(candidateFolder, RECRUITER_NOTES_PATH), "utf8").catch(() => "");
  return raw.startsWith(NOTES_HEADER) ? raw.slice(NOTES_HEADER.length) : raw;
}

export async function saveRecruiterNotes(candidateFolder: string, notes: string): Promise<string> {
  if (notes.length > MAX_NOTES) throw new Error("Notes are limited to 50,000 characters.");
  // Logical path: the folder layout decides where it sits on disk (src/shared/workspace-layout.ts).
  const path = workspaceFile(candidateFolder, RECRUITER_NOTES_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeTextAtomic(path, `${NOTES_HEADER}${notes.replaceAll("\r\n", "\n").trim()}\n`);
  return RECRUITER_NOTES_PATH;
}

/**
 * Deletes a candidate for good (recruiter plan R6): their folder and their place on the list (the caller also removes
 * their Agy history). Returns what was removed. The caller confirms first and offers an export.
 */
export async function deleteCandidate(root: string, id: string): Promise<{ name: string; removed: string[] }> {
  const roster = await readRoster(root);
  const entry = roster.candidates.find((candidate) => candidate.id === id);
  if (!entry) throw new Error("That candidate isn't on the list.");
  const folder = await candidatePath(root, id);
  const removed: string[] = [];
  await rm(folder, { recursive: true, force: true });
  removed.push(`Their folder (${candidateFolder(id)})`);
  await saveRoster(root, { ...roster, candidates: roster.candidates.filter((candidate) => candidate.id !== id) });
  removed.push("Their place on the candidate list");
  const settings = await readRecruiterSettings(root);
  if (settings.activeCandidateId === id) await writeJsonAtomic(join(root, RECRUITER_SETTINGS_PATH), recruiterSettingsSchema.parse({ ...settings, activeCandidateId: null, updatedAt: now() }));
  return { name: entry.displayName, removed };
}

/** No candidate open: the app shows the Candidates page. */
export async function clearActiveCandidate(root: string): Promise<void> {
  const settings = await readRecruiterSettings(root);
  if (settings.activeCandidateId) await writeJsonAtomic(join(root, RECRUITER_SETTINGS_PATH), recruiterSettingsSchema.parse({ ...settings, activeCandidateId: null, updatedAt: now() }));
}
