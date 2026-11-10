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

describe("Agy home per candidate (recruiter plan R2)", () => {
  it("gives each candidate their own home and refuses names that could leave it", async () => {
    const { candidateAgyHomePath } = await import("../electron/agy-home");
    expect(candidateAgyHomePath("/data", "alex-morgan-7k2f")).toBe(join("/data", "agy-home", "candidates", "alex-morgan-7k2f"));
    for (const bad of ["../x", "a/b", "Alex"]) expect(() => candidateAgyHomePath("/data", bad)).toThrow();
  });

  it("copies only the sign-in into a new candidate's home, never memory", async () => {
    const { shareSignIn } = await import("../electron/agy-home");
    const { mkdir, writeFile, utimes } = await import("node:fs/promises");
    const homes = join(await root(), "agy-home", "candidates");
    const token = (name: string) => join(homes, name, ".gemini", "antigravity-cli", "antigravity-oauth-token");
    for (const [name, text, age] of [["alex-morgan-7k2f", "old token", 100], ["jordan-lee-q9w3", "new token", 10]] as const) {
      await mkdir(join(homes, name, ".gemini", "antigravity-cli", "conversations"), { recursive: true });
      await writeFile(token(name), text);
      await writeFile(join(homes, name, ".gemini", "antigravity-cli", "conversations", "chat.pb"), `${name} memory`);
      const when = new Date(Date.now() - age * 1000);
      await utimes(token(name), when, when);
    }
    const fresh = join(homes, "sam-rivera-a1b2");
    expect(await shareSignIn(fresh)).toBe(true);
    expect(await readFile(token("sam-rivera-a1b2"), "utf8")).toBe("new token");
    expect(await exists(join(fresh, ".gemini", "antigravity-cli", "conversations"))).toBe(false);
    expect(await shareSignIn(fresh)).toBe(false); // already signed in: left alone
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

  it("deletes a candidate's folder, Agy home, and list entry, and never follows the keychain link out of the home", async () => {
    const { deleteCandidate } = await import("../electron/candidates");
    const { mkdir, writeFile, symlink } = await import("node:fs/promises");
    const dir = await root();
    const alex = await addCandidate(dir, "Alex Morgan", { suffix: "7k2f", seed: false });
    const jordan = await addCandidate(dir, "Jordan Lee", { suffix: "q9w3", seed: false });
    await setActiveCandidate(dir, alex.id);
    const outside = join(dir, "keychains");
    await mkdir(outside);
    await writeFile(join(outside, "login.keychain-db"), "keep me");
    const home = join(dir, "user-data", "agy-home", "candidates", alex.id);
    await mkdir(join(home, "Library"), { recursive: true });
    await symlink(outside, join(home, "Library", "Keychains"), "dir");
    const result = await deleteCandidate(dir, alex.id, home);
    expect(result.name).toBe("Alex Morgan");
    expect(await exists(join(dir, "candidates", alex.id))).toBe(false);
    expect(await exists(home)).toBe(false);
    expect(await readFile(join(outside, "login.keychain-db"), "utf8")).toBe("keep me");
    expect((await readRoster(dir)).candidates.map((candidate) => candidate.id)).toEqual([jordan.id]);
    expect(await activeCandidatePath(dir)).toBeNull();
    const leftovers = JSON.stringify([await readFile(join(dir, "recruiter", "candidates.json"), "utf8"), await readFile(join(dir, "recruiter", "settings.json"), "utf8")]);
    expect(leftovers).not.toContain("Alex");
    expect(await exists(join(dir, "candidates", jordan.id))).toBe(true);
  });
});
