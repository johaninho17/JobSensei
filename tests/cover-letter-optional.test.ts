// Recruiter plan R7: cover letters on or off per candidate, written only with enough real material.
// Fictional candidate (Alex Morgan / Northstar Labs).
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { coverLetterPlan } from "../src/shared/cover-letter-policy";
import { buildContextManifest } from "../electron/context";
import { createEvidenceSnapshot } from "../electron/evidence-snapshot";
import { finalizeApplication } from "../electron/application-finalize";
import { readTextFile } from "../electron/persistence";

const edition = process.env.JOBSENSEI_EDITION;
afterEach(() => { if (edition === undefined) delete process.env.JOBSENSEI_EDITION; else process.env.JOBSENSEI_EDITION = edition; });
const exists = (path: string) => stat(path).then(() => true, () => false);
const base = { name: "Alex Morgan", transitionSummary: "From support to solutions work.", pillars: ["Moved toward customers.", "Stays calm when things break.", ""], hasVoice: true, careerFiles: 2 };

describe("cover letter plan (one owner)", () => {
  it("keeps the solo edition writing letters unless the user turns them off", () => {
    expect(coverLetterPlan({ ...base, enabled: null, optIn: false, careerFiles: 0, hasVoice: false, transitionSummary: "", pillars: [] })).toMatchObject({ write: true });
    expect(coverLetterPlan({ ...base, enabled: false, optIn: false })).toMatchObject({ write: false, off: true });
  });

  it("leaves letters off in the Recruiter Edition until turned on, with nothing to warn about", () => {
    expect(coverLetterPlan({ ...base, enabled: null, optIn: true })).toEqual({ write: false, off: true, missing: [], reason: "Cover letters are turned off for Alex Morgan." });
  });

  it("says exactly what's missing when a letter is on but there isn't enough material", () => {
    const plan = coverLetterPlan({ ...base, enabled: true, optIn: true, pillars: ["One answer."], hasVoice: false, careerFiles: 1 });
    expect(plan.write).toBe(false);
    expect(plan.reason).toBe("Add the career story (direction plus two of the three questions), a writing voice and 1 more checked career file (notes, another resume, or work records) to write letters for Alex Morgan.");
  });

  it("writes a letter when it's on and the material is there", () => {
    expect(coverLetterPlan({ ...base, enabled: true, optIn: true })).toMatchObject({ write: true, reason: null });
  });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sensei-letter-"));
  for (const dir of [".sensei", "context/structured", "resumes", "jobs/sample-role", "profile"]) await mkdir(join(root, dir), { recursive: true });
  const bullets = ["Supported API integrations.", "Documented integration setup.", "Tested SDK examples.", "Troubleshot authentication failures.", "Translated customer requirements.", "Coordinated implementation feedback.", "Built internal workflow tools.", "Reviewed data mappings.", "Added automated checks.", "Supported deployment validation."];
  await Promise.all([
    writeFile(join(root, "resumes", "base.md"), `# **ALEX MORGAN**\nalex@example.com\n\n## **SKILLS**\n**Engineering:** TypeScript\n\n## **PROFESSIONAL EXPERIENCE**\n### **Northstar Labs**\n*Solutions Engineer* | *2024 - Present*\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}\n\n## **EDUCATION**\n### **Example University**\nBachelor of Science\n`),
    writeFile(join(root, "context", "denylist.md"), "# Career Claim Denylist\n"),
    writeFile(join(root, "context", "structured", "work.md"), `# Work\n\n- source_role: direct project notes\n- confidence: high\n\n| Evidence ID | Year | Project | Explicit claim | Scope note | Source locator | Confidence | Public use |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| context:work:api | 2025 | Northstar Labs | Configured and tested API integrations for customer workflows. | Configuration and testing scope. | Notes | high | eligible |\n`),
    writeFile(join(root, "profile", "candidate.json"), JSON.stringify({ schemaVersion: 1, identity: { fullName: "Alex Morgan", artifactPrefix: "Alex_Morgan" }, sources: { baseResumePath: "resumes/base.md" }, career: {}, preferences: { resume: {}, coverLetter: {} }, truth: {}, updatedAt: "2026-11-10T00:00:00.000Z" })),
    writeFile(join(root, "jobs", "sample-role", "job.json"), JSON.stringify({ company: "Sample", title: "Engineer" })),
    writeFile(join(root, "jobs", "sample-role", "original_jd.txt"), "Sample needs API integration and customer workflow experience."),
  ]);
  await buildContextManifest(root, { structuredPaths: ["context/structured/work.md"], broadPaths: [], careerPaths: [], jobPaths: [], jobIds: [] }, { baseResumePath: "resumes/base.md", secondaryResumePaths: [], linkedinProfilePath: null });
  return root;
}

async function writeBundle(root: string, withLetter: boolean): Promise<void> {
  const snapshot = JSON.parse(await readTextFile(join(root, "jobs", "sample-role", ".sensei", "evidence_snapshot.json")));
  const run = JSON.parse(await readFile(join(root, "jobs", "sample-role", ".sensei", "application_run.json"), "utf8"));
  await writeFile(join(root, "jobs", "sample-role", ".sensei", "application_bundle.json"), JSON.stringify({
    schemaVersion: 1, applicationRunId: run.runId, evidenceSnapshotId: snapshot.snapshotId, canonicalBaselineId: snapshot.canonicalResume.baselineId,
    evaluationMarkdown: "# Application Evaluation\n\n### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n| API integration | core | 100% | yes | direct | context:work:api |",
    resume: { skillsLines: [{ text: "**Engineering:** TypeScript", evidenceIds: [] }], employers: [{ name: "Northstar Labs", bullets: Array.from({ length: 10 }, (_, index) => ({ text: `Configured and tested API integration workflow ${index + 1}.`, evidenceIds: ["context:work:api"] })) }] },
    ...(withLetter ? { coverLetter: { date: "November 10, 2026", recipientLines: ["Hiring Manager", "Sample"], salutation: "Dear Hiring Manager,", bodyParagraphs: [{ sentences: [{ text: "I configured and tested API integrations for customer workflows.", evidenceIds: ["context:work:api"] }] }, { sentences: [{ text: "Thank you for your consideration.", evidenceIds: [] }] }], closing: "Sincerely," } } : {}),
    excludedClaims: [], warnings: [],
  }));
}

describe("a run without a letter (Recruiter Edition)", () => {
  it("tells Agy why, writes the resume only, and reports the reason instead of a missing letter", async () => {
    process.env.JOBSENSEI_EDITION = "recruiter";
    const root = await workspace();
    const snapshot = await createEvidenceSnapshot(root, "sample-role");
    expect(snapshot.coverLetterPlan).toMatchObject({ write: false, off: true });
    const context = await readFile(join(root, "jobs", "sample-role", ".sensei", "application_context.json"), "utf8");
    expect(context).not.toContain("coverLetterBrief");
    expect(context).toContain("No cover letter for this job (owner of this rule): Cover letters are turned off for Alex Morgan.");
    await writeBundle(root, true); // a letter Agy wrote anyway is ignored
    const report = await finalizeApplication(root, "sample-role", false);
    expect(report.coverLetterSkipped).toBe("Cover letters are turned off for Alex Morgan.");
    expect(report.issues.map((issue) => issue.code)).not.toContain("COVER_LETTER_MISSING");
    expect(await exists(join(root, "jobs", "sample-role", "cover_letter.md"))).toBe(false);
    expect(await exists(join(root, "jobs", "sample-role", "Alex_Morgan_Sample_Resume.md"))).toBe(true);
    expect(await readFile(join(root, "jobs", "sample-role", "evaluation.md"), "utf8")).toContain("**Not written:** Cover letters are turned off for Alex Morgan.");
  });

  it("still requires a letter in the solo edition", async () => {
    delete process.env.JOBSENSEI_EDITION;
    const root = await workspace();
    const snapshot = await createEvidenceSnapshot(root, "sample-role");
    expect(snapshot.coverLetterPlan?.write).toBe(true);
    expect(await readFile(join(root, "jobs", "sample-role", ".sensei", "application_context.json"), "utf8")).toContain("coverLetterBrief");
    await writeBundle(root, false);
    const report = await finalizeApplication(root, "sample-role", false);
    expect(report.status).toBe("not_ready");
    expect(JSON.stringify(report.issues)).toContain("coverLetter is missing");
  });
});
