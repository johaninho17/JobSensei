// #213: a debrief can be pasted in the app; a job is optional.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importRecordingText } from "../electron/recording-import";
import { scanRecordings } from "../electron/content-refresh";

describe("pasted debriefs (#213)", () => {
  it("saves pasted notes as a new recording, with or without a job", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-debrief-"));
    const now = new Date("2026-11-26T10:00:00Z");
    const result = await importRecordingText(root, "Recruiter asked about onboarding at Northstar Labs; I told the runbook story.", "interview", null, now);
    expect(result.added).toEqual(["2026-11-26-interview-notes.md"]);
    expect(await readFile(join(root, "debrief/other/2026-11-26-interview-notes.md"), "utf8")).toContain("I told the runbook story.");
    expect((await importRecordingText(root, "Another set of notes from the same day, long enough.", "interview", null, now)).added).toEqual(["2026-11-26-interview-notes-2.md"]);
    await importRecordingText(root, "Mock interview with a friend about pricing questions.", "practice", null, now);
    const found = await scanRecordings(root, []);
    expect(found.filter((recording) => recording.state === "new").map((recording) => recording.path).sort()).toEqual([
      "debrief/mock-interviews/2026-11-26-practice-notes.md", "debrief/other/2026-11-26-interview-notes-2.md", "debrief/other/2026-11-26-interview-notes.md",
    ]);
    await expect(importRecordingText(root, "short", "interview", null, now)).rejects.toThrow(/Paste/);
  });

  it("tells Agy an unlinked recording still counts and never to ask which job", async () => {
    const workflow = await readFile(".agents/workflows/jobsensei-interview-review.md", "utf8");
    expect(workflow).toContain("never ask which job it was");
    expect(await readFile("src/renderer/InterviewsHome.tsx", "utf8")).not.toContain("Agy will ask");
  });
});
