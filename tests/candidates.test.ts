// Recruiter plan R1 (data layer): roster, folders, and the active candidate. Fictional candidates only.
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CANDIDATE_ID, candidateFolder, candidateIdFor } from "../src/shared/candidates";
import { activeCandidatePath, addCandidate, candidatePath, ensureRecruiterRoot, readRecruiterSettings, readRoster, renameCandidate, setActiveCandidate, setCandidateStatus } from "../electron/candidates";

const temps: string[] = [];
async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sensei-recruiter-"));
  temps.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const exists = (path: string) => stat(path).then(() => true, () => false);

describe("candidate ids", () => {
  it("makes a readable id with a suffix, never a bare name", () => {
    expect(candidateIdFor("Alex Morgan", "7k2f")).toBe("alex-morgan-7k2f");
    expect(candidateIdFor("  Zoë O'Brien-Lee ", "a1b2")).toBe("zoe-o-brien-lee-a1b2");
    expect(candidateIdFor("李明", "zz99")).toBe("candidate-zz99");
    expect(CANDIDATE_ID.test("alex-morgan")).toBe(false);
  });

  it("refuses ids that could leave the candidates folder", () => {
    expect(candidateFolder("alex-morgan-7k2f")).toBe("candidates/alex-morgan-7k2f");
    for (const bad of ["../alex-7k2f", "alex/../../x-7k2f", "Alex-7K2F", ""]) expect(() => candidateFolder(bad)).toThrow();
  });
});

describe("candidate roster", () => {
  it("creates the recruiter layout once and keeps what is there", async () => {
    const dir = await root();
    await ensureRecruiterRoot(dir);
    await addCandidate(dir, "Alex Morgan", { suffix: "7k2f", seed: false });
    await ensureRecruiterRoot(dir);
    expect((await readRoster(dir)).candidates.map((candidate) => candidate.id)).toEqual(["alex-morgan-7k2f"]);
  });

  it("gives every candidate their own workspace folder, seeded for the recruiter edition", async () => {
    const dir = await root();
    const alex = await addCandidate(dir, "Alex Morgan", { suffix: "7k2f" });
    const folder = join(dir, "candidates", alex.id);
    for (const name of ["profile", "resumes", "context", "jobs"]) expect(await exists(join(folder, name)), name).toBe(true);
    expect(await exists(join(folder, "debrief"))).toBe(false);
    const skills = await readdir(join(folder, ".agents", "skills"));
    expect(skills).toContain("jobsensei-resume-tailor");
    expect(skills).not.toContain("jobsensei-interview-pipeline");
    expect(await readFile(join(folder, "AGENTS.md"), "utf8")).not.toContain("## Interview flow");
  });

  it("keeps two candidates with the same name apart", async () => {
    const dir = await root();
    const first = await addCandidate(dir, "Jordan Lee", { suffix: "aaaa", seed: false });
    const second = await addCandidate(dir, "Jordan Lee", { suffix: "aaaa", seed: false });
    expect(first.id).not.toBe(second.id);
    expect((await readRoster(dir)).candidates).toHaveLength(2);
  });

  it("renames without moving the folder", async () => {
    const dir = await root();
    const alex = await addCandidate(dir, "Alex Morgan", { suffix: "7k2f", seed: false });
    const renamed = await renameCandidate(dir, alex.id, "Alex Morgan-Reyes");
    expect(renamed).toMatchObject({ id: "alex-morgan-7k2f", displayName: "Alex Morgan-Reyes" });
    expect(await candidatePath(dir, alex.id)).toBe(join(dir, "candidates", "alex-morgan-7k2f"));
  });

  it("refuses an empty name and candidates that aren't on the list", async () => {
    const dir = await root();
    await expect(addCandidate(dir, "   ", { seed: false })).rejects.toThrow("Enter the candidate's name.");
    await expect(candidatePath(dir, "nobody-here-0000")).rejects.toThrow("isn't on the list");
  });
});

describe("active candidate", () => {
  it("switches between candidates and remembers the last one used", async () => {
    const dir = await root();
    const alex = await addCandidate(dir, "Alex Morgan", { suffix: "7k2f", seed: false });
    const jordan = await addCandidate(dir, "Jordan Lee", { suffix: "q9w3", seed: false });
    expect(await activeCandidatePath(dir)).toBeNull();
    expect(await setActiveCandidate(dir, alex.id)).toBe(join(dir, "candidates", alex.id));
    expect(await setActiveCandidate(dir, jordan.id)).toBe(join(dir, "candidates", jordan.id));
    expect(await activeCandidatePath(dir)).toBe(join(dir, "candidates", jordan.id));
    expect((await readRecruiterSettings(dir)).activeCandidateId).toBe(jordan.id);
    expect((await readRoster(dir)).candidates.find((candidate) => candidate.id === jordan.id)?.lastUsedAt).not.toBeNull();
  });

  it("never leaves an archived candidate active and refuses to open one", async () => {
    const dir = await root();
    const alex = await addCandidate(dir, "Alex Morgan", { suffix: "7k2f", seed: false });
    await setActiveCandidate(dir, alex.id);
    await setCandidateStatus(dir, alex.id, "archived");
    expect(await activeCandidatePath(dir)).toBeNull();
    await expect(setActiveCandidate(dir, alex.id)).rejects.toThrow("Alex Morgan is archived");
    await setCandidateStatus(dir, alex.id, "active");
    expect(await setActiveCandidate(dir, alex.id)).toBe(join(dir, "candidates", alex.id));
  });
});

describe("one Agy home, history kept per candidate (recruiter plan R2, 2026-11-11)", () => {
  async function home() {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const userData = await root();
    const cli = join(userData, "agy-home", ".gemini", "antigravity-cli");
    await mkdir(join(cli, "conversations"), { recursive: true });
    await writeFile(join(cli, "settings.json"), "{\"shared\":true}");
    await writeFile(join(cli, "antigravity-oauth-token"), "shared sign-in");
    return { userData, cli, writeFile, mkdir };
  }

  it("swaps each candidate's conversations and memory in and out; sign-in and settings stay shared", async () => {
    const { useCandidateHistory } = await import("../electron/agy-home");
    const { userData, cli, writeFile, mkdir } = await home();
    await useCandidateHistory(userData, "alex-morgan-7k2f");
    await mkdir(join(cli, "conversations"), { recursive: true });
    await writeFile(join(cli, "conversations", "alex.pb"), "Alex's run");
    await mkdir(join(cli, "brain"), { recursive: true });
    await writeFile(join(cli, "brain", "memory.md"), "Alex's memory");
    await writeFile(join(cli, "history.jsonl"), "alex prompts");
    // Found live: the cache keeps conversation titles and first prompts, and the logs keep prompts.
    await mkdir(join(cli, "cache"), { recursive: true });
    await writeFile(join(cli, "cache", "conversation_metadata.json"), "alex first prompt");
    await writeFile(join(cli, "cache", "onboarding.json"), "first run done");
    await mkdir(join(cli, "log"), { recursive: true });
    await writeFile(join(cli, "log", "cli-1.log"), "alex prompt");
    await writeFile(join(cli, "cli.log"), "alex prompt");
    await useCandidateHistory(userData, "jordan-lee-q9w3");
    expect(await readFile(join(cli, "cache", "onboarding.json"), "utf8")).toBe("first run done");
    for (const path of ["cache/conversation_metadata.json", "log", "cli.log"]) expect(await exists(join(cli, path))).toBe(false);
    expect(await exists(join(cli, "conversations", "alex.pb"))).toBe(false);
    expect(await exists(join(cli, "brain"))).toBe(false);
    expect(await exists(join(cli, "history.jsonl"))).toBe(false);
    expect(await readFile(join(cli, "antigravity-oauth-token"), "utf8")).toBe("shared sign-in");
    expect(await readFile(join(cli, "settings.json"), "utf8")).toBe("{\"shared\":true}");
    await mkdir(join(cli, "conversations"), { recursive: true });
    await writeFile(join(cli, "conversations", "jordan.pb"), "Jordan's run");
    await useCandidateHistory(userData, "alex-morgan-7k2f");
    expect(await readFile(join(cli, "conversations", "alex.pb"), "utf8")).toBe("Alex's run");
    expect(await exists(join(cli, "conversations", "jordan.pb"))).toBe(false);
    expect(await readFile(join(cli, "brain", "memory.md"), "utf8")).toBe("Alex's memory");
    expect(await readFile(join(userData, "agy-history", "jordan-lee-q9w3", "antigravity-cli", "conversations", "jordan.pb"), "utf8")).toBe("Jordan's run");
  });

  it("sets aside history with no owner instead of giving it to a candidate", async () => {
    const { useCandidateHistory } = await import("../electron/agy-home");
    const { userData, cli, writeFile } = await home();
    await writeFile(join(cli, "conversations", "old.pb"), "earlier history");
    await useCandidateHistory(userData, "alex-morgan-7k2f");
    expect(await exists(join(cli, "conversations", "old.pb"))).toBe(false);
    expect(await exists(join(userData, "agy-history", "_unowned", "antigravity-cli", "conversations", "old.pb"))).toBe(true);
  });

  it("removes a deleted candidate's history, in the store and in the shared home", async () => {
    const { removeCandidateHistory, useCandidateHistory } = await import("../electron/agy-home");
    const { userData, cli, writeFile, mkdir } = await home();
    await useCandidateHistory(userData, "alex-morgan-7k2f");
    await mkdir(join(cli, "conversations"), { recursive: true });
    await writeFile(join(cli, "conversations", "alex.pb"), "Alex's run");
    await removeCandidateHistory(userData, "alex-morgan-7k2f");
    expect(await exists(join(cli, "conversations", "alex.pb"))).toBe(false);
    expect(await readFile(join(cli, "antigravity-oauth-token"), "utf8")).toBe("shared sign-in");
    await mkdir(join(userData, "agy-history", "jordan-lee-q9w3"), { recursive: true });
    await removeCandidateHistory(userData, "jordan-lee-q9w3");
    expect(await exists(join(userData, "agy-history", "jordan-lee-q9w3"))).toBe(false);
    await expect(removeCandidateHistory(userData, "../x")).rejects.toThrow();
  });

  it("denies Agy's file tools the stored histories", async () => {
    const { prepareAgyHome } = await import("../electron/agy-home");
    const userData = await root();
    const { mkdir } = await import("node:fs/promises");
    const workspace = join(await root(), "candidates", "alex-morgan-7k2f");
    await mkdir(workspace, { recursive: true });
    const agyHome = await prepareAgyHome(userData, workspace, [], undefined, "alex-morgan-7k2f");
    expect(agyHome).toBe(join(userData, "agy-home"));
    const settings = JSON.parse(await readFile(join(agyHome, ".gemini", "antigravity-cli", "settings.json"), "utf8").catch(() => "{}"));
    expect(settings.permissions?.deny ?? []).toEqual(expect.arrayContaining([`read_file(${join(userData, "agy-history")})`]));
  });
});

describe("recruiter notes (recruiter plan R4)", () => {
  it("saves notes as a context file Agy reads, and reads back only what the recruiter wrote", async () => {
    const { readRecruiterNotes, saveRecruiterNotes, RECRUITER_NOTES_PATH } = await import("../electron/candidates");
    const dir = await root();
    expect(await readRecruiterNotes(dir)).toBe("");
    expect(await saveRecruiterNotes(dir, "- Uses Excel for weekly reports.\r\n")).toBe(RECRUITER_NOTES_PATH);
    expect(await readFile(join(dir, "context", "structured", "recruiter-notes.md"), "utf8")).toBe("# Recruiter notes\n\n- source_role: recruiter-notes\n\n- Uses Excel for weekly reports.\n");
    expect(await readRecruiterNotes(dir)).toBe("- Uses Excel for weekly reports.\n");
    await expect(saveRecruiterNotes(dir, "x".repeat(50_001))).rejects.toThrow("50,000");
  });
});

describe("export and delete (recruiter plan R6)", () => {
  it("exports a candidate's folder as a .zip that lists every file", async () => {
    const { zipFolder } = await import("../electron/zip-folder");
    const { writeFile, mkdir } = await import("node:fs/promises");
    const dir = await root();
    const alex = await addCandidate(dir, "Alex Morgan", { suffix: "7k2f", seed: false });
    const folder = join(dir, "candidates", alex.id);
    await mkdir(join(folder, "resumes"), { recursive: true });
    await writeFile(join(folder, "resumes", "base.md"), "# Alex Morgan\n- Supported REST API integrations.\n");
    const target = join(dir, "alex.zip");
    const count = await zipFolder(folder, target, "Alex_Morgan");
    const zip = await readFile(target);
    expect(count).toBeGreaterThan(0);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from("Alex_Morgan/resumes/base.md"))).toBe(true);
    const end = zip.subarray(zip.length - 22);
    expect(end.readUInt32LE(0)).toBe(0x06054b50);
    expect(end.readUInt16LE(10)).toBe(count);
    const { execFileSync } = await import("node:child_process");
    if (process.platform !== "win32") expect(execFileSync("unzip", ["-p", target, "Alex_Morgan/resumes/base.md"]).toString()).toContain("REST API");
  });

  it("deletes a candidate's folder and list entry, leaving the other candidate alone", async () => {
    const { deleteCandidate } = await import("../electron/candidates");
    const dir = await root();
    const alex = await addCandidate(dir, "Alex Morgan", { suffix: "7k2f", seed: false });
    const jordan = await addCandidate(dir, "Jordan Lee", { suffix: "q9w3", seed: false });
    await setActiveCandidate(dir, alex.id);
    const result = await deleteCandidate(dir, alex.id);
    expect(result.name).toBe("Alex Morgan");
    expect(await exists(join(dir, "candidates", alex.id))).toBe(false);
    expect((await readRoster(dir)).candidates.map((candidate) => candidate.id)).toEqual([jordan.id]);
    expect(await activeCandidatePath(dir)).toBeNull();
    const leftovers = JSON.stringify([await readFile(join(dir, "recruiter", "candidates.json"), "utf8"), await readFile(join(dir, "recruiter", "settings.json"), "utf8")]);
    expect(leftovers).not.toContain("Alex");
    expect(await exists(join(dir, "candidates", jordan.id))).toBe(true);
  });
});

describe("Agy home preparations run one at a time (found live 2026-11-11)", () => {
  it("two candidates prepared at once each end with a consistent owner and no lost history", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { prepareAgyHome } = await import("../electron/agy-home");
    const userData = await root();
    const cli = join(userData, "agy-home", ".gemini", "antigravity-cli");
    const alex = join(userData, "agy-history", "alex-morgan-7k2f", "antigravity-cli");
    await mkdir(alex, { recursive: true });
    await writeFile(join(alex, "history.jsonl"), "alex prompts");
    const workspace = await root();
    await Promise.all([
      prepareAgyHome(userData, workspace, [], undefined, "alex-morgan-7k2f"),
      prepareAgyHome(userData, workspace, [], undefined, "jordan-lee-q9w3"),
      prepareAgyHome(userData, workspace, [], undefined, "alex-morgan-7k2f"),
    ]);
    expect((await readFile(join(cli, "jobsensei-history-owner"), "utf8")).trim()).toBe("alex-morgan-7k2f");
    expect(await readFile(join(cli, "history.jsonl"), "utf8")).toBe("alex prompts");
  });
});
