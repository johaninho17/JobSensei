import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentItems, finishUpdate, importedFromList, matchJob, readPendingUpdate, reviewChanges, scanRecordings, startUpdate, undoUpdate } from "../electron/content-refresh";

const STORIES = [
  "# Interview stories",
  "## Imported recordings",
  "- `debrief/northstar/recruiter.md` (recruiter, Oct 1): imported 2026-10-20",
  "",
  "## Evidence Inventory",
  "| Evidence ID | Claim |",
  "| --- | --- |",
  "| context:interview-stories:import-fix | Fixed a stalled customer import |",
].join("\n");
const BANK = [
  "# Story bank",
  "## S1 · Stalled import",
  "- Situation: a customer import kept failing (context:interview-stories:import-fix)",
  "- Result: customer live in two days",
  "",
  "## S2 · Guide for support",
  "- Wrote the troubleshooting guide the team still uses",
].join("\n");

describe("recording ledger", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  async function workspace() {
    dir = await mkdtemp(join(tmpdir(), "content-refresh-"));
    for (const folder of ["debrief/northstar", "debrief/orbit", "debrief/interview-memory", "context/structured", "profile"]) await mkdir(join(dir, folder), { recursive: true });
    await writeFile(join(dir, "context/structured/interview-stories.md"), STORIES);
    await writeFile(join(dir, "profile/story_bank.md"), BANK);
    await writeFile(join(dir, "debrief/northstar/recruiter.md"), "Recruiter: why are you looking?");
    await writeFile(join(dir, "debrief/northstar/hiring-manager.md"), "Manager: walk me through a project.");
    await writeFile(join(dir, "debrief/orbit/copy.md"), "Manager: walk me through a project.");
    await writeFile(join(dir, "debrief/interview-memory/notes.md"), "# Role memory");
    // The AI summary saved beside an imported transcript, at the same time, counts as imported too.
    await writeFile(join(dir, "debrief/northstar/recruiter-summary.txt"), "Summary of the recruiter call");
    const { utimes } = await import("node:fs/promises");
    const when = new Date("2026-10-01T10:00:00Z");
    await utimes(join(dir, "debrief/northstar/recruiter.md"), when, when);
    await utimes(join(dir, "debrief/northstar/recruiter-summary.txt"), when, when);
    return dir;
  }

  it("seeds from the old import list, finds new files, skips role memory, and flags exact copies", async () => {
    await workspace();
    expect(importedFromList(STORIES)).toEqual(["debrief/northstar/recruiter.md"]);
    const recordings = await scanRecordings(dir, ["northstar-support-engineer", "orbit-analyst", "orbit-analyst-2"]);
    expect(recordings.map((recording) => [recording.path, recording.state, recording.duplicateOf, recording.jobId])).toEqual([
      ["debrief/northstar/hiring-manager.md", "new", null, "northstar-support-engineer"],
      ["debrief/northstar/recruiter-summary.txt", "imported", null, "northstar-support-engineer"],
      ["debrief/northstar/recruiter.md", "imported", null, "northstar-support-engineer"],
      ["debrief/orbit/copy.md", "duplicate", "debrief/northstar/hiring-manager.md", null],
    ]);
  });

  it("a fuller version of an imported recording counts as changed", async () => {
    await workspace();
    await scanRecordings(dir);
    await writeFile(join(dir, "debrief/northstar/recruiter.md"), "Recruiter: why are you looking? Full transcript now.");
    expect((await scanRecordings(dir)).find((recording) => recording.path.endsWith("recruiter.md"))!.state).toBe("changed");
  });

  it("an update names only new files, backs up content, and marks them imported when finished", async () => {
    await workspace();
    const { prompt, update } = await startUpdate(dir, await scanRecordings(dir, ["northstar-support-engineer"]), { "northstar-support-engineer": "Northstar Labs, Support Engineer" });
    // The Console accepts one safe line of up to 500 characters: the details go in the brief file.
    expect(prompt).not.toMatch(/[\r\n]/);
    expect(prompt.length).toBeLessThanOrEqual(500);
    expect(prompt).toContain(".sensei/content-update.md");
    const brief = await readFile(join(dir, ".sensei/content-update.md"), "utf8");
    expect(brief).toContain("debrief/northstar/hiring-manager.md (job: northstar-support-engineer, Northstar Labs, Support Engineer)");
    expect(brief).not.toContain("recruiter.md");
    expect(brief).not.toContain("copy.md");
    expect(await readFile(join(dir, update.backup, "profile/story_bank.md"), "utf8")).toBe(BANK);
    // Agy adds a story but drops S2 without listing it: finishing puts S2 back.
    await writeFile(join(dir, "profile/story_bank.md"), BANK.split("\n## S2")[0] + "\n\n## S3 · New partner story\n- Partner unsure where the product fit\n");
    const { restored } = await finishUpdate(dir);
    expect(restored).toBe(1);
    const bank = await readFile(join(dir, "profile/story_bank.md"), "utf8");
    expect(bank).toContain("## S2 · Guide for support");
    expect(bank).toContain("## S3 · New partner story");
    expect(await readPendingUpdate(dir)).toBeNull();
    expect((await scanRecordings(dir)).find((recording) => recording.path.endsWith("hiring-manager.md"))!.state).toBe("imported");
  });

  it("undo puts every content file back and keeps the recordings new", async () => {
    await workspace();
    await startUpdate(dir, await scanRecordings(dir));
    await writeFile(join(dir, "profile/story_bank.md"), "# Story bank\n");
    await undoUpdate(dir);
    expect(await readFile(join(dir, "profile/story_bank.md"), "utf8")).toBe(BANK);
    expect((await scanRecordings(dir)).find((recording) => recording.path.endsWith("hiring-manager.md"))!.state).toBe("new");
  });
});

describe("change check", () => {
  const before = [...contentItems("profile/story_bank.md", BANK), ...contentItems("context/structured/interview-stories.md", STORIES)];

  it("accepts additions and upgrades", () => {
    const upgraded = BANK.replace("customer live in two days", "customer live in two days; the fix became the standard import check") + "\n\n## S3 · New\n- New story";
    const review = reviewChanges(before, contentItems("profile/story_bank.md", upgraded).concat(contentItems("context/structured/interview-stories.md", STORIES)), []);
    expect(review.added.map((item) => item.key)).toEqual(["S3"]);
    expect(review.upgraded.map((entry) => entry.before.key)).toEqual(["S1"]);
    expect(review.lost).toEqual([]);
  });

  it("treats a removal or a lost evidence ID as lost unless the change list names its replacement", () => {
    const weaker = BANK.replace(" (context:interview-stories:import-fix)", "").split("\n## S2")[0]!;
    const after = contentItems("profile/story_bank.md", weaker).concat(contentItems("context/structured/interview-stories.md", STORIES));
    expect(reviewChanges(before, after, []).lost.map((entry) => entry.before.key)).toEqual(["S1", "S2"]);
    const listed = reviewChanges(before, after, [{ file: "profile/story_bank.md", kind: "replaced", item: "S2", replacement: "S1", why: "the guide is now part of S1" }]);
    expect(listed.replaced.map((entry) => [entry.before.key, entry.replacement])).toEqual([["S2", "S1"]]);
    expect(listed.lost.map((entry) => entry.before.key)).toEqual(["S1"]);
  });
});

describe("job matching", () => {
  it("matches a recording's folder to exactly one job", () => {
    expect(matchJob("debrief/Northstar/call.md", ["northstar-support-engineer", "orbit-analyst"])).toBe("northstar-support-engineer");
    expect(matchJob("debrief/orbit/call.md", ["orbit-analyst", "orbit-analyst-2"])).toBeNull();
    expect(matchJob("debrief/review.md", ["review-lead"])).toBeNull();
  });
});
