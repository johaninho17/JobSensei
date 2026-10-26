import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { capWorkspaceNpmCache, initializeWorkspace, pruneAgentBackups, syncWorkspaceAgentFiles } from "../electron/workspace-init";

const temps: string[] = [];
async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function fakeRepo(skillText: string): Promise<string> {
  const repo = await temp("sensei-repo-");
  await mkdir(join(repo, ".agents", "skills", "jobsensei-application-pipeline"), { recursive: true });
  await mkdir(join(repo, ".agents", "rules"), { recursive: true });
  await mkdir(join(repo, ".agents", "workflows"), { recursive: true });
  await writeFile(join(repo, ".agents", "skills", "jobsensei-application-pipeline", "SKILL.md"), skillText);
  await writeFile(join(repo, ".agents", "rules", "truth.md"), "rule v1");
  await writeFile(join(repo, ".agents", "workflows", "apply.md"), "workflow v1");
  await writeFile(join(repo, "AGENTS.md"), "agents v1");
  return repo;
}

describe("workspace Agy runtime sync", () => {
  it("replaces a stale workspace skill with the app version and keeps a backup", async () => {
    const repo = await fakeRepo("skill v2");
    const workspace = await temp("sensei-ws-");
    const staleSkill = join(workspace, ".agents", "skills", "jobsensei-application-pipeline", "SKILL.md");
    await mkdir(join(staleSkill, ".."), { recursive: true });
    await writeFile(staleSkill, "skill v1 (stale)");
    await writeFile(join(workspace, "AGENTS.md"), "agents v0");

    const report = await syncWorkspaceAgentFiles(workspace, { sourceRoots: [repo], now: new Date("2026-10-23T00:00:00Z") });

    expect(await readFile(staleSkill, "utf8")).toBe("skill v2");
    expect(await readFile(join(workspace, "AGENTS.md"), "utf8")).toBe("agents v1");
    expect(await readFile(join(workspace, ".agents", "rules", "truth.md"), "utf8")).toBe("rule v1");
    expect(await readFile(join(workspace, ".agents", "workflows", "apply.md"), "utf8")).toBe("workflow v1");
    expect(report.updated).toEqual(expect.arrayContaining(["skills/jobsensei-application-pipeline", "AGENTS.md"]));
    expect(await readFile(join(report.backupPath!, "skills", "jobsensei-application-pipeline", "SKILL.md"), "utf8")).toBe("skill v1 (stale)");
  });

  it("is a no-op when the workspace already matches", async () => {
    const repo = await fakeRepo("skill v2");
    const workspace = await temp("sensei-ws-");
    await syncWorkspaceAgentFiles(workspace, { sourceRoots: [repo] });
    const second = await syncWorkspaceAgentFiles(workspace, { sourceRoots: [repo] });
    expect(second.updated).toEqual([]);
    expect(second.added).toEqual([]);
    expect(second.backupPath).toBeNull();
  });

  it("removes retired builder skills and the folded-in truth rule from the workspace", async () => {
    const repo = await fakeRepo("skill v2");
    const workspace = await temp("sensei-ws-");
    await mkdir(join(workspace, ".agents", "skills", "jobsensei-ui-ux"), { recursive: true });
    await writeFile(join(workspace, ".agents", "skills", "jobsensei-ui-ux", "SKILL.md"), "builder skill");
    await mkdir(join(workspace, ".agents", "rules"), { recursive: true });
    await writeFile(join(workspace, ".agents", "rules", "jobsensei-truth.md"), "old rule");

    const report = await syncWorkspaceAgentFiles(workspace, { sourceRoots: [repo] });

    expect(report.removed).toEqual(expect.arrayContaining(["skills/jobsensei-ui-ux", "rules/jobsensei-truth.md"]));
    expect(await readdir(join(workspace, ".agents", "skills"))).not.toContain("jobsensei-ui-ux");
    expect(await readdir(join(workspace, ".agents", "rules"))).not.toContain("jobsensei-truth.md");
  });

  it("seeds a new workspace from this repository's real Agy skills", async () => {
    const workspace = await temp("sensei-ws-");
    const report = await initializeWorkspace(workspace);
    expect(report.sourceRoot).not.toBeNull();
    const skills = await readdir(join(workspace, ".agents", "skills"));
    expect(skills).toContain("jobsensei-application-pipeline");
    expect(skills).not.toContain("jobsensei-ui-ux");
    const repoSkill = await readFile(join(__dirname, "..", ".agents", "skills", "jobsensei-application-pipeline", "SKILL.md"), "utf8");
    expect(await readFile(join(workspace, ".agents", "skills", "jobsensei-application-pipeline", "SKILL.md"), "utf8")).toBe(repoSkill);
  });
});

describe("workspace housekeeping", () => {
  it("keeps only the newest five backup sets", async () => {
    const agents = await temp("sensei-backups-");
    const stamps = Array.from({ length: 8 }, (_, index) => `2026-10-0${index + 1}T00-00-00-000Z`);
    for (const stamp of stamps) await mkdir(join(agents, ".backups", stamp, "skills"), { recursive: true });
    expect(await pruneAgentBackups(agents)).toEqual(stamps.slice(0, 3));
    expect((await readdir(join(agents, ".backups"))).sort()).toEqual(stamps.slice(3));
  });

  it("clears the npm cache only when it passes its size limit", async () => {
    const workspace = await temp("sensei-npm-cache-");
    const cache = join(workspace, ".sensei", "npm-cache", "_cacache");
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, "entry"), "x".repeat(2048));
    expect(await capWorkspaceNpmCache(workspace, 4096)).toBe(false);
    expect(await readdir(cache)).toEqual(["entry"]);
    expect(await capWorkspaceNpmCache(workspace, 1024)).toBe(true);
    expect(await readdir(join(workspace, ".sensei")).then((names) => names.includes("npm-cache"))).toBe(false);
  });
});
