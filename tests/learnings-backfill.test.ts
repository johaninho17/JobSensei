import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backfillPlanSchema, mergeBackfill, runBackfill } from "../electron/interview-backfill";
import { computeLearnings, furthestRecordedStage } from "../src/shared/learnings";
import { jobFolderSummarySchema, jobTrackerSchema, type JobFolderSummary } from "../src/shared/schemas";

const job = (id: string, extra: Record<string, unknown>): JobFolderSummary => jobFolderSummarySchema.parse({
  id, relativePath: `jobs/${id}`, name: id, company: id, createdAt: "2026-10-01T00:00:00.000Z", modifiedAt: "2026-10-01T00:00:00.000Z", artifactCount: 3, hasApplicationMaterials: true, hasPdfs: true, ...extra,
});

describe("backfill merge", () => {
  it("adds interviews without duplicates, fills the outcome, and keeps the user's reason and status", () => {
    const current = jobTrackerSchema.parse({ status: "rejected", interviews: [{ round: "recruiter", date: "2026-09-24" }], outcome: { stageReached: "recruiter", result: "rejected", reason: "my own words" } });
    const [entry] = backfillPlanSchema.parse([{ jobId: "northstar", interviews: [{ round: "recruiter", date: "2026-09-24", source: "recording" }, { round: "hiring_manager", date: "2026-10-01", source: "recording" }], outcome: { result: "rejected", reason: "from the plan" } }]);
    const { tracker, changes } = mergeBackfill(current, entry!);
    expect(tracker.status).toBe("rejected");
    expect(tracker.interviews.map((event) => event.round)).toEqual(["recruiter", "hiring_manager"]);
    expect(tracker.outcome).toEqual({ stageReached: "hiring_manager", result: "rejected", reason: "my own words", date: null });
    expect(changes).toEqual(["add hiring_manager interview on 2026-10-01 (recording)", 'outcome: reached hiring_manager, rejected, "my own words"']);
    expect(mergeBackfill(tracker, entry!).changes).toEqual([]);
  });

  it("leaves a job alone when the plan has nothing confirmed for it", () => {
    const [entry] = backfillPlanSchema.parse([{ jobId: "northstar" }]);
    expect(mergeBackfill(null, entry!).changes).toEqual([]);
  });
});

describe("backfill command", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("dry-runs by default, then writes trackers and creates a reconstructed job folder with --apply", async () => {
    dir = await mkdtemp(join(tmpdir(), "backfill-"));
    await mkdir(join(dir, "jobs", "northstar"), { recursive: true });
    const plan = backfillPlanSchema.parse([
      { jobId: "northstar", interviews: [{ round: "recruiter", date: "2026-09-03", source: "recording" }], outcome: { result: "rejected" } },
      { jobId: "missing-job", interviews: [{ round: "recruiter" }] },
      { jobId: "orbit-fde", interviews: [{ round: "recruiter", date: "2026-07-29", source: "recording" }], outcome: { result: "no_reply" }, createJob: { company: "Orbit", title: "Forward Deployed Engineer", posting: "An enterprise automation startup." } },
    ]);
    const dry = await runBackfill(dir, plan, false);
    expect(dry[1]).toMatch(/no job folder/);
    await expect(stat(join(dir, "jobs", "northstar", ".sensei", "tracker.json"))).rejects.toThrow();
    await runBackfill(dir, plan, true);
    const tracker = JSON.parse(await readFile(join(dir, "jobs", "northstar", ".sensei", "tracker.json"), "utf8"));
    expect(tracker).toMatchObject({ status: "rejected", outcome: { stageReached: "recruiter", result: "rejected" } });
    expect(await readFile(join(dir, "jobs", "orbit-fde", "original_jd.md"), "utf8")).toMatch(/^# Forward Deployed Engineer\n\n\*\*Company:\*\* Orbit/);
    expect(JSON.parse(await readFile(join(dir, "jobs", "orbit-fde", ".sensei", "tracker.json"), "utf8")).status).toBe("rejected");
  });
});

describe("learnings", () => {
  const tracked = (status: string, interviews: Array<{ round: string }>, reason = "") => jobTrackerSchema.parse({ status, interviews, outcome: reason ? { result: "rejected", reason } : null, updatedAt: "2026-10-20T00:00:00.000Z" });
  const jobs = [
    job("a", { rating: 4.0, tracker: tracked("rejected", [{ round: "recruiter" }, { round: "hiring_manager" }], "wanted Kotlin"), role: { workMode: "remote", payRange: { min: 120000, max: 160000, currency: "USD", period: "year" } }, gapTerms: [] }),
    job("b", { rating: 3.5, tracker: tracked("rejected", [{ round: "recruiter" }]), role: { workMode: "hybrid" }, gapTerms: ["Kotlin"] }),
    job("c", { rating: 3.0, tracker: tracked("rejected", []), role: { workMode: "remote", payRange: { min: 90000, max: 110000, currency: "USD", period: "year" } }, gapTerms: ["Kotlin", "SQL"] }),
    job("d", { rating: 2.8, interviewRoundCount: 2, gapTerms: ["Kotlin"] }),
  ];

  it("counts only recorded interviews and reports prep without them", () => {
    const learn = computeLearnings(jobs);
    expect(learn).toMatchObject({ applied: 4, interviewed: 2, unrecorded: 1 });
    expect(learn.funnel.slice(0, 2)).toEqual([{ stage: "recruiter", count: 2 }, { stage: "hiring_manager", count: 1 }]);
    expect(learn.fitByStage).toEqual([{ stage: "none", jobs: 2, averageFit: 2.9 }, { stage: "recruiter", jobs: 1, averageFit: 3.5 }, { stage: "hiring_manager", jobs: 1, averageFit: 4.0 }]);
    expect(learn.bySetup).toContainEqual({ label: "Remote", applied: 2, interviewed: 1 });
    expect(learn.pay).toEqual({ interviewed: 140000, notInterviewed: 100000 });
    expect(learn.gapTerms[0]).toEqual({ term: "Kotlin", noInterview: 2, interviewed: 1 });
    expect(learn.reasons).toEqual([{ jobId: "a", company: "a", stage: "Hiring manager", result: "rejected", reason: "wanted Kotlin" }]);
    expect(furthestRecordedStage(jobs[3]!)).toBeNull();
  });
});
