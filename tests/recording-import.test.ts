// #16: recordings, debrief notes, and practice transcripts added from the app land in the right folder and show as new.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importRecordings } from "../electron/recording-import";
import { scanRecordings } from "../electron/content-refresh";
import { isRecordingPath, recordingFolder, waitingToImport } from "../src/shared/recordings";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sensei-rec-"));
  const outside = await mkdtemp(join(tmpdir(), "sensei-rec-src-"));
  await mkdir(join(root, "jobs", "northstar-solutions-engineer"), { recursive: true });
  const transcript = join(outside, "recruiter-call.txt");
  const mock = join(outside, "mock-1.md");
  await writeFile(transcript, "Interviewer: Tell me about a customer launch.\nAlex: ...\n");
  await writeFile(mock, "AI interviewer: Walk me through an onboarding.\nAlex: ...\n");
  return { root, transcript, mock, outside };
}

describe("adding recordings from the app (#16)", () => {
  it("puts a real interview under its job and a practice interview in mock-interviews", () => {
    expect(recordingFolder("interview", "northstar-solutions-engineer")).toBe("debrief/northstar-solutions-engineer");
    expect(recordingFolder("interview", null)).toBe("debrief/other");
    expect(recordingFolder("interview", "../escape")).toBe("debrief/other");
    expect(recordingFolder("practice", "northstar-solutions-engineer")).toBe("debrief/mock-interviews");
  });

  it("copies the files, which the scan lists as new and matched to the job", async () => {
    const { root, transcript, mock } = await setup();
    expect((await importRecordings(root, [transcript], "interview", "northstar-solutions-engineer")).added).toEqual(["debrief/northstar-solutions-engineer/recruiter-call.txt"]);
    expect((await importRecordings(root, [mock], "practice", null)).added).toEqual(["debrief/mock-interviews/mock-1.md"]);
    const waiting = waitingToImport(await scanRecordings(root, ["northstar-solutions-engineer"]));
    expect(waiting.map((recording) => [recording.path, recording.jobId])).toEqual([
      ["debrief/mock-interviews/mock-1.md", null],
      ["debrief/northstar-solutions-engineer/recruiter-call.txt", "northstar-solutions-engineer"],
    ]);
    expect(await readFile(transcript, "utf8")).toContain("Tell me about");
  });

  it("skips a second copy of the same file and unreadable types", async () => {
    const { root, transcript, outside } = await setup();
    await importRecordings(root, [transcript], "interview", null);
    const again = await importRecordings(root, [transcript], "interview", null);
    expect(again.skipped[0]?.reason).toMatch(/already added/);
    const audio = join(outside, "call.m4a");
    await writeFile(audio, "x");
    expect((await importRecordings(root, [audio], "interview", null)).skipped[0]?.reason).toMatch(/not a readable type/);
  });

  it("knows which changed paths are recordings, in either folder layout", () => {
    expect(isRecordingPath("debrief/northstar/call.txt")).toBe(true);
    expect(isRecordingPath("interviews/recordings/northstar/call.txt")).toBe(true);
    expect(isRecordingPath("debrief/interview-memory/solutions.md")).toBe(false);
    expect(isRecordingPath("jobs/northstar/original_jd.md")).toBe(false);
  });
});

describe("recordings waiting to import (#9)", () => {
  it("duplicates and skipped files never count as waiting", () => {
    expect(waitingToImport([{ state: "new" }, { state: "changed" }, { state: "duplicate" }, { state: "skipped" }, { state: "imported" }] as const)).toHaveLength(2);
  });
});
