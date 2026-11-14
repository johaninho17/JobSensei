import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanRecordings, skipRecordings } from "../electron/content-refresh";
import { buildTodayData } from "../electron/today";
import { waitingToImport } from "../src/shared/recordings";

const recordingInsight = (insights: Array<{ text: string }>) => insights.find((insight) => /interview recording/.test(insight.text))?.text ?? null;

describe("Today and Your content count new recordings the same way (#9)", () => {
  it("a new practice interview shows on Today with the same count as Your content, and leaves once skipped", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-today-rec-"));
    await mkdir(join(root, "debrief", "northstar"), { recursive: true });
    await writeFile(join(root, "debrief", "northstar", "mock-interview-1.md"), "Interviewer: Tell me about a time a customer launch slipped.\nAlex: ...\n");
    await writeFile(join(root, "debrief", "northstar", "mock-interview-2.md"), "Interviewer: Walk me through an onboarding.\nAlex: ...\n");

    const waiting = waitingToImport(await scanRecordings(root, []));
    expect(waiting).toHaveLength(2);
    const today = await buildTodayData(root, { jobs: [], profile: null, readiness: null });
    expect(recordingInsight(today.insights)).toMatch(/^2 new interview recordings aren't in your interview content yet/);

    await skipRecordings(root, waiting.map((recording) => recording.path));
    expect(waitingToImport(await scanRecordings(root, []))).toHaveLength(0);
    expect(recordingInsight((await buildTodayData(root, { jobs: [], profile: null, readiness: null })).insights)).toBeNull();
  });

  it("duplicates and skipped files never count as waiting", () => {
    expect(waitingToImport([{ state: "new" }, { state: "changed" }, { state: "duplicate" }, { state: "skipped" }, { state: "imported" }] as const)).toHaveLength(2);
  });
});
