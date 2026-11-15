// #33: the Agy page lists panel and background runs together, newest first.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agyActivity } from "../electron/agy-activity";

const put = async (root: string, path: string, value: unknown) => { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), JSON.stringify(value)); };

describe("Agy activity (#33)", () => {
  it("reads every kind of run into one list with time, duration, result, and where to open it", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-activity-"));
    const job = "jobs/northstar-solutions-engineer/.sensei";
    await put(root, `${job}/job.json`, { company: "Northstar Labs", title: "Solutions Engineer" });
    await put(root, `${job}/run_timing.json`, { startedAt: "2026-11-14T10:00:00.000Z", finalizedAt: "2026-11-14T10:01:20.000Z", durationSeconds: 80 });
    await put(root, `${job}/validation_report.json`, { status: "passed", issues: [{ severity: "warning" }] });
    await put(root, `${job}/application_questions.json`, { status: "done", startedAt: "2026-11-14T10:00:30.000Z", finishedAt: "2026-11-14T10:01:40.000Z", durationSeconds: 70, answers: [{}, {}] });
    await put(root, "jobs/northstar-solutions-engineer/interviews/.sensei/run_timing_recruiter.json", { startedAt: "2026-11-14T12:00:00.000Z", checkedAt: "2026-11-14T12:03:00.000Z" });
    await put(root, "jobs/northstar-solutions-engineer/interviews/.sensei/check_recruiter.json", { status: "passed", durationSeconds: 180, issues: [] });
    await put(root, ".sensei/job-search/state.json", { runs: [{ id: "run-1", startedAt: "2026-11-14T08:00:00.000Z", finishedAt: "2026-11-14T08:01:15.000Z", status: "done", added: 4, source: "search", scheduled: true }] });
    await put(root, ".sensei/today-answers.json", { answers: [{ id: "a1", subject: "Looker", status: "filed", answeredAt: "2026-11-14T09:00:00.000Z", filedAt: "2026-11-14T09:01:00.000Z", filedTo: "context/structured/northstar.md" }] });
    await put(root, ".sensei/content-sources.json", { files: { "debrief/northstar/call.md": { status: "imported", importedAt: "2026-11-14T13:00:00.000Z" } } });

    const list = await agyActivity(root, { now: Date.parse("2026-11-14T14:00:00.000Z") });
    expect(list.map((entry) => [entry.kind, entry.where, entry.result])).toEqual([
      ["content", "panel", "passed"],
      ["interview", "panel", "passed"],
      ["answers", "background", "passed"],
      ["application", "panel", "warnings"],
      ["filing", "background", "passed"],
      ["search", "background", "passed"],
    ]);
    const application = list.find((entry) => entry.kind === "application")!;
    expect(application).toMatchObject({ label: "Application: Northstar Labs, Solutions Engineer", durationSeconds: 80, open: { jobId: "northstar-solutions-engineer", tab: "application" } });
    expect(list.find((entry) => entry.kind === "search")).toMatchObject({ label: "Job search (scheduled)", durationSeconds: 75, detail: "4 new", open: { page: "search-home" } });
    expect(list.find((entry) => entry.kind === "interview")?.open).toEqual({ jobId: "northstar-solutions-engineer", tab: "interview", roundId: "recruiter" });
  });

  it("shows a run that is still going as running, and an empty workspace as an empty list", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-activity-"));
    expect(await agyActivity(root)).toEqual([]);
    await put(root, "jobs/x/.sensei/run_timing.json", { startedAt: "2026-11-14T10:00:00.000Z" });
    expect((await agyActivity(root, { now: Date.parse("2026-11-14T10:05:00.000Z") }))[0]?.result).toBe("running");
    expect((await agyActivity(root, { now: Date.parse("2026-11-14T11:00:00.000Z") }))[0]?.result).toBe("failed");
  });
});
