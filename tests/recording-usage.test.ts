// #17: after a content update, each recording shows what it was used for.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHANGES_FILE, finishUpdate, scanRecordings, startUpdate } from "../electron/content-refresh";
import { usageByRecording, usedInText } from "../src/shared/recordings";

describe("what each recording was used for (#17)", () => {
  it("counts changes per recording and content area; unnamed changes are shared", () => {
    const usage = usageByRecording(["debrief/a/call.md", "debrief/b/mock.md"], [
      { file: "profile/story_bank.md", from: "debrief/a/call.md" },
      { file: "profile/interview_voice.md", from: "debrief/a/call.md" },
      { file: "profile/story_bank.md", from: "debrief/a/call.md" },
      { file: "debrief/interview-memory/solutions.md" },
    ]);
    expect(usedInText(usage["debrief/a/call.md"]!.usedIn)).toBe("Story bank (2), Interview voice (1), Role memory (1)");
    expect(usage["debrief/a/call.md"]!.shared).toBe(true);
    expect(usedInText(usage["debrief/b/mock.md"]!.usedIn)).toBe("Role memory (1)");
    expect(usedInText([])).toBe("Nothing taken from it");
  });

  it("a single-recording update owns every change; tidy-layout paths are understood", () => {
    const usage = usageByRecording(["debrief/a/call.md"], [{ file: "interviews/memory/solutions.md" }, { file: "career/records/interview-stories.md", from: "interviews/recordings/a/call.md" }], (path) => path.replace(/^interviews\/recordings\//, "debrief/"));
    expect(usage["debrief/a/call.md"]).toEqual({ usedIn: [{ area: "Role memory", count: 1 }, { area: "Interview stories", count: 1 }], shared: false });
  });

  it("finishing an update stores the usage, and the scan shows it on the imported recording", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-usage-"));
    await mkdir(join(root, "debrief", "northstar"), { recursive: true });
    await mkdir(join(root, "profile"), { recursive: true });
    await mkdir(join(root, ".sensei"), { recursive: true });
    await writeFile(join(root, "debrief", "northstar", "call.md"), "Interviewer: Tell me about a launch.\nAlex: ...\n");
    await writeFile(join(root, "profile", "story_bank.md"), "# Story bank\n");
    await startUpdate(root, await scanRecordings(root, []), {});
    await writeFile(join(root, "profile", "story_bank.md"), "# Story bank\n\n## S1 Launch that slipped\n- cue\n");
    await writeFile(join(root, CHANGES_FILE), JSON.stringify({ changes: [{ file: "profile/story_bank.md", kind: "added", item: "S1", from: "debrief/northstar/call.md" }] }));
    await finishUpdate(root);
    const recording = (await scanRecordings(root, [])).find((entry) => entry.path === "debrief/northstar/call.md")!;
    expect(recording.state).toBe("imported");
    expect(recording.usedIn).toEqual([{ area: "Story bank", count: 1 }]);
    expect(recording.importedAt).toBeTruthy();
  });
});
