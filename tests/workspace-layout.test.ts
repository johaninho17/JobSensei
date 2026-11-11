import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildContextManifest } from "../electron/context";
import { importContextFiles } from "../electron/context-import";
import { previewFile } from "../electron/files";
import { applyMigration, healStrayPaths, planMigration, undoMigration } from "../electron/layout-migration";
import { layoutVersion, logicalPath, workspaceFile } from "../electron/layout";
import { initializeWorkspace, syncWorkspaceAgentFiles } from "../electron/workspace-init";
import { LAYOUT_V2_RULES, agentTextForLayout, toDisk, toLogical } from "../src/shared/workspace-layout";

const made: string[] = [];
afterEach(async () => { await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function put(root: string, path: string, text: string) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), text);
}

/** Every file under the folder with its content hash (hidden app state left out). */
async function listing(root: string, folder = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.name === ".sensei" || entry.name === ".agents" || entry.name === "AGENTS.md") continue;
    if (entry.isDirectory()) Object.assign(out, await listing(root, path));
    else out[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
  }
  return out;
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sensei-layout-"));
  made.push(root);
  await put(root, "profile/candidate.json", "{}");
  await put(root, "profile/story_bank.md", "## S1 · Launch\n");
  await put(root, "profile/interview_voice.md", "# Voice\n");
  await put(root, "context/application_voice_profile.md", "- plain words\n");
  await put(root, "context/denylist.md", "# Never say\n");
  await put(root, "context/offer.pdf", "pdf");
  await put(root, "context/structured/northstar.md", "# Northstar work record\n");
  await put(root, "context/broad/northstar-copy.md", "# Northstar work record\n");
  await put(root, "context/broad/notes.md", "# Notes\n");
  await put(root, "debrief/northstar/recruiter.txt", "transcript one");
  await put(root, "debrief/northstar/recruiter (1).txt", "transcript one");
  await put(root, "debrief/interview-memory/role-index.json", "{\"roles\":[]}");
  await put(root, "resumes/base.md", "# Alex Morgan\n");
  await put(root, "jobs/northstar-support-engineer/original_jd.md", "# Support Engineer\n");
  await put(root, "screened-jobs/old/screen.json", "{}");
  await put(root, "run.paste-1.json", "{}");
  await mkdir(join(root, ".sensei"), { recursive: true });
  return root;
}

describe("workspace layout", () => {
  it("leaves the original layout exactly as it is", () => {
    for (const [logical] of LAYOUT_V2_RULES) expect(toDisk(logical, 1)).toBe(logical);
  });

  it("maps every rule both ways and is safe to apply twice", () => {
    for (const [logical, disk] of LAYOUT_V2_RULES) {
      expect(toDisk(logical, 2)).toBe(disk);
      expect(toLogical(disk, 2)).toBe(logical);
      expect(toDisk(disk, 2)).toBe(disk);
      expect(toLogical(logical, 2)).toBe(logical);
    }
    expect(toDisk("context/structured/company/acme.md", 2)).toBe("career/records/company/acme.md");
    expect(toDisk("context/offer.pdf", 2)).toBe("career/offer.pdf");
    expect(toDisk("debrief/northstar/call.txt", 2)).toBe("interviews/recordings/northstar/call.txt");
    expect(toLogical("interviews/memory/support.md", 2)).toBe("debrief/interview-memory/support.md");
    expect(toDisk("jobs/northstar-support-engineer/original_jd.md", 2)).toBe("jobs/northstar-support-engineer/original_jd.md");
    expect(toDisk("context/structured/", 2)).toBe("career/records/");
  });

  it("rewrites the paths in Agy's instructions and nothing else", () => {
    const text = "Read `data/context/structured/` and profile/story_bank.md. Save to debrief/interview-memory/x.md. Career context matters.";
    expect(agentTextForLayout(text, 1)).toBe(text);
    expect(agentTextForLayout(text, 2)).toBe("Read `data/career/records/` and profile/story-bank.md. Save to interviews/memory/x.md. Career context matters.");
  });

  it("leaves no original folder name in the Agy files a tidy workspace gets", async () => {
    const root = await workspace();
    await applyMigration(root);
    await syncWorkspaceAgentFiles(root, { sourceRoots: [join(__dirname, "..")] });
    const leftovers: string[] = [];
    async function scan(folder: string) {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.name === ".backups") continue;
        if (entry.isDirectory()) await scan(path);
        else if (entry.name.endsWith(".md") && /(?<![\w/.-])(?:data\/)?(?:context|debrief)\/|profile\/(?:story_bank|interview_voice)\.md/.test(await readFile(path, "utf8"))) leftovers.push(path);
      }
    }
    await scan(join(root, ".agents"));
    if (/(?<![\w/.-])(?:data\/)?(?:context|debrief)\/|profile\/story_bank\.md/.test(await readFile(join(root, "AGENTS.md"), "utf8"))) leftovers.push("AGENTS.md");
    expect(leftovers).toEqual([]);
    // A second sync changes nothing (no backup set every time the app starts).
    const again = await syncWorkspaceAgentFiles(root, { sourceRoots: [join(__dirname, "..")] });
    expect([...again.updated, ...again.added]).toEqual([]);
  });
});

describe("tidying a workspace", () => {
  it("previews without moving anything", async () => {
    const root = await workspace();
    const before = await listing(root);
    const plan = await planMigration(root);
    expect(await listing(root)).toEqual(before);
    expect(plan.version).toBe(1);
    expect(plan.conflicts).toEqual([]);
    const byFrom = Object.fromEntries(plan.moves.map((move) => [move.from, move.to]));
    expect(byFrom["context/structured"]).toBe("career/records");
    expect(byFrom["context/offer.pdf"]).toBe("career/offer.pdf");
    expect(byFrom["context/denylist.md"]).toBe("profile/private-names.md");
    expect(byFrom["debrief/northstar"]).toBe("interviews/recordings/northstar");
    expect(byFrom["context/broad/northstar-copy.md"]).toBe("archive/duplicates/context/broad/northstar-copy.md");
    expect(byFrom["debrief/northstar/recruiter (1).txt"]).toBe("archive/duplicates/debrief/northstar/recruiter (1).txt");
    expect(byFrom["screened-jobs"]).toBe("archive/screened-jobs");
    expect(byFrom["run.paste-1.json"]).toBe("archive/stray/run.paste-1.json");
    expect(Object.keys(byFrom).some((from) => from.startsWith("jobs") || from.startsWith("resumes"))).toBe(false);
  });

  it("keeps a copy that is the only one checked for Agy", async () => {
    const root = await workspace();
    await put(root, ".sensei/active-context.json", JSON.stringify({ selectedCareerPaths: ["context/broad/northstar-copy.md"] }));
    const plan = await planMigration(root);
    expect(plan.moves.some((move) => move.from === "context/broad/northstar-copy.md")).toBe(false);
    expect(plan.notes.join(" ")).toContain("only the copy is checked");
  });

  it("moves the folders, and the app still finds everything by its usual name", async () => {
    const root = await workspace();
    await applyMigration(root);
    expect(layoutVersion(root)).toBe(2);
    expect(await readFile(join(root, "career/records/northstar.md"), "utf8")).toContain("Northstar");
    expect(await readFile(join(root, "profile/story-bank.md"), "utf8")).toContain("S1");
    expect(await stat(join(root, "context")).catch(() => null)).toBeNull();
    expect(await stat(join(root, "debrief")).catch(() => null)).toBeNull();
    // Logical names keep working.
    expect((await previewFile(root, "profile/story_bank.md")).content).toContain("S1");
    expect((await previewFile(root, "context/application_voice_profile.md")).content).toContain("plain words");
    expect(workspaceFile(root, "debrief/interview-memory/role-index.json")).toBe(join(root, "interviews/memory/role-index.json"));
    expect(logicalPath(root, join(root, "career/notes/notes.md"))).toBe("context/broad/notes.md");
    const manifest = await buildContextManifest(root, { structuredPaths: ["context/structured"], broadPaths: ["context/broad"] });
    expect(manifest.selectedStructuredPaths).toEqual(["context/structured/northstar.md"]);
    expect(manifest.selectedBroadPaths).toEqual(["context/broad/notes.md"]);
    // New files land in the tidy folders and are named the usual way.
    const source = join(root, "..", `added-${Date.now()}.md`);
    made.push(source);
    await writeFile(source, "# Added\n");
    const added = await importContextFiles(root, [source], "structured");
    expect(added.added[0]).toMatch(/^context\/structured\/added-/);
    expect((await readdir(join(root, "career/records"))).length).toBe(2);
    await initializeWorkspace(root);
    expect(await stat(join(root, "context")).catch(() => null)).toBeNull();
  });

  it("undo puts every file back exactly", async () => {
    const root = await workspace();
    const before = await listing(root);
    await applyMigration(root);
    expect(await listing(root)).not.toEqual(before);
    const result = await undoMigration(root);
    expect(result.skipped).toEqual([]);
    expect(await listing(root)).toEqual(before);
    expect(layoutVersion(root)).toBe(1);
    for (const folder of ["career", "interviews", "archive"]) expect(await stat(join(root, folder)).catch(() => null)).toBeNull();
  });

  it("is safe to run twice and refuses when a target already exists", async () => {
    const root = await workspace();
    await applyMigration(root);
    const after = await listing(root);
    const again = await applyMigration(root);
    expect(again.version).toBe(2);
    expect(await listing(root)).toEqual(after);

    const blocked = await workspace();
    await put(blocked, "career/records/existing.md", "x");
    await expect(applyMigration(blocked)).rejects.toThrow(/can't be tidied yet/);
    expect(layoutVersion(blocked)).toBe(1);
  });

  it("brings home a file written to an old path in a tidy workspace", async () => {
    const root = await workspace();
    await applyMigration(root);
    await put(root, "context/structured/interview-stories.md", "# Stories\n");
    await put(root, "profile/story_bank.md", "old path, but the real file exists");
    const healed = await healStrayPaths(root);
    expect(healed.moved).toEqual(["career/records/interview-stories.md"]);
    expect(healed.left).toEqual(["profile/story_bank.md"]);
    expect(await readFile(join(root, "career/records/interview-stories.md"), "utf8")).toContain("Stories");
    expect(await stat(join(root, "context")).catch(() => null)).toBeNull();
  });
});
