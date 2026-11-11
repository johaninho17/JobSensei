import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { agentTextForLayout, type LayoutVersion } from "../src/shared/workspace-layout";
import { agentsMdFor, featuresFor, includedAgentEntry, type Features } from "../src/shared/edition";
import { currentEdition } from "./edition";
import { layoutVersion, workspaceFile } from "./layout";
import { healStrayPaths } from "./layout-migration";

/** Agy runtime directories the app owns and keeps in sync inside the workspace. */
export const MANAGED_AGENT_DIRS = ["skills", "rules", "workflows"] as const;

/** Entries (relative to `<workspace>/.agents`) that used to ship to workspaces and must be removed. */
export const RETIRED_WORKSPACE_ENTRIES = [
  "skills/jobsensei-adk-typescript",
  "skills/jobsensei-feature-builder",
  "skills/jobsensei-local-data",
  "skills/jobsensei-quality-gate",
  "skills/jobsensei-ui-ux",
  "rules/jobsensei-truth.md", // folded into AGENTS.md
] as const;

export interface AgentSyncReport {
  sourceRoot: string | null;
  updated: string[];
  added: string[];
  removed: string[];
  backupPath: string | null;
}

export async function initializeWorkspace(workspacePath: string, features: Features = featuresFor(currentEdition())): Promise<AgentSyncReport> {
  // Logical names; the layout decides where each one sits on disk.
  await Promise.all([...["profile", "context/structured", "context/broad", "resumes", "jobs", ...(features.contentRefresh ? ["debrief"] : []), "fallback-references"].map((folder) => mkdir(workspaceFile(workspacePath, folder), { recursive: true })),
    mkdir(join(workspacePath, ".sensei"), { recursive: true }),
  ]);
  await healStrayPaths(workspacePath).catch(() => undefined);

  return syncWorkspaceAgentFiles(workspacePath, { features });
}

interface AgentSource {
  root: string;
  dirs: Partial<Record<(typeof MANAGED_AGENT_DIRS)[number], string>>;
  agentsMd: string | null;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function resolveAgentSource(sourceRoots?: string[]): Promise<AgentSource | null> {
  const candidates: AgentSource[] = [];
  if (sourceRoots) {
    for (const root of sourceRoots) candidates.push(repoLayout(root));
  } else {
    if (process.resourcesPath) {
      const resources = process.resourcesPath;
      candidates.push({
        root: resources,
        dirs: {
          skills: join(resources, "agents", "skills"),
          rules: join(resources, "agents", "rules"),
          workflows: join(resources, "agents", "workflows"),
        },
        agentsMd: join(resources, "AGENTS.md"),
      });
      // Legacy packaged layout: skills only.
      candidates.push({ root: resources, dirs: { skills: join(resources, "skills") }, agentsMd: join(resources, "AGENTS.md") });
    }
    // Compiled (dist-electron/electron) and source (electron/) locations of the repo root.
    candidates.push(repoLayout(join(__dirname, "..", "..")), repoLayout(join(__dirname, "..")));
  }

  for (const candidate of candidates) {
    if (candidate.dirs.skills && await exists(candidate.dirs.skills)) {
      return { ...candidate, agentsMd: candidate.agentsMd && await exists(candidate.agentsMd) ? candidate.agentsMd : null };
    }
  }
  return null;
}

function repoLayout(root: string): AgentSource {
  return {
    root,
    dirs: {
      skills: join(root, ".agents", "skills"),
      rules: join(root, ".agents", "rules"),
      workflows: join(root, ".agents", "workflows"),
    },
    agentsMd: join(root, "AGENTS.md"),
  };
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** Content digest of a file or directory tree, independent of timestamps. */
async function digest(path: string): Promise<string | null> {
  const info = await stat(path).catch(() => null);
  if (!info) return null;
  const hash = createHash("sha256");
  if (info.isFile()) {
    hash.update(await readFile(path));
    return hash.digest("hex");
  }
  const files = (await listFiles(path)).sort();
  for (const file of files) {
    hash.update(relative(path, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Keeps the workspace copy of Agy's runtime files identical to the app's version.
 * Agy runs from the workspace, so a stale copy silently undoes every skill fix.
 * Differing workspace files are backed up before replacement; nothing is lost.
 */
export async function syncWorkspaceAgentFiles(workspacePath: string, options: { sourceRoots?: string[]; now?: Date; features?: Features } = {}): Promise<AgentSyncReport> {
  const features = options.features ?? featuresFor(currentEdition());
  const report: AgentSyncReport = { sourceRoot: null, updated: [], added: [], removed: [], backupPath: null };
  const original = await resolveAgentSource(options.sourceRoots);
  if (!original) return report;
  report.sourceRoot = original.root;
  // Agy reads real files, so a tidy workspace gets a copy of the instructions that names its folders.
  const version = layoutVersion(workspacePath);
  const rendered = version === 1 ? null : await renderAgentSource(original, version);
  const source = rendered?.source ?? original;
  try {
    return await syncFrom(source, workspacePath, report, options.now ?? new Date(), features);
  } finally {
    if (rendered) await rm(rendered.root, { recursive: true, force: true });
  }
}

/** A temporary copy of the Agy files with every workspace path rewritten for the layout. */
async function renderAgentSource(source: AgentSource, version: LayoutVersion): Promise<{ root: string; source: AgentSource }> {
  const root = await mkdtemp(join(tmpdir(), "sensei-agents-"));
  const dirs: AgentSource["dirs"] = {};
  for (const dir of MANAGED_AGENT_DIRS) {
    const from = source.dirs[dir];
    if (!from || !await exists(from)) continue;
    const to = join(root, dir);
    await cp(from, to, { recursive: true });
    for (const file of await listFiles(to)) if (file.endsWith(".md")) await writeFile(file, agentTextForLayout(await readFile(file, "utf8"), version));
    dirs[dir] = to;
  }
  let agentsMd: string | null = null;
  if (source.agentsMd) { agentsMd = join(root, "AGENTS.md"); await writeFile(agentsMd, agentTextForLayout(await readFile(source.agentsMd, "utf8"), version)); }
  return { root, source: { root: source.root, dirs, agentsMd } };
}

async function syncFrom(source: AgentSource, workspacePath: string, report: AgentSyncReport, now: Date, features: Features): Promise<AgentSyncReport> {
  const agentsRoot = join(workspacePath, ".agents");
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupRoot = join(agentsRoot, ".backups", stamp);

  const backup = async (target: string, label: string) => {
    const destination = join(backupRoot, label);
    await mkdir(join(destination, ".."), { recursive: true });
    await cp(target, destination, { recursive: true });
    report.backupPath = backupRoot;
  };

  const replace = async (sourcePath: string, target: string, label: string) => {
    const [sourceDigest, targetDigest] = await Promise.all([digest(sourcePath), digest(target)]);
    if (sourceDigest === targetDigest) return;
    if (targetDigest) {
      await backup(target, label);
      await rm(target, { recursive: true, force: true });
      report.updated.push(label);
    } else {
      report.added.push(label);
    }
    await mkdir(join(target, ".."), { recursive: true });
    await cp(sourcePath, target, { recursive: true });
  };

  const leftOut: string[] = [];
  for (const dir of MANAGED_AGENT_DIRS) {
    const sourceDir = source.dirs[dir];
    if (!sourceDir || !await exists(sourceDir)) continue;
    const entries = await readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const label = `${dir}/${entry.name}`;
      // Files for a feature this edition doesn't have are never seeded (and removed below if an older copy exists).
      if (!includedAgentEntry(features, label)) { leftOut.push(label); continue; }
      await replace(join(sourceDir, entry.name), join(agentsRoot, dir, entry.name), label);
    }
  }

  for (const retired of [...RETIRED_WORKSPACE_ENTRIES, ...leftOut]) {
    const target = join(agentsRoot, retired);
    if (await exists(target)) {
      await backup(target, retired);
      await rm(target, { recursive: true, force: true });
      report.removed.push(retired);
    }
  }

  if (source.agentsMd) {
    // AGENTS.md is written with only this edition's sections (feature markers in the source decide).
    const text = agentsMdFor(features, await readFile(source.agentsMd, "utf8"));
    const target = join(workspacePath, "AGENTS.md");
    const current = await readFile(target, "utf8").catch(() => null);
    if (current !== text) {
      if (current !== null) { await backup(target, "AGENTS.md"); report.updated.push("AGENTS.md"); }
      else report.added.push("AGENTS.md");
      await writeFile(target, text, "utf8");
    }
  }

  await pruneAgentBackups(agentsRoot);
  return report;
}

export const KEPT_AGENT_BACKUPS = 5;

/** Keeps the newest backup sets; stamps are ISO times, so name order is time order. */
export async function pruneAgentBackups(agentsRoot: string, keep = KEPT_AGENT_BACKUPS): Promise<string[]> {
  const root = join(agentsRoot, ".backups");
  const sets = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const old = sets.slice(0, Math.max(0, sets.length - keep));
  await Promise.all(old.map((name) => rm(join(root, name), { recursive: true, force: true })));
  return old;
}

export const NPM_CACHE_LIMIT_BYTES = 200 * 1024 * 1024;

async function directorySize(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(entries.map((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return directorySize(child);
    return entry.isFile() ? stat(child).then((info) => info.size, () => 0) : 0;
  }));
  return sizes.reduce((total, size) => total + size, 0);
}

/** Agy's npm cache (.sensei/npm-cache) is only a cache: past the limit it is cleared and npm refills it on demand. */
export async function capWorkspaceNpmCache(workspacePath: string, limitBytes = NPM_CACHE_LIMIT_BYTES): Promise<boolean> {
  const cache = join(workspacePath, ".sensei", "npm-cache");
  if (await directorySize(cache) <= limitBytes) return false;
  await rm(cache, { recursive: true, force: true });
  return true;
}
