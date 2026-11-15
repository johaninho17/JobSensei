// Adds the user's files to career context from inside the app (Add files or drag-and-drop), so nobody has to find the
// workspace folder in Finder or Explorer. Files are copied, never moved; the originals are left as they are.
import { workspaceFile } from "./workspace";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";

export type ContextKind = "structured" | "broad";
export const CONTEXT_FOLDERS: Record<ContextKind, string> = { structured: "context/structured", broad: "context/broad" };
/** File types Agy and the app can read as career context. */
export const CONTEXT_EXTENSIONS = [".md", ".txt", ".pdf", ".docx", ".rtf", ".json", ".csv"];
const MAX_BYTES = 20 * 1024 * 1024;

export type ImportResult = { added: string[]; skipped: Array<{ name: string; reason: string }> };

const sha = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");

/** A file name that doesn't overwrite one already there ("notes.md" → "notes-2.md"). */
async function freeName(folder: string, name: string): Promise<string> {
  const existing = new Set(await readdir(folder).catch(() => [] as string[]));
  if (!existing.has(name)) return name;
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let index = 2; ; index++) if (!existing.has(`${stem}-${index}${extension}`)) return `${stem}-${index}${extension}`;
}

export async function importContextFiles(workspacePath: string, sources: string[], kind: ContextKind): Promise<ImportResult> {
  return copyFilesInto(workspacePath, CONTEXT_FOLDERS[kind], sources, CONTEXT_EXTENSIONS);
}

/**
 * Copies files into one workspace folder (logical path, mapped to disk by the layout): copies only, never overwrites
 * ("notes-2.md"), skips folders, unreadable types, files over 20 MB, and exact copies already there. Shared by career
 * context and interview recordings (electron/recording-import.ts).
 */
export async function copyFilesInto(workspacePath: string, folderRelative: string, sources: string[], extensions: string[]): Promise<ImportResult> {
  const root = resolve(workspacePath);
  const folder = workspaceFile(root, folderRelative);
  await mkdir(folder, { recursive: true });
  const result: ImportResult = { added: [], skipped: [] };
  for (const source of sources) {
    const name = basename(source);
    const info = await stat(source).catch(() => null);
    if (!info?.isFile()) { result.skipped.push({ name, reason: "not a file (folders can't be added; add the files inside)" }); continue; }
    if (!extensions.includes(extname(name).toLowerCase())) { result.skipped.push({ name, reason: `not a readable type (use ${extensions.join(", ")})` }); continue; }
    if (info.size > MAX_BYTES) { result.skipped.push({ name, reason: "larger than 20 MB" }); continue; }
    const absolute = resolve(source);
    if (absolute.startsWith(`${folder}${sep}`)) { result.skipped.push({ name, reason: "already in this folder" }); continue; }
    // The same file added twice is skipped instead of copied again under a new name.
    const hash = await sha(absolute);
    const duplicates = await Promise.all((await readdir(folder).catch(() => [] as string[])).map(async (existing) => {
      const path = join(folder, existing);
      const existingInfo = await stat(path).catch(() => null);
      return existingInfo?.isFile() && existingInfo.size === info.size && await sha(path) === hash ? existing : null;
    }));
    const duplicate = duplicates.find(Boolean);
    if (duplicate) { result.skipped.push({ name, reason: `already added as ${duplicate}` }); result.added.push(`${folderRelative}/${duplicate}`); continue; }
    const target = await freeName(folder, name);
    await copyFile(absolute, join(folder, target));
    result.added.push(`${folderRelative}/${target}`);
  }
  return result;
}
