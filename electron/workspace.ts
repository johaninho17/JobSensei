import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { readJson, writeJsonAtomic } from "./persistence";
import type { Settings } from "../src/shared/schemas";
import { executableAvailable, profileHasBaseResume, readCandidateProfile } from "./candidate-profile";

const CONTEXT_DIR = "context";
const JOBS_DIR = "jobs";
const INDEX_FILE = ".sensei/index.db";
const CONTEXT_INDEX_FILE = ".sensei/context-index.json";

export function assertInsideWorkspace(workspacePath: string, candidatePath: string): string {
  const root = resolve(workspacePath);
  const candidate = resolve(candidatePath);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) throw new Error("The requested path is outside the selected workspace.");
  return candidate;
}

async function countFiles(path: string): Promise<number> {
  let count = 0;
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === ".sensei" || entry.name === "node_modules" || entry.name === ".DS_Store") continue;
      if (entry.isDirectory()) await visit(join(directory, entry.name));
      else count += 1;
    }
  }
  await visit(path);
  return count;
}

export async function indexContext(workspacePath: string): Promise<{ files: unknown[]; evidence: unknown[]; warnings: string[] }> {
  const contextPath = assertInsideWorkspace(workspacePath, join(workspacePath, CONTEXT_DIR));
  const files = await countFiles(contextPath);
  const index = { schemaVersion: 1, updatedAt: new Date().toISOString(), fileCount: files };
  await writeJsonAtomic(join(workspacePath, CONTEXT_INDEX_FILE), index);
  return { files: [], evidence: [], warnings: [] };
}

export async function summarizeWorkspace(workspacePath: string, repositoryRoot = resolve(workspacePath, ".."), settings?: Settings) {
  try {
    const root = resolve(workspacePath);
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) throw new Error("Workspace path is not a directory.");
    const stored = await readJson<{ fileCount?: unknown }>(join(root, CONTEXT_INDEX_FILE));
    const contextFileCount = typeof stored?.fileCount === "number" ? stored.fileCount : await countFiles(join(root, CONTEXT_DIR));
    const jobEntries = await readdir(join(root, JOBS_DIR), { withFileTypes: true }).catch(() => []);
    const profile = await readCandidateProfile(root);
    const effectiveSettings = settings ?? {
      schemaVersion: 1 as const,
      workspacePath: root,
      baseResumePath: profile?.sources.baseResumePath ?? null,
      secondaryResumePaths: profile?.sources.secondaryResumePaths ?? [],
      linkedinProfilePath: profile?.sources.linkedinProfilePath ?? null,
      updatedAt: new Date(0).toISOString(),
    };
    return {
      path: root,
      repositoryRoot: resolve(repositoryRoot),
      status: "ready" as const,
      contextFileCount,
      jobCount: jobEntries.filter((entry) => entry.isDirectory()).length,
      hasIndex: await stat(join(root, INDEX_FILE)).then(() => true).catch(() => false),
      hasCandidateProfile: Boolean(profile),
      hasBaseResume: await profileHasBaseResume(root, profile, effectiveSettings),
      agyAvailable: await executableAvailable("agy"),
      warnings: [] as string[],
    };
  } catch (error) {
    return { path: workspacePath, repositoryRoot: resolve(repositoryRoot), status: "error" as const, contextFileCount: 0, jobCount: 0, hasIndex: false, hasCandidateProfile: false, hasBaseResume: false, agyAvailable: false, warnings: [error instanceof Error ? error.message : "Unable to read workspace."] };
  }
}

export function relativePath(workspacePath: string, path: string): string { return relative(workspacePath, assertInsideWorkspace(workspacePath, path)); }
