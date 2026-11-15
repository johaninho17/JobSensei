// Adds interview recordings, debrief notes, and practice-interview transcripts from inside the app (Interviews → Your
// content), so nobody has to make folders by hand. The recording scan (electron/content-refresh.ts) then lists them as new.
import { copyFilesInto, type ImportResult } from "./context-import";
import { recordingFolder, type RecordingKind } from "../src/shared/recordings";

/** Transcripts and notes: text, documents, and subtitle files. */
export const RECORDING_EXTENSIONS = [".md", ".txt", ".pdf", ".docx", ".rtf", ".json", ".csv", ".vtt", ".srt"];

export async function importRecordings(workspacePath: string, sources: string[], kind: RecordingKind, jobId: string | null): Promise<ImportResult> {
  return copyFilesInto(workspacePath, recordingFolder(kind, jobId), sources, RECORDING_EXTENSIONS);
}
