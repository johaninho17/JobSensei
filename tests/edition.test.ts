// Recruiter plan R0: each edition contains only its features (src/shared/edition.ts owns the lists).
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EDITION_INFO, FEATURE_AGENT_ENTRIES, FEATURE_COMMANDS, FEATURE_MODULES, agentsMdFor, featuresFor, folderMismatchMessage, includedCommand } from "../src/shared/edition";
import { folderEdition, prepareEditionFolder } from "../electron/edition";
import { pipelineScripts } from "../electron/agy-home";
import { syncWorkspaceAgentFiles } from "../electron/workspace-init";
import { computeReadiness } from "../electron/setup-readiness";

const repo = join(__dirname, "..");
const solo = featuresFor("solo");
const recruiter = featuresFor("recruiter");
const temps: string[] = [];
async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("edition features", () => {
  it("leaves every single-user area out of the recruiter edition and keeps all of them in solo", () => {
    expect(recruiter).toEqual({ interviews: false, applicationQuestions: false, contentRefresh: false, learnings: false, interviewProfile: false, nudges: false, jobSearch: false, candidates: true });
    expect(Object.entries(solo).filter(([name, on]) => name !== "candidates" && !on)).toEqual([]);
  });

  it("names the recruiter edition so users can tell the builds apart", () => {
    expect(EDITION_INFO.recruiter).toMatchObject({ subtitle: "Recruiter Edition", badge: "RE", appId: "com.jobsensei.recruiter" });
    expect(EDITION_INFO.solo).toMatchObject({ productName: "JobSensei", appId: "com.jobsensei.desktop", subtitle: null, badge: null });
    expect(EDITION_INFO.recruiter.defaultFolder).not.toBe(EDITION_INFO.solo.defaultFolder);
  });
});

describe("Agy runtime per edition", () => {
  it("gives recruiter Agy only the application commands", () => {
    const all = Object.keys(pipelineScripts(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> }));
    expect(all.filter((name) => includedCommand(recruiter, name)).sort()).toEqual(["application:finalize", "application:validate", "context:snapshot", "jd:fetch"]);
    expect(all.filter((name) => includedCommand(solo, name))).toEqual(all);
    for (const name of Object.keys(FEATURE_COMMANDS)) expect(all).toContain(name); // the list names real commands
  });

  it("names only Agy files that exist, so the left-out list can't go stale", () => {
    for (const entry of Object.keys(FEATURE_AGENT_ENTRIES)) expect(existsSync(join(repo, ".agents", entry)), entry).toBe(true);
  });

  it("removes the interview section from AGENTS.md for recruiter and keeps solo's text as it was", () => {
    const text = readFileSync(join(repo, "AGENTS.md"), "utf8");
    const recruiterText = agentsMdFor(recruiter, text);
    expect(recruiterText).not.toMatch(/## Interview flow|interview-pipeline|interview-coach|technical-challenge|interview:/);
    expect(recruiterText).toContain("## New job flow");
    expect(recruiterText).not.toContain("<!--");
    const soloText = agentsMdFor(solo, text);
    expect(soloText).toContain("## Interview flow");
    expect(soloText).toBe(text.replace(/<!-- \/?feature(?::\w+)? -->\n/g, ""));
  });

  it("seeds a recruiter workspace without interview skills and removes older copies", async () => {
    const workspace = await temp("sensei-re-ws-");
    await mkdir(join(workspace, ".agents", "skills", "jobsensei-interview-coach"), { recursive: true });
    await writeFile(join(workspace, ".agents", "skills", "jobsensei-interview-coach", "SKILL.md"), "old copy");
    await syncWorkspaceAgentFiles(workspace, { sourceRoots: [repo], features: recruiter });
    const skills = await readdir(join(workspace, ".agents", "skills"));
    const workflows = await readdir(join(workspace, ".agents", "workflows"));
    for (const entry of Object.keys(FEATURE_AGENT_ENTRIES)) expect([...skills.map((name) => `skills/${name}`), ...workflows.map((name) => `workflows/${name}`)]).not.toContain(entry);
    expect(skills).toContain("jobsensei-application-pipeline");
    expect(skills).toContain("jobsensei-resume-tailor");
    expect(await readFile(join(workspace, "AGENTS.md"), "utf8")).not.toMatch(/## Interview flow|interview-pipeline/);
  });
});

describe("main process loads feature modules only on demand", () => {
  const main = readFileSync(join(repo, "electron", "main.ts"), "utf8");

  it("never imports a feature-only module statically, so the recruiter build can leave them out", () => {
    for (const name of Object.keys(FEATURE_MODULES)) {
      expect(existsSync(join(repo, "electron", `${name}.ts`)), name).toBe(true);
      expect(main, name).not.toMatch(new RegExp(`^import [^;]*from "\\./${name}(?:\\.js)?";`, "m"));
    }
  });

  it("registers no interview, question, or content channels itself", () => {
    expect(main).not.toMatch(/ipcMain\.handle\("(?:interviews|questions|content):/);
  });

  it("no always-loaded module imports a feature-only one", async () => {
    const offModules = new Set(Object.keys(FEATURE_MODULES));
    for (const file of await readdir(join(repo, "electron"))) {
      const name = file.replace(/\.ts$/, "");
      if (!file.endsWith(".ts") || offModules.has(name)) continue;
      const text = readFileSync(join(repo, "electron", file), "utf8");
      for (const off of offModules) expect(text, `${file} imports ${off}`).not.toMatch(new RegExp(`from "\\./${off}(?:\\.js)?"`));
    }
  });
});

describe("folders belong to one edition", () => {
  it("keeps the recruiter edition out of a solo workspace and stamps new folders", async () => {
    const soloFolder = await temp("sensei-solo-");
    await mkdir(join(soloFolder, "jobs"), { recursive: true });
    expect(await folderEdition(soloFolder)).toBe("solo");
    const fallback = join(await temp("sensei-re-"), "JobSensei Recruiter");
    expect(await prepareEditionFolder(soloFolder, "recruiter", fallback)).toBe(fallback);
    expect(await stat(join(soloFolder, ".sensei", "edition.json")).then(() => true, () => false)).toBe(false);
    expect(await folderEdition(fallback)).toBe("recruiter");
    expect(await prepareEditionFolder(soloFolder, "solo", fallback)).toBe(soloFolder);
    expect(await folderEdition(soloFolder)).toBe("solo");
  });

  it("treats an empty folder as free for either edition", async () => {
    expect(await folderEdition(await temp("sensei-empty-"))).toBeNull();
    expect(folderMismatchMessage("recruiter", "solo")).toBe("This folder belongs to JobSensei. Open it there, or choose another folder.");
    expect(folderMismatchMessage("solo", "solo")).toBeNull();
  });
});

describe("setup per edition", () => {
  it("lists no interview steps in the recruiter edition", async () => {
    const workspace = await temp("sensei-re-setup-");
    const input = { workspacePath: workspace, profile: null, settings: null, manifest: null, contextFileCount: 0, agy: { installed: true, signedIn: true } };
    const ids = (await computeReadiness({ ...input, features: recruiter })).items.map((item) => item.id);
    expect(ids).not.toContain("logistics");
    expect(ids).not.toContain("story-bank");
    const soloIds = (await computeReadiness({ ...input, features: solo })).items.map((item) => item.id);
    expect(soloIds).toEqual(expect.arrayContaining(["logistics", "story-bank"]));
  });
});
