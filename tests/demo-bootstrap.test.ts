import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createEvidenceSnapshot } from "../electron/evidence-snapshot";
import { validateJobApplication } from "../electron/application-validation";

async function makeTestWorkspace(): Promise<string> {
  const dir = join(tmpdir(), `sensei-bootstrap-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(dir, "profile"), { recursive: true });
  await mkdir(join(dir, "resumes"), { recursive: true });
  await mkdir(join(dir, "context", "structured"), { recursive: true });
  await mkdir(join(dir, "context", "broad"), { recursive: true });
  await mkdir(join(dir, "jobs", "test-role"), { recursive: true });
  return dir;
}

describe("demo bootstrap and resilience", () => {
  it("auto-bootstraps active-context.json when running createEvidenceSnapshot on a fresh workspace", async () => {
    const workspace = await makeTestWorkspace();
    try {
      await writeFile(join(workspace, "profile", "candidate.json"), JSON.stringify({
        schemaVersion: 1,
        identity: { fullName: "Alex Morgan", artifactPrefix: "Alex_Morgan", links: [] },
        sources: {
          baseResumePath: "resumes/Alex_Morgan_Resume.md",
          secondaryResumePaths: [],
          linkedinProfilePath: null,
          structuredContextRoots: ["context/structured"],
          broadContextRoots: ["context/broad"],
          denylistPath: "context/denylist.md",
          applicationVoicePath: "context/application_voice_profile.md",
        },
        career: { employers: [{ name: "Meridian", title: "Lead Engineer", startDate: "2021-03", endDate: null }], education: [], transitionSummary: "", preferredRoleFamilies: [] },
        preferences: {
          resume: { includeSummary: false, totalExperienceBullets: { min: 4, max: 8 }, currentEmployerBullets: { min: 2, max: 4 }, skillsCategories: [] },
          coverLetter: { storyGuidance: [], voiceGuidance: [] },
        },
        truth: { factualAuthority: "Selected structured career evidence", boundaries: [] },
        updatedAt: new Date().toISOString(),
      }), "utf8");

      await writeFile(join(workspace, "resumes", "Alex_Morgan_Resume.md"), `# ALEX MORGAN
## SKILLS & Languages
**Engineering:** TypeScript, Node.js, Go, REST APIs

## PROFESSIONAL EXPERIENCE
**Meridian** — Lead Engineer
- Architected and scaled TypeScript integration adapters connecting 25 external APIs.
- Diagnosed complex API authentication and schema drift sustaining 99.99% uptime.

## EDUCATION
UC Berkeley — BS EECS
`, "utf8");

      await writeFile(join(workspace, "context", "structured", "meridian.md"), `# Meridian Evidence
- source_role: primary-context-summary-index
- confidence: high

| Evidence ID | Year | Project | Explicit claim | Scope note | Source locator | Confidence | Public use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| context:meridian:adapters | 2021-2026 | Adapters | Architected and scaled TypeScript integration adapters connecting 25 external APIs. | Lead solutions engineer | Spec #1 | high | allowed |
`, "utf8");

      await writeFile(join(workspace, "jobs", "test-role", "original_jd.md"), `# Integrations Engineer
Acme is hiring an Integrations Engineer to connect APIs and sustain partner uptime.
`, "utf8");

      // Verify that .sensei/active-context.json does NOT exist before running snapshot
      const manifestPath = join(workspace, ".sensei", "active-context.json");
      await expect(readFile(manifestPath, "utf8")).rejects.toThrow();

      // createEvidenceSnapshot should auto-bootstrap the manifest without crashing with ENOENT
      const snapshot = await createEvidenceSnapshot(workspace, "test-role");
      expect(snapshot).toBeDefined();
      expect(snapshot.baseResumePath).toBe("resumes/Alex_Morgan_Resume.md");

      // The manifest must now exist on disk
      const generatedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
      expect(generatedManifest.baseResumePath).toBe("resumes/Alex_Morgan_Resume.md");

      // The evidence row with "allowed" should be treated as "eligible"
      const adapterRow = snapshot.evidenceRows.find((row) => row.evidenceId === "context:meridian:adapters");
      expect(adapterRow?.eligibility).toBe("eligible");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("accepts a cover letter opening where candidate, company, and role appear across the first paragraph", async () => {
    const workspace = await makeTestWorkspace();
    try {
      await mkdir(join(workspace, "jobs", "test-role", ".sensei"), { recursive: true });
      await writeFile(join(workspace, "jobs", "test-role", "original_jd.md"), "# Engineer\nPlaid is seeking an Integrations Operations Engineer.", "utf8");
      await writeFile(join(workspace, "jobs", "test-role", ".sensei", "job.json"), JSON.stringify({
        id: "test-role",
        company: "Plaid",
        title: "Integrations Operations Engineer",
      }), "utf8");

      const coverLetter = `**ALEX MORGAN**
Portland, OR

October 2, 2026

Hiring Team
Plaid

Dear Hiring Team,

Over the past eight years, my engineering career has developed from designing core REST services to scaling partner pipelines. I am writing regarding the Integrations Operations Engineer role at Plaid to connect this background to your team.

At Meridian, I led integration engineering across 25 partner APIs.

Sincerely,
Alex Morgan`;

      await writeFile(join(workspace, "jobs", "test-role", "cover_letter.md"), coverLetter, "utf8");

      const status = await validateJobApplication(workspace, "test-role", false);
      const impersonalIssue = status.issues.find((issue) => issue.code === "COVER_LETTER_INTRO_IMPERSONAL");
      expect(impersonalIssue).toBeUndefined();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
