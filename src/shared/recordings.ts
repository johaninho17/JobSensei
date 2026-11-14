// What counts as a recording waiting to be imported into interview content (Interviews → Your content). One rule for the
// Interviews badge, the Your content list, the update, and Today, so they always show the same number.

export type RecordingState = "new" | "changed" | "imported" | "duplicate" | "skipped";

/** New files and fuller versions of ones imported before; duplicates and skipped files never wait. */
export function waitingToImport<T extends { state: RecordingState }>(recordings: T[]): T[] {
  return recordings.filter((recording) => recording.state === "new" || recording.state === "changed");
}
