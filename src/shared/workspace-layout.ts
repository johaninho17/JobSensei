// The one owner of where things live in a workspace folder.
//
// The app, its saved data (evidence rows, manifests, the profile), and its checks all name files by their
// *logical* path ("context/structured/work.md", "profile/story_bank.md"). That never changes, so nothing saved
// has to be rewritten. Where a logical path sits *on disk* depends on the workspace's layout version:
//
//   version 1 (the original layout): disk path = logical path.
//   version 2 (tidy layout): the rules below. One home per kind of thing, with plain names.
//
// Job folders are `jobs/<job-id>/` in both versions. Only the functions here translate; no other file may
// hard-code a version-2 name.

export const LAYOUT_FILE = ".sensei/layout.json";
export const LAYOUT_VERSIONS = [1, 2] as const;
export type LayoutVersion = (typeof LAYOUT_VERSIONS)[number];
/** New workspaces start on this version; existing ones change only through the migration the user runs. */
export const DEFAULT_LAYOUT_VERSION: LayoutVersion = 1;

/** Logical → disk, most specific first. A rule covers the path itself and everything under it. */
export const LAYOUT_V2_RULES: ReadonlyArray<readonly [logical: string, disk: string]> = [
  ["context/application_voice_profile.md", "profile/writing-voice.md"],
  ["context/denylist.md", "profile/private-names.md"],
  ["profile/story_bank.md", "profile/story-bank.md"],
  ["profile/interview_voice.md", "profile/interview-voice.md"],
  ["context/structured", "career/records"],
  ["context/broad", "career/notes"],
  ["context", "career"],
  ["debrief/interview-memory", "interviews/memory"],
  ["debrief", "interviews/recordings"],
];

/** What each version-2 folder is for. Read it through workspaceMap(), which names folders for the active layout. */
export const LAYOUT_V2_FOLDERS: ReadonlyArray<readonly [folder: string, purpose: string]> = [
  ["profile", "Who you are: your profile, story bank, interview voice, writing voice, and names to keep private"],
  ["resumes", "Your base resume and other versions"],
  ["career/records", "Work records: the facts drafts are built from"],
  ["career/notes", "Notes and documents that add background"],
  ["jobs", "One folder per job"],
  ["interviews/recordings", "Interview recordings and transcripts, by company"],
  ["interviews/memory", "What interviewers asked, by kind of role"],
  ["archive", "Older and duplicate files the app no longer uses; nothing is deleted"],
];

export type WorkspaceMapRow = { folder: string; purpose: string };

/** In the original layout the voice profile and denylist sit in context/, so profile/ holds less. */
const ORIGINAL_PURPOSES: Readonly<Record<string, string>> = {
  profile: "Who you are: your profile, story bank, and interview voice",
};

/** What each folder is for, named as it sits on disk in this layout (Setup → Your folders). */
export function workspaceMap(version: LayoutVersion): WorkspaceMapRow[] {
  if (version === 2) return LAYOUT_V2_FOLDERS.map(([folder, purpose]) => ({ folder, purpose }));
  const rows = LAYOUT_V2_FOLDERS.filter(([folder]) => folder !== "archive")
    .map(([folder, purpose]) => ({ folder: toLogical(folder, 2), purpose: ORIGINAL_PURPOSES[folder] ?? purpose }));
  rows.splice(rows.findIndex((row) => row.folder.startsWith("context/")), 0, { folder: "context", purpose: "Your career files, plus your writing voice and names to keep private" });
  return rows;
}

/** Everything the app expects at the top of a workspace in this layout. Hidden and system files are never listed. */
export function knownRootEntries(version: LayoutVersion): Set<string> {
  return new Set(["AGENTS.md", ".agents", ".sensei", "archive", ...workspaceMap(version).map((row) => row.folder.split("/")[0])]);
}

export type RootEntry = { name: string; kind: "file" | "dir" };
export type StrayItem = RootEntry & { suggestion: string };

const SYSTEM_FILE = /^(\..*|Thumbs\.db|desktop\.ini|Icon\r?)$/i;
const DOCUMENT = /\.(md|txt|pdf|docx?|rtf|odt|pages)$/i;
const RECORDING = /\.(m4a|mp3|mp4|wav|mov|webm|vtt|srt)$/i;

/**
 * Items at the top of a workspace the app doesn't expect, each with a suggestion for where it belongs. `handled`
 * names items something else already deals with (the tidy-folders preview), so they aren't listed twice.
 */
export function strayRootItems(entries: RootEntry[], version: LayoutVersion, handled: ReadonlySet<string> = new Set()): StrayItem[] {
  const known = knownRootEntries(version);
  const notes = toDisk("context/broad", version);
  const recordings = toDisk("debrief", version);
  return entries
    .filter((entry) => !known.has(entry.name) && !handled.has(entry.name) && !SYSTEM_FILE.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({ ...entry, suggestion: suggestHome(entry, version, notes, recordings) }));
}

function suggestHome(entry: RootEntry, version: LayoutVersion, notes: string, recordings: string): string {
  if (entry.kind === "dir") {
    if (version === 2 && (entry.name === "context" || entry.name === "debrief")) return `An old folder name. Its files belong in ${entry.name === "context" ? "career/" : "interviews/"}.`;
    return `The app doesn't read this folder. Move what you need into ${notes}/, or the rest to archive/.`;
  }
  if (/^run\.paste-.*\.json$/i.test(entry.name)) return "Leftover from an old run. Move it to archive/.";
  if (DOCUMENT.test(entry.name) && /(resume|résumé|\bcv\b)/i.test(entry.name)) return "Looks like a resume. Move it to resumes/.";
  if (RECORDING.test(entry.name)) return `Looks like an interview recording. Move it to ${recordings}/<company>/.`;
  if (DOCUMENT.test(entry.name)) return `If it's about your career, add it from Profile → Sources (it goes to ${notes}/).`;
  return "The app doesn't read files here. Move it into a folder, or to archive/.";
}

const clean = (path: string) => path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

function translate(path: string, version: LayoutVersion, from: 0 | 1): string {
  if (version === 1) return path;
  const trailing = /[\\/]$/.test(path) ? "/" : "";
  const value = clean(path);
  const to = from === 0 ? 1 : 0;
  // Longest matching prefix wins, so "career/records" is read before "career".
  const rule = [...LAYOUT_V2_RULES].sort((a, b) => b[from].length - a[from].length).find((candidate) => under(value, candidate[from]));
  if (!rule) return path;
  return `${rule[to]}${value.slice(rule[from].length)}${trailing}`;
}

/** Where a logical workspace path sits on disk. Safe to call on a path that is already a disk path. */
export function toDisk(logicalPath: string, version: LayoutVersion): string {
  return translate(logicalPath, version, 0);
}

/** The logical path of a disk path. Safe to call on a path that is already logical. */
export function toLogical(diskPath: string, version: LayoutVersion): string {
  return translate(diskPath, version, 1);
}

const AGENT_PATH = /(?<![\w/.-])(data\/)?((?:context|debrief)\/[\w.<>/-]*|profile\/(?:story_bank|interview_voice)\.md)/g;

/**
 * Agy reads and writes real files, so its instructions must name disk paths. The tracked skill files name logical
 * paths; the workspace copy is rewritten with this when the workspace uses another layout.
 */
export function agentTextForLayout(text: string, version: LayoutVersion): string {
  if (version === 1) return text;
  return text.replace(AGENT_PATH, (_match, prefix: string | undefined, path: string) => `${prefix ?? ""}${toDisk(path, version)}`);
}

export function parseLayoutVersion(value: unknown): LayoutVersion {
  const version = (value as { version?: unknown } | null)?.version;
  return version === 2 ? 2 : 1;
}
