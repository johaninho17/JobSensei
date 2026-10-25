import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { latestRun } from "../electron/run-status";

async function write(root: string, path: string, value: unknown, seconds: number) {
  const full = join(root, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, JSON.stringify(value));
  const at = new Date(Date.UTC(2026, 9, 25, 12, 0, seconds));
  await utimes(full, at, at);
}

describe("run status", () => {
  it("reports the newest run with its result and top issues", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-runs-"));
    await write(root, "jobs/northstar-analyst/.sensei/job.json", { company: "Northstar Labs", title: "Support Analyst" }, 0);
    await write(root, "jobs/northstar-analyst/.sensei/validation_report.json", { status: "passed", fitScore: 4.1, gateStatus: "accepted", issues: [{ severity: "warning", code: "COVER_LETTER_DENSE_PARAGRAPH", message: "Shorten paragraph 2." }] }, 5);
    await write(root, "jobs/northstar-analyst/.sensei/run_timing.json", { startedAt: "2026-10-25T11:59:00Z", finalizedAt: "2026-10-25T12:00:10Z", durationSeconds: 70 }, 10);
    const now = Date.UTC(2026, 9, 25, 13);
    expect(await latestRun(root, now)).toMatchObject({ kind: "application", jobId: "northstar-analyst", label: "Northstar Labs, Support Analyst", durationSeconds: 70, state: "warnings", fitScore: 4.1, issues: [{ code: "COVER_LETTER_DENSE_PARAGRAPH" }] });
    await write(root, "jobs/northstar-analyst/interviews/.sensei/run_timing_01-recruiter-screen.json", { startedAt: "2026-10-25T12:59:00Z" }, 20);
    expect(await latestRun(root, now)).toMatchObject({ kind: "interview", roundId: "01-recruiter-screen", state: "running" });
    await write(root, "jobs/northstar-analyst/interviews/.sensei/check_01-recruiter-screen.json", { status: "failed", durationSeconds: 95, issues: [{ severity: "error", code: "SCRIPTED_ANSWER", message: "Remove the script." }] }, 30);
    expect(await latestRun(root, now)).toMatchObject({ kind: "interview", state: "failed", durationSeconds: 95 });
  });

  it("returns null for an empty workspace", async () => {
    expect(await latestRun(await mkdtemp(join(tmpdir(), "sensei-runs-")))).toBeNull();
  });
});
