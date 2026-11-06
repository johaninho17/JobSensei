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
