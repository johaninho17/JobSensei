import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";

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

export async function initializeWorkspace(workspacePath: string): Promise<AgentSyncReport> {
  await Promise.all([
    mkdir(join(workspacePath, "profile"), { recursive: true }),
    mkdir(join(workspacePath, "context", "structured"), { recursive: true }),
    mkdir(join(workspacePath, "context", "broad"), { recursive: true }),
    mkdir(join(workspacePath, "resumes"), { recursive: true }),
    mkdir(join(workspacePath, "jobs"), { recursive: true }),
    mkdir(join(workspacePath, "debrief"), { recursive: true }),
    mkdir(join(workspacePath, "fallback-references"), { recursive: true }),
    mkdir(join(workspacePath, ".sensei"), { recursive: true }),
  ]);

  return syncWorkspaceAgentFiles(workspacePath);
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
export async function syncWorkspaceAgentFiles(workspacePath: string, options: { sourceRoots?: string[]; now?: Date } = {}): Promise<AgentSyncReport> {
  const report: AgentSyncReport = { sourceRoot: null, updated: [], added: [], removed: [], backupPath: null };
  const source = await resolveAgentSource(options.sourceRoots);
  if (!source) return report;
  report.sourceRoot = source.root;

  const agentsRoot = join(workspacePath, ".agents");
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
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

  for (const dir of MANAGED_AGENT_DIRS) {
    const sourceDir = source.dirs[dir];
    if (!sourceDir || !await exists(sourceDir)) continue;
    const entries = await readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      await replace(join(sourceDir, entry.name), join(agentsRoot, dir, entry.name), `${dir}/${entry.name}`);
    }
  }

  for (const retired of RETIRED_WORKSPACE_ENTRIES) {
    const target = join(agentsRoot, retired);
    if (await exists(target)) {
      await backup(target, retired);
      await rm(target, { recursive: true, force: true });
      report.removed.push(retired);
    }
  }

  if (source.agentsMd) {
    await replace(source.agentsMd, join(workspacePath, "AGENTS.md"), "AGENTS.md");
  }

  return report;
}
