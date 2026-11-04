import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildJobRecord, JOB_RECORD_FILE, saveJobRecord, type JobRecordInput } from "../electron/job-record";
import { buildPostingRecord } from "../electron/posting-record";
import { updateJobTracker } from "../electron/tracker";
import { jobTrackerSchema } from "../src/shared/schemas";
import { reachedInterview } from "../src/shared/tracker";

const POSTING = [
  "# Support Engineer",
  "**Company:** Northstar Labs",
  "",
  "## Requirements",
  "- 3+ years supporting technical customers",
  "- Fluency in SQL",
  "- Experience with Kotlin services",
].join("\n");

const evaluation = (rows: string[]) => [
  "# Evaluation",
  "Gate status: YES",
  "### Requirement Scoring",
  "| Requirement | Category | Weight | Material | Classification | Evidence | Blocker |",
  "| --- | --- | ---: | --- | --- | --- | --- |",
  ...rows,
].join("\n");

const CURRENT = evaluation([
  "| req:1 3+ years supporting technical customers | core | 40% | yes | direct | context:work:a | |",
  "| req:2 Fluency in SQL | technical | 30% | yes | strong_transferable | context:work:b | |",
  "| req:3 Experience with Kotlin services | technical | 30% | yes | gap | | |",
]);

const input = (overrides: Partial<JobRecordInput> = {}): JobRecordInput => ({
  jobId: "northstar-support-engineer",
  posting: buildPostingRecord(POSTING),
  evaluation: CURRENT,
  rating: 3.6,
  decision: "YES",
  confidence: "medium",
  documents: { evaluation: true, resume: true, coverLetter: true, answers: false, pdfs: 0 },
  preparedRounds: 0,
  tracker: null,
  status: "applied",
  ...overrides,
});

describe("job record", () => {
  it("reads requirement rows, gaps, and the posting tools the evidence didn't cover", () => {
    const record = buildJobRecord(input());
    expect(record.fit).toMatchObject({ score: 3.6, byRequirement: true, matchesPosting: true });
    expect(record.requirements.map((row) => row.id)).toEqual(["req:1", "req:2", "req:3"]);
    expect(record.gaps).toEqual(["Experience with Kotlin services"]);
    expect(record.gapTerms).toEqual(["Kotlin"]);
    expect(record.posting).toMatchObject({ requiredCount: 3, tools: ["SQL", "Kotlin"], experience: "3+ years" });
    expect(record.health).toEqual({ posting: "complete", evaluation: "complete", documents: "complete", tracking: "not_needed", notes: [] });
  });

  it("marks older ratings: no requirement IDs, or rows that no longer match the posting", () => {
    const old = buildJobRecord(input({ evaluation: evaluation(["| Customer support | core | 100% | yes | direct | context:work:a | |"]) }));
    expect(old.health.evaluation).toBe("older");
    expect(old.health.notes[0]).toMatch(/older format/);
    const stale = buildJobRecord(input({ evaluation: evaluation(["| req:1 Acme is looking to hire a consultant | core | 100% | yes | direct | x | |", "| req:2 Consultants blend storytelling | core | 0% | yes | gap | | |"]) }));
    expect(stale.fit.matchesPosting).toBe(false);
    expect(stale.health.notes[0]).toMatch(/re-read since this rating/);
  });

  it("flags missing ratings and drafts, and skips drafts below the gate", () => {
    expect(buildJobRecord(input({ evaluation: "", rating: null, documents: { evaluation: false, resume: false, coverLetter: false, answers: false, pdfs: 0 } })).health)
      .toMatchObject({ evaluation: "missing", documents: "not_needed" });
    expect(buildJobRecord(input({ documents: { evaluation: true, resume: true, coverLetter: false, answers: false, pdfs: 0 } })).health.documents).toBe("partial");
    expect(buildJobRecord(input({ rating: 2.4, documents: { evaluation: true, resume: false, coverLetter: false, answers: false, pdfs: 0 } })).health.documents).toBe("not_needed");
  });

  it("asks for the real interviews and the reason when a job reached interviews (prep alone doesn't count)", () => {
    const prepOnly = buildJobRecord(input({ preparedRounds: 2, status: "rejected" }));
    expect(prepOnly.health.tracking).toBe("missing");
    const tracker = jobTrackerSchema.parse({ status: "rejected", interviews: [{ round: "recruiter" }, { round: "hiring_manager", date: "2026-10-01" }], outcome: { stageReached: "hiring_manager", result: "rejected", reason: "wanted deeper Kotlin" } });
    const done = buildJobRecord(input({ preparedRounds: 2, status: "rejected", tracker }));
    expect(done.interviews).toEqual({ preparedRounds: 2, recorded: 2, furthestRound: "hiring_manager" });
    expect(done.outcome).toEqual({ stageReached: "hiring_manager", result: "rejected", reason: "wanted deeper Kotlin" });
    expect(done.health.tracking).toBe("complete");
    expect(buildJobRecord(input({ status: "interviewing", preparedRounds: 1 })).health.tracking).toBe("missing");
  });
});

describe("job record file and tracker", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("is saved once and not rewritten when only the build time changes", async () => {
    dir = await mkdtemp(join(tmpdir(), "job-record-"));
    await saveJobRecord(dir, buildJobRecord(input(), new Date("2026-11-01T00:00:00Z")));
    const first = (await stat(join(dir, JOB_RECORD_FILE))).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await saveJobRecord(dir, buildJobRecord(input(), new Date("2026-11-02T00:00:00Z")));
    expect((await stat(join(dir, JOB_RECORD_FILE))).mtimeMs).toBe(first);
    expect(JSON.parse(await readFile(join(dir, JOB_RECORD_FILE), "utf8")).builtAt).toBe("2026-11-01T00:00:00.000Z");
  });

  it("stores interviews and the outcome in the tracker; a recorded interview counts as reaching interviews", async () => {
    dir = await mkdtemp(join(tmpdir(), "job-tracker-"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "jobs", "northstar"), { recursive: true });
    const tracker = await updateJobTracker(dir, "northstar", { status: "rejected", interviews: [{ round: "recruiter", date: "2026-10-02" }], outcome: { stageReached: "recruiter", result: "rejected", reason: "went with an internal hire" } });
    expect(tracker.interviews).toEqual([{ round: "recruiter", date: "2026-10-02", note: "", source: "user" }]);
    expect(tracker.outcome?.reason).toBe("went with an internal hire");
    expect(reachedInterview({ interviewRoundLabel: null, interviewRoundCount: 0, tracker })).toBe(true);
    await expect(updateJobTracker(dir, "northstar", { interviews: [{ round: "phone" }] })).rejects.toThrow();
  });
});
