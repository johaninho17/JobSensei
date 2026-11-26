// What counts as a recording waiting to be imported into interview content (Interviews → Your content). One rule for the
// Interviews badge, the Your content list, the update, and Today, so they always show the same number.

export type RecordingState = "new" | "changed" | "imported" | "duplicate" | "skipped";

/** New files and fuller versions of ones imported before; duplicates and skipped files never wait. */
export function waitingToImport<T extends { state: RecordingState }>(recordings: T[]): T[] {
  return recordings.filter((recording) => recording.state === "new" || recording.state === "changed");
}

/** Where a recording's content went in an update (#17), counted per content area. */
export type UsedIn = { area: "Story bank" | "Interview voice" | "Role memory" | "Interview stories"; count: number };

export function contentArea(file: string): UsedIn["area"] | null {
  const path = file.replace(/\\/g, "/");
  if (/(^|\/)story[_-]bank\.md$/.test(path)) return "Story bank";
  if (/(^|\/)interview[_-]voice\.md$/.test(path)) return "Interview voice";
  if (/(^|\/)(?:debrief\/interview-memory|interviews\/memory)\//.test(path)) return "Role memory";
  if (/(^|\/)interview-stories\.md$/.test(path)) return "Interview stories";
  return null;
}

/**
 * What each recording of an update was used for, from Agy's change list. A change names its recording in `from`; a
 * change without one belongs to the only recording when there is one, else to every recording of the update (shared).
 */
export function usageByRecording(recordings: string[], changes: Array<{ file: string; from?: string }>, toLogical: (path: string) => string = (path) => path): Record<string, { usedIn: UsedIn[]; shared: boolean }> {
  const out: Record<string, { counts: Map<UsedIn["area"], number>; shared: boolean }> = Object.fromEntries(recordings.map((path) => [path, { counts: new Map(), shared: false }]));
  for (const change of changes) {
    const area = contentArea(change.file);
    if (!area) continue;
    const from = change.from ? toLogical(change.from.replace(/\\/g, "/")) : null;
    const owners = from && out[from] ? [from] : recordings.length === 1 ? recordings : recordings;
    const shared = !(from && out[from]) && recordings.length > 1;
    for (const owner of owners) { out[owner]!.counts.set(area, (out[owner]!.counts.get(area) ?? 0) + 1); if (shared) out[owner]!.shared = true; }
  }
  return Object.fromEntries(Object.entries(out).map(([path, value]) => [path, { usedIn: [...value.counts].map(([area, count]) => ({ area, count })), shared: value.shared }]));
}

export function usedInText(usedIn: UsedIn[]): string {
  return usedIn.length ? usedIn.map((entry) => `${entry.area} (${entry.count})`).join(", ") : "Nothing taken from it";
}

/** Kinds of recording a user adds in Interviews → Your content. Practice interviews go to their own folder, which the
 * review workflow treats as practice (.agents/workflows/jobsensei-interview-review.md step 6). */
export type RecordingKind = "interview" | "practice";

/** Where an added recording goes: always `debrief/` itself, no subfolders (#244). The file's name links it to its job. */
export function recordingFolder(_kind: RecordingKind, _jobId: string | null): string {
  return "debrief";
}

/**
 * The name an added recording gets (#244): `<job-or-company>-<stage>[-n].<ext>` for an interview, `mock-<name>` for
 * practice. `prefix` is the company, or the job ID when the company has more than one job, so the name alone links it.
 */
export function recordingName(original: string, kind: RecordingKind, prefix: string | null, stage: string | null): string {
  const dot = original.lastIndexOf(".");
  const ext = dot > 0 ? original.slice(dot).toLowerCase() : "";
  const stem = (dot > 0 ? original.slice(0, dot) : original).toLowerCase().replace(/\(\d+\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (kind === "practice") return `${stem.startsWith("mock") ? stem : `mock-${stem || "interview"}`}${ext}`;
  const head = prefix ? prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-") : null;
  const rest = head && stem.startsWith(`${head}-`) ? stem.slice(head.length + 1) : stem;
  return `${[head, stage ?? (rest || "interview")].filter(Boolean).join("-")}${ext}`;
}

/** A practice interview (a mock with an AI interviewer or a friend): named mock (or under an older mock-interviews/ folder),
 * simulation, or practice. It belongs to no job (review workflow step 6). */
export function isPracticeRecording(path: string): boolean {
  const normal = path.replace(/\\/g, "/");
  return /(^|\/)mock-interviews\//.test(normal) || /\b(mock|simulation|practice)\b/i.test((normal.split("/").pop() ?? "").replace(/_/g, " "));
}

/** A changed path (logical or tidy-layout disk path) is a recording, so the Interviews badge and list refresh. */
export function isRecordingPath(path: string): boolean {
  return /^(?:debrief|interviews\/recordings)\//.test(path.replace(/\\/g, "/")) && !/^debrief\/interview-memory\//.test(path);
}

const STAGE_WORDS: Array<[RegExp, string]> = [
  [/recruit|\bscreen\b|phone/i, "recruiter"],
  [/hiring[\s_-]*manager|\bhm\b|\bmanager\b/i, "hiring-manager"],
  [/technical|\btech\b|coding|practical|\bcase\b/i, "technical"],
  [/panel|onsite|on-site|final/i, "panel"],
  [/\bintro\b/i, "intro"],
];

/** The stage words in a name, in interview order ("recruiter-hiring-manager"); "interview" when it only says so. */
export function stageOf(name: string): string | null {
  const words = name.replace(/[_]+/g, " ");
  const found = STAGE_WORDS.filter(([pattern]) => pattern.test(words)).map(([, stage]) => stage);
  const stages = [...new Set(found)].join("-");
  const summary = /\bsummary\b/i.test(words) ? "-summary" : "";
  if (stages) return stages + summary;
  return /interview|intrerview|transcript/i.test(words) ? `interview${summary}` : null;
}

/** Whether a job ID is at this company: "product-board-ai-cse" matches "productboard" and "product-board" (#244). */
export function jobAtCompany(jobId: string, company: string): boolean {
  const key = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return false;
  const segments = jobId.split("-");
  for (let n = 1; n <= Math.min(3, segments.length); n += 1) if (segments.slice(0, n).join("") === key) return true;
  return false;
}
