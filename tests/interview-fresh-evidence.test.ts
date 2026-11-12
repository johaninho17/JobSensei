// Interview prep tells current facts: when the career files change after a job's application snapshot, prep builds a
// fresh snapshot under interviews/.sensei and leaves the application's own files as they were.
import { cp, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContextManifest } from "../electron/context";
import { createEvidenceSnapshot } from "../electron/evidence-snapshot";
import { INTERVIEW_SNAPSHOT_DIR, interviewEvidence } from "../electron/interview-context";

async function demo(): Promise<{ root: string; jobId: string }> {
  const root = await mkdtemp(join(tmpdir(), "sensei-fresh-"));
  await cp(join(__dirname, "..", "examples", "demo-workspace"), root, { recursive: true });
  await buildContextManifest(root, {}, { baseResumePath: "resumes/Alex_Morgan_Resume.md", secondaryResumePaths: [], linkedinProfilePath: null });
  return { root, jobId: "plaid-integrations-operations-engineer" };
}

describe("fresh evidence for interview prep", () => {
  it("uses the application's snapshot while it is current, and a fresh one after the career files change", async () => {
    const { root, jobId } = await demo();
    const appSnapshot = join(root, "jobs", jobId, ".sensei", "evidence_snapshot.json");
    await createEvidenceSnapshot(root, jobId);
    const before = await readFile(appSnapshot);
    const current = await interviewEvidence(root, jobId);
    expect(current?.evidenceRows.length).toBeGreaterThan(0);
    expect(await stat(join(root, "jobs", jobId, INTERVIEW_SNAPSHOT_DIR, "evidence_snapshot.json")).catch(() => null)).toBeNull();

    // The candidate adds a dated record after the application was drafted.
    const record = join(root, "context", "structured", "meridian.md");
    const text = await readFile(record, "utf8");
    await writeFile(record, text.replace("## Evidence Inventory", "## Evidence Inventory").replace(/(\| --- \|[^\n]*\n)/, "$1| context:meridian:new-onboarding | 2026 | Partner onboarding | Onboarded a new partner end to end. | Fictional test row. | Test | high | eligible |\n"));
    const later = new Date(Date.now() + 60_000);
    await utimes(record, later, later);

    const fresh = await interviewEvidence(root, jobId);
    expect(fresh?.evidenceRows.some((row) => row.evidenceId === "context:meridian:new-onboarding")).toBe(true);
    expect(await stat(join(root, "jobs", jobId, INTERVIEW_SNAPSHOT_DIR, "evidence_snapshot.json"))).toBeTruthy();
    // The application's snapshot is untouched.
    expect((await readFile(appSnapshot)).equals(before)).toBe(true);
  });
});
