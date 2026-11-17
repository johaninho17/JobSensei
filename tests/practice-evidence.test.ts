// #18: practice (mock) interviews count as career evidence only when the candidate says so. Fictional candidate.
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContextManifest } from "../electron/context";
import { createEvidenceSnapshot, profileInstructionLines } from "../electron/evidence-snapshot";
import { startUpdate } from "../electron/content-refresh";
import { PRACTICE_NOT_EVIDENCE_LINE, fromPracticeInterview } from "../src/shared/practice-evidence";
import { candidateProfileSchema } from "../src/shared/schemas";

const profileJson = (practice: boolean | undefined) => JSON.stringify({ schemaVersion: 1, identity: { fullName: "Alex Morgan", artifactPrefix: "Alex_Morgan" }, sources: { baseResumePath: "resumes/base.md" }, career: {}, preferences: { resume: {}, coverLetter: {} }, truth: practice === undefined ? {} : { practiceInterviewsAsEvidence: practice }, updatedAt: "2026-11-10T00:00:00.000Z" });

async function workspace(practice: boolean | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sensei-practice-"));
  for (const dir of [".sensei", "context/structured", "resumes", "jobs/sample-role", "profile"]) await mkdir(join(root, dir), { recursive: true });
  await Promise.all([
    writeFile(join(root, "resumes", "base.md"), "# **ALEX MORGAN**\nalex@example.com\n\n## **PROFESSIONAL EXPERIENCE**\n### **Northstar Labs**\n*Solutions Engineer* | *2024 - Present*\n- Supported API integrations.\n- Documented integration setup.\n\n## **EDUCATION**\n### **Example University**\nBachelor of Science\n"),
    writeFile(join(root, "context", "denylist.md"), "# Career Claim Denylist\n"),
    writeFile(join(root, "context", "structured", "interview-stories.md"), "# Interview stories\n\n- source_role: candidate-confirmed-work-record\n\n| Evidence ID | Year | Project | Explicit claim | Scope note | Source locator | Confidence | Public use |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| context:interview-stories:real | 2025 | Northstar Labs | Led a customer onboarding for a logistics client. | Own account. | Recruiter interview, Northstar, 2026-10-02 | high | eligible |\n| context:interview-stories:mock | 2025 | Northstar Labs | Rebuilt a failing data sync for a partner. | Told in practice. | Mock interview (AI interviewer), 2026-11-01 | high | eligible |\n"),
    writeFile(join(root, "profile", "candidate.json"), profileJson(practice)),
    writeFile(join(root, "jobs", "sample-role", "job.json"), JSON.stringify({ company: "Sample", title: "Engineer" })),
    writeFile(join(root, "jobs", "sample-role", "original_jd.txt"), "Sample needs customer onboarding and data sync experience."),
  ]);
  await buildContextManifest(root, { structuredPaths: ["context/structured/interview-stories.md"], broadPaths: [], careerPaths: [], jobPaths: [], jobIds: [] }, { baseResumePath: "resumes/base.md", secondaryResumePaths: [], linkedinProfilePath: null });
  return root;
}

const rowIds = async (practice: boolean | undefined) => (await createEvidenceSnapshot(await workspace(practice), "sample-role")).evidenceRows.map((row) => row.evidenceId).filter((id) => id.startsWith("context:interview-stories")).sort();

describe("practice interviews as career evidence (#18)", () => {
  it("recognises rows recorded from practice interviews by their source", () => {
    expect(fromPracticeInterview({ sourceLocator: "Mock interview (AI interviewer), 2026-11-01" })).toBe(true);
    expect(fromPracticeInterview({ sourceLocator: "Practice round with a friend" })).toBe(true);
    expect(fromPracticeInterview({ sourceLocator: "Recruiter interview, Northstar, 2026-10-02" })).toBe(false);
  });
  it("counts them by default and leaves them out of the snapshot when turned off", async () => {
    expect(await rowIds(undefined)).toEqual(["context:interview-stories:mock", "context:interview-stories:real"]);
    expect(await rowIds(false)).toEqual(["context:interview-stories:real"]);
  });
  it("tells Agy when practice interviews are not evidence", () => {
    const profile = (practice: boolean) => candidateProfileSchema.parse(JSON.parse(profileJson(practice)));
    expect(profileInstructionLines(profile(false))).toContain(PRACTICE_NOT_EVIDENCE_LINE);
    expect(profileInstructionLines(profile(true))).not.toContain(PRACTICE_NOT_EVIDENCE_LINE);
  });
  it("the content update proposes no story rows from practice interviews when off", async () => {
    const root = await workspace(false);
    await mkdir(join(root, "debrief", "mock-interviews"), { recursive: true });
    await writeFile(join(root, "debrief", "mock-interviews", "mock-1.md"), "Interviewer: ...\n");
    const recordings = [{ path: "debrief/mock-interviews/mock-1.md", size: 16, state: "new" as const, duplicateOf: null, jobId: null }];
    const brief = () => readFile(join(root, ".sensei/content-update.md"), "utf8");
    await startUpdate(root, recordings, {}, new Date(), false);
    expect(await brief()).toMatch(/propose no interview-story rows/);
    // A practice interview belongs to no job: Agy is never asked which job it was.
    expect(await brief()).toMatch(/\(practice interview, no job/);
    expect(await brief()).not.toMatch(/ask me which job/);
    await startUpdate(root, recordings, {}, new Date(), true);
    expect(await brief()).not.toMatch(/propose no interview-story rows/);
  });
});
