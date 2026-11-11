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

/** What each version-2 folder is for, shown in the migration preview and the docs. */
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
