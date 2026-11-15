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
