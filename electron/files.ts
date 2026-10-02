import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { shell } from "electron";
import mammoth from "mammoth";
import type { FilePreview, FileTreeNode, MarkdownSaveInput } from "../src/shared/schemas";
import { filePreviewSchema, markdownSaveInputSchema } from "../src/shared/schemas";
import { writeTextAtomic } from "./persistence";
import { assertInsideWorkspace } from "./workspace";

const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_BINARY_PREVIEW_BYTES = 16 * 1024 * 1024;
const ignoredNames = new Set([".DS_Store", ".sensei", "node_modules", "example_evals", "fallback-references"]);
const protectedRoots = new Set(["context", "jobs", "resumes", "cover-letters", "debrief"]);

function fileType(path: string): FilePreview["fileType"] {
  const extension = extname(path).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".docx" || extension === ".doc") return "docx";
  if (extension === ".rtf") return "rtf";
  if (extension === ".json") return "json";
  if ([".txt", ".md", ".log", ".csv"].includes(extension)) return "text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension)) return "image";
  return "unknown";
}

async function detectFileType(path: string): Promise<FilePreview["fileType"]> {
  const extensionType = fileType(path);
  const header = (await readFile(path)).subarray(0, 8);
  if (header.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (header[0] === 0x50 && header[1] === 0x4b) return extensionType === "docx" ? "docx" : extensionType;
  return extensionType;
}

function stripRtf(value: string): string {
  return value.replace(/\\'[0-9a-f]{2}/gi, "").replace(/\\[a-z]+\d* ?/gi, "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

async function nodeForPath(workspacePath: string, path: string): Promise<FileTreeNode | null> {
  const info = await stat(path).catch(() => null);
  if (!info) return null;
  const relativePath = relative(workspacePath, path).replaceAll("\\", "/");
  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    const children: FileTreeNode[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignoredNames.has(entry.name)) continue;
      const child = await nodeForPath(workspacePath, join(path, entry.name));
      if (child) children.push(child);
    }
    return { name: basename(path), relativePath, kind: "directory", children };
  }
  return { name: basename(path), relativePath, kind: "file", fileType: fileType(path), sizeBytes: info.size, modifiedAt: info.mtime.toISOString() };
}

async function jobMetadataForPath(workspacePath: string, relativePath: string): Promise<{ jobCompany: string | null; jobTitle: string | null }> {
  const match = relativePath.match(/^jobs\/([^/]+)(?:\/|$)/);
  if (!match) return { jobCompany: null, jobTitle: null };
  for (const metadataPath of [
    resolve(workspacePath, "jobs", match[1], ".sensei", "job.json"),
    resolve(workspacePath, "jobs", match[1], "job.json"),
  ]) {
    try {
      const metadata = JSON.parse(await readFile(assertInsideWorkspace(workspacePath, metadataPath), "utf8")) as Record<string, unknown>;
      return {
        jobCompany: typeof metadata.company === "string" ? metadata.company : null,
        jobTitle: typeof metadata.title === "string" ? metadata.title : typeof metadata.role === "string" ? metadata.role : null,
      };
    } catch {
      // New workspaces use hidden metadata; legacy workspaces may still use the root file.
    }
  }
  return { jobCompany: null, jobTitle: null };
}

export async function listFileTree(workspacePath: string): Promise<FileTreeNode[]> {
  const roots: FileTreeNode[] = [];
  for (const name of ["context", "cover-letters", "debrief"]) {
    const node = await nodeForPath(workspacePath, join(workspacePath, name));
    if (node) roots.push(node);
  }
  return roots;
}

export async function previewFile(workspacePath: string, relativePath: string): Promise<FilePreview> {
  if (!relativePath || relativePath.startsWith(".") || relativePath.includes("\\")) throw new Error("Use a workspace-relative file path.");
  const path = assertInsideWorkspace(workspacePath, resolve(workspacePath, relativePath));
  const info = await stat(path);
  if (!info.isFile()) throw new Error("The selected path is not a file.");
  const type = await detectFileType(path);
  const base = { relativePath, name: basename(path), fileType: type, sizeBytes: info.size, modifiedAt: info.mtime.toISOString(), ...(await jobMetadataForPath(workspacePath, relativePath)) };
  if (["text", "json", "rtf"].includes(type) && info.size <= MAX_PREVIEW_BYTES) {
    const raw = await readFile(path, "utf8");
    const content = type === "rtf" ? stripRtf(raw) : raw;
    return filePreviewSchema.parse({ ...base, canPreview: true, content, contentType: "text", dataUrl: null, message: null });
  }
  if ((type === "pdf" || type === "image") && info.size <= MAX_BINARY_PREVIEW_BYTES) {
    const mime = type === "pdf" ? "application/pdf" : mimeForImage(path);
    const dataUrl = `data:${mime};base64,${(await readFile(path)).toString("base64")}`;
    return filePreviewSchema.parse({ ...base, canPreview: true, content: null, contentType: "data-url", dataUrl, message: null });
  }
  if (type === "docx" && info.size <= MAX_BINARY_PREVIEW_BYTES) {
    let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>;
    try { result = await mammoth.convertToHtml({ buffer: await readFile(path) }); }
    catch (error) {
      const message = error instanceof Error ? `DOCX preview unavailable: ${error.message}` : "DOCX preview unavailable because the file is malformed.";
      return filePreviewSchema.parse({ ...base, canPreview: false, content: null, contentType: null, dataUrl: null, message });
    }
    const warning = result.messages.length > 0 ? `DOCX converted with ${result.messages.length} warning${result.messages.length === 1 ? "" : "s"}.` : null;
    return filePreviewSchema.parse({ ...base, canPreview: true, content: result.value, contentType: "html", dataUrl: null, message: warning });
  }
  const message = info.size > (type === "pdf" || type === "image" || type === "docx" ? MAX_BINARY_PREVIEW_BYTES : MAX_PREVIEW_BYTES) ? "This file is too large for an inline preview." : "No inline preview is available for this file type.";
  return filePreviewSchema.parse({ ...base, canPreview: false, content: null, contentType: null, dataUrl: null, message });
}

export async function saveMarkdownFile(workspacePath: string, input: MarkdownSaveInput): Promise<FilePreview> {
  const parsed = markdownSaveInputSchema.parse(input);
  if (parsed.relativePath.startsWith(".") || parsed.relativePath.includes("\\")) throw new Error("Use a workspace-relative Markdown path.");
  const workspaceRoot = resolve(workspacePath);
  const path = assertInsideWorkspace(workspaceRoot, resolve(workspaceRoot, parsed.relativePath));
  const safeRelativePath = relative(workspaceRoot, path).replaceAll("\\", "/");
  if (!safeRelativePath.match(/^(jobs|debrief|resumes)\//)) throw new Error("Career source files are read-only. Only job, debrief, and resume Markdown can be edited.");
  if (extname(path).toLowerCase() !== ".md") throw new Error("Only Markdown files can be edited.");

  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Error("The Markdown file no longer exists.");
  const actualPath = await realpath(path);
  assertInsideWorkspace(await realpath(workspaceRoot), actualPath);
  const expectedTime = new Date(parsed.expectedModifiedAt).getTime();
  const currentContent = await readFile(actualPath, "utf8");
  if (!Number.isFinite(expectedTime) || currentContent !== parsed.expectedContent) {
    throw new Error("This file changed on disk. Reload it before saving so external edits are not overwritten.");
  }

  await writeTextAtomic(actualPath, parsed.content);
  return previewFile(workspaceRoot, safeRelativePath);
}

export async function deleteWorkspacePath(workspacePath: string, relativePath: string, trashItem: (path: string) => Promise<void> = (path) => shell.trashItem(path)): Promise<void> {
  if (!relativePath || relativePath.startsWith(".") || relativePath.includes("\\")) throw new Error("Use a workspace-relative file or folder path.");
  const pathParts = relativePath.split("/");
  if (pathParts.length === 1 && protectedRoots.has(pathParts[0])) throw new Error("Workspace root folders cannot be deleted.");
  const path = assertInsideWorkspace(workspacePath, resolve(workspacePath, relativePath));
  const info = await stat(path).catch(() => null);
  if (!info) throw new Error("The selected file or folder no longer exists.");
  await trashItem(path);
}

export async function revealWorkspacePath(workspacePath: string, relativePath: string): Promise<void> {
  if (!relativePath || relativePath.startsWith(".") || relativePath.includes("\\")) throw new Error("Use a workspace-relative file or folder path.");
  const path = assertInsideWorkspace(workspacePath, resolve(workspacePath, relativePath));
  const info = await stat(path).catch(() => null);
  if (!info) throw new Error("The selected file or folder no longer exists.");
  shell.showItemInFolder(path);
}

function mimeForImage(path: string): string {
  const extension = extname(path).toLowerCase();
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" } as Record<string, string>)[extension] ?? "application/octet-stream";
}

export async function getBaseResume(workspacePath: string, configuredPath: string | null): Promise<string | null> {
  const candidates = configuredPath ? [configuredPath] : [];
  for (const candidate of candidates) {
    try {
      const safe = assertInsideWorkspace(workspacePath, resolve(workspacePath, candidate));
      const info = await stat(safe).catch(() => null);
      if (info?.isFile()) return relative(workspacePath, safe).replaceAll("\\", "/");
    } catch { /* Skip stale or unsafe configured paths and try the default. */ }
  }
  return null;
}

export async function listResumePaths(workspacePath: string, configuredBase: string | null, configuredSecondary: string[] = []): Promise<{ baseResumePath: string | null; secondaryResumePaths: string[] }> {
  const baseResumePath = await getBaseResume(workspacePath, configuredBase);
  const secondaryResumePaths: string[] = [];
  for (const candidate of configuredSecondary) {
    try {
      const safe = assertInsideWorkspace(workspacePath, resolve(workspacePath, candidate));
      const info = await stat(safe).catch(() => null);
      const relativeCandidate = relative(workspacePath, safe).replaceAll("\\", "/");
      if (info?.isFile() && relativeCandidate !== baseResumePath) secondaryResumePaths.push(relativeCandidate);
    } catch { /* Ignore stale or unsafe saved paths. */ }
  }
  return { baseResumePath, secondaryResumePaths: [...new Set(secondaryResumePaths)] };
}

export function hashPath(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export { assertInsideWorkspace };
