// Layout-aware paths: the one door between logical workspace paths and where they sit on disk.
// No imports from other app modules, so anything may import this.
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { LAYOUT_FILE, parseLayoutVersion, toDisk, toLogical, type LayoutVersion } from "../src/shared/workspace-layout";

const layoutCache = new Map<string, { version: LayoutVersion; mtimeMs: number; checkedAt: number }>();

/** The workspace's layout version (`.sensei/layout.json`; a workspace without the file uses the original layout). */
export function layoutVersion(workspacePath: string): LayoutVersion {
  const root = resolve(workspacePath);
  const cached = layoutCache.get(root);
  const now = Date.now();
  if (cached && now - cached.checkedAt < 1000) return cached.version;
  const file = join(root, LAYOUT_FILE);
  let mtimeMs = -1;
  try { mtimeMs = statSync(file).mtimeMs; } catch { /* no layout file: original layout */ }
  if (cached && cached.mtimeMs === mtimeMs) { cached.checkedAt = now; return cached.version; }
  let version: LayoutVersion = 1;
  if (mtimeMs >= 0) { try { version = parseLayoutVersion(JSON.parse(readFileSync(file, "utf8"))); } catch { version = 1; } }
  layoutCache.set(root, { version, mtimeMs, checkedAt: now });
  return version;
}

/** Call after writing or removing the layout file, so the next path is resolved with the new layout. */
export function forgetLayout(workspacePath: string): void { layoutCache.delete(resolve(workspacePath)); }

function insideWorkspace(root: string, candidate: string): void {
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) throw new Error("The requested path is outside the selected workspace.");
}

/**
 * The one door to the workspace on disk: checks the path stays inside the workspace and returns where it sits on
 * disk under the workspace's layout (src/shared/workspace-layout.ts). Callers pass logical paths; a disk path
 * comes back unchanged.
 */
export function assertInsideWorkspace(workspacePath: string, candidatePath: string): string {
  const root = resolve(workspacePath);
  const candidate = resolve(candidatePath);
  insideWorkspace(root, candidate);
  if (candidate === root) return candidate;
  const version = layoutVersion(root);
  if (version === 1) return candidate;
  const onDisk = resolve(root, toDisk(relative(root, candidate).replaceAll("\\", "/"), version));
  insideWorkspace(root, onDisk);
  return onDisk;
}

/** Disk location of a logical workspace-relative path. */
export function workspaceFile(workspacePath: string, logicalPath: string): string {
  return assertInsideWorkspace(workspacePath, join(resolve(workspacePath), logicalPath));
}

/** The logical workspace-relative path ("context/structured/x.md") of a file on disk, whatever the layout. */
export function logicalPath(workspacePath: string, path: string): string {
  const root = resolve(workspacePath);
  const candidate = resolve(path);
  insideWorkspace(root, candidate);
  return toLogical(relative(root, candidate).replaceAll("\\", "/"), layoutVersion(root));
}
