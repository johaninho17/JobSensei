// Recruiter plan R8 P2: the review screen shows each resume line, whether it changed, and the evidence it cites.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { applicationReview } from "../electron/application-review";

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function job(compressed: boolean) {
  const root = await mkdtemp(join(tmpdir(), "sensei-review-"));
  temps.push(root);
  const state = join(root, "jobs", "northstar-support", ".sensei");
  await mkdir(state, { recursive: true });
  const ids = { runId: "run-1", snapshotId: "snap-1", baselineId: "base-1" };
  await writeFile(join(state, "application_draft.json"), JSON.stringify({ schemaVersion: 1, applicationRunId: ids.runId, evidenceSnapshotId: ids.snapshotId, canonicalBaselineId: ids.baselineId,
    resume: { skillsLines: ["**Tools:** Excel, Zendesk"], employers: [{ name: "Northstar Labs", bullets: ["Answered customer tickets about billing.", "Trained new support hires on the ticket queue."] }] }, coverLetter: null }));
  const mapping = (publicText: string, claimType: string, evidenceIds: string[]) => ({ publicText, claimType, evidenceIds, sourcePaths: [], timeline: null, ownership: "" });
  await writeFile(join(state, "application_evidence.json"), JSON.stringify({ schemaVersion: 1, applicationRunId: ids.runId, evidenceSnapshotId: ids.snapshotId, manifestHash: "m", baseResumePath: "resumes/base.md",
    resume: { publicArtifact: "Alex_Morgan_Northstar_Resume.md", claimMappings: [mapping("**Tools:** Excel, Zendesk", "baseline", []), mapping("Answered customer tickets about billing.", "baseline", []), mapping("Trained new support hires on the ticket queue.", "candidate", ["file:structured-recruiter-notes:1"])] },
    coverLetter: null, excludedClaims: [], warnings: [] }));
  const snapshot = JSON.stringify({ evidenceRows: [{ evidenceId: "file:structured-recruiter-notes:1", claim: "At Northstar Labs, Alex trained new support hires on the ticket queue.", sourcePath: "context/structured/recruiter-notes.md" }] });
  await writeFile(join(state, "evidence_snapshot.json"), compressed ? gzipSync(snapshot) : snapshot);
  return root;
}

describe("review before sending", () => {
  it.each([false, true])("marks changed lines with the evidence they cite (compressed snapshot: %s)", async (compressed) => {
    const review = await applicationReview(await job(compressed), "northstar-support");
    expect(review).toMatchObject({ resumeName: "Alex_Morgan_Northstar_Resume.md", changed: 1, total: 3, letter: false });
    const lines = review!.sections.flatMap((section) => section.lines);
    expect(lines.filter((line) => line.changed).map((line) => line.evidence)).toEqual([[{ id: "file:structured-recruiter-notes:1", text: "At Northstar Labs, Alex trained new support hires on the ticket queue.", source: "Recruiter notes" }]]);
    expect(review!.sections.map((section) => section.title)).toEqual(["Skills", "Northstar Labs"]);
  });

  it("returns nothing for a job without drafts, and refuses odd job IDs", async () => {
    const root = await job(false);
    expect(await applicationReview(root, "no-such-job")).toBeNull();
    await expect(applicationReview(root, "../x")).rejects.toThrow("invalid");
  });
});
